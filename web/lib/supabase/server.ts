import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  getSupabasePublishableKey,
  getSupabaseSecretKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";

/**
 * Server-side Supabase client for Server Components and API route handlers.
 *
 * Uses the secret key so it bypasses RLS — suitable for import
 * pipeline reads and admin operations. For public page rendering, the
 * publishable-key client respects RLS and is preferred.
 */
export async function createAdminClient() {
  const cookieStore = await cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabaseSecretKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from Server Components where cookies can't be set.
            // Ignore — session refresh happens in middleware.
          }
        },
      },
    }
  );
}

/**
 * Server-side Supabase client using the publishable key (respects RLS).
 * Use this for public-facing server component data fetches.
 */
export async function createPublicClient() {
  const cookieStore = await cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ignore — see note above
          }
        },
      },
    }
  );
}
