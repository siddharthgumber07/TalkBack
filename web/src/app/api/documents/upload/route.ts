import { NextRequest, NextResponse } from "next/server";
import { ingestFile } from "@/lib/rag";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const kbId = (req.nextUrl.searchParams.get("kb_id") || "default").trim() || "default";

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ detail: "file is required" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const { docId, numChunks } = await ingestFile(buffer, file.name || "document", kbId);
    return NextResponse.json({
      doc_id: docId,
      filename: file.name,
      chunks: numChunks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

