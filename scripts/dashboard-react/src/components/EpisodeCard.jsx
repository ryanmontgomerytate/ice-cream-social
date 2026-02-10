import { useState } from 'react'
import { queueAPI, episodesAPI, isTauri } from '../services/api'
import TranscriptModal from './TranscriptModal'

export default function EpisodeCard({ episode, onNotification, onUpdate, queue }) {
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showTranscriptModal, setShowTranscriptModal] = useState(false)
  const [transcript, setTranscript] = useState(null)
  const [loadingTranscript, setLoadingTranscript] = useState(false)

  const handleAddToQueue = async (priority = 0) => {
    setAdding(true)
    try {
      await queueAPI.addToQueue(episode.id, priority)
      onNotification?.(`Added "${episode.title}" to queue`, 'success')
      onUpdate?.()
    } catch (error) {
      onNotification?.(`Error adding to queue: ${error.message}`, 'error')
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveFromQueue = async () => {
    setRemoving(true)
    try {
      await queueAPI.removeFromQueue(episode.id)
      onNotification?.(`Removed "${episode.title}" from queue`, 'success')
      onUpdate?.()
    } catch (error) {
      onNotification?.(`Error removing from queue: ${error.message}`, 'error')
    } finally {
      setRemoving(false)
    }
  }

  const handleViewTranscript = async () => {
    if (showTranscript) {
      setShowTranscript(false)
      return
    }

    setLoadingTranscript(true)
    try {
      const data = await episodesAPI.getTranscript(episode.id)
      setTranscript(data)
      setShowTranscript(true)
    } catch (error) {
      onNotification?.(`Error loading transcript: ${error.message || error}`, 'error')
    } finally {
      setLoadingTranscript(false)
    }
  }

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown duration'
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return ''
    const mb = (bytes / (1024 * 1024)).toFixed(1)
    return `${mb} MB`
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

  // Helper to find queue position
  const getQueuePosition = () => {
    if (!queue) return null

    // Check if processing
    const processingIdx = queue.processing?.findIndex(item =>
      (item.episode?.id || item.episode_id) === episode.id
    )
    if (processingIdx >= 0) return { status: 'processing', position: 1 }

    // Check if pending (position in queue)
    const pendingIdx = queue.pending?.findIndex(item =>
      (item.episode?.id || item.episode_id) === episode.id
    )
    if (pendingIdx >= 0) return { status: 'pending', position: pendingIdx + 1 }

    // Check if failed
    const failedIdx = queue.failed?.findIndex(item =>
      (item.episode?.id || item.episode_id) === episode.id
    )
    if (failedIdx >= 0) return { status: 'failed', position: null }

    return null
  }

  const getStatusBadges = () => {
    const badges = []
    const queuePos = getQueuePosition()

    if (episode.transcription_status === 'completed' && episode.is_transcribed) {
      badges.push(
        <span key="transcribed" className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
          ✓ Transcribed
        </span>
      )
      // Check if has diarization (we'll need to fetch this or store it)
      if (episode.has_diarization) {
        badges.push(
          <span key="diarized" className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
            👥 {episode.num_speakers || 2} speakers
          </span>
        )
      }
      return <div className="flex flex-wrap gap-1">{badges}</div>
    }

    // Show queue position from queue data
    if (queuePos?.status === 'processing') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
          <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-800 rounded-full animate-spin"></div>
          Processing
        </span>
      )
    }

    if (queuePos?.status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
          <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
          Queue #{queuePos.position}
        </span>
      )
    }

    if (queuePos?.status === 'failed' || episode.transcription_status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
          ✕ Failed
        </span>
      )
    }

    // Fallback to episode flags
    if (episode.is_in_queue) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
          <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
          In Queue
        </span>
      )
    }

    if (episode.transcription_status === 'processing') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
          <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-800 rounded-full animate-spin"></div>
          Processing
        </span>
      )
    }

    if (episode.is_downloaded) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
          ⬇ Downloaded
        </span>
      )
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
        Pending
      </span>
    )
  }

  return (
    <div className="bg-cream-50 border border-cream-200 rounded-lg p-4 hover:bg-cream-100 transition-all hover:shadow-md">
      <div className="flex items-start gap-4">
        {/* Episode Number Badge */}
        {episode.episode_number && (
          <div className="flex-shrink-0 w-16 h-16 bg-gradient-to-br from-coral-400 to-coral-600 rounded-lg flex items-center justify-center shadow-sm">
            <div className="text-center">
              <div className="text-xs font-medium text-white/80">#</div>
              <div className="text-lg font-bold text-white leading-none">
                {episode.episode_number}
              </div>
            </div>
          </div>
        )}

        {/* Episode Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-2">
            <h3 className="font-semibold text-gray-900 leading-tight flex-1">
              {episode.title}
            </h3>
            {getStatusBadges()}
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mb-3">
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatDuration(episode.duration)}
            </span>
            {episode.file_size > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {formatFileSize(episode.file_size)}
              </span>
            )}
            {formatDate(episode.published_date) && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatDate(episode.published_date)}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200">
              {episode.feed_source === 'patreon' ? '💎 Patreon' : '🎙️ Apple'}
            </span>
          </div>

          {/* Description (if available) */}
          {episode.description && (
            <p className="text-sm text-gray-600 line-clamp-2 mb-3">
              {episode.description.replace(/<[^>]*>/g, '')}
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {episode.is_in_queue ? (
              <button
                onClick={handleRemoveFromQueue}
                disabled={removing}
                className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {removing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-red-300 border-t-red-700 rounded-full animate-spin"></div>
                    Removing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Remove from Queue
                  </>
                )}
              </button>
            ) : !episode.is_transcribed ? (
              <>
                <button
                  onClick={() => handleAddToQueue(0)}
                  disabled={adding}
                  className="px-4 py-2 bg-coral-500 hover:bg-coral-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {adding ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Adding...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add to Queue
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleAddToQueue(10)}
                  disabled={adding}
                  className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  title="Add with high priority"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  Priority
                </button>
              </>
            ) : (
              /* Transcribed - Show View/Download Buttons */
              <div className="flex items-center gap-2 flex-wrap">
                {/* Full transcript modal with speaker view */}
                <button
                  onClick={() => setShowTranscriptModal(true)}
                  className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  View Transcript
                </button>
                {/* Quick inline preview */}
                <button
                  onClick={handleViewTranscript}
                  disabled={loadingTranscript}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {loadingTranscript ? (
                    <>
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin"></div>
                      Loading...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {showTranscript ? 'Hide Preview' : 'Quick Preview'}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript Display (Quick Preview) */}
      {showTranscript && transcript && (
        <div className="mt-4 border-t border-cream-200 pt-4">
          <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-semibold text-gray-900">
                Transcript {transcript.episode_number && `(Episode ${transcript.episode_number})`}
              </h4>
              <button
                onClick={() => setShowTranscript(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Transcript Info */}
            <div className="flex flex-wrap gap-2 mb-3">
              {transcript.language && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                  🌐 {transcript.language.toUpperCase()}
                </span>
              )}
              {transcript.model_used && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">
                  🤖 {transcript.model_used}
                </span>
              )}
              {/* Diarization Status */}
              {transcript.has_diarization ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-purple-100 text-purple-700">
                  👥 {transcript.num_speakers} speakers
                  {transcript.diarization_method && (
                    <span className="text-purple-500 text-[10px]">({transcript.diarization_method})</span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-500">
                  👤 No speaker data
                </span>
              )}
            </div>
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {transcript.full_text}
            </div>
          </div>
        </div>
      )}

      {/* Full Transcript Modal with Speaker View */}
      {showTranscriptModal && (
        <TranscriptModal
          episode={episode}
          onClose={() => setShowTranscriptModal(false)}
        />
      )}
    </div>
  )
}
