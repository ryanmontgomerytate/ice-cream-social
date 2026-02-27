import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search Transcripts",
  description: "Search across all Ice Cream Social episode transcripts.",
};

// Stub — Transcript FTS search (Phase 2)
export default function SearchPage() {
  return (
    <div className="py-16 text-center text-gray-500">
      <p className="text-4xl mb-4">🔍</p>
      <h1 className="text-2xl font-bold text-white mb-2">Search Transcripts</h1>
      <p>Full-text search coming in Phase 2.</p>
    </div>
  );
}
