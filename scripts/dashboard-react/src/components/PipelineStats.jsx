import { useState, useEffect, useRef, memo } from 'react'
import Stats from './Stats'
import CurrentActivity from './CurrentActivity'
import { statsAPI } from '../services/api'

function formatDuration(seconds) {
  if (seconds == null || seconds === 0) return '-'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function formatAudioLength(seconds) {
  if (seconds == null) return '-'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}

const CONTEXT_COLORS = {
  download:   'bg-blue-100 text-blue-700',
  transcribe: 'bg-purple-100 text-purple-700',
  diarize:    'bg-orange-100 text-orange-700',
}

function PipelineStats({ stats, currentActivity }) {
  const [pipelineStats, setPipelineStats] = useState(null)
  const [health, setHealth] = useState(null)
  const [recentErrors, setRecentErrors] = useState([])
  const [loading, setLoading] = useState(true)
  const fetchingRef = useRef(false)

  const loadPipelineStats = async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const [data, h, errors] = await Promise.all([
        statsAPI.getPipelineStats(20),
        statsAPI.getPipelineHealth(),
        statsAPI.getRecentErrors(10),
      ])
      setPipelineStats(data)
      setHealth(h)
      setRecentErrors(errors || [])
    } catch (e) {
      console.error('Failed to load pipeline stats:', e)
    } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPipelineStats()
    const interval = setInterval(loadPipelineStats, 60000)
    return () => clearInterval(interval)
  }, [])

  const timing = pipelineStats?.timing
  const recent = pipelineStats?.recent || []

  return (
    <div className="space-y-6">
      <Stats stats={stats} />
      <CurrentActivity activity={currentActivity} />

      {/* Pipeline Health Cards */}
      {health && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Success Rate</div>
            <div className={`text-2xl font-bold mt-1 ${health.success_rate_last_50 >= 0.9 ? 'text-green-600' : health.success_rate_last_50 >= 0.7 ? 'text-yellow-600' : 'text-red-600'}`}>
              {(health.success_rate_last_50 * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-400 mt-1">last 50 episodes</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Queue Remaining</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{health.episodes_remaining.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">
              {isFinite(health.estimated_completion_days)
                ? `~${Math.ceil(health.estimated_completion_days)}d to finish`
                : 'rate unknown'}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Errors (24h)</div>
            <div className={`text-2xl font-bold mt-1 ${health.failed_last_24h > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {health.failed_last_24h}
            </div>
            <div className="text-xs text-gray-400 mt-1">{health.unresolved_errors} unresolved total</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Transcribe</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{formatDuration(health.avg_transcribe_seconds)}</div>
            <div className="text-xs text-gray-400 mt-1">per episode</div>
          </div>
        </div>
      )}

      {/* Average Timing Cards */}
      {timing && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Download</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{formatDuration(timing.avg_download_seconds)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Transcribe</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{formatDuration(timing.avg_transcribe_seconds)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Diarize</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{formatDuration(timing.avg_diarize_seconds)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Transcribe / Hr Audio</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{formatDuration(timing.avg_transcribe_per_hour_audio)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-cream-200 p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Processed</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{timing.total_hours_processed.toFixed(1)}h</div>
            <div className="text-xs text-gray-400 mt-1">{timing.episodes_timed} episodes</div>
          </div>
        </div>
      )}

      {/* Recent Pipeline Errors */}
      {recentErrors.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-red-200">
          <div className="px-4 py-3 border-b border-red-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-red-800">Recent Pipeline Errors</h3>
            <span className="text-xs text-red-500">{recentErrors.filter(e => !e.resolved).length} unresolved</span>
          </div>
          <div className="divide-y divide-red-50">
            {recentErrors.map((err) => (
              <div key={err.id} className={`px-4 py-3 ${err.resolved ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${CONTEXT_COLORS[err.context] || 'bg-gray-100 text-gray-600'}`}>
                    {err.context}
                  </span>
                  {err.resolved && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded flex-shrink-0">resolved</span>
                  )}
                  <span className="text-xs text-gray-500 flex-shrink-0">{err.occurred_at}</span>
                </div>
                {err.episode_title && (
                  <div className="text-xs font-medium text-gray-700 mt-1 truncate">{err.episode_title}</div>
                )}
                <div className="text-xs text-gray-500 mt-0.5 line-clamp-2 font-mono">{err.error_detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Completed Table */}
      <div className="bg-white rounded-lg shadow-sm border border-cream-200">
        <div className="px-4 py-3 border-b border-cream-200">
          <h3 className="text-sm font-semibold text-gray-900">Recently Completed</h3>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading...</div>
        ) : recent.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No timed episodes yet. Durations are recorded as episodes complete the pipeline.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-cream-200 text-sm">
              <thead className="bg-cream-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Ep#</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Title</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Audio</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Download</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Transcribe</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Diarize</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Total</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Finished</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-100">
                {recent.map((ep) => (
                  <tr key={ep.id} className="hover:bg-cream-50">
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{ep.episode_number || '-'}</td>
                    <td className="px-3 py-2 text-gray-900 max-w-xs truncate">{ep.title}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{formatAudioLength(ep.audio_duration)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{formatDuration(ep.download_duration)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{formatDuration(ep.transcribe_duration)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{formatDuration(ep.diarize_duration)}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900 whitespace-nowrap">{formatDuration(ep.total_duration)}</td>
                    <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">
                      {ep.completed_date ? new Date(ep.completed_date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(PipelineStats)
