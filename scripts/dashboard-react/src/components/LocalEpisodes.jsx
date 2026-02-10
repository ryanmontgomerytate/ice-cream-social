import { useState } from 'react'
import TranscriptModal from './TranscriptModal'

export default function LocalEpisodes({ episodes }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedEpisode, setSelectedEpisode] = useState(null)

  const formatDuration = (seconds) => {
    if (!seconds) return ''
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours > 0) {
      return `${hours}h ${mins}m`
    }
    return `${mins}m`
  }

  const filteredEpisodes = episodes.filter((ep) => {
    const matchesSearch = ep.filename.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter =
      filter === 'all' ||
      (filter === 'completed' && ep.transcribed) ||
      (filter === 'pending' && !ep.transcribed)
    return matchesSearch && matchesFilter
  })

  return (
    <>
      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search episodes..."
          className="input flex-1"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All Episodes</option>
          <option value="completed">Transcribed</option>
          <option value="pending">Not Transcribed</option>
        </select>
      </div>

      {/* Episodes List */}
      <div className="max-h-[600px] overflow-y-auto space-y-2">
        {filteredEpisodes.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No episodes found
          </div>
        ) : (
          filteredEpisodes.map((ep, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-4 bg-cream-50 rounded-lg hover:bg-cream-100 transition-colors cursor-pointer border border-cream-200"
              onClick={() => ep.transcribed && setSelectedEpisode(ep)}
            >
              <div className="flex-1">
                <div className="font-medium text-gray-800">{ep.filename}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {formatDuration(ep.duration)} • {ep.size_mb} MB •{' '}
                  {new Date(ep.added_date).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ep.transcribed ? (
                  <>
                    <span className="badge badge-success">✓ Transcribed</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedEpisode(ep)
                      }}
                    >
                      View
                    </button>
                  </>
                ) : (
                  <span className="badge badge-pending">Pending</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Transcript Modal */}
      {selectedEpisode && (
        <TranscriptModal
          episode={selectedEpisode}
          onClose={() => setSelectedEpisode(null)}
        />
      )}
    </>
  )
}
