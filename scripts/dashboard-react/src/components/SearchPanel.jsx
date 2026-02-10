import { useState, useEffect, useCallback } from 'react'
import { searchAPI, episodesAPI } from '../services/api'

// Helper to get Tauri listen function dynamically
const getTauriListen = async () => {
  try {
    const { listen } = await import('@tauri-apps/api/event')
    return listen
  } catch (e) {
    return null
  }
}

function formatTime(seconds) {
  if (seconds == null) return '--:--'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function SearchPanel({ onNotification, onViewEpisode }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [searchStats, setSearchStats] = useState({ indexed_segments: 0, unindexed_episode_count: 0 })
  const [page, setPage] = useState(0)
  const [indexing, setIndexing] = useState(false)
  const [indexProgress, setIndexProgress] = useState({ current: 0, total: 0 })
  const limit = 25

  useEffect(() => {
    loadSearchStats()
  }, [])

  const loadSearchStats = async () => {
    try {
      const stats = await searchAPI.getSearchStats()
      setSearchStats(stats)
    } catch (error) {
      console.error('Error loading search stats:', error)
    }
  }

  const handleSearch = useCallback(async (resetPage = true) => {
    if (!query.trim()) {
      setResults([])
      setTotal(0)
      return
    }

    setLoading(true)
    if (resetPage) setPage(0)

    try {
      const currentPage = resetPage ? 0 : page
      const response = await searchAPI.searchTranscripts(query.trim(), limit, currentPage * limit)
      setResults(response.results || [])
      setTotal(response.total || 0)
    } catch (error) {
      console.error('Search failed:', error)
      onNotification?.(`Search failed: ${error.message}`, 'error')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, page, limit, onNotification])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch(true)
    }
  }

  const handlePageChange = (newPage) => {
    setPage(newPage)
    // Trigger search with new page
    setTimeout(() => handleSearch(false), 0)
  }

  const handleIndexAll = async () => {
    setIndexing(true)
    setIndexProgress({ current: 0, total: 0, episode_title: '' })

    // Set up event listeners for progress
    let unlisten1 = null
    let unlisten2 = null

    try {
      const listen = await getTauriListen()
      if (listen) {
        unlisten1 = await listen('indexing_progress', (event) => {
          setIndexProgress({
            current: event.payload.current,
            total: event.payload.total,
            episode_title: event.payload.episode_title
          })
        })

        unlisten2 = await listen('indexing_complete', (event) => {
          const { indexed, failed, total } = event.payload
          onNotification?.(`Indexing complete: ${indexed} indexed, ${failed} failed`, indexed > 0 ? 'success' : 'warning')
        })
      }

      onNotification?.('Starting transcript indexing...', 'info')
      const result = await searchAPI.indexAllTranscripts()

      if (result) {
        onNotification?.(`Indexed ${result.indexed} episodes (${result.failed} failed)`, result.indexed > 0 ? 'success' : 'warning')
      }

      await loadSearchStats()
    } catch (error) {
      console.error('Indexing failed:', error)
      onNotification?.(`Indexing failed: ${error.message}`, 'error')
    } finally {
      // Clean up listeners
      if (unlisten1) unlisten1()
      if (unlisten2) unlisten2()
      setIndexing(false)
      setIndexProgress({ current: 0, total: 0, episode_title: '' })
    }
  }

  const handleViewResult = async (result) => {
    // Open the episode transcript at the specific timestamp
    if (onViewEpisode) {
      onViewEpisode(result.episode_id, result.start_time)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Search Transcripts</h2>
            <p className="text-indigo-100 text-sm">
              Search across all episode transcripts with timestamps
            </p>
          </div>
          <div className="text-right text-sm text-indigo-100">
            <div>{searchStats.indexed_segments.toLocaleString()} segments indexed</div>
            {searchStats.unindexed_episode_count > 0 && (
              <div className="text-yellow-200">
                {searchStats.unindexed_episode_count} episodes need indexing
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Search Input */}
        <div className="flex gap-3 mb-6">
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Search for quotes, characters, topics... (e.g., "Sweet Bean" OR "pizza rolls")'
              className="w-full px-4 py-3 pl-11 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-lg"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            onClick={() => handleSearch(true)}
            disabled={loading || !query.trim()}
            className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Search Tips */}
        {results.length === 0 && !loading && !query && (
          <div className="bg-indigo-50 rounded-lg p-4 mb-6">
            <h3 className="font-medium text-indigo-800 mb-2">Search Tips</h3>
            <ul className="text-sm text-indigo-700 space-y-1">
              <li>Use quotes for exact phrases: <code className="bg-indigo-100 px-1 rounded">"Sweet Bean"</code></li>
              <li>Use OR for alternatives: <code className="bg-indigo-100 px-1 rounded">pizza OR burger</code></li>
              <li>Use * for wildcards: <code className="bg-indigo-100 px-1 rounded">Matting*</code></li>
              <li>Use - to exclude: <code className="bg-indigo-100 px-1 rounded">commercial -sponsor</code></li>
            </ul>
          </div>
        )}

        {/* Results Count */}
        {total > 0 && (
          <div className="text-sm text-gray-500 mb-4">
            Found {total.toLocaleString()} results for "{query}"
            {totalPages > 1 && ` (page ${page + 1} of ${totalPages})`}
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-gray-500">Searching transcripts...</div>
          </div>
        ) : results.length === 0 && query ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
            </svg>
            <p>No results found for "{query}"</p>
            <p className="text-sm mt-2">Try different keywords or check if episodes are indexed</p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((result) => (
              <div
                key={result.id}
                className="p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer bg-white"
                onClick={() => handleViewResult(result)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                        Ep {result.episode_number || '?'}
                      </span>
                      <span className="font-medium text-gray-800 truncate">
                        {result.episode_title}
                      </span>
                    </div>
                    {result.speaker && (
                      <span className="text-xs text-gray-500">
                        Speaker: {result.speaker}
                      </span>
                    )}
                  </div>
                  <button
                    className="flex items-center gap-1 px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg text-sm font-medium transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleViewResult(result)
                    }}
                  >
                    <span className="font-mono">{formatTime(result.start_time)}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
                <p
                  className="text-sm text-gray-700 line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: result.snippet || result.text }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 0 || loading}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum
                if (totalPages <= 5) {
                  pageNum = i
                } else if (page < 3) {
                  pageNum = i
                } else if (page > totalPages - 4) {
                  pageNum = totalPages - 5 + i
                } else {
                  pageNum = page - 2 + i
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    disabled={loading}
                    className={`w-8 h-8 rounded ${
                      pageNum === page
                        ? 'bg-indigo-500 text-white'
                        : 'border border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum + 1}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages - 1 || loading}
              className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}

        {/* Indexing Status */}
        {searchStats.unindexed_episode_count > 0 && (
          <div className="mt-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-yellow-800">
                  {searchStats.unindexed_episode_count} episodes need indexing
                </h3>
                <p className="text-sm text-yellow-700">
                  Index transcripts to enable full-text search
                </p>
              </div>
              <button
                onClick={handleIndexAll}
                disabled={indexing}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white rounded-lg font-medium text-sm transition-colors"
              >
                {indexing ? 'Indexing...' : 'Index All'}
              </button>
            </div>
            {indexing && indexProgress.total > 0 && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-yellow-700 mb-1">
                  <span className="truncate flex-1">{indexProgress.episode_title || 'Indexing...'}</span>
                  <span className="ml-2">{indexProgress.current} / {indexProgress.total}</span>
                </div>
                <div className="w-full bg-yellow-200 rounded-full h-2">
                  <div
                    className="bg-yellow-500 h-2 rounded-full transition-all"
                    style={{ width: `${(indexProgress.current / indexProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
