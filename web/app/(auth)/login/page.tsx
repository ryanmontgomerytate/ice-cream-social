import type { Metadata } from "next";

export const metadata: Metadata = { title: "Login" };

// Stub — Patreon OAuth login (Phase 3)
export default function LoginPage() {
  return (
    <div className="py-16 text-center text-gray-500">
      <p className="text-4xl mb-4">🔐</p>
      <h1 className="text-2xl font-bold text-white mb-2">Login</h1>
      <p>Patreon authentication coming in Phase 3.</p>
    </div>
  );
}
