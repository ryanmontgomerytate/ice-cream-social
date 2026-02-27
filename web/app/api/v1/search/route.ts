import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { searchTranscriptSegments } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const perPage = parseInt(searchParams.get("per_page") ?? "20", 10);

  try {
    const payload = await searchTranscriptSegments({ q, page, perPage });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
