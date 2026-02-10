import { useState } from 'react'
import EpisodeCard from './EpisodeCard'

// Pagination component
function Pagination({ currentPage, totalPages, onPageChange, disabled }) {
  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages = []
    const maxVisible = 7 // Show max 7 page numbers

    if (totalPages <= maxVisible) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      // Always show first page
      pages.push(1)

      if (currentPage > 3) {
        pages.push('...')
      }

      // Pages around current
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i)
      }

      if (currentPage < totalPages - 2) {
        pages.push('...')
      }

      // Always show last page
      if (!pages.includes(totalPages)) pages.push(totalPages)
    }

    return pages
  }

  return (
    <div className="mt-8 flex items-center justify-center gap-1">
      {/* Previous */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={disabled || currentPage === 1}
        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 text-gray-600"
      >
        ← Prev
      </button>

      {/* Page Numbers */}
      {getPageNumbers().map((page, idx) => (
        page === '...' ? (
          <span key={`ellipsis-${idx}`} className="px-2 py-2 text-gray-400">...</span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            disabled={disabled}
            className={`min-w-[40px] px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentPage === page
                ? 'bg-coral-500 text-white'
                : 'hover:bg-gray-100 text-gray-600'
            } disabled:opacity-50`}
          >
            {page}
          </button>
        )
      ))}

      {/* Next */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={disabled || currentPage === totalPages}
        className="px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 text-gray-600"
      >
        Next →
      </button>
    </div>
  )
}

export default function EpisodeFeed({
  episodes,
  loading,
  total,
  filters,
  onFilterChange,
  onNotification,
  onEpisodesChange,
  queue
}) {
  const [searchInput, setSearchInput] = useState(filters.search || '')

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    onFilterChange({ search: searchInput })
  }

  const handleSortChange = (sortBy) => {
    onFilterChange({
      sort_by: sortBy,
      sort_desc: filters.sort_by === sortBy ? !filters.sort_desc : true
    })
  }

  const handleFilterToggle = (filterKey) => {
    onFilterChange({ [filterKey]: !filters[filterKey] })
  }

  return (
    <div>
      {/* Filters and Search */}
      <div className="mb-6 space-y-4">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder="Search episodes by title or description..."
            className="flex-1 px-4 py-2 border border-cream-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-coral-500 focus:border-transparent"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button
            type="submit"
            className="px-6 py-2 bg-coral-500 hover:bg-coral-600 text-white rounded-lg font-medium transition-colors"
          >
            Search
          </button>
          {filters.search && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                onFilterChange({ search: '' })
              }}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              Clear
            </button>
          )}
        </form>

        {/* Filter Toggles and Sort */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Filters:</span>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.transcribed_only}
                onChange={() => handleFilterToggle('transcribed_only')}
                className="w-4 h-4 text-coral-500 border-gray-300 rounded focus:ring-coral-400"
              />
              <span className="text-sm text-gray-700">Transcribed Only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.in_queue_only}
                onChange={() => handleFilterToggle('in_queue_only')}
                className="w-4 h-4 text-coral-500 border-gray-300 rounded focus:ring-coral-400"
              />
              <span className="text-sm text-gray-700">In Queue Only</span>
            </label>
          </div>

          <div className="h-6 w-px bg-gray-300"></div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Sort by:</span>
            {['published_date', 'title', 'episode_number', 'has_diarization'].map((sortField) => (
              <button
                key={sortField}
                onClick={() => handleSortChange(sortField)}
                className={`
                  px-3 py-1 rounded-lg text-sm font-medium transition-colors
                  ${filters.sort_by === sortField
                    ? 'bg-coral-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                {sortField === 'published_date' && 'Date'}
                {sortField === 'title' && 'Title'}
                {sortField === 'episode_number' && 'Episode #'}
                {sortField === 'has_diarization' && 'Diarized'}
                {filters.sort_by === sortField && (
                  <span className="ml-1">{filters.sort_desc ? '↓' : '↑'}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Results Count */}
        <div className="text-sm text-gray-600">
          {loading && episodes.length === 0 ? (
            'Loading...'
          ) : (
            <>
              Showing {filters.offset + 1}-{Math.min(filters.offset + episodes.length, total)} of {total.toLocaleString()} episodes
              {filters.search && ` matching "${filters.search}"`}
            </>
          )}
        </div>
      </div>

      {/* Loading State - Only show spinner on initial load */}
      {loading && episodes.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-coral-200 border-t-coral-500 rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-gray-500">Loading episodes...</div>
          </div>
        </div>
      ) : episodes.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-gray-400 text-lg">
            {filters.search || filters.transcribed_only || filters.in_queue_only
              ? 'No episodes found matching your filters'
              : 'No episodes available'}
          </div>
        </div>
      ) : (
        <>
          {/* Episodes Grid */}
          <div className="space-y-3">
            {episodes.map((episode) => (
              <EpisodeCard
                key={episode.id}
                episode={episode}
                onNotification={onNotification}
                onUpdate={onEpisodesChange}
                queue={queue}
              />
            ))}
          </div>

          {/* Pagination */}
          {total > 0 && (
            <Pagination
              currentPage={Math.floor(filters.offset / filters.limit) + 1}
              totalPages={Math.ceil(total / filters.limit)}
              onPageChange={(page) => onFilterChange({ offset: (page - 1) * filters.limit })}
              disabled={loading}
            />
          )}
        </>
      )}
    </div>
  )
}
