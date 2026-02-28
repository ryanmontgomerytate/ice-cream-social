"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface AuthMePayload {
  authenticated: boolean;
  user: { id: string; email: string | null } | null;
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

const DEFAULT_AUTH_STATE: AuthMePayload = {
  authenticated: false,
  user: null,
  profile: null,
  roles: [],
  bootstrap_applied: [],
};

export default function LoginPanel() {
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthMePayload>(DEFAULT_AUTH_STATE);

  const refreshAuthState = useCallback(async () => {
    const response = await fetch("/api/v1/auth/me", { cache: "no-store" });
    const payload = (await response.json()) as AuthMePayload | { error?: string };

    if (!response.ok) {
      throw new Error(typeof payload === "object" && payload && "error" in payload ? payload.error ?? "Auth check failed" : "Auth check failed");
    }

    setAuthState(payload as AuthMePayload);
  }, []);

  useEffect(() => {
    refreshAuthState().catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "Failed to load auth state");
    });
  }, [refreshAuthState]);

  const handlePasswordSignIn = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsLoading(false);
      return;
    }

    setMessage("Signed in.");
    await refreshAuthState();
    setIsLoading(false);
  }, [email, password, refreshAuthState, supabase.auth]);

  const handleSignUp = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;

    const { error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setIsLoading(false);
      return;
    }

    setMessage("Signup submitted. Check your email to confirm your account if required.");
    await refreshAuthState();
    setIsLoading(false);
  }, [email, password, refreshAuthState, supabase.auth]);

  const handleMagicLink = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: redirectTo,
      },
    });

    if (otpError) {
      setError(otpError.message);
      setIsLoading(false);
      return;
    }

    setMessage("Magic link sent. Check your inbox.");
    setIsLoading(false);
  }, [email, supabase.auth]);

  const handleSignOut = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setIsLoading(false);
      return;
    }

    setAuthState(DEFAULT_AUTH_STATE);
    setMessage("Signed out.");
    setIsLoading(false);
  }, [supabase.auth]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-6">
        <h1 className="text-2xl font-bold text-white">Sign in</h1>
        <p className="mt-1 text-sm text-gray-400">
          Phase 2 auth for moderator/admin workflows.
        </p>

        <div className="mt-5 grid gap-3">
          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
              placeholder="••••••••"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isLoading || !email.trim() || !password}
            onClick={handlePasswordSignIn}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign in with password
          </button>
          <button
            type="button"
            disabled={isLoading || !email.trim() || !password}
            onClick={handleSignUp}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign up
          </button>
          <button
            type="button"
            disabled={isLoading || !email.trim()}
            onClick={handleMagicLink}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Send magic link
          </button>
          <button
            type="button"
            disabled={isLoading || !authState.authenticated}
            onClick={handleSignOut}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sign out
          </button>
        </div>

        {message && <p className="mt-3 text-sm text-emerald-300">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6">
        <h2 className="text-lg font-semibold text-white">Current session</h2>
        {!authState.authenticated ? (
          <p className="mt-2 text-sm text-gray-400">Not signed in.</p>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-gray-300">
            <p>
              <span className="text-gray-500">User:</span> {authState.user?.email ?? authState.user?.id}
            </p>
            <p>
              <span className="text-gray-500">Display name:</span> {authState.profile?.display_name ?? "-"}
            </p>
            <p>
              <span className="text-gray-500">Roles:</span>{" "}
              {authState.roles.length > 0 ? authState.roles.join(", ") : "none"}
            </p>
            {authState.bootstrap_applied.length > 0 && (
              <p className="text-amber-300">
                Bootstrap applied this session: {authState.bootstrap_applied.join(", ")}
              </p>
            )}
            <a href="/admin" className="inline-block text-sm text-blue-300 underline hover:text-blue-200">
              Open admin dashboard
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
