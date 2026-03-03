import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/rag";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const q = url.searchParams.get("q") ?? "";
  const kbId = (url.searchParams.get("kb_id") || "default").trim() || "default";
  const topKParam = url.searchParams.get("top_k");

  if (!q.trim()) {
    return NextResponse.json({ detail: "q is required" }, { status: 400 });
  }

  let topK = 5;
  if (topKParam) {
    const parsed = Number.parseInt(topKParam, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 20) {
      topK = parsed;
    }
  }

  try {
    const results = await search(q, kbId, topK);
    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}

