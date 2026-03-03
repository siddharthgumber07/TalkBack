import { NextRequest, NextResponse } from "next/server";
import { deleteDocument } from "@/lib/rag";

export const runtime = "nodejs";

type RouteParams = {
  params: {
    doc_id: string;
  };
};

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const kbId = (req.nextUrl.searchParams.get("kb_id") || "default").trim() || "default";
  const docId = params.doc_id;

  if (!docId) {
    return NextResponse.json({ detail: "doc_id is required" }, { status: 400 });
  }

  await deleteDocument(docId, kbId);
  return NextResponse.json({ deleted: docId });
}

