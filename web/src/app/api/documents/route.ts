import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/rag";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const kbId = (req.nextUrl.searchParams.get("kb_id") || "default").trim() || "default";
  const documents = await listDocuments(kbId);
  return NextResponse.json({ documents });
}

