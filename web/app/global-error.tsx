"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <main className="mx-auto max-w-2xl px-4 py-20">
          <h1 className="text-2xl font-bold text-white">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-400">
            An unexpected error occurred. It has been captured for debugging.
          </p>
          {error?.digest && (
            <p className="mt-3 text-xs text-gray-500">
              Digest: <code>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
