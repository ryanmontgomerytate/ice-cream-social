import Link from "next/link";
import type { EpisodeCard as EpisodeCardType } from "@/lib/types";
import { formatDuration, formatDate } from "@/lib/types";

const CATEGORY_COLORS: Record<string, string> = {
  episode: "bg-indigo-900/40 text-indigo-300 border-indigo-700",
  fubts: "bg-red-900/40 text-red-300 border-red-700",
  scoopflix: "bg-amber-900/40 text-amber-300 border-amber-700",
  abracababble: "bg-purple-900/40 text-purple-300 border-purple-700",
  shituational: "bg-lime-900/40 text-lime-300 border-lime-700",
  bonus: "bg-gray-800 text-gray-400 border-gray-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  episode: "Episode",
  fubts: "FUBTS",
  scoopflix: "Scoopflix",
  abracababble: "Abracababble",
  shituational: "Shituational",
  bonus: "Bonus",
};

interface Props {
  episode: EpisodeCardType;
}

export default function EpisodeCard({ episode }: Props) {
  const categoryColor =
    CATEGORY_COLORS[episode.category] ?? CATEGORY_COLORS.bonus;
  const categoryLabel =
    CATEGORY_LABELS[episode.category] ?? episode.category;

  return (
    <Link
      href={`/episodes/${episode.id}`}
      className="group flex flex-col gap-2 rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-gray-600 hover:bg-gray-800/80 transition-all"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Category badge */}
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${categoryColor}`}
          >
            {categoryLabel}
          </span>

          {/* Episode number */}
          {episode.episode_number && (
            <span className="text-xs text-gray-500">
              #{episode.episode_number}
            </span>
          )}

          {/* Diarization badge */}
          {episode.has_diarization && (
            <span className="inline-flex items-center rounded border border-teal-800 bg-teal-900/30 px-1.5 py-0.5 text-xs text-teal-400">
              Speakers
            </span>
          )}
        </div>

        {/* Duration */}
        {episode.duration && (
          <span className="shrink-0 text-xs text-gray-500">
            {formatDuration(episode.duration)}
          </span>
        )}
      </div>

      {/* Title */}
      <h2 className="font-semibold text-white leading-snug group-hover:text-brand-400 transition-colors line-clamp-2">
        {episode.title}
      </h2>

      {/* Description */}
      {episode.description && (
        <p className="text-sm text-gray-500 line-clamp-2 leading-relaxed">
          {episode.description}
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto pt-1 text-xs text-gray-600">
        {formatDate(episode.published_date)}
      </div>
    </Link>
  );
}
