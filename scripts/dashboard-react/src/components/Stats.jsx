import { useState } from 'react'

export default function Stats({ stats }) {
  const [collapsed, setCollapsed] = useState(false)
  const total = stats.total_episodes || 0
  const downloaded = stats.downloaded_episodes || 0
  const transcribed = stats.transcribed_episodes || 0
  const diarized = stats.diarized_episodes || 0
  const inQueue = stats.in_queue || 0
  const inDiarizationQueue = stats.in_diarization_queue || 0
  const failed = stats.failed || 0

  // Calculate simple percentages
  const transcribedPercent = total > 0 ? ((transcribed / total) * 100).toFixed(1) : 0
  const diarizedPercent = transcribed > 0 ? ((diarized / transcribed) * 100).toFixed(1) : 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden mb-8">
      {/* Header */}
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

      {/* Stats Grid */}
      {!collapsed && <div className="p-4">
        <div className="grid grid-cols-5 gap-3 mb-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{total}</div>
            <div className="text-xs text-gray-500">Total</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">{downloaded}</div>
            <div className="text-xs text-blue-600">Downloaded</div>
          </div>
          <div className="text-center p-3 bg-amber-50 rounded-lg">
            <div className="text-2xl font-bold text-amber-700">{inQueue}</div>
            <div className="text-xs text-amber-600">In Queue to Transcribe</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-700">{transcribed}</div>
            <div className="text-xs text-green-600">Transcribed</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">{diarized}</div>
            <div className="text-xs text-purple-600">Diarized</div>
          </div>
          {failed > 0 && (
            <div className="text-center p-3 bg-red-50 rounded-lg col-span-5">
              <div className="text-2xl font-bold text-red-700">{failed}</div>
              <div className="text-xs text-red-600">Failed</div>
            </div>
          )}
        </div>

        {/* Transcription Progress */}
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

        {/* Diarization Progress */}
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
  )
}
