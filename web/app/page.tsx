import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
};

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-24 text-center">
      <div className="text-6xl">🍦</div>
      <h1 className="text-4xl font-bold text-white">
        Matt &amp; Mattingly&apos;s Ice Cream Social
      </h1>
      <p className="max-w-lg text-gray-400">
        Episode guide, transcript search, and fan wiki for the ICS Scoops
        community.
      </p>
      <div className="flex gap-4">
        <Link
          href="/episodes"
          className="rounded-lg bg-brand-500 px-6 py-3 font-semibold text-white hover:bg-brand-600 transition-colors"
        >
          Browse Episodes
        </Link>
        <Link
          href="/search"
          className="rounded-lg border border-gray-700 px-6 py-3 font-semibold text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
        >
          Search Transcripts
        </Link>
      </div>
    </div>
  );
}
