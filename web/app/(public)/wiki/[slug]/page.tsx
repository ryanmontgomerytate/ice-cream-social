import type { Metadata } from "next";

// Stub — Wiki lore page (Phase 2)

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function WikiPage({ params }: PageProps) {
  const { slug } = await params;

  return (
    <div className="py-16 text-center text-gray-500">
      <p className="text-4xl mb-4">📖</p>
      <h1 className="text-2xl font-bold text-white mb-2">{slug}</h1>
      <p>Wiki pages coming in Phase 2.</p>
    </div>
  );
}
