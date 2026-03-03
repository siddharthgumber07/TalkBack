'use client';

import { useState, useCallback, useEffect } from "react";
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  type DocItem,
} from "@/lib/clientApi";

const KB_ID = "default";

export default function KBUpload() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listDocuments(KB_ID);
      setDocs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(file, KB_ID);
      await loadDocs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (docId: string) => {
    setError(null);
    try {
      await deleteDocument(docId, KB_ID);
      setDocs((prev) => prev.filter((d) => d.doc_id !== docId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <section className="mt-6 flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">Knowledge base</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Upload PDF or text documents. The agent will use them as context when answering during the
          call.
        </p>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-dashed border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          <input
            type="file"
            accept=".pdf,.txt,.md,.markdown"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
          {uploading ? "Uploading…" : "Choose file"}
        </label>
        <button
          type="button"
          onClick={() => void loadDocs()}
          disabled={loading}
          className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          {loading ? "Loading…" : "Refresh list"}
        </button>
      </div>
      <div className="mt-3">
        {docs.length === 0 && !loading ? (
          <p className="text-sm text-zinc-500">
            No documents yet. Upload a file to get started.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {docs.map((d) => (
              <li key={d.doc_id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm text-zinc-800">{d.filename}</span>
                <button
                  type="button"
                  onClick={() => void handleDelete(d.doc_id)}
                  className="text-xs font-medium text-red-500 hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

