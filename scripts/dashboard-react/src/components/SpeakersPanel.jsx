import { useState, useEffect, useRef } from 'react'
import { speakersAPI } from '../services/api'
import { convertFileSrc } from '@tauri-apps/api/core'

export default function SpeakersPanel({ onNotification }) {
  const [speakers, setSpeakers] = useState([])
  const [speakerStats, setSpeakerStats] = useState([])
  const [voiceLibrary, setVoiceLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingSpeaker, setEditingSpeaker] = useState(null)
  const [formData, setFormData] = useState({ name: '', shortName: '', isHost: false })
  const [playingSpeaker, setPlayingSpeaker] = useState(null)
  const audioRef = useRef(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [speakersData, statsData, voiceData] = await Promise.all([
        speakersAPI.getSpeakers(),
        speakersAPI.getSpeakerStats(),
        speakersAPI.getVoiceLibrary(),
      ])
      setSpeakers(speakersData)
      setSpeakerStats(statsData)
      setVoiceLibrary(voiceData)
    } catch (error) {
      console.error('Error loading speakers:', error)
      onNotification?.('Error loading speakers', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleAddSpeaker = async () => {
    if (!formData.name.trim()) {
      onNotification?.('Name is required', 'error')
      return
    }
    try {
      await speakersAPI.createSpeaker(
        formData.name.trim(),
        formData.shortName.trim() || null,
        formData.isHost
      )
      onNotification?.(`Speaker "${formData.name}" added`, 'success')
      setFormData({ name: '', shortName: '', isHost: false })
      setShowAddForm(false)
      loadData()
    } catch (error) {
      onNotification?.(`Error adding speaker: ${error.message}`, 'error')
    }
  }

  const handleUpdateSpeaker = async () => {
    if (!editingSpeaker || !formData.name.trim()) return
    try {
      await speakersAPI.updateSpeaker(
        editingSpeaker.id,
        formData.name.trim(),
        formData.shortName.trim() || null,
        formData.isHost
      )
      onNotification?.(`Speaker "${formData.name}" updated`, 'success')
      setEditingSpeaker(null)
      setFormData({ name: '', shortName: '', isHost: false })
      loadData()
    } catch (error) {
      onNotification?.(`Error updating speaker: ${error.message}`, 'error')
    }
  }

  const handleDeleteSpeaker = async (speaker) => {
    if (!confirm(`Delete speaker "${speaker.name}"?`)) return
    try {
      await speakersAPI.deleteSpeaker(speaker.id)
      onNotification?.(`Speaker "${speaker.name}" deleted`, 'success')
      loadData()
    } catch (error) {
      onNotification?.(`Error deleting speaker: ${error.message}`, 'error')
    }
  }

  const startEditing = (speaker) => {
    setEditingSpeaker(speaker)
    setFormData({
      name: speaker.name,
      shortName: speaker.short_name || '',
      isHost: speaker.is_host,
    })
    setShowAddForm(false)
  }

  const cancelEditing = () => {
    setEditingSpeaker(null)
    setFormData({ name: '', shortName: '', isHost: false })
  }

  const formatTime = (seconds) => {
    if (!seconds) return '0m'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  // Play voice sample for a speaker
  const playSample = async (speakerName) => {
    try {
      const path = await speakersAPI.getVoiceSamplePath(speakerName)
      if (path && audioRef.current) {
        audioRef.current.src = convertFileSrc(path)
        audioRef.current.play()
        setPlayingSpeaker(speakerName)
      } else {
        onNotification?.('No voice sample available', 'info')
      }
    } catch (error) {
      console.error('Error playing sample:', error)
    }
  }

  const stopSample = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setPlayingSpeaker(null)
  }

  // Merge speakers with their stats and voice library info
  const speakersWithStats = speakers.map(speaker => {
    const stats = speakerStats.find(s => s.id === speaker.id) || {}
    const voiceInfo = voiceLibrary.find(v => v.name === speaker.name)
    return { ...speaker, ...stats, voiceInfo }
  })

  // Get voice library speakers that aren't in the database
  const voiceOnlySpeakers = voiceLibrary.filter(
    v => !speakers.find(s => s.name === v.name)
  )

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Speakers</h2>
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingSpeaker(null)
              setFormData({ name: '', shortName: '', isHost: false })
            }}
            className="px-3 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium text-sm transition-colors"
          >
            + Add Speaker
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Voice Library Section */}
        {voiceLibrary.length > 0 && (
          <div className="mb-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🎤</span>
              <h3 className="font-medium text-yellow-800">Voice Library</h3>
              <span className="text-sm text-yellow-600">({voiceLibrary.length} speakers with voice samples)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {voiceLibrary.map((speaker) => (
                <button
                  key={speaker.name}
                  onClick={() => playingSpeaker === speaker.name ? stopSample() : playSample(speaker.name)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    playingSpeaker === speaker.name
                      ? 'bg-yellow-400 border-yellow-500 shadow-md'
                      : 'bg-white border-yellow-300 hover:bg-yellow-100'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                    playingSpeaker === speaker.name ? 'bg-yellow-600' : 'bg-yellow-500'
                  }`}>
                    {speaker.short_name.charAt(0).toUpperCase()}
                  </span>
                  <div className="text-left">
                    <div className="font-medium text-gray-800 text-sm">{speaker.name}</div>
                    <div className="text-xs text-gray-500">{speaker.sample_count} sample{speaker.sample_count !== 1 ? 's' : ''}</div>
                  </div>
                  <span className={`ml-1 transition-transform ${playingSpeaker === speaker.name ? 'animate-pulse' : ''}`}>
                    {playingSpeaker === speaker.name ? '⏹️' : '▶️'}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-yellow-700 mt-3">
              Voice samples improve automatic speaker identification during diarization.
              Add more samples in the Transcript viewer by marking good clips.
            </p>
          </div>
        )}

        {/* Add/Edit Form */}
        {(showAddForm || editingSpeaker) && (
          <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
            <h3 className="font-medium text-purple-800 mb-3">
              {editingSpeaker ? 'Edit Speaker' : 'Add New Speaker'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Matt Donnelly"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Short Name</label>
                <input
                  type="text"
                  value={formData.shortName}
                  onChange={(e) => setFormData({ ...formData, shortName: e.target.value })}
                  placeholder="e.g., Matt"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="flex items-end gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isHost}
                    onChange={(e) => setFormData({ ...formData, isHost: e.target.checked })}
                    className="w-4 h-4 text-purple-500 border-gray-300 rounded focus:ring-purple-400"
                  />
                  <span className="text-sm text-gray-700">Is Host</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={editingSpeaker ? handleUpdateSpeaker : handleAddSpeaker}
                className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                {editingSpeaker ? 'Update' : 'Add Speaker'}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false)
                  cancelEditing()
                }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Speakers List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-gray-500">Loading speakers...</div>
          </div>
        ) : speakersWithStats.length === 0 && voiceOnlySpeakers.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No speakers yet. Add hosts and guests to track them across episodes.
          </div>
        ) : (
          <div className="space-y-3">
            {speakersWithStats.map((speaker) => (
              <div
                key={speaker.id}
                className={`p-4 rounded-lg border ${
                  speaker.is_host
                    ? 'bg-purple-50 border-purple-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                      speaker.is_host ? 'bg-purple-500' : 'bg-gray-400'
                    }`}>
                      {(speaker.short_name || speaker.name).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{speaker.name}</span>
                        {speaker.short_name && (
                          <span className="text-sm text-gray-500">({speaker.short_name})</span>
                        )}
                        {speaker.is_host && (
                          <span className="px-2 py-0.5 bg-purple-200 text-purple-700 rounded text-xs font-medium">
                            Host
                          </span>
                        )}
                        {speaker.voiceInfo && (
                          <span className="px-2 py-0.5 bg-yellow-200 text-yellow-700 rounded text-xs font-medium">
                            🎤 {speaker.voiceInfo.sample_count} sample{speaker.voiceInfo.sample_count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                        <span>{speaker.episode_count || 0} episodes</span>
                        <span>{formatTime(speaker.total_speaking_time)}</span>
                        <span>{speaker.total_segments || 0} segments</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {speaker.voiceInfo && (
                      <button
                        onClick={() => playingSpeaker === speaker.name ? stopSample() : playSample(speaker.name)}
                        className={`px-3 py-1 text-sm rounded transition-colors ${
                          playingSpeaker === speaker.name
                            ? 'bg-yellow-400 text-yellow-900'
                            : 'text-yellow-600 hover:bg-yellow-100'
                        }`}
                      >
                        {playingSpeaker === speaker.name ? '⏹️ Stop' : '▶️ Play'}
                      </button>
                    )}
                    <button
                      onClick={() => startEditing(speaker)}
                      className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-100 rounded transition-colors"
                    >
                      Edit
                    </button>
                    {!speaker.is_host && (
                      <button
                        onClick={() => handleDeleteSpeaker(speaker)}
                        className="px-3 py-1 text-sm text-red-600 hover:bg-red-100 rounded transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Voice-only speakers (in voice library but not in database) */}
            {voiceOnlySpeakers.length > 0 && (
              <>
                <div className="text-sm text-gray-500 mt-6 mb-2">
                  Voice Library Only (not in speakers list):
                </div>
                {voiceOnlySpeakers.map((speaker) => (
                  <div
                    key={speaker.name}
                    className="p-4 rounded-lg border bg-yellow-50 border-yellow-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold bg-yellow-500">
                          {speaker.short_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{speaker.name}</span>
                            <span className="px-2 py-0.5 bg-yellow-200 text-yellow-700 rounded text-xs font-medium">
                              🎤 {speaker.sample_count} sample{speaker.sample_count !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            Has voice samples but not added as speaker
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => playingSpeaker === speaker.name ? stopSample() : playSample(speaker.name)}
                          className={`px-3 py-1 text-sm rounded transition-colors ${
                            playingSpeaker === speaker.name
                              ? 'bg-yellow-400 text-yellow-900'
                              : 'text-yellow-600 hover:bg-yellow-100'
                          }`}
                        >
                          {playingSpeaker === speaker.name ? '⏹️ Stop' : '▶️ Play'}
                        </button>
                        <button
                          onClick={() => {
                            setFormData({
                              name: speaker.name,
                              shortName: speaker.short_name,
                              isHost: false
                            })
                            setShowAddForm(true)
                          }}
                          className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-100 rounded transition-colors"
                        >
                          Add as Speaker
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingSpeaker(null)}
        onError={() => setPlayingSpeaker(null)}
      />
    </div>
  )
}
