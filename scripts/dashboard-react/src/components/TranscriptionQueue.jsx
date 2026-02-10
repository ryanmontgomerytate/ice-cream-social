import { useState, useEffect } from 'react'
import { queueAPI, episodesAPI } from '../services/api'

export default function TranscriptionQueue({ onNotification, onViewTranscript }) {
  const [queue, setQueue] = useState({
    pending: [],
    processing: [],
    completed: [],
    failed: []
  })
  const [status, setStatus] = useState({
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    total: 0
  })
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState(null)
  const [stopping, setStopping] = useState(false)
  const [retrying, setRetrying] = useState(null)
  const [downloading, setDownloading] = useState(null)

  useEffect(() => {
    loadQueue()
    const interval = setInterval(loadQueue, 5000) // Refresh every 5 seconds
    return () => clearInterval(interval)
  }, [])

  const loadQueue = async () => {
    try {
      const [queueData, statusData] = await Promise.all([
        queueAPI.getQueue(),
        queueAPI.getStatus()
      ])
      setQueue(queueData.queue || {
        pending: [],
        processing: [],
        completed: [],
        failed: []
      })
      setStatus(statusData)
      setLoading(false)
    } catch (error) {
      console.error('Error loading queue:', error)
      setLoading(false)
    }
  }

  const handleRemoveFromQueue = async (episodeId) => {
    setRemoving(episodeId)
    try {
      await queueAPI.removeFromQueue(episodeId)
      onNotification?.('Episode removed from queue', 'success')
      loadQueue()
    } catch (error) {
      onNotification?.(`Error removing episode: ${error.message}`, 'error')
    } finally {
      setRemoving(null)
    }
  }

  const handleStopCurrent = async () => {
    setStopping(true)
    try {
      await queueAPI.stopCurrent()
      onNotification?.('Stopping current transcription...', 'success')
      loadQueue()
    } catch (error) {
      onNotification?.(`Error stopping transcription: ${error.message}`, 'error')
    } finally {
      setStopping(false)
    }
  }

  const handleRetry = async (episodeId) => {
    setRetrying(episodeId)
    try {
      await queueAPI.retryTranscription(episodeId)
      onNotification?.('Episode queued for retry', 'success')
      loadQueue()
    } catch (error) {
      onNotification?.(`Error retrying transcription: ${error.message}`, 'error')
    } finally {
      setRetrying(null)
    }
  }

  const handleDownload = async (episodeId) => {
    setDownloading(episodeId)
    try {
      await episodesAPI.downloadEpisode(episodeId)
      onNotification?.('Episode downloaded successfully', 'success')
      loadQueue()
    } catch (error) {
      onNotification?.(`Error downloading episode: ${error.message}`, 'error')
    } finally {
      setDownloading(null)
    }
  }

  const formatDuration = (seconds) => {
    if (!seconds) return ''
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  // Format relative time (e.g., "2 minutes ago")
  const formatRelativeTime = (isoString) => {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      const now = new Date()
      const diffMs = now - date
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      return `${diffDays}d ago`
    } catch {
      return ''
    }
  }

  // Compact item for Recently Completed
  const CompletedItem = ({ item }) => {
    const { episode, queue_item } = item

    return (
      <div className="flex items-center justify-between py-2 px-3 bg-green-50 border border-green-100 rounded-lg">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-green-500 text-sm">✓</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 text-sm truncate">{episode.title}</div>
            <div className="text-xs text-gray-500">
              {formatRelativeTime(queue_item?.completed_date)}
            </div>
          </div>
        </div>
        <button
          onClick={() => onViewTranscript?.(episode.id)}
          className="flex-shrink-0 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg font-medium text-xs transition-colors flex items-center gap-1"
        >
          📄 View
        </button>
      </div>
    )
  }

  const QueueItem = ({ item, type, onRemove, onRetry, onDownload }) => {
    const { episode, queue_item } = item
    const isRemoving = removing === episode.id
    const isRetrying = retrying === episode.id
    const isDownloading = downloading === episode.id

    // Get source icon and label
    const getSourceInfo = (source) => {
      const sources = {
        'patreon': { icon: '💎', label: 'Patreon', color: 'text-orange-600' },
        'apple': { icon: '🎙️', label: 'Apple Podcasts', color: 'text-purple-600' },
        'local': { icon: '📁', label: 'Local File', color: 'text-blue-600' }
      }
      return sources[source] || { icon: '📄', label: source || 'Unknown', color: 'text-gray-600' }
    }

    const sourceInfo = getSourceInfo(episode.feed_source)

    return (
      <div className={`border rounded-lg p-4 hover:shadow-sm transition-shadow ${
        type === 'failed' ? 'bg-red-50 border-red-200' :
        type === 'processing' ? 'bg-blue-50 border-blue-200' :
        type === 'completed' ? 'bg-green-50 border-green-200' :
        'bg-white border-cream-200'
      }`}>
        <div className="flex items-start gap-3">
          {/* Priority Badge (only for pending) */}
          {type === 'pending' && (
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-sm">
              <div className="text-white font-bold text-sm">{queue_item?.priority || 0}</div>
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Title */}
            <h4 className="font-medium text-gray-900">{episode.title}</h4>

            {/* Info row - compact for pending/processing */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
              {episode.episode_number && <span>Ep #{episode.episode_number}</span>}
              {episode.duration && <span>{formatDuration(episode.duration)}</span>}
              <span className={sourceInfo.color}>{sourceInfo.icon} {sourceInfo.label}</span>
              {!episode.is_downloaded && (
                <span className="text-red-500 text-xs">Not downloaded</span>
              )}
            </div>

            {/* Error Message (for failed) */}
            {type === 'failed' && queue_item?.error_message && (
              <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded">
                <div className="text-xs font-semibold text-red-700 mb-1">Error:</div>
                <div className="text-sm text-red-900">{queue_item.error_message}</div>
                <div className="text-xs text-red-600 mt-1">
                  Retries: {queue_item.retry_count || 0}/3
                </div>
              </div>
            )}

            {/* Processing indicator */}
            {type === 'processing' && (
              <div className="mt-2 text-blue-600 font-medium flex items-center gap-2 text-sm">
                <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
                <span>Processing...</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-3 flex gap-2">
              {/* View Transcript Button (if transcribed) */}
              {episode.is_transcribed && onViewTranscript && (
                <button
                  onClick={() => onViewTranscript(episode.id)}
                  className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg font-medium text-xs transition-colors flex items-center gap-1"
                  title="View transcript"
                >
                  📄 View Transcript
                </button>
              )}

              {/* Remove Button (for pending only - don't show for processing or completed) */}
              {type === 'pending' && onRemove && (
                <button
                  onClick={() => onRemove(episode.id)}
                  disabled={isRemoving}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-red-100 text-gray-700 hover:text-red-700 rounded-lg font-medium text-xs transition-colors disabled:opacity-50 flex items-center gap-1"
                  title="Remove from queue"
                >
                  {isRemoving ? (
                    <>
                      <div className="w-3 h-3 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin"></div>
                      Removing...
                    </>
                  ) : (
                    <>✕ Remove</>
                  )}
                </button>
              )}

              {/* Retry Button (for failed) */}
              {type === 'failed' && onRetry && (
                <button
                  onClick={() => onRetry(episode.id)}
                  disabled={isRetrying}
                  className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg font-medium text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  title="Retry transcription"
                >
                  {isRetrying ? (
                    <>
                      <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-700 rounded-full animate-spin"></div>
                      Retrying...
                    </>
                  ) : (
                    <>↻ Retry</>
                  )}
                </button>
              )}

              {/* Download First Button (if not downloaded) */}
              {type === 'failed' && !episode.is_downloaded && episode.audio_url && onDownload && (
                <button
                  onClick={() => onDownload(episode.id)}
                  disabled={isDownloading}
                  className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg font-medium text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  title="Download episode first"
                >
                  {isDownloading ? (
                    <>
                      <div className="w-3 h-3 border-2 border-amber-300 border-t-amber-700 rounded-full animate-spin"></div>
                      Downloading...
                    </>
                  ) : (
                    <>⬇ Download</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Transcription Queue</h2>
          <div className="flex items-center gap-2 text-white/90 text-sm">
            <span className="px-3 py-1 bg-white/20 rounded-lg font-medium">
              {status.total} total
            </span>
          </div>
        </div>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-4 gap-4 p-6 bg-cream-50 border-b border-cream-200">
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-600">{status.pending}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{status.processing}</div>
          <div className="text-sm text-gray-600">Processing</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{status.completed}</div>
          <div className="text-sm text-gray-600">Completed</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">{status.failed}</div>
          <div className="text-sm text-gray-600">Failed</div>
        </div>
      </div>

      {/* Queue Content */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-500 rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Processing */}
            {queue.processing && queue.processing.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    Currently Processing
                  </h3>
                  <button
                    onClick={handleStopCurrent}
                    disabled={stopping}
                    className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {stopping ? (
                      <>
                        <div className="w-4 h-4 border-2 border-red-300 border-t-red-700 rounded-full animate-spin"></div>
                        Stopping...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                        </svg>
                        Stop
                      </>
                    )}
                  </button>
                </div>
                <div className="space-y-2">
                  {queue.processing.map((item, idx) => (
                    <QueueItem key={idx} item={item} type="processing" />
                  ))}
                </div>
              </div>
            )}

            {/* Pending */}
            {queue.pending && queue.pending.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  Pending ({queue.pending.length})
                </h3>
                <div className="space-y-2">
                  {queue.pending.map((item, idx) => (
                    <QueueItem
                      key={idx}
                      item={item}
                      type="pending"
                      onRemove={handleRemoveFromQueue}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed (last 3, compact) */}
            {queue.completed && queue.completed.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  Recently Completed ({queue.completed.length})
                </h3>
                <div className="space-y-1">
                  {queue.completed.slice(0, 3).map((item, idx) => (
                    <CompletedItem key={idx} item={item} />
                  ))}
                </div>
              </div>
            )}

            {/* Failed (last 5) */}
            {queue.failed && queue.failed.length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  Failed
                </h3>
                <div className="space-y-2">
                  {queue.failed.slice(0, 5).map((item, idx) => (
                    <QueueItem
                      key={idx}
                      item={item}
                      type="failed"
                      onRetry={handleRetry}
                      onDownload={handleDownload}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!queue.pending?.length &&
              !queue.processing?.length &&
              !queue.completed?.length &&
              !queue.failed?.length && (
                <div className="text-center py-12 text-gray-400">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <div className="text-lg font-medium">Queue is empty</div>
                  <div className="text-sm mt-1">Add episodes from the browser above to start transcribing</div>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  )
}
