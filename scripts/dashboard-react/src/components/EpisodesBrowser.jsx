import { useState, useEffect } from 'react'
import { episodesAPI } from '../services/api'
import EpisodeFeed from './EpisodeFeed'

export default function EpisodesBrowser({ onNotification, refreshKey, queue }) {
  const [activeTab, setActiveTab] = useState('patreon')
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState({
    search: '',
    transcribed_only: false,
    in_queue_only: false,
    sort_by: 'published_date',
    sort_desc: true,
    limit: 20,  // Reduced from 50 to 20 for faster loading and less scrolling
    offset: 0
  })
  const [feedSources, setFeedSources] = useState([])
  const [refreshing, setRefreshing] = useState(false)

  // Load feed sources on mount
  useEffect(() => {
    loadFeedSources()
  }, [])

  // Load episodes when tab or filters change
  useEffect(() => {
    loadEpisodes()
  }, [activeTab, filters])

  // Refresh when refreshKey changes (triggered by queue updates)
  useEffect(() => {
    if (refreshKey > 0) {
      loadEpisodes()
    }
  }, [refreshKey])

  const loadFeedSources = async () => {
    try {
      const sources = await episodesAPI.getFeedSources()
      setFeedSources(sources)
    } catch (error) {
      console.error('Error loading feed sources:', error)
    }
  }

  const loadEpisodes = async () => {
    setLoading(true)
    try {
      const params = {
        ...filters,
        feed_source: activeTab
      }
      const data = await episodesAPI.getEpisodes(params)

      // Replace episodes (for new searches/filters/tab changes)
      setEpisodes(data.episodes || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error('Error loading episodes:', error)
      onNotification?.('Error loading episodes', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshFeed = async () => {
    setRefreshing(true)
    try {
      const result = await episodesAPI.refreshFeed(activeTab, false)

      // In Tauri mode, refresh is synchronous and returns immediately with results
      if (result && typeof result.added !== 'undefined') {
        onNotification?.(
          `Feed refreshed: ${result.added} added, ${result.updated} updated`,
          'success'
        )
        loadEpisodes()
        setRefreshing(false)
      } else {
        // Fallback for HTTP mode - poll for status
        onNotification?.(`Feed refresh started for ${activeTab}`, 'success')

        const checkStatus = async () => {
          const status = await episodesAPI.getRefreshStatus(activeTab)

          if (status.status === 'completed') {
            onNotification?.(
              `Feed refreshed: ${status.added || 0} added, ${status.updated || 0} updated`,
              'success'
            )
            loadEpisodes()
            setRefreshing(false)
          } else if (status.status === 'error') {
            onNotification?.(`Feed refresh failed: ${status.error}`, 'error')
            setRefreshing(false)
          } else if (status.is_refreshing) {
            setTimeout(checkStatus, 2000)
          } else {
            setRefreshing(false)
          }
        }

        setTimeout(checkStatus, 2000)
      }
    } catch (error) {
      onNotification?.(`Error refreshing feed: ${error.message || error}`, 'error')
      setRefreshing(false)
    }
  }

  const handleFilterChange = (newFilters) => {
    setFilters((prev) => {
      // If offset is explicitly provided (pagination), use it
      // Otherwise reset to 0 (filter/search/sort change)
      const newOffset = 'offset' in newFilters ? newFilters.offset : 0
      return {
        ...prev,
        ...newFilters,
        offset: newOffset
      }
    })
  }

  const activeFeedSource = feedSources.find((source) => source.id === activeTab)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-coral-500 to-coral-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Browse Episodes</h2>
          <div className="flex items-center gap-2">
            <span className="text-white/90 text-sm">
              {total.toLocaleString()} episodes
            </span>
            {/* Reload list button - refreshes episode data from database */}
            <button
              onClick={loadEpisodes}
              disabled={loading}
              className="px-3 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              title="Reload episode list from database (updates transcription status)"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reload
            </button>
            {/* Fetch new episodes from RSS feed */}
            <button
              onClick={handleRefreshFeed}
              disabled={refreshing || !activeFeedSource?.enabled}
              className="px-3 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              title="Check RSS feed for new episodes"
            >
              {refreshing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Syncing...
                </>
              ) : (
                <>Sync Feed</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Queue Summary Bar */}
      {queue && (queue.processing?.length > 0 || queue.pending?.length > 0 || queue.failed?.length > 0) && (
        <div className="px-6 py-2 bg-gradient-to-r from-yellow-50 to-orange-50 border-b border-yellow-200 flex items-center gap-4 text-sm">
          <span className="font-medium text-gray-700">Queue:</span>
          {queue.processing?.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              {queue.processing.length} processing
            </span>
          )}
          {queue.pending?.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              {queue.pending.length} pending
            </span>
          )}
          {queue.failed?.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-100 text-red-700 rounded-full">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              {queue.failed.length} failed
            </span>
          )}
          {queue.completed?.length > 0 && (
            <span className="text-green-600 text-xs">
              {queue.completed.length} recently completed
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-cream-200 bg-cream-50">
        <div className="flex">
          {feedSources.map((source) => (
            <button
              key={source.id}
              onClick={() => setActiveTab(source.id)}
              disabled={!source.enabled}
              className={`
                flex-1 px-6 py-4 font-medium text-sm transition-colors relative
                ${activeTab === source.id
                  ? 'text-coral-600 bg-white'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-cream-100'
                }
                ${!source.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg">{source.icon}</span>
                <span>{source.name}</span>
                {!source.enabled && (
                  <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                    Coming Soon
                  </span>
                )}
              </div>
              {activeTab === source.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-coral-500"></div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Episode Feed */}
      <div className="p-6">
        <EpisodeFeed
          episodes={episodes}
          loading={loading}
          total={total}
          filters={filters}
          onFilterChange={handleFilterChange}
          onNotification={onNotification}
          onEpisodesChange={loadEpisodes}
          queue={queue}
        />
      </div>
    </div>
  )
}
