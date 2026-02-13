import { useState, useEffect } from 'react'
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

export default function PipelineStats({ stats, currentActivity }) {
  const [pipelineStats, setPipelineStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadPipelineStats = async () => {
    try {
      const data = await statsAPI.getPipelineStats(20)
      setPipelineStats(data)
    } catch (e) {
      console.error('Failed to load pipeline stats:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPipelineStats()
    const interval = setInterval(loadPipelineStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const timing = pipelineStats?.timing
  const recent = pipelineStats?.recent || []

  return (
    <div className="space-y-6">
      <Stats stats={stats} />
      <CurrentActivity activity={currentActivity} />

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
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Date</th>
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
                      {ep.completed_date ? new Date(ep.completed_date).toLocaleDateString() : '-'}
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
