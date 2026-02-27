import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Stub — Full-text search via Postgres tsvector (Phase 2)
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";

  return NextResponse.json(
    {
      query: q,
      results: [],
      total: 0,
      message: "Full-text search coming in Phase 2.",
    },
    { status: 200 }
  );
}
