import type { Metadata } from "next";

// Stub — Episode detail page (Phase 2)

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Episode ${id}` };
}

export default async function EpisodeDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="py-16 text-center text-gray-500">
      <p className="text-4xl mb-4">🍦</p>
      <h1 className="text-2xl font-bold text-white mb-2">Episode {id}</h1>
      <p>Full episode detail page coming in Phase 2.</p>
    </div>
  );
}
