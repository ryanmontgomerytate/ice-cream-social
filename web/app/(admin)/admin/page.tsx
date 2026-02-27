import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin" };

// Stub — Admin panel (Phase 3)
export default function AdminPage() {
  return (
    <div className="py-16 text-center text-gray-500">
      <p className="text-4xl mb-4">⚙️</p>
      <h1 className="text-2xl font-bold text-white mb-2">Admin</h1>
      <p>Admin panel coming in Phase 3.</p>
    </div>
  );
}
