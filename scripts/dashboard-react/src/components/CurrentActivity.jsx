import { useState, useEffect, useRef, memo } from 'react'

function CurrentActivity({ activity }) {
  const [collapsed, setCollapsed] = useState(false)
  // Track elapsed time locally between polls for smooth counting
  const [localElapsed, setLocalElapsed] = useState({}) // keyed by episode id
  const lastPollRef = useRef({}) // last polled elapsed per episode

  // Update local elapsed from polled data, then tick every second
  useEffect(() => {
    if (!activity || activity.status === 'idle') {
      setLocalElapsed({})
      lastPollRef.current = {}
      return
    }

    const slots = activity.slots || []
    if (slots.length === 0 && activity.current_episode) {
      // backward compat single slot
      const id = activity.current_episode.id
      if (activity.elapsed_seconds != null) {
        lastPollRef.current[id] = { polled: activity.elapsed_seconds, at: Date.now() }
      }
    } else {
      for (const slot of slots) {
        const id = slot.episode.id
        if (slot.elapsed_seconds != null) {
          lastPollRef.current[id] = { polled: slot.elapsed_seconds, at: Date.now() }
        }
      }
    }
  }, [activity])

  // Tick local elapsed every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      const next = {}
      for (const [id, ref] of Object.entries(lastPollRef.current)) {
        const drift = (now - ref.at) / 1000
        next[id] = Math.floor(ref.polled + drift)
      }
      setLocalElapsed(next)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const getElapsed = (episodeId, fallback) => {
    if (localElapsed[episodeId] != null) return localElapsed[episodeId]
    return fallback
  }

  const formatDuration = (seconds) => {
    if (seconds == null) return 'Unknown'
    if (seconds === 0) return '0m 0s'
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

  const formatEmbeddingModel = (value) => {
    if (!value) return 'pyannote'
    return value === 'ecapa-tdnn' ? 'ECAPA-TDNN' : value
  }

  const formatAsrModel = (value) => value || 'medium'

  const getActiveIdentity = () => {
    const slots = activity?.slots || []
    const fallbackAsr = activity?.worker_info?.model || 'medium'
    const fallbackEmbed = activity?.worker_info?.embedding_model || 'pyannote'

    if (!slots.length) {
      return {
        asr: formatAsrModel(fallbackAsr),
        embed: formatEmbeddingModel(fallbackEmbed),
      }
    }

    const asrModels = [...new Set(slots.map(s => formatAsrModel(s.transcription_model || fallbackAsr)))]
    const embedModels = [...new Set(slots.map(s => formatEmbeddingModel(s.embedding_backend || fallbackEmbed)))]

    return {
      asr: asrModels.length === 1 ? asrModels[0] : `mixed (${asrModels.join(' + ')})`,
      embed: embedModels.length === 1 ? embedModels[0] : `mixed (${embedModels.join(' + ')})`,
    }
  }

  const stageConfig = {
    downloading: { icon: '📥', label: 'Downloading', color: 'amber', bgClass: 'bg-amber-50', borderClass: 'border-amber-200', textClass: 'text-amber-600', barClass: 'bg-amber-500' },
    transcribing: { icon: '🎙️', label: 'Transcribing', color: 'sky', bgClass: 'bg-sky-50', borderClass: 'border-sky-200', textClass: 'text-sky-600', barClass: 'bg-sky-500' },
    diarizing: { icon: '👥', label: 'Diarizing', color: 'purple', bgClass: 'bg-purple-50', borderClass: 'border-purple-300', textClass: 'text-purple-600', barClass: 'bg-gradient-to-r from-purple-500 to-purple-600' },
    identifying: { icon: '🔍', label: 'Identifying Speakers', color: 'purple', bgClass: 'bg-purple-50', borderClass: 'border-purple-300', textClass: 'text-purple-600', barClass: 'bg-gradient-to-r from-purple-500 to-purple-600' },
    saving: { icon: '💾', label: 'Saving', color: 'green', bgClass: 'bg-green-50', borderClass: 'border-green-200', textClass: 'text-green-600', barClass: 'bg-green-500' },
  }

  const renderSlotCard = (slot) => {
    const config = stageConfig[slot.stage] || stageConfig.transcribing
    const elapsed = getElapsed(slot.episode.id, slot.elapsed_seconds)
    const progress = slot.progress || 0
    const asrModel = formatAsrModel(slot.transcription_model || activity?.worker_info?.model)
    const embeddingModel = formatEmbeddingModel(slot.embedding_backend || activity?.worker_info?.embedding_model)
    const showPipelineBadges = slot.stage === 'transcribing' || slot.stage === 'diarizing' || slot.stage === 'identifying'
    return (
      <div key={`${slot.episode.id}-${slot.stage}`} className={`p-4 rounded-lg border ${config.bgClass} ${config.borderClass}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{config.icon}</span>
          <span className={`text-xs font-bold uppercase tracking-wide ${config.textClass}`}>{config.label}</span>
        </div>
        <div className="font-semibold text-gray-900 text-sm">
          {slot.episode.episode_number ? `Ep ${slot.episode.episode_number}: ` : ''}{slot.episode.title}
        </div>
        {showPipelineBadges && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
              ASR: {asrModel}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-violet-100 border border-violet-200 text-violet-700">
              Embed: {embeddingModel}
            </span>
          </div>
        )}

        {/* Progress bar - always rendered, hidden when no progress */}
        <div className={`mt-3 transition-opacity duration-300 ${progress > 0 ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>
          <div className="flex justify-between items-center mb-1">
            <span className={`text-xs ${config.textClass}`}>{config.label} Progress</span>
            <span className={`text-xs font-bold ${config.textClass}`}>~{progress}%</span>
          </div>
          <div className={`h-2 rounded-full overflow-hidden bg-${config.color}-100`}>
            <div
              className={`h-full transition-all duration-1000 ease-linear ${config.barClass}`}
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Time info */}
        <div className="flex gap-4 mt-3 text-xs">
          <div>
            <span className="text-gray-500">Elapsed: </span>
            <span className="font-medium text-gray-900">{formatDuration(elapsed)}</span>
          </div>
          {slot.estimated_remaining_seconds != null && slot.estimated_remaining_seconds > 0 && (
            <div>
              <span className="text-gray-500">Remaining: </span>
              <span className="font-medium text-gray-900">~{formatDuration(slot.estimated_remaining_seconds)}</span>
            </div>
          )}
        </div>
      </div>
    )
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

    // IDLE STATE
    if (activity.status === 'idle') {
      return (
        <div className="space-y-3">
          <div className="p-4 bg-white border border-gray-200 rounded-lg">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Pipeline Status</div>
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
          {activity.last_activity && (
            <div className="text-xs text-gray-400 text-center">
              Last completed: {formatDateTime(activity.last_activity)}
            </div>
          )}
        </div>
      )
    }

    // PROCESSING STATE — Multi-slot pipeline view
    if (activity.status === 'processing' || activity.status === 'transcribing') {
      const slots = activity.slots || []
      const hasMultipleSlots = slots.length > 1

      // If we have slots data, render multi-slot view
      if (slots.length > 0) {
        return (
          <div className="space-y-3">
            {/* Pipeline overview header */}
            <div className="p-4 bg-white border border-sky-200 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-gray-500 uppercase">Pipeline Status</div>
                <div className="text-xs font-medium text-sky-600">
                  {slots.length} active {slots.length === 1 ? 'slot' : 'slots'}
                </div>
              </div>
              {/* 4-step pipeline indicator */}
              <div className="flex items-center gap-1">
                {['downloading', 'transcribing', 'diarizing', 'saving'].map((step, i) => {
                  const isActive = slots.some(s => s.stage === step)
                  const isDone = false // Can't easily know without more state
                  return (
                    <div key={step} className="flex items-center flex-1">
                      <div className={`h-1.5 rounded-full flex-1 ${
                        isActive ? 'bg-sky-500 animate-pulse' : 'bg-gray-200'
                      }`} />
                      {i < 3 && <div className="w-1" />}
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between mt-1">
                {['Download', 'Transcribe', 'Diarize', 'Save'].map(label => (
                  <div key={label} className="text-[10px] text-gray-400 text-center flex-1">{label}</div>
                ))}
              </div>
            </div>

            {/* Render each active slot */}
            {slots.map(slot => renderSlotCard(slot))}

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
          </div>
        )
      }

      // Fallback: single slot backward-compat view (if slots array is empty but status is processing)
      const episode = activity.current_episode
      const stage = activity.stage || 'transcribing'

      const isDownloading = stage === 'downloading'
      const isTranscribing = stage === 'transcribing'
      const isDiarizing = stage === 'diarizing'
      const isSaving = stage === 'saving'
      const downloadDone = isTranscribing || isDiarizing || isSaving
      const transcribeDone = isDiarizing || isSaving
      const diarizeDone = isSaving

      return (
        <div className="space-y-3">
          <div className="p-4 bg-white border border-sky-200 rounded-lg">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Pipeline Status</div>
            <div className="space-y-2">
              {/* Step 1: Download */}
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
                </div>
              </div>

              {/* Step 2: Transcribe */}
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
                </div>
              </div>

              {/* Step 3: Diarize */}
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
                </div>
              </div>
            </div>
          </div>

          {/* Active stage detail card */}
          {episode && (isTranscribing || isDiarizing || isDownloading || isSaving) && (
            renderSlotCard({
              episode,
              stage,
              progress: activity.progress,
              elapsed_seconds: activity.elapsed_seconds,
              estimated_remaining_seconds: activity.estimated_remaining_seconds,
            })
          )}
        </div>
      )
    }

    // ERROR STATE
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <div className="text-red-700 font-semibold">Unknown Status: {activity.status}</div>
        <pre className="text-xs mt-2 text-red-600">{JSON.stringify(activity, null, 2)}</pre>
      </div>
    )
  }

  // Determine header color based on current stage
  const stage = activity?.stage || 'idle'
  const slots = activity?.slots || []
  const activeCount = slots.length

  // Use most important active stage for header color
  const hasStage = (s) => slots.some(slot => slot.stage === s)
  const headerGradient = hasStage('transcribing')
    ? 'from-sky-600 to-sky-700'
    : hasStage('diarizing')
      ? 'from-purple-600 to-purple-700'
      : hasStage('downloading')
        ? 'from-amber-500 to-amber-600'
        : stage === 'diarizing'
          ? 'from-purple-600 to-purple-700'
          : stage === 'transcribing'
            ? 'from-sky-600 to-sky-700'
            : stage === 'downloading'
              ? 'from-amber-500 to-amber-600'
              : 'from-slate-700 to-slate-800'

  const getStageText = () => {
    if (!activity || activity.status === 'idle') return 'Waiting for queue items'
    if (activeCount > 1) return `${activeCount} slots active — pipeline processing`
    switch (stage) {
      case 'downloading': return 'Downloading audio...'
      case 'transcribing': return 'Transcribing audio...'
      case 'diarizing': return 'Identifying speakers...'
      case 'saving': return 'Saving results...'
      default: return 'Processing...'
    }
  }

  const activeIdentity = getActiveIdentity()

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
        <div className="mt-3 flex items-center justify-center gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-white/90 border border-white/70 text-slate-800">
            ASR: {activeIdentity.asr}
          </span>
          <span className="px-2 py-1 rounded bg-violet-100 border border-violet-200 text-violet-700">
            Embed: {activeIdentity.embed}
          </span>
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

export default memo(CurrentActivity)
