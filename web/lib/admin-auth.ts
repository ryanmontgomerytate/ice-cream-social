import { NextRequest, NextResponse } from "next/server";

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Minimal admin gate for early Phase 2 endpoints.
 * Accepts either:
 * - `x-admin-key: <ADMIN_API_KEY>`
 * - `Authorization: Bearer <ADMIN_API_KEY>`
 */
export function requireAdminApiKey(request: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_API_KEY?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "Admin API not configured. Set ADMIN_API_KEY on the server environment.",
      },
      { status: 503 }
    );
  }

  const headerKey = request.headers.get("x-admin-key")?.trim();
  const bearer = getBearerToken(request.headers.get("authorization"));
  const provided = headerKey || bearer;

  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
