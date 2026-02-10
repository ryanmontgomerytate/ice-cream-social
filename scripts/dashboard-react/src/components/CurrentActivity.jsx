import { useState } from 'react'

export default function CurrentActivity({ activity }) {
  const [collapsed, setCollapsed] = useState(false)
  const formatDuration = (seconds) => {
    if (!seconds || seconds === null) return 'Unknown'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}m ${secs}s`
  }

  const formatDateTime = (isoString) => {
    if (!isoString) return 'Never'
    try {
      const date = new Date(isoString)
      return date.toLocaleString()
    } catch {
      return 'Invalid date'
    }
  }

  const formatMemory = (mb) => {
    if (!mb) return 'N/A'
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`
    }
    return `${mb.toFixed(0)} MB`
  }

  const renderContent = () => {
    if (!activity) {
      return (
        <div className="text-center py-8 text-gray-400">
          <div className="text-4xl mb-2">🔄</div>
          <div>Connecting...</div>
        </div>
      )
    }

    // IDLE STATE - Nothing in queue
    if (activity.status === 'idle') {
      return (
        <div className="space-y-3">
          {/* Pipeline Status */}
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Pipeline Status</div>

            {/* Step indicators */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <span className="text-green-600 text-sm">✓</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">Ready to Process</div>
                  <div className="text-xs text-gray-500">Worker is online and waiting</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">○</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-400">Queue Empty</div>
                  <div className="text-xs text-gray-400">Add episodes to start transcribing</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-gray-50 rounded-lg text-center">
              <div className="text-2xl font-bold text-gray-900">
                {activity.worker_info?.processed_today || 0}
              </div>
              <div className="text-xs text-gray-500">Done Today</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg text-center">
              <div className="text-2xl font-bold text-gray-900">
                {activity.worker_info?.model || 'medium'}
              </div>
              <div className="text-xs text-gray-500">Model</div>
            </div>
          </div>

          {/* Last Activity */}
          {activity.last_activity && (
            <div className="text-xs text-gray-400 text-center">
              Last completed: {formatDateTime(activity.last_activity)}
            </div>
          )}
        </div>
      )
    }

    // PROCESSING STATE - Actively processing an episode
    if (activity.status === 'processing' || activity.status === 'transcribing') {
      const episode = activity.current_episode
      const stage = activity.stage || 'transcribing'

      // Determine step states based on current stage
      const isDownloading = stage === 'downloading'
      const isTranscribing = stage === 'transcribing'
      const isDiarizing = stage === 'diarizing'
      const isSaving = stage === 'saving'
      const downloadDone = isTranscribing || isDiarizing || isSaving
      const transcribeDone = isDiarizing || isSaving
      const diarizeDone = isSaving

      return (
        <div className="space-y-3">
          {/* Pipeline Status */}
          <div className="p-4 bg-white border border-sky-200 rounded-lg">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Pipeline Status</div>

            {/* Step indicators */}
            <div className="space-y-2">
              {/* Step 1: Audio Download */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  downloadDone ? 'bg-green-100' : isDownloading ? 'bg-amber-500' : 'bg-gray-100'
                }`}>
                  {downloadDone ? (
                    <span className="text-green-600 text-sm">✓</span>
                  ) : isDownloading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span className="text-gray-400 text-sm">○</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${downloadDone ? 'text-gray-900' : isDownloading ? 'text-amber-700' : 'text-gray-400'}`}>
                    {downloadDone ? 'Audio Downloaded' : 'Downloading Audio'}
                  </div>
                  <div className={`text-xs ${isDownloading ? 'text-amber-600' : 'text-gray-500'}`}>
                    {isDownloading ? 'Fetching MP3 file...' : 'File ready for processing'}
                  </div>
                </div>
              </div>

              {/* Step 2: Transcribing */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  transcribeDone ? 'bg-green-100' : isTranscribing ? 'bg-sky-500' : 'bg-gray-100'
                }`}>
                  {transcribeDone ? (
                    <span className="text-green-600 text-sm">✓</span>
                  ) : isTranscribing ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span className="text-gray-400 text-sm">○</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${transcribeDone ? 'text-gray-900' : isTranscribing ? 'text-sky-700' : 'text-gray-400'}`}>
                    {transcribeDone ? 'Transcription Complete' : 'Transcribing Audio'}
                  </div>
                  <div className={`text-xs ${isTranscribing ? 'text-sky-600' : 'text-gray-500'}`}>
                    {isTranscribing ? `Using ${activity.worker_info?.model || 'medium'} model` : 'Speech to text conversion'}
                  </div>
                </div>
              </div>

              {/* Step 3: Diarization */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  diarizeDone ? 'bg-green-100' : isDiarizing ? 'bg-purple-500' : 'bg-gray-100'
                }`}>
                  {diarizeDone ? (
                    <span className="text-green-600 text-sm">✓</span>
                  ) : isDiarizing ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span className="text-gray-400 text-sm">○</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${diarizeDone ? 'text-gray-900' : isDiarizing ? 'text-purple-700' : 'text-gray-400'}`}>
                    {diarizeDone ? 'Speakers Identified' : 'Speaker Diarization'}
                  </div>
                  <div className={`text-xs ${isDiarizing ? 'text-purple-600' : 'text-gray-500'}`}>
                    {isDiarizing ? 'Identifying speakers with pyannote' : 'Who said what'}
                  </div>
                </div>
              </div>

              {/* Step 4: Save */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isSaving ? 'bg-green-500' : 'bg-gray-100'
                }`}>
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span className="text-gray-400 text-sm">○</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${isSaving ? 'text-green-700' : 'text-gray-400'}`}>
                    {isSaving ? 'Saving...' : 'Save Transcript'}
                  </div>
                  <div className="text-xs text-gray-500">Write to database</div>
                </div>
              </div>
            </div>
          </div>

          {/* Transcription Card - Only shows during transcription */}
          {episode && isTranscribing && (
            <div className="p-4 rounded-lg border bg-sky-50 border-sky-200">
              <div className="flex items-center gap-2 text-sky-600 mb-2">
                <span className="text-lg">🎙️</span>
                <span className="text-xs font-bold uppercase tracking-wide">Transcribing</span>
              </div>
              <div className="font-semibold text-gray-900 text-sm">{episode.title}</div>
              {episode.duration && (
                <div className="text-xs text-gray-500 mt-1">
                  {Math.floor(episode.duration / 60)} min audio
                </div>
              )}

              {/* Progress */}
              {activity.progress !== null && activity.progress > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-sky-600">Transcription Progress</span>
                    <span className="text-xs font-bold text-sky-700">~{activity.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden bg-sky-100">
                    <div
                      className="h-full transition-all duration-500 bg-sky-500"
                      style={{ width: `${activity.progress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Time */}
              <div className="flex gap-4 mt-3 text-xs">
                <div>
                  <span className="text-gray-500">Elapsed: </span>
                  <span className="font-medium text-gray-900">{formatDuration(activity.elapsed_seconds)}</span>
                </div>
                {activity.estimated_remaining_seconds !== null && (
                  <div>
                    <span className="text-gray-500">Remaining: </span>
                    <span className="font-medium text-gray-900">~{formatDuration(activity.estimated_remaining_seconds)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Diarization Card - Only shows during diarization */}
          {episode && isDiarizing && (
            <div className="p-4 rounded-lg border-2 bg-purple-50 border-purple-300">
              <div className="flex items-center gap-2 text-purple-600 mb-2">
                <span className="text-lg">👥</span>
                <span className="text-xs font-bold uppercase tracking-wide">Speaker Diarization</span>
              </div>
              <div className="font-semibold text-gray-900 text-sm">{episode.title}</div>
              <div className="text-xs text-purple-600 mt-1">
                Identifying who said what with pyannote
              </div>

              {/* Progress */}
              {activity.progress !== null && (
                <div className="mt-3">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-purple-600">Diarization Progress</span>
                    <span className="text-xs font-bold text-purple-700">~{activity.progress}%</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden bg-purple-100">
                    <div
                      className="h-full transition-all duration-500 bg-gradient-to-r from-purple-500 to-purple-600"
                      style={{ width: `${activity.progress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {/* Time */}
              <div className="flex gap-4 mt-3 text-xs">
                <div>
                  <span className="text-gray-500">Elapsed: </span>
                  <span className="font-medium text-gray-900">{formatDuration(activity.elapsed_seconds)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Downloading Card */}
          {episode && isDownloading && (
            <div className="p-4 rounded-lg border bg-amber-50 border-amber-200">
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <span className="text-lg">⬇️</span>
                <span className="text-xs font-bold uppercase tracking-wide">Downloading</span>
              </div>
              <div className="font-semibold text-gray-900 text-sm">{episode.title}</div>
            </div>
          )}

          {/* Saving Card */}
          {episode && isSaving && (
            <div className="p-4 rounded-lg border bg-green-50 border-green-200">
              <div className="flex items-center gap-2 text-green-600 mb-2">
                <span className="text-lg">💾</span>
                <span className="text-xs font-bold uppercase tracking-wide">Saving</span>
              </div>
              <div className="font-semibold text-gray-900 text-sm">{episode.title}</div>
            </div>
          )}
        </div>
      )
    }

    // ERROR STATE (if status is something else)
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <div className="text-red-700 font-semibold">Unknown Status: {activity.status}</div>
        <pre className="text-xs mt-2 text-red-600">{JSON.stringify(activity, null, 2)}</pre>
      </div>
    )
  }

  // Determine header color based on current stage
  const stage = activity?.stage || 'idle'
  const headerGradient = stage === 'diarizing'
    ? 'from-purple-600 to-purple-700'
    : stage === 'transcribing'
      ? 'from-sky-600 to-sky-700'
      : stage === 'downloading'
        ? 'from-amber-500 to-amber-600'
        : 'from-slate-700 to-slate-800'

  const getStageText = () => {
    if (!activity || activity.status === 'idle') return 'Waiting for queue items'
    switch (stage) {
      case 'downloading': return 'Downloading audio...'
      case 'transcribing': return 'Transcribing audio...'
      case 'diarizing': return 'Identifying speakers...'
      case 'saving': return 'Saving results...'
      default: return 'Processing...'
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      <div
        className={`bg-gradient-to-r ${headerGradient} px-6 py-4 transition-colors duration-500 cursor-pointer select-none`}
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Processing Pipeline
            </h2>
            <p className="text-white/80 text-xs mt-1">
              {getStageText()}
            </p>
          </div>
          <svg
            className={`w-5 h-5 text-white/80 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {!collapsed && (
        <div className="p-4">
          {renderContent()}
        </div>
      )}
    </div>
  )
}
