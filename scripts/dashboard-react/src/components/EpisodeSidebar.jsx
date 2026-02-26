import { useState, useEffect, useCallback } from 'react'
import { episodesAPI, queueAPI } from '../services/api'

// --- Recently-viewed helpers ---
const RECENT_KEY = 'ics_recent_episodes'
const MAX_RECENT = 25

const readRecent = () => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
const recordRecent = (episodeId) => {
  const list = readRecent().filter(id => id !== episodeId)
  list.unshift(episodeId)
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
}

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
  const badges = []
  const isFailed = queueStatus?.status === 'failed' || episode.transcription_status === 'failed'

  // Failed badge - always show if failed, regardless of queue state
  if (isFailed) {
    const errorMsg = episode.transcription_error || ''
    const isDownloadFail = errorMsg.toLowerCase().includes('download')
    const isDiarizeFail = queueStatus?.queue_type === 'diarize_only'
    const label = isDownloadFail ? 'Download Failed' : isDiarizeFail ? 'Diarization Failed' : 'Failed'
    badges.push(
      <span key="failed" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 border border-red-200" title={errorMsg}>
        {label}
      </span>
    )
  }

  // Queue/processing badge
  if (queueStatus?.status === 'processing') {
    badges.push(
      <span key="processing" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200">
        <span className="w-2 h-2 border border-blue-300 border-t-blue-700 rounded-full animate-spin"></span>
        Processing
      </span>
    )
  } else if (queueStatus?.status === 'pending') {
    badges.push(
      <span key="queued" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 border border-yellow-200">
        <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse"></span>
        Queue #{queueStatus.priority}
      </span>
    )
  }

  // Status badge (only if not already showing a badge above)
  if (badges.length === 0) {
    if (episode.is_transcribed) {
      badges.push(
        <span key="transcribed" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-200">
          ✓ Transcribed
        </span>
      )
    } else if (episode.is_downloaded) {
      badges.push(
        <span key="downloaded" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200">
          Downloaded
        </span>
      )
    } else {
      badges.push(
        <span key="pending" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
          Pending
        </span>
      )
    }
  }

  // Pending-work badges (shown in addition to status badges)
  if (episode.unresolved_flag_count > 0) {
    badges.push(
      <span key="flags" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200" title="Unresolved flags — needs review">
        🚩 {episode.unresolved_flag_count}
      </span>
    )
  }
  if (episode.pending_correction_count > 0) {
    badges.push(
      <span key="corrections" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 border border-violet-200" title="Pending Scoop Polish corrections — needs approval">
        ✏️ {episode.pending_correction_count}
      </span>
    )
  }

  return <>{badges}</>
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
  const [failedEpisodeCount, setFailedEpisodeCount] = useState(0)
  const [feedSource, setFeedSource] = useState(null) // null = all feeds
  const [category, setCategory] = useState(null) // null = all categories (no filter)
  const [categoryRules, setCategoryRules] = useState([])
  const [sortBy, setSortBy] = useState('published_date')
  const [sortDesc, setSortDesc] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState({
    transcribed_only: false,
    in_queue_only: false,
    failed_only: false,
    downloaded_only: false,
    not_downloaded_only: false,
    diarized_only: false,
    has_pending_work_only: false,
    limit: 50,
    offset: 0
  })
  const [recentOnly, setRecentOnly] = useState(false)
  const [recentIds, setRecentIds] = useState(() => readRecent())
  const [recentEpisodes, setRecentEpisodes] = useState([])

  // Load category rules on mount
  useEffect(() => {
    episodesAPI.getCategoryRules().then(rules => {
      if (rules && rules.length > 0) {
        setCategoryRules(rules)
      }
    }).catch(e => console.error('Failed to load category rules:', e))
  }, [])

  // Load episodes
  useEffect(() => {
    loadEpisodes()
  }, [filters, search, feedSource, category, sortBy, sortDesc])

  // Load queue status
  useEffect(() => {
    loadQueueStatus()
    const interval = setInterval(loadQueueStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  // Record whenever an episode is opened (via prop from parent)
  useEffect(() => {
    if (!selectedEpisodeId) return
    recordRecent(selectedEpisodeId)
    setRecentIds(readRecent())
  }, [selectedEpisodeId])

  // Fetch recent episodes when recent-only mode is active
  useEffect(() => {
    if (!recentOnly) return
    const ids = readRecent()
    Promise.all(ids.map(id => episodesAPI.getEpisode(id).catch(() => null)))
      .then(results => {
        // keep the order from localStorage (most recent first), drop nulls
        setRecentEpisodes(results.filter(Boolean))
      })
  }, [recentOnly, recentIds])

  const loadEpisodes = async () => {
    try {
      setLoading(true)
      const data = await episodesAPI.getEpisodes({
        ...filters,
        search,
        ...(feedSource ? { feed_source: feedSource } : {}),
        ...(category ? { category } : {}),
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
        map[item.episode?.id || item.episode_id] = { status: 'processing', queue_type: item.queue_item?.queue_type || 'full' }
      })
      // Map pending episodes with priority
      queue.pending?.forEach((item, idx) => {
        map[item.episode?.id || item.episode_id] = { status: 'pending', priority: idx + 1, queue_type: item.queue_item?.queue_type || 'full' }
      })
      // Map failed episodes
      queue.failed?.forEach(item => {
        map[item.episode?.id || item.episode_id] = { status: 'failed', queue_type: item.queue_item?.queue_type || 'full' }
      })

      setQueueMap(map)

      // Also count episodes with failed transcription_status (may not be in queue anymore)
      const failedData = await episodesAPI.getEpisodes({ failed_only: true, limit: 1, offset: 0 })
      setFailedEpisodeCount(failedData.total || 0)
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

  const currentPage = Math.floor(filters.offset / filters.limit) + 1
  const totalPages = Math.ceil(total / filters.limit)

  const goToPage = (page) => {
    setFilters(prev => ({ ...prev, offset: (page - 1) * prev.limit }))
  }

  const handleSyncFeed = async () => {
    try {
      setRefreshing(true)
      await episodesAPI.refreshFeed(feedSource || 'patreon', false)
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
  ]

  // Count queue items split by type
  const queueValues = Object.values(queueMap)
  const queueCounts = {
    processing: queueValues.filter(q => q.status === 'processing').length,
    queueFailed: queueValues.filter(q => q.status === 'failed').length,
    transcriptionPending: queueValues.filter(q => q.status === 'pending' && q.queue_type !== 'diarize_only').length,
    diarizationPending: queueValues.filter(q => q.status === 'pending' && q.queue_type === 'diarize_only').length,
  }
  // Total failed = episodes with failed status (includes those no longer in queue)
  const totalFailed = Math.max(failedEpisodeCount, queueCounts.queueFailed)

  return (
    <div className="h-full flex flex-col bg-white border-r border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800">Library</h2>
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

        {/* Status Filters */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <span className="text-[11px] text-gray-500 font-medium">Status:</span>
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
            onClick={() => setFilters(prev => ({ ...prev, diarized_only: !prev.diarized_only, offset: 0 }))}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filters.diarized_only
                ? 'bg-purple-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Diarized
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
          <button
            onClick={() => setFilters(prev => ({ ...prev, downloaded_only: !prev.downloaded_only, not_downloaded_only: false, offset: 0 }))}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filters.downloaded_only
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Downloaded
          </button>
          <button
            onClick={() => setFilters(prev => ({ ...prev, not_downloaded_only: !prev.not_downloaded_only, downloaded_only: false, offset: 0 }))}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filters.not_downloaded_only
                ? 'bg-gray-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Not Downloaded
          </button>
          {totalFailed > 0 && (
            <button
              onClick={() => setFilters(prev => ({ ...prev, failed_only: !prev.failed_only, offset: 0 }))}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                filters.failed_only
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Failed
            </button>
          )}
          <button
            onClick={() => setFilters(prev => ({ ...prev, has_pending_work_only: !prev.has_pending_work_only, offset: 0 }))}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              filters.has_pending_work_only
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Show episodes with unresolved flags or pending corrections"
          >
            Needs Review
          </button>
        </div>

        {/* Source */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="text-[11px] text-gray-500 font-medium">Source:</span>
          {[null, 'patreon', 'apple'].map(src => (
            <button
              key={src || 'all'}
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

        {/* Category */}
        {categoryRules.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[11px] text-gray-500 font-medium">Category:</span>
            <button
              onClick={() => { setCategory(null); setFilters(prev => ({ ...prev, offset: 0 })) }}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                category === null
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {categoryRules.filter(r => r.priority < 99).map(rule => (
              <button
                key={rule.category}
                onClick={() => { setCategory(rule.category); setFilters(prev => ({ ...prev, offset: 0 })) }}
                className={`px-2 py-1 text-xs rounded-full transition-colors ${
                  category === rule.category
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={category === rule.category ? { backgroundColor: rule.color || '#6366f1' } : {}}
              >
                {rule.icon} {rule.display_name}
              </button>
            ))}
            <button
              onClick={() => { setCategory('bonus'); setFilters(prev => ({ ...prev, offset: 0 })) }}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${
                category === 'bonus'
                  ? 'bg-gray-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              🎁 Bonus
            </button>
          </div>
        )}

        {/* Sort + Recent */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="text-[11px] text-gray-500 font-medium">Sort:</span>
          <button
            onClick={() => {
              setRecentOnly(prev => !prev)
              setFilters(prev => ({ ...prev, offset: 0 }))
            }}
            className={`px-2 py-0.5 text-[11px] rounded-full transition-colors ${
              recentOnly
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Show recently opened episodes"
          >
            🕐 Recent
          </button>
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

        {/* Recent mode count */}
        {recentOnly && recentEpisodes.length > 0 && (
          <div className="text-[11px] text-orange-600 mt-2">
            {recentEpisodes.length} recently opened · most recent first
          </div>
        )}

        {/* Pagination */}
        {!recentOnly && total > 0 && (
          <div className="flex items-center justify-between mt-3">
            <div className="text-[11px] text-gray-400">
              {filters.offset + 1}–{Math.min(filters.offset + episodes.length, total)} of {total}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1 || loading}
                  className="px-1.5 py-0.5 text-[11px] rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ‹
                </button>
                <span className="text-[11px] text-gray-500 px-1">{currentPage} / {totalPages}</span>
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages || loading}
                  className="px-1.5 py-0.5 text-[11px] rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Episode List */}
      <div className="flex-1 overflow-y-auto">
        {recentOnly && recentEpisodes.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">
            <div className="text-2xl mb-2">🕐</div>
            <p>No recently opened episodes yet.</p>
            <p className="text-xs mt-1">Episodes you view will appear here.</p>
          </div>
        ) : loading && episodes.length === 0 && !recentOnly ? (
          <div className="p-4 text-center text-gray-500">
            <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            Loading...
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {(recentOnly ? recentEpisodes : episodes).map(episode => {
              const queueStatus = queueMap[episode.id]
              const isSelected = selectedEpisodeId === episode.id
              const formattedDate = formatDate(episode.published_date)
              const categoryRule = categoryRules.find(r => r.category === episode.category)
              const categoryBadge = categoryRule ? `${categoryRule.icon || ''} ${categoryRule.display_name}` : null
              const feedIcon = episode.feed_source === 'patreon' ? '💎' : '🎙️'

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

                  {/* Meta line: category badge + ep number + feed + date */}
                  <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-1 flex-wrap">
                    {categoryBadge && episode.category !== 'episode' && (
                      <>
                        <span className="font-medium px-1 py-0 rounded text-[10px]" style={{ backgroundColor: (categoryRule?.color || '#6366f1') + '20', color: categoryRule?.color || '#6366f1' }}>
                          {categoryBadge}
                        </span>
                        <span>·</span>
                      </>
                    )}
                    {(episode.category_number || episode.episode_number) && (
                      <>
                        <span className="font-medium text-gray-600">
                          {episode.category === 'episode' ? 'Ep.' : '#'} {episode.category_number || episode.episode_number}
                        </span>
                        <span>·</span>
                      </>
                    )}
                    <span>{feedIcon}</span>
                    {formattedDate && (
                      <>
                        <span>·</span>
                        <span>{formattedDate}</span>
                      </>
                    )}
                    {episode.sub_series && (
                      <>
                        <span>·</span>
                        <span className="italic text-gray-400">{episode.sub_series}</span>
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

        {/* Bottom Pagination */}
        {!recentOnly && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 p-2 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={() => goToPage(1)}
              disabled={currentPage <= 1 || loading}
              className="px-1.5 py-1 text-[11px] rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              «
            </button>
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              className="px-1.5 py-1 text-[11px] rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ‹ Prev
            </button>
            <span className="text-[11px] text-gray-500 px-2">{currentPage} / {totalPages}</span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages || loading}
              className="px-1.5 py-1 text-[11px] rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next ›
            </button>
            <button
              onClick={() => goToPage(totalPages)}
              disabled={currentPage >= totalPages || loading}
              className="px-1.5 py-1 text-[11px] rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              »
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
