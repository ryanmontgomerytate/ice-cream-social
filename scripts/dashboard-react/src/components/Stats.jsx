import { useState, useEffect } from 'react'
import { statsAPI } from '../services/api'

export default function Stats({ stats, onOpenEpisode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [queuesCollapsed, setQueuesCollapsed] = useState(false)
  const [transcribeOpen, setTranscribeOpen] = useState(true)
  const [diarizeOpen, setDiarizeOpen] = useState(true)
  const [queueLists, setQueueLists] = useState({ transcribe: [], diarize: [] })
  const [queuesLoaded, setQueuesLoaded] = useState(false)

  const total = stats.total_episodes || 0
  const downloaded = stats.downloaded_episodes || 0
  const transcribed = stats.transcribed_episodes || 0
  const diarized = stats.diarized_episodes || 0
  const inQueue = stats.in_transcription_queue || 0
  const inDiarizationQueue = stats.in_diarization_queue || 0
  const failed = stats.failed || 0

  const transcribedPercent = total > 0 ? ((transcribed / total) * 100).toFixed(1) : 0
  const diarizedPercent = transcribed > 0 ? ((diarized / transcribed) * 100).toFixed(1) : 0

  const hasAnyQueue = inQueue > 0 || inDiarizationQueue > 0

  useEffect(() => {
    if (!queuesCollapsed && hasAnyQueue) {
      setQueuesLoaded(false)
      statsAPI.getQueueEpisodeLists().then(lists => {
        setQueueLists(lists || { transcribe: [], diarize: [] })
        setQueuesLoaded(true)
      }).catch(() => setQueuesLoaded(true))
    }
  }, [queuesCollapsed, inQueue, inDiarizationQueue])

  return (
    <div className="space-y-4 mb-4">
      {/* Episode Tracking */}
      <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
        <div
          className="bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 cursor-pointer select-none"
          onClick={() => setCollapsed(c => !c)}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Episode Tracking</h2>
              {collapsed && (
                <p className="text-white/80 text-xs mt-1">
                  {transcribed} transcribed / {diarized} diarized / {total} total ({transcribedPercent}%)
                </p>
              )}
            </div>
            <svg
              className={`w-5 h-5 text-white/80 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {!collapsed && <div className="p-4">
          {/* Row 1: progress stats */}
          <div className="grid grid-cols-4 gap-3 mb-3">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{total}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-700">{downloaded}</div>
              <div className="text-xs text-blue-600">Downloaded</div>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-700">{transcribed}</div>
              <div className="text-xs text-green-600">Transcribed</div>
            </div>
            <div className="text-center p-3 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-700">{diarized}</div>
              <div className="text-xs text-purple-600">Diarized</div>
            </div>
          </div>

          {/* Row 2: queue counts */}
          <div className={`grid gap-3 mb-3 ${failed > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <div className="text-2xl font-bold text-amber-700">{inQueue}</div>
              <div className="text-xs text-amber-600">Transcribe Queue</div>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-700">{inDiarizationQueue}</div>
              <div className="text-xs text-orange-600">Diarization Queue</div>
            </div>
            {failed > 0 && (
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-700">{failed}</div>
                <div className="text-xs text-red-600">Failed</div>
              </div>
            )}
          </div>

          {/* Progress bars */}
          <div className="bg-gray-50 rounded-lg p-3 mb-2">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Transcription Progress</span>
              <span className="text-sm font-bold text-gray-900">{transcribed} of {total} ({transcribedPercent}%)</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-500"
                style={{ width: `${transcribedPercent}%` }}
              ></div>
            </div>
          </div>

          {transcribed > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-gray-600">Diarization Progress</span>
                <span className="text-sm font-bold text-gray-900">{diarized} of {transcribed} ({diarizedPercent}%)</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-500"
                  style={{ width: `${diarizedPercent}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>}
      </div>

      {/* Queue Tables — always shown when any queue has items */}
      {hasAnyQueue && (
        <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
          <div
            className="bg-gradient-to-r from-slate-600 to-slate-700 px-6 py-3 cursor-pointer select-none"
            onClick={() => setQueuesCollapsed(c => !c)}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">
                Transcription &amp; Diarization Queues
                <span className="ml-2 text-white/70 text-sm font-normal">
                  ({inQueue + inDiarizationQueue} pending)
                </span>
              </h2>
              <svg
                className={`w-4 h-4 text-white/80 transition-transform ${queuesCollapsed ? '-rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {!queuesCollapsed && (
            <div className="divide-y divide-cream-100">
              {/* Transcribe Queue */}
              <div>
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
                  onClick={() => setTranscribeOpen(o => !o)}
                >
                  <span>Transcribe Queue ({inQueue})</span>
                  <svg className={`w-4 h-4 transition-transform ${transcribeOpen ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {transcribeOpen && (
                  <div className="max-h-72 overflow-y-auto">
                    {!queuesLoaded ? (
                      <div className="px-4 py-2 text-xs text-gray-400">Loading...</div>
                    ) : inQueue === 0 ? (
                      <div className="px-4 py-2 text-xs text-gray-400">Nothing in transcription queue</div>
                    ) : (
                      <table className="min-w-full text-xs">
                        <tbody className="divide-y divide-cream-50">
                          {queueLists.transcribe.map((ep, i) => (
                            <tr key={ep.id} className="hover:bg-amber-50">
                              <td className="px-4 py-1.5 text-gray-400 w-6 tabular-nums">{i + 1}</td>
                              <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap w-12">{ep.episode_number ? `#${ep.episode_number}` : '—'}</td>
                              <td className="px-2 py-1.5 text-gray-800 truncate max-w-xs">{ep.title}</td>
                              {onOpenEpisode && (
                                <td className="px-2 py-1.5 w-8">
                                  <button onClick={() => onOpenEpisode(ep.id)} className="text-amber-500 hover:text-amber-700 text-xs" title="Open episode">→</button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* Diarization Queue */}
              <div>
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-orange-800 bg-orange-50 hover:bg-orange-100 transition-colors text-left"
                  onClick={() => setDiarizeOpen(o => !o)}
                >
                  <span>Diarization Queue ({inDiarizationQueue})</span>
                  <svg className={`w-4 h-4 transition-transform ${diarizeOpen ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {diarizeOpen && (
                  <div className="max-h-72 overflow-y-auto">
                    {!queuesLoaded ? (
                      <div className="px-4 py-2 text-xs text-gray-400">Loading...</div>
                    ) : inDiarizationQueue === 0 ? (
                      <div className="px-4 py-2 text-xs text-gray-400">Nothing in diarization queue</div>
                    ) : (
                      <table className="min-w-full text-xs">
                        <tbody className="divide-y divide-cream-50">
                          {queueLists.diarize.map((ep, i) => (
                            <tr key={ep.id} className="hover:bg-orange-50">
                              <td className="px-4 py-1.5 text-gray-400 w-6 tabular-nums">{i + 1}</td>
                              <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap w-12">{ep.episode_number ? `#${ep.episode_number}` : '—'}</td>
                              <td className="px-2 py-1.5 text-gray-800 truncate max-w-xs">{ep.title}</td>
                              {onOpenEpisode && (
                                <td className="px-2 py-1.5 w-8">
                                  <button onClick={() => onOpenEpisode(ep.id)} className="text-orange-500 hover:text-orange-700 text-xs" title="Open episode">→</button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
