import { useState, useEffect } from 'react'
import { episodesAPI, queueAPI } from '../services/api'

const formatDuration = (seconds) => {
  if (!seconds) return 'Unknown duration'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

const formatDate = (dateString) => {
  if (!dateString) return null
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return null
  }
}

function getStatusBadges(episode, queueStatus) {
  if (queueStatus?.status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200">
        <span className="w-2 h-2 border border-blue-300 border-t-blue-700 rounded-full animate-spin"></span>
        Processing
      </span>
    )
  }
  if (queueStatus?.status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 border border-yellow-200">
        <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></span>
        Queue #{queueStatus.priority}
      </span>
    )
  }
  if (queueStatus?.status === 'failed' || episode.transcription_status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 border border-red-200">
        Failed
      </span>
    )
  }
  if (episode.is_transcribed) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-200">
        ✓ Transcribed
      </span>
    )
  }
  if (episode.is_downloaded) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200">
        Downloaded
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
      Pending
    </span>
  )
}

export default function EpisodeSidebar({
  selectedEpisodeId,
  onSelectEpisode,
  onNotification
}) {
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [queueMap, setQueueMap] = useState({}) // episodeId -> queue status
  const [feedSource, setFeedSource] = useState('patreon')
  const [sortBy, setSortBy] = useState('published_date')
  const [sortDesc, setSortDesc] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState({
    transcribed_only: false,
    in_queue_only: false,
    limit: 50,
    offset: 0
  })

  // Load episodes
  useEffect(() => {
    loadEpisodes()
  }, [filters, search, feedSource, sortBy, sortDesc])

  // Load queue status
  useEffect(() => {
    loadQueueStatus()
    const interval = setInterval(loadQueueStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const loadEpisodes = async () => {
    try {
      setLoading(true)
      const data = await episodesAPI.getEpisodes({
        ...filters,
        search,
        ...(feedSource !== 'all' ? { feed_source: feedSource } : {}),
        sort_by: sortBy,
        sort_desc: sortDesc
      })
      setEpisodes(data.episodes || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error('Error loading episodes:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadQueueStatus = async () => {
    try {
      const data = await queueAPI.getQueue()
      const queue = data.queue || data
      const map = {}

      // Map processing episodes
      queue.processing?.forEach(item => {
        map[item.episode?.id || item.episode_id] = { status: 'processing' }
      })
      // Map pending episodes with priority
      queue.pending?.forEach((item, idx) => {
        map[item.episode?.id || item.episode_id] = { status: 'pending', priority: idx + 1 }
      })
      // Map failed episodes
      queue.failed?.forEach(item => {
        map[item.episode?.id || item.episode_id] = { status: 'failed' }
      })

      setQueueMap(map)
    } catch (error) {
      console.error('Error loading queue:', error)
    }
  }

  const handleAddToQueue = async (episodeId, priority = 0) => {
    try {
      await queueAPI.addToQueue(episodeId, priority)
      onNotification?.('Added to queue', 'success')
      loadQueueStatus()
    } catch (error) {
      onNotification?.(`Error: ${error.message}`, 'error')
    }
  }

  const handleRemoveFromQueue = async (episodeId) => {
    try {
      await queueAPI.removeFromQueue(episodeId)
      onNotification?.('Removed from queue', 'success')
      loadQueueStatus()
    } catch (error) {
      onNotification?.(`Error: ${error.message}`, 'error')
    }
  }

  const handleLoadMore = () => {
    setFilters(prev => ({ ...prev, offset: prev.offset + prev.limit }))
  }

  const handleSyncFeed = async () => {
    try {
      setRefreshing(true)
      await episodesAPI.refreshFeed(feedSource !== 'all' ? feedSource : 'patreon', false)
      onNotification?.('Feed synced', 'success')
      await loadEpisodes()
    } catch (error) {
      onNotification?.(`Sync error: ${error.message}`, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const sortOptions = [
    { key: 'published_date', label: 'Date' },
    { key: 'title', label: 'Title' },
    { key: 'episode_number', label: 'Ep#' },
    { key: 'has_diarization', label: 'Diarized' },
  ]

  // Count queue items
  const queueCounts = {
    processing: Object.values(queueMap).filter(q => q.status === 'processing').length,
    pending: Object.values(queueMap).filter(q => q.status === 'pending').length,
    failed: Object.values(queueMap).filter(q => q.status === 'failed').length
  }

  return (
    <div className="h-full flex flex-col bg-white border-r border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800">Episodes</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={loadEpisodes}
              disabled={loading}
              title="Reload episodes"
              className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={handleSyncFeed}
              disabled={refreshing}
              title="Sync RSS feed"
              className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-md transition-colors"
            >
              <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search episodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        />

        {/* Queue Summary */}
        <div className="flex gap-2 mt-3 text-xs">
          {queueCounts.processing > 0 && (
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
              {queueCounts.processing} processing
            </span>
          )}
          {queueCounts.pending > 0 && (
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full">
              {queueCounts.pending} pending
            </span>
          )}
          {queueCounts.failed > 0 && (
            <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full">
              {queueCounts.failed} failed
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            onClick={() => setFilters(prev => ({ ...prev, transcribed_only: !prev.transcribed_only, offset: 0 }))}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filters.transcribed_only
                ? 'bg-green-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Transcribed
          </button>
          <button
            onClick={() => setFilters(prev => ({ ...prev, in_queue_only: !prev.in_queue_only, offset: 0 }))}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filters.in_queue_only
                ? 'bg-yellow-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            In Queue
          </button>
          <span className="w-px bg-gray-200 mx-0.5"></span>
          {['patreon', 'apple', 'all'].map(src => (
            <button
              key={src}
              onClick={() => { setFeedSource(src); setFilters(prev => ({ ...prev, offset: 0 })) }}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                feedSource === src
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {src === 'patreon' ? '💎 Patreon' : src === 'apple' ? '🎙️ Apple' : '🌐 All'}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1.5 mt-3">
          <span className="text-[11px] text-gray-500 font-medium">Sort:</span>
          {sortOptions.map(opt => {
            const isActive = sortBy === opt.key
            return (
              <button
                key={opt.key}
                onClick={() => {
                  if (isActive) {
                    setSortDesc(prev => !prev)
                  } else {
                    setSortBy(opt.key)
                    setSortDesc(true)
                  }
                  setFilters(prev => ({ ...prev, offset: 0 }))
                }}
                className={`px-2 py-0.5 text-[11px] rounded-full transition-colors ${
                  isActive
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}{isActive ? (sortDesc ? ' ↓' : ' ↑') : ''}
              </button>
            )
          })}
        </div>

        {/* Results count */}
        {total > 0 && (
          <div className="mt-2 text-[11px] text-gray-400">
            Showing {filters.offset + 1}–{Math.min(filters.offset + episodes.length, total)} of {total}
            {search && <span> matching "<span className="text-gray-600">{search}</span>"</span>}
          </div>
        )}
      </div>

      {/* Episode List */}
      <div className="flex-1 overflow-y-auto">
        {loading && episodes.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            Loading...
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {episodes.map(episode => {
              const queueStatus = queueMap[episode.id]
              const isSelected = selectedEpisodeId === episode.id
              const formattedDate = formatDate(episode.published_date)
              const feedLabel = episode.feed_source === 'patreon' ? '💎 Patreon' : '🎙️ Apple'

              return (
                <div
                  key={episode.id}
                  onClick={() => onSelectEpisode?.(episode)}
                  className={`p-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-purple-50 border-l-4 border-purple-500'
                      : 'hover:bg-gray-50 border-l-4 border-transparent'
                  }`}
                >
                  {/* Title */}
                  <div className="font-medium text-sm text-gray-800 line-clamp-2 mb-1">
                    {episode.title}
                  </div>

                  {/* Meta line: ep number + feed source + date */}
                  <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-1 flex-wrap">
                    {episode.episode_number && (
                      <>
                        <span className="font-medium text-gray-600">Ep. {episode.episode_number}</span>
                        <span>·</span>
                      </>
                    )}
                    <span>{feedLabel}</span>
                    {formattedDate && (
                      <>
                        <span>·</span>
                        <span>{formattedDate}</span>
                      </>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="text-[11px] text-gray-400 mb-1.5">
                    {formatDuration(episode.duration)}
                  </div>

                  {/* Description preview */}
                  {episode.description && (
                    <p className="text-[11px] text-gray-400 line-clamp-2 mb-2 leading-relaxed">
                      {episode.description.replace(/<[^>]*>/g, '')}
                    </p>
                  )}

                  {/* Status + Actions row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {getStatusBadges(episode, queueStatus)}
                    {episode.has_diarization && episode.is_transcribed && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 border border-purple-200">
                        👥 {episode.num_speakers || 2} speakers
                      </span>
                    )}

                    {/* Contextual action buttons */}
                    {episode.is_transcribed && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectEpisode?.(episode)
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors"
                      >
                        View
                      </button>
                    )}
                    {!episode.is_transcribed && episode.is_downloaded && !queueStatus && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAddToQueue(episode.id)
                          }}
                          className="px-2 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded transition-colors"
                        >
                          + Queue
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAddToQueue(episode.id, 10)
                          }}
                          className="px-2 py-0.5 text-[10px] font-medium bg-yellow-400 text-yellow-900 hover:bg-yellow-500 rounded transition-colors"
                          title="Add with high priority"
                        >
                          ⭐ Priority
                        </button>
                      </>
                    )}
                    {queueStatus?.status === 'pending' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveFromQueue(episode.id)
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Load More */}
        {episodes.length < total && (
          <div className="p-4">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="w-full py-2 text-sm text-purple-600 hover:text-purple-800 disabled:opacity-50"
            >
              Load More ({episodes.length} of {total})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
