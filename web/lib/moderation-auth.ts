import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";

export interface ModeratorAccessContext {
  supabase: Awaited<ReturnType<typeof createPublicClient>>;
  userId: string;
}

export interface ModeratorAccessResult {
  context: ModeratorAccessContext | null;
  response: NextResponse | null;
}

/**
 * Enforces authenticated moderator/admin access via DB role assignments.
 * Requires RPC function `public.current_user_has_role(text[])`.
 */
export async function requireModeratorAccess(): Promise<ModeratorAccessResult> {
  const supabase = await createPublicClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return {
      context: null,
      response: NextResponse.json({ error: userError.message }, { status: 500 }),
    };
  }

  if (!user) {
    return {
      context: null,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }

  const { error: ensureProfileError } = await supabase.rpc("ensure_profile_for_current_user");
  if (ensureProfileError) {
    return {
      context: null,
      response: NextResponse.json({ error: ensureProfileError.message }, { status: 500 }),
    };
  }

  const { data: isModerator, error: roleError } = await supabase.rpc("current_user_has_role", {
    role_keys: ["admin", "moderator"],
  });

  if (roleError) {
    return {
      context: null,
      response: NextResponse.json({ error: roleError.message }, { status: 500 }),
    };
  }

  if (!isModerator) {
    return {
      context: null,
      response: NextResponse.json({ error: "Moderator role required" }, { status: 403 }),
    };
  }

  return {
    context: { supabase, userId: user.id },
    response: null,
  };
}
