import { useState, useEffect } from 'react'
import Header from './components/Header'
import Stats from './components/Stats'
import CurrentActivity from './components/CurrentActivity'
import PipelineStats from './components/PipelineStats'
import TranscriptModal from './components/TranscriptModal'
import TranscriptReviewLayout from './components/TranscriptReviewLayout'
import Notification from './components/Notification'
import SpeakersPanel from './components/SpeakersPanel'
import CharactersPanel from './components/CharactersPanel'
import SponsorsPanel from './components/SponsorsPanel'
import SettingsPanel from './components/SettingsPanel'
import SearchPanel from './components/SearchPanel'
import ExtractionPanel from './components/ExtractionPanel'
import { isTauri, statsAPI, workerAPI, episodesAPI, setupEventListeners } from './services/api'

function App() {
  const [connected, setConnected] = useState(false)
  const [activeMainTab, setActiveMainTab] = useState('episodes')
  const [stats, setStats] = useState({
    total_episodes: 0,
    transcribed_episodes: 0,
    downloaded_episodes: 0,
    in_queue: 0,
    failed: 0,
    completion_rate: { downloaded: 0, total: 0 }
  })
  const [currentActivity, setCurrentActivity] = useState(null)
  const [notification, setNotification] = useState(null)
  const [transcriptEpisode, setTranscriptEpisode] = useState(null)

  // Initialize connection (Tauri events or Socket.IO)
  useEffect(() => {
    if (isTauri) {
      // Use Tauri events
      console.log('Running in Tauri mode')
      setConnected(true)

      const setupEvents = async () => {
        const cleanup = await setupEventListeners({
          onStatusUpdate: (data) => {
            console.log('Status update:', data)
            loadCurrentActivity()
          },
          onQueueUpdate: (data) => {
            console.log('Queue update:', data)
            loadStats()
          },
          onStatsUpdate: (data) => {
            console.log('Stats update:', data)
            loadStats()
          },
          onTranscriptionComplete: (episodeId) => {
            showNotification(`Transcription completed for episode ${episodeId}`, 'success')
            loadStats()
          },
          onTranscriptionFailed: ([episodeId, error]) => {
            showNotification(`Transcription failed: ${error}`, 'error')
          },
        })

        return cleanup
      }

      setupEvents()
    } else {
      // Fall back to Socket.IO for development
      console.log('Running in browser mode (Socket.IO)')
      import('socket.io-client').then(({ io }) => {
        const newSocket = io()

        newSocket.on('connect', () => {
          console.log('Connected to server')
          setConnected(true)
          newSocket.emit('request_update')
        })

        newSocket.on('disconnect', () => {
          console.log('Disconnected from server')
          setConnected(false)
        })

        newSocket.on('status_update', (data) => {
          setCurrentActivity(data)
        })

        newSocket.on('stats_update', (data) => {
          setStats(data)
        })

        newSocket.on('download_complete', (data) => {
          showNotification(`Downloaded: ${data.episode}`, 'success')
        })

        newSocket.on('download_error', (data) => {
          showNotification(`Error: ${data.error}`, 'error')
        })

        return () => newSocket.close()
      })
    }
  }, [])

  // Load initial data
  useEffect(() => {
    loadStats()
    loadCurrentActivity()
  }, [])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadCurrentActivity()
      loadStats()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const loadStats = async () => {
    try {
      const data = await statsAPI.getStats()
      if (data) {
        setStats(data)
      }
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  const loadCurrentActivity = async () => {
    try {
      const data = await workerAPI.getStatus()
      if (data && !data.error) {
        setCurrentActivity(data)
      } else {
        setCurrentActivity({
          status: 'idle',
          current_episode: null,
          progress: null,
          elapsed_seconds: null,
          estimated_remaining_seconds: null,
          last_activity: null,
          next_check_seconds: 60,
          worker_info: {
            model: 'unknown',
            memory_mb: null,
            memory_percent: null,
            processed_today: null
          }
        })
      }
    } catch (error) {
      console.error('Error loading status:', error)
      setCurrentActivity(null)
    }
  }

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 5000)
  }

  return (
    <div className="min-h-screen bg-cream-100">
      <Header connected={connected} isTauri={isTauri} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Main Navigation Tabs */}
        <div className="border-b border-cream-200">
          <nav className="flex gap-1">
            {[
              { id: 'episodes', label: 'Episodes', icon: '📻' },
              { id: 'search', label: 'Search', icon: '🔍' },
              { id: 'extraction', label: 'Extraction', icon: '🤖' },
              { id: 'speakers', label: 'Audio ID', icon: '🎙️' },
              { id: 'characters', label: 'Characters', icon: '🎭' },
              { id: 'sponsors', label: 'Sponsors', icon: '📺' },
              { id: 'stats', label: 'Stats', icon: '📊' },
              { id: 'settings', label: 'Settings', icon: '⚙️' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveMainTab(tab.id)}
                className={`px-4 py-3 font-medium text-sm transition-colors border-b-2 ${
                  activeMainTab === tab.id
                    ? 'border-coral-500 text-coral-600 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-cream-50'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeMainTab === 'stats' && (
          <PipelineStats stats={stats} currentActivity={currentActivity} />
        )}

        {activeMainTab === 'episodes' && (
          <TranscriptReviewLayout onNotification={showNotification} />
        )}

        {activeMainTab === 'search' && (
          <SearchPanel
            onNotification={showNotification}
            onViewEpisode={async (episodeId, timestamp) => {
              try {
                const episode = await episodesAPI.getEpisode(episodeId)
                if (episode) {
                  setTranscriptEpisode({ ...episode, initialTimestamp: timestamp })
                }
              } catch (error) {
                showNotification(`Error loading episode: ${error.message}`, 'error')
              }
            }}
          />
        )}

        {activeMainTab === 'extraction' && (
          <ExtractionPanel onNotification={showNotification} />
        )}

        {activeMainTab === 'speakers' && (
          <SpeakersPanel
            onNotification={showNotification}
            onViewEpisode={async (episodeId, timestamp) => {
              try {
                const episode = await episodesAPI.getEpisode(episodeId)
                if (episode) {
                  setTranscriptEpisode({ ...episode, initialTimestamp: timestamp })
                }
              } catch (error) {
                showNotification(`Error loading episode: ${error.message}`, 'error')
              }
            }}
          />
        )}

        {activeMainTab === 'characters' && (
          <CharactersPanel onNotification={showNotification} />
        )}

        {activeMainTab === 'sponsors' && (
          <SponsorsPanel onNotification={showNotification} />
        )}

        {activeMainTab === 'settings' && (
          <SettingsPanel onNotification={showNotification} />
        )}
      </main>

      {/* Transcript Modal */}
      {transcriptEpisode && (
        <TranscriptModal
          episode={transcriptEpisode}
          onClose={() => setTranscriptEpisode(null)}
        />
      )}

      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  )
}

export default App
