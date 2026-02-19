import { useState, useEffect, useRef } from 'react'
import { speakersAPI, contentAPI } from '../services/api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useConfirm } from '../hooks/useConfirm'

function IceCreamLoader({ message, detail }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <style>{`
          @keyframes scoop-drop {
            0% { transform: translateY(-30px); opacity: 0; }
            40% { transform: translateY(0px); opacity: 1; }
            60% { transform: translateY(0px); opacity: 1; }
            100% { transform: translateY(30px) scale(0.3); opacity: 0; }
          }
          .scoop-anim { animation: scoop-drop 2s ease-in-out infinite; }
        `}</style>
        <div className="relative mx-auto mb-6 w-20 h-28">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-pink-400 shadow-md scoop-anim" style={{ animationDelay: '0s', zIndex: 3 }}></div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-100 shadow-md scoop-anim" style={{ animationDelay: '0.6s', zIndex: 2 }}></div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-800 shadow-md scoop-anim" style={{ animationDelay: '1.2s', zIndex: 1 }}></div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '24px solid transparent', borderRight: '24px solid transparent', borderTop: '40px solid #d97706', zIndex: 4 }}></div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '20px solid transparent', borderRight: '20px solid transparent', borderTop: '34px solid #b45309', zIndex: 4, opacity: 0.3 }}></div>
        </div>
        <div className="text-gray-500 text-sm font-medium">{message || 'Loading...'}</div>
        {detail && <div className="text-gray-400 text-xs mt-1">{detail}</div>}
      </div>
    </div>
  )
}

function MiniIceCreamLoader() {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
      <style>{`
        @keyframes mini-scoop {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
      <div className="flex gap-0.5">
        <div className="w-2.5 h-2.5 rounded-full bg-pink-400" style={{ animation: 'mini-scoop 1s ease-in-out infinite', animationDelay: '0s' }}></div>
        <div className="w-2.5 h-2.5 rounded-full bg-amber-100" style={{ animation: 'mini-scoop 1s ease-in-out infinite', animationDelay: '0.2s' }}></div>
        <div className="w-2.5 h-2.5 rounded-full bg-amber-800" style={{ animation: 'mini-scoop 1s ease-in-out infinite', animationDelay: '0.4s' }}></div>
      </div>
      Loading samples...
    </div>
  )
}

function StarRating({ rating, onChange }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onClick={(e) => { e.stopPropagation(); onChange(rating === star ? 0 : star) }}
          className={`text-sm transition-colors ${
            star <= rating ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'
          }`}
          title={`Rate ${star} star${star !== 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function formatTimestamp(seconds) {
  if (seconds == null) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SpeakersPanel({ onNotification, onViewEpisode }) {
  const confirm = useConfirm()
  const [speakers, setSpeakers] = useState([])
  const [speakerStats, setSpeakerStats] = useState([])
  const [voiceLibrary, setVoiceLibrary] = useState([])
  const [audioDrops, setAudioDrops] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingSpeaker, setEditingSpeaker] = useState(null)
  const [formData, setFormData] = useState({ name: '', shortName: '', isHost: false })
  const [expandedRow, setExpandedRow] = useState(null)
  const [expandedSamples, setExpandedSamples] = useState({})
  const [loadingSamples, setLoadingSamples] = useState({})
  const [playingFile, setPlayingFile] = useState(null)
  const audioRef = useRef(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [speakersData, statsData, voiceData, dropsData] = await Promise.all([
        speakersAPI.getSpeakers(),
        speakersAPI.getSpeakerStats(),
        speakersAPI.getVoiceLibrary(),
        contentAPI.getAudioDrops(),
      ])
      setSpeakers(speakersData)
      setSpeakerStats(statsData)
      setVoiceLibrary(voiceData)
      setAudioDrops(dropsData)
    } catch (error) {
      console.error('Error loading data:', error)
      onNotification?.('Error loading audio ID data', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Lazy-load samples when a row is expanded
  const loadSamplesForRow = async (name) => {
    if (expandedSamples[name]) return
    setLoadingSamples(prev => ({ ...prev, [name]: true }))
    try {
      const samples = await speakersAPI.getVoiceSamples(name)
      setExpandedSamples(prev => ({ ...prev, [name]: samples }))
    } catch (error) {
      console.error('Error loading samples for', name, error)
      setExpandedSamples(prev => ({ ...prev, [name]: [] }))
    } finally {
      setLoadingSamples(prev => ({ ...prev, [name]: false }))
    }
  }

  const toggleRow = (name) => {
    if (expandedRow === name) {
      setExpandedRow(null)
    } else {
      setExpandedRow(name)
      loadSamplesForRow(name)
    }
  }

  // Speaker CRUD
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
    if (!await confirm(`Delete speaker "${speaker.name}"?`)) return
    try {
      await speakersAPI.deleteSpeaker(speaker.id)
      onNotification?.(`Speaker "${speaker.name}" deleted`, 'success')
      if (expandedRow === speaker.name) setExpandedRow(null)
      loadData()
    } catch (error) {
      onNotification?.(`Error deleting speaker: ${error.message}`, 'error')
    }
  }

  const startEditing = (speaker, e) => {
    e.stopPropagation()
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

  // Sample playback
  const playSample = (filePath) => {
    if (audioRef.current) {
      if (playingFile === filePath) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
        setPlayingFile(null)
        return
      }
      audioRef.current.src = convertFileSrc(filePath)
      audioRef.current.play()
      setPlayingFile(filePath)
    }
  }

  // Sound bite deletion
  const handleDeleteSoundBite = async (item) => {
    if (!item.drop?.id) {
      onNotification?.('Cannot delete: sound bite has no ID', 'error')
      return
    }
    if (!await confirm(`Delete sound bite "${item.cleanName}"? This will remove it from all episodes.`)) return
    try {
      await contentAPI.deleteAudioDrop(item.drop.id)
      onNotification?.(`Sound bite "${item.cleanName}" deleted`, 'success')
      loadData()
    } catch (error) {
      onNotification?.(`Error deleting sound bite: ${error.message}`, 'error')
    }
  }

  // Sample deletion
  const handleDeleteSample = async (speakerName, sample) => {
    if (!await confirm(`Delete sample "${sample.file_name}"?`)) return
    try {
      await speakersAPI.deleteVoiceSample(speakerName, sample.file_path, sample.id)
      onNotification?.(`Deleted "${sample.file_name}"`, 'success')
      // Reload samples for this row
      setExpandedSamples(prev => ({ ...prev, [speakerName]: undefined }))
      loadSamplesForRow(speakerName)
      // Also reload voice library to update counts
      const voiceData = await speakersAPI.getVoiceLibrary()
      setVoiceLibrary(voiceData)
    } catch (error) {
      onNotification?.(`Error deleting sample: ${error.message}`, 'error')
    }
  }

  // Sample rating
  const handleRateSample = async (speakerName, sample, rating) => {
    if (!sample.id) return
    try {
      await speakersAPI.updateVoiceSampleRating(sample.id, rating)
      // Update local state immediately
      setExpandedSamples(prev => ({
        ...prev,
        [speakerName]: (prev[speakerName] || []).map(s =>
          s.id === sample.id ? { ...s, rating } : s
        )
      }))
    } catch (error) {
      onNotification?.(`Error updating rating: ${error.message}`, 'error')
    }
  }

  const formatTime = (seconds) => {
    if (!seconds) return '0m'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Categorize voice library entries
  const isSoundBite = (voiceEntry) => {
    if (voiceEntry.name.startsWith('🔊')) return true
    return audioDrops.some(d => d.name === voiceEntry.name || `🔊 ${d.name}` === voiceEntry.name)
  }

  // Build speaker rows: merge DB speakers with voice library info
  const speakerRows = speakers.map(speaker => {
    const stats = speakerStats.find(s => s.id === speaker.id) || {}
    const voiceInfo = voiceLibrary.find(v => v.name === speaker.name)
    return { ...speaker, ...stats, voiceInfo, type: 'speaker' }
  })

  // Sort: hosts first, then by episode count
  speakerRows.sort((a, b) => {
    if (a.is_host !== b.is_host) return a.is_host ? -1 : 1
    return (b.episode_count || 0) - (a.episode_count || 0)
  })

  // Build sound bite rows from voice library entries that are sound bites
  const soundBiteVoiceEntries = voiceLibrary.filter(v => isSoundBite(v))
  const soundBiteRows = soundBiteVoiceEntries.map(v => {
    const cleanName = v.name.replace(/^🔊\s*/, '')
    const drop = audioDrops.find(d => d.name === cleanName)
    return {
      name: v.name,
      cleanName,
      voiceInfo: v,
      sample_count: v.sample_count,
      short_name: v.short_name,
      sample_file: v.sample_file,
      drop,
      type: 'sound_bite',
    }
  })

  // Also add audio_drops that have no voice library entry
  audioDrops.forEach(drop => {
    const hasVoice = voiceLibrary.some(v =>
      v.name === drop.name || v.name === `🔊 ${drop.name}`
    )
    if (!hasVoice) {
      soundBiteRows.push({
        name: drop.name,
        cleanName: drop.name,
        voiceInfo: null,
        sample_count: 0,
        short_name: drop.name.charAt(0),
        sample_file: null,
        drop,
        type: 'sound_bite',
      })
    }
  })

  // Unlinked voice entries: in voice library but not a speaker and not a sound bite
  const unlinkedEntries = voiceLibrary.filter(v => {
    if (isSoundBite(v)) return false
    return !speakers.some(s => s.name === v.name)
  })

  const renderRow = (item, section) => {
    const isExpanded = expandedRow === item.name
    const isSpeaker = section === 'speaker'
    const voiceInfo = item.voiceInfo
    const hasEmbedding = voiceInfo && voiceInfo.sample_count > 0
    const embeddingCount = voiceInfo?.sample_count || 0
    const fileCount = voiceInfo?.file_count || 0
    const sourceFile = voiceInfo?.sample_file || item.sample_file
    const avatar = (item.short_name || item.cleanName || item.name || '?').charAt(0).toUpperCase()

    return (
      <div key={item.name} className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Collapsed row header */}
        <div
          onClick={() => toggleRow(item.name)}
          className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
            isExpanded ? 'bg-gray-100' : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
              item.is_host ? 'bg-purple-500' : isSpeaker ? 'bg-gray-400' : 'bg-amber-500'
            }`}>
              {isSpeaker ? avatar : '🔊'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-800 truncate">
                  {item.cleanName || item.name}
                </span>
                {item.is_host && (
                  <span className="px-1.5 py-0.5 bg-purple-200 text-purple-700 rounded text-xs font-medium flex-shrink-0">
                    Host
                  </span>
                )}
                {hasEmbedding && (
                  <span
                    className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium flex-shrink-0"
                    title={`Voice print trained from ${embeddingCount} clip${embeddingCount !== 1 ? 's' : ''}${sourceFile ? ` (last: ${sourceFile})` : ''}`}
                  >
                    Voice ID ({embeddingCount}x)
                  </span>
                )}
                {fileCount > 0 && (
                  <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium flex-shrink-0">
                    {fileCount} clip{fileCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {isSpeaker && (
                <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                  <span>{item.episode_count || 0} episodes</span>
                  <span>{formatTime(item.total_speaking_time)}</span>
                  <span>{item.total_segments || 0} segments</span>
                </div>
              )}
              {!isSpeaker && item.drop?.description && (
                <div className="text-xs text-gray-500 mt-0.5 truncate">{item.drop.description}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className={`text-gray-400 text-xs transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
              ▶
            </span>
          </div>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
            {/* Action buttons */}
            {isSpeaker && (
              <div className="flex gap-2 mb-3">
                <button
                  onClick={(e) => startEditing(item, e)}
                  className="px-3 py-1 text-xs text-purple-600 hover:bg-purple-100 rounded border border-purple-200 transition-colors"
                >
                  Edit Speaker
                </button>
                {!item.is_host && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSpeaker(item); }}
                    className="px-3 py-1 text-xs text-red-600 hover:bg-red-100 rounded border border-red-200 transition-colors"
                  >
                    Delete Speaker
                  </button>
                )}
              </div>
            )}
            {!isSpeaker && item.drop && (
              <div className="flex gap-2 mb-3">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteSoundBite(item); }}
                  className="px-3 py-1 text-xs text-red-600 hover:bg-red-100 rounded border border-red-200 transition-colors"
                >
                  Delete Sound Bite
                </button>
              </div>
            )}

            {/* Voice ID info */}
            {hasEmbedding && (
              <div className="mb-3 p-2 bg-green-50 rounded border border-green-200 text-xs text-green-700">
                Voice print trained from {embeddingCount} clip{embeddingCount !== 1 ? 's' : ''}
                {sourceFile && (
                  <span className="text-green-600 ml-1">&middot; Last source: {sourceFile}</span>
                )}
              </div>
            )}

            {/* Audio sample files */}
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Audio Samples
            </div>
            {loadingSamples[item.name] ? (
              <MiniIceCreamLoader />
            ) : (expandedSamples[item.name] || []).length === 0 ? (
              <div className="text-sm text-gray-400 py-2">
                {hasEmbedding && fileCount === 0
                  ? 'Voice print trained from older clips (no audio files saved). Add new clips from the Transcript viewer to see them here.'
                  : 'No saved audio clips. Mark clips in the Transcript viewer to add samples.'}
              </div>
            ) : (
              <div className="space-y-1">
                {(expandedSamples[item.name] || []).map((sample) => (
                  <div
                    key={sample.file_path}
                    className="py-1.5 px-2 rounded hover:bg-white transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          onClick={() => playSample(sample.file_path)}
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 transition-colors ${
                            playingFile === sample.file_path
                              ? 'bg-yellow-400 text-yellow-900'
                              : 'bg-gray-200 hover:bg-gray-300 text-gray-600'
                          }`}
                        >
                          {playingFile === sample.file_path ? '⏹' : '▶'}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-700 truncate">{sample.file_name}</span>
                            {sample.id != null && (
                              <StarRating
                                rating={sample.rating || 0}
                                onChange={(r) => handleRateSample(item.name, sample, r)}
                              />
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>{formatFileSize(sample.file_size)}</span>
                            {sample.episode_title && (
                              <span className="text-gray-500">
                                {sample.episode_title.length > 30
                                  ? sample.episode_title.substring(0, 30) + '...'
                                  : sample.episode_title}
                              </span>
                            )}
                            {sample.start_time != null && sample.end_time != null && (
                              <span className="text-purple-500 font-medium">
                                {formatTimestamp(sample.start_time)}-{formatTimestamp(sample.end_time)}
                              </span>
                            )}
                            {!sample.episode_title && sample.created && (
                              <span>{sample.created}</span>
                            )}
                          </div>
                          {sample.transcript_text && (
                            <div className="text-xs text-gray-400 italic truncate mt-0.5">
                              "{sample.transcript_text.length > 60
                                ? sample.transcript_text.substring(0, 60) + '...'
                                : sample.transcript_text}"
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {sample.episode_id && onViewEpisode && (
                          <button
                            onClick={() => onViewEpisode(sample.episode_id, sample.start_time)}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded border border-purple-200 transition-colors flex-shrink-0"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            Jump to source
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteSample(item.name, sample)}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Delete sample"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Audio Identification</h2>
              <p className="text-purple-100 text-sm mt-0.5">
                Manage speakers and sound bites used for automatic audio identification
              </p>
            </div>
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

        {/* Add/Edit Form */}
        {(showAddForm || editingSpeaker) && (
          <div className="p-4 bg-purple-50 border-b border-purple-200">
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
      </div>

      {loading ? (
        <IceCreamLoader message="Scooping up audio ID data..." />
      ) : (
        <>
          {/* Section 1: Speakers */}
          <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-2">
                <span className="text-base">👥</span>
                <h3 className="font-semibold text-gray-800">Speakers</h3>
                <span className="text-sm text-gray-500">({speakerRows.length})</span>
              </div>
            </div>
            <div className="p-4 space-y-2">
              {speakerRows.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No speakers yet. Add hosts and guests to track them across episodes.
                </div>
              ) : (
                speakerRows.map(row => renderRow(row, 'speaker'))
              )}

              {/* Unlinked voice entries that could be speakers */}
              {unlinkedEntries.length > 0 && (
                <>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mt-4 mb-1 px-1">
                    Voice Library Only (not added as speaker)
                  </div>
                  {unlinkedEntries.map(v => (
                    <div key={v.name} className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-dashed border-yellow-300 bg-yellow-50">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm bg-yellow-500">
                          {v.short_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{v.name}</span>
                            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                              Voice ID ({v.sample_count}x)
                            </span>
                          </div>
                          {v.sample_file && (
                            <div className="text-xs text-gray-400 mt-0.5">Source: {v.sample_file}</div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setFormData({ name: v.name, shortName: v.short_name, isHost: false })
                          setShowAddForm(true)
                        }}
                        className="px-3 py-1 text-xs text-purple-600 hover:bg-purple-100 rounded border border-purple-200 transition-colors"
                      >
                        Add as Speaker
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Section 2: Sound Bites */}
          <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-2">
                <span className="text-base">🔊</span>
                <h3 className="font-semibold text-gray-800">Sound Bites</h3>
                <span className="text-sm text-gray-500">({soundBiteRows.length})</span>
              </div>
            </div>
            <div className="p-4 space-y-2">
              {soundBiteRows.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No sound bites yet. Sound bites are non-speech audio identified during diarization (intros, music, drops).
                </div>
              ) : (
                soundBiteRows.map(row => renderRow(row, 'sound_bite'))
              )}
            </div>
          </div>
        </>
      )}

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingFile(null)}
        onError={() => setPlayingFile(null)}
      />
    </div>
  )
}
