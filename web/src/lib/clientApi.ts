export interface TokenRequest {
  room_name?: string;
  participant_identity?: string;
  metadata?: { system_prompt?: string; kb_id?: string };
}

export interface TokenResponse {
  token: string;
  url: string;
  room_name: string;
}

export async function getLiveKitToken(req: TokenRequest): Promise<TokenResponse> {
  const res = await fetch("/api/livekit/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail || "Failed to get token");
  }
  return res.json();
}

export interface DocItem {
  doc_id: string;
  filename: string;
}

export async function listDocuments(kbId = "default"): Promise<DocItem[]> {
  const res = await fetch(`/api/documents?kb_id=${encodeURIComponent(kbId)}`);
  if (!res.ok) throw new Error("Failed to list documents");
  const data = await res.json();
  return (data.documents as DocItem[]) || [];
}

export async function uploadDocument(
  file: File,
  kbId = "default",
): Promise<{ doc_id: string; chunks: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/documents/upload?kb_id=${encodeURIComponent(kbId)}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail || "Upload failed");
  }
  return res.json();
}

export async function deleteDocument(docId: string, kbId = "default"): Promise<void> {
  const res = await fetch(
    `/api/documents/${encodeURIComponent(docId)}?kb_id=${encodeURIComponent(kbId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to delete document");
}

