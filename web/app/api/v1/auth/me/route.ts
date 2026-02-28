import { NextResponse } from "next/server";
import { createAdminClient, createPublicClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface AuthMeResponse {
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
  } | null;
  profile: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    is_suspended: boolean;
  } | null;
  roles: string[];
  bootstrap_applied: string[];
}

function parseAllowlist(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function applyBootstrapRolesIfEligible({
  userId,
  email,
  existingRoles,
}: {
  userId: string;
  email: string | null;
  existingRoles: string[];
}): Promise<string[]> {
  const normalizedEmail = email?.trim().toLowerCase() ?? null;
  if (!normalizedEmail) return [];

  const adminAllowlist = parseAllowlist(process.env.PHASE2_BOOTSTRAP_ADMIN_EMAILS);
  const moderatorAllowlist = parseAllowlist(process.env.PHASE2_BOOTSTRAP_MODERATOR_EMAILS);

  const desiredRoles = new Set<string>();

  if (adminAllowlist.has(normalizedEmail)) {
    desiredRoles.add("admin");
    desiredRoles.add("moderator");
  }

  if (moderatorAllowlist.has(normalizedEmail)) {
    desiredRoles.add("moderator");
  }

  const missingRoles = Array.from(desiredRoles).filter((role) => !existingRoles.includes(role));
  if (missingRoles.length === 0) return [];

  const adminSupabase = await createAdminClient();

  const { data: roleRows, error: roleError } = await adminSupabase
    .from("roles")
    .select("id, key")
    .in("key", missingRoles);

  if (roleError) {
    throw new Error(roleError.message);
  }

  const roleIdByKey = new Map((roleRows ?? []).map((row) => [row.key as string, row.id as number]));

  const assignments = missingRoles
    .map((key) => roleIdByKey.get(key))
    .filter((id): id is number => typeof id === "number")
    .map((roleId) => ({
      user_id: userId,
      role_id: roleId,
      assigned_by: userId,
    }));

  if (assignments.length === 0) return [];

  const { error: insertError } = await adminSupabase
    .from("user_role_assignments")
    .upsert(assignments, { onConflict: "user_id,role_id", ignoreDuplicates: true });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return missingRoles;
}

export async function GET() {
  const supabase = await createPublicClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  if (!user) {
    const payload: AuthMeResponse = {
      authenticated: false,
      user: null,
      profile: null,
      roles: [],
      bootstrap_applied: [],
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  }

  const { error: ensureError } = await supabase.rpc("ensure_profile_for_current_user");
  if (ensureError) {
    return NextResponse.json({ error: ensureError.message }, { status: 500 });
  }

  const { data: rolesData, error: rolesError } = await supabase.rpc("current_user_roles");
  if (rolesError) {
    return NextResponse.json({ error: rolesError.message }, { status: 500 });
  }

  const initialRoles = ((rolesData ?? []) as { role_key: string }[])
    .map((row) => row.role_key)
    .filter(Boolean);

  let bootstrapApplied: string[] = [];
  try {
    bootstrapApplied = await applyBootstrapRolesIfEligible({
      userId: user.id,
      email: user.email ?? null,
      existingRoles: initialRoles,
    });
  } catch (bootstrapError) {
    const message =
      bootstrapError instanceof Error ? bootstrapError.message : "Bootstrap role assignment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { data: refreshedRolesData, error: refreshedRolesError } = await supabase.rpc("current_user_roles");
  if (refreshedRolesError) {
    return NextResponse.json({ error: refreshedRolesError.message }, { status: 500 });
  }

  const roles = ((refreshedRolesData ?? []) as { role_key: string }[])
    .map((row) => row.role_key)
    .filter(Boolean);

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, bio, is_suspended")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const payload: AuthMeResponse = {
    authenticated: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
    profile: profileRow
      ? {
          id: profileRow.id,
          username: profileRow.username,
          display_name: profileRow.display_name,
          avatar_url: profileRow.avatar_url,
          bio: profileRow.bio,
          is_suspended: profileRow.is_suspended,
        }
      : null,
    roles,
    bootstrap_applied: bootstrapApplied,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
