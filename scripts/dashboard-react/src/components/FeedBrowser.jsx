import { useState } from 'react'

export default function FeedBrowser({ episodes, onDownload, onBatchDownload }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedEpisodes, setSelectedEpisodes] = useState(new Set())

  const filteredEpisodes = episodes.filter((ep) => {
    const matchesSearch = ep.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesSource =
      sourceFilter === 'all' || ep.source === sourceFilter
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'downloaded' && ep.downloaded) ||
      (statusFilter === 'available' && !ep.downloaded)
    return matchesSearch && matchesSource && matchesStatus
  })

  const handleToggleSelect = (index) => {
    const newSelected = new Set(selectedEpisodes)
    if (newSelected.has(index)) {
      newSelected.delete(index)
    } else {
      newSelected.add(index)
    }
    setSelectedEpisodes(newSelected)
  }

  const handleSelectAll = (checked) => {
    if (checked) {
      const availableIndices = filteredEpisodes
        .map((ep, idx) => (!ep.downloaded ? idx : null))
        .filter((idx) => idx !== null)
      setSelectedEpisodes(new Set(availableIndices))
    } else {
      setSelectedEpisodes(new Set())
    }
  }

  const handleBatchDownload = () => {
    const episodesToDownload = Array.from(selectedEpisodes).map(
      (idx) => filteredEpisodes[idx]
    )
    onBatchDownload(episodesToDownload)
    setSelectedEpisodes(new Set())
  }

  if (episodes.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-4 border-coral-200 border-t-coral-500 rounded-full animate-spin mx-auto mb-4"></div>
        <div className="text-gray-500">Loading podcast feed...</div>
      </div>
    )
  }

  return (
    <>
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          placeholder="Search podcast feed..."
          className="input flex-1"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="select"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="all">All Sources</option>
          <option value="patreon">Patreon</option>
          <option value="apple">Apple Podcasts</option>
        </select>
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="downloaded">Downloaded</option>
          <option value="available">Not Downloaded</option>
        </select>
      </div>

      {/* Batch Controls */}
      <div className="flex items-center justify-between p-4 bg-cream-50 rounded-lg mb-4 border border-cream-200">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="select-all"
            className="w-4 h-4 text-coral-500 border-cream-400 rounded focus:ring-coral-400"
            checked={selectedEpisodes.size > 0 && selectedEpisodes.size === filteredEpisodes.filter(ep => !ep.downloaded).length}
            onChange={(e) => handleSelectAll(e.target.checked)}
          />
          <label htmlFor="select-all" className="text-sm font-medium text-gray-700 cursor-pointer">
            Select All
          </label>
          <span className="text-sm text-gray-500 ml-4">
            {selectedEpisodes.size} selected
          </span>
        </div>
        <button
          className="btn btn-success"
          disabled={selectedEpisodes.size === 0}
          onClick={handleBatchDownload}
        >
          Download Selected
        </button>
      </div>

      {/* Episodes List */}
      <div className="max-h-[600px] overflow-y-auto space-y-2">
        {filteredEpisodes.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No episodes found in feed
          </div>
        ) : (
          filteredEpisodes.map((ep, index) => {
            const epNum = ep.episode_number || ep.index
            const downloaded = ep.downloaded

            return (
              <div
                key={index}
                className="flex items-center gap-4 p-4 bg-cream-50 rounded-lg hover:bg-cream-100 transition-colors border border-cream-200"
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 text-coral-500 border-cream-400 rounded focus:ring-coral-400 disabled:opacity-50"
                  checked={selectedEpisodes.has(index)}
                  disabled={downloaded}
                  onChange={() => handleToggleSelect(index)}
                />

                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-800 truncate">{ep.title}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {epNum ? `#${epNum} • ` : ''}
                    {ep.duration || 'Duration unknown'} •{' '}
                    {ep.source_name || 'Unknown Source'} •{' '}
                    {ep.published ? new Date(ep.published).toLocaleDateString() : 'Date unknown'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {downloaded ? (
                    <span className="badge badge-downloaded">✓ Downloaded</span>
                  ) : (
                    <>
                      <span className="badge bg-gray-100 text-gray-600 border border-gray-200">
                        Available
                      </span>
                      <button
                        className="btn btn-success text-sm px-3 py-1"
                        onClick={() => onDownload(ep)}
                      >
                        Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
