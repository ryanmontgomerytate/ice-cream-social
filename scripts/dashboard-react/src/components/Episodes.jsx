import { useState, useEffect } from 'react'
import LocalEpisodes from './LocalEpisodes'
import FeedBrowser from './FeedBrowser'

export default function Episodes({
  episodes,
  feedEpisodes,
  onDownload,
  onBatchDownload,
  onRefreshFeed
}) {
  const [activeTab, setActiveTab] = useState('local')

  return (
    <div className="card mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📚</span>
          <h2 className="text-xl font-bold text-gray-800">Episodes</h2>
        </div>
        <span className="text-sm text-gray-500 font-medium">
          {episodes.length} local episodes
        </span>
      </div>

      {/* Tabs */}
      <div className="border-b border-cream-300 mb-6">
        <div className="flex gap-1">
          <button
            className={`px-6 py-3 font-medium transition-all border-b-2 ${
              activeTab === 'local'
                ? 'text-coral-600 border-coral-500'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('local')}
          >
            Downloaded Episodes
          </button>
          <button
            className={`px-6 py-3 font-medium transition-all border-b-2 ${
              activeTab === 'feed'
                ? 'text-coral-600 border-coral-500'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
            onClick={() => {
              setActiveTab('feed')
              if (feedEpisodes.length === 0) {
                onRefreshFeed()
              }
            }}
          >
            Browse Podcast Feed
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'local' ? (
        <LocalEpisodes episodes={episodes} />
      ) : (
        <FeedBrowser
          episodes={feedEpisodes}
          onDownload={onDownload}
          onBatchDownload={onBatchDownload}
        />
      )}
    </div>
  )
}
