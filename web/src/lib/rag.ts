import OpenAI from "openai";
import { CloudClient, IncludeEnum, type Collection } from "chromadb";
import crypto from "node:crypto";

const EMBEDDING_MODEL = "text-embedding-3-small";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const DEFAULT_KB_ID = "default";

type ChunkMetadata = {
  docId: string;
  filename: string;
  chunkIndex: number;
};

let openaiClient: OpenAI | null = null;
let chromaClient: CloudClient | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getChromaClient(): CloudClient {
  if (!chromaClient) {
    const apiKey = process.env.CHROMA_API_KEY;
    if (!apiKey) {
      throw new Error("CHROMA_API_KEY is not set");
    }
    chromaClient = new CloudClient({
      apiKey,
      tenant: process.env.CHROMA_TENANT,
      database: process.env.CHROMA_DATABASE,
    });
  }
  return chromaClient;
}

async function getKbCollection(kbId: string = DEFAULT_KB_ID): Promise<Collection> {
  const client = getChromaClient();
  const name = `kb_${kbId}`;

  try {
    return await client.getCollection({ name });
  } catch {
    return client.createCollection({ name });
  }
}

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + chunkSize, trimmed.length);

    if (end < trimmed.length) {
      const separators = ["\n\n", "\n", ". ", " "];
      for (const sep of separators) {
        const idx = trimmed.lastIndexOf(sep, end);
        if (idx > start) {
          end = idx + sep.length;
          break;
        }
      }
    }

    const chunk = trimmed.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= trimmed.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function extractTextFromBuffer(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    // pdf-parse v2 exposes a PDFParse class for parsing PDFs.
    const pdfModule = await import("pdf-parse");
    const PDFParse = (pdfModule as any).PDFParse;
    if (!PDFParse) {
      throw new Error("Failed to load PDFParse from pdf-parse");
    }
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return (result as any)?.text ?? "";
  }
  return buffer.toString("utf8");
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getOpenAI();
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  // Ensure order by index
  const sorted = [...res.data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding as number[]);
}

export async function ingestFile(
  buffer: Buffer,
  filename: string,
  kbId: string = DEFAULT_KB_ID,
): Promise<{ docId: string; numChunks: number }> {
  const text = (await extractTextFromBuffer(buffer, filename)).trim();
  if (!text) {
    throw new Error(`No text extracted from ${filename}`);
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(`No chunks produced from ${filename}`);
  }

  const embeddings = await embedTexts(chunks);
  const docId = crypto.randomUUID();
  const collection = await getKbCollection(kbId);

  const ids = chunks.map((_, index) => `${docId}_${index}`);
  const metadatas: ChunkMetadata[] = chunks.map((_, index) => ({
    docId,
    filename,
    chunkIndex: index,
  }));

  await collection.add({
    ids,
    embeddings,
    documents: chunks,
    metadatas,
  });

  return { docId, numChunks: chunks.length };
}

export async function search(
  query: string,
  kbId: string = DEFAULT_KB_ID,
  topK: number = 5,
): Promise<Array<{ content: string; metadata: Record<string, unknown> }>> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [queryEmbedding] = await embedTexts([trimmed]);
  const collection = await getKbCollection(kbId);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: topK,
    include: ["documents", "metadatas"] as IncludeEnum[],
  });

  const documents = (results.documents?.[0] ?? []) as string[];
  const metadatas = (results.metadatas?.[0] ?? []) as ChunkMetadata[];

  return documents.map(
    (content: string, index: number): { content: string; metadata: Record<string, unknown> } => {
      const meta = metadatas[index];
      return {
        content,
        metadata: {
          doc_id: meta?.docId,
          filename: meta?.filename,
          chunk_index: meta?.chunkIndex ?? index,
          kb_id: kbId,
        },
      };
    },
  );
}

export async function listDocuments(
  kbId: string = DEFAULT_KB_ID,
): Promise<Array<{ doc_id: string; filename: string }>> {
  const collection = await getKbCollection(kbId);
  const records = await collection.get({
    include: ["metadatas"] as IncludeEnum[],
    // Chroma Cloud free tier has a relatively low per-request limit,
    // so keep this comfortably under that quota.
    limit: 250,
  });

  const docs = new Map<string, string>();

  for (const meta of (records.metadatas ?? []) as ChunkMetadata[]) {
    if (!meta.docId || !meta.filename) continue;
    if (!docs.has(meta.docId)) {
      docs.set(meta.docId, meta.filename);
    }
  }

  return Array.from(docs.entries()).map(([doc_id, filename]) => ({
    doc_id,
    filename,
  }));
}

export async function deleteDocument(docId: string, kbId: string = DEFAULT_KB_ID): Promise<void> {
  const collection = await getKbCollection(kbId);
  await collection.delete({
    where: { docId },
  });
}

