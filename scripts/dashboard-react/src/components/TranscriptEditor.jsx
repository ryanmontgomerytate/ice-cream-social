import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { episodesAPI, speakersAPI, contentAPI } from '../services/api'
import { convertFileSrc } from '@tauri-apps/api/core'

// Flag types for segment issues
const FLAG_TYPES = [
  { id: 'wrong_speaker', label: 'Wrong Speaker', icon: '👤', needsSpeaker: true },
  { id: 'character_voice', label: 'Character Voice', icon: '🎭', needsCharacter: true },
  { id: 'multiple_speakers', label: 'Multiple Speakers', icon: '👥', needsSpeakers: true },
  { id: 'audio_issue', label: 'Audio Issue', icon: '🔇' },
  { id: 'other', label: 'Other', icon: '📝', needsNotes: true },
]

// Speaker color palette with hex values for left column backgrounds
const SPEAKER_COLORS = {
  'SPEAKER_00': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'bg-blue-200 text-blue-800', border: 'border-blue-300', ring: 'ring-blue-400', hex: '#dbeafe', borderHex: '#93c5fd' },
  'SPEAKER_01': { bg: 'bg-green-100', text: 'text-green-700', label: 'bg-green-200 text-green-800', border: 'border-green-300', ring: 'ring-green-400', hex: '#dcfce7', borderHex: '#86efac' },
  'SPEAKER_02': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'bg-orange-200 text-orange-800', border: 'border-orange-300', ring: 'ring-orange-400', hex: '#ffedd5', borderHex: '#fdba74' },
  'SPEAKER_03': { bg: 'bg-purple-100', text: 'text-purple-700', label: 'bg-purple-200 text-purple-800', border: 'border-purple-300', ring: 'ring-purple-400', hex: '#f3e8ff', borderHex: '#c084fc' },
  'SPEAKER_04': { bg: 'bg-pink-100', text: 'text-pink-700', label: 'bg-pink-200 text-pink-800', border: 'border-pink-300', ring: 'ring-pink-400', hex: '#fce7f3', borderHex: '#f9a8d4' },
  'SPEAKER_05': { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'bg-cyan-200 text-cyan-800', border: 'border-cyan-300', ring: 'ring-cyan-400', hex: '#cffafe', borderHex: '#67e8f9' },
  'UNKNOWN': { bg: 'bg-gray-100', text: 'text-gray-600', label: 'bg-gray-200 text-gray-600', border: 'border-gray-300', ring: 'ring-gray-400', hex: '#f3f4f6', borderHex: '#d1d5db' },
}

const getSpeakerColor = (speaker) => SPEAKER_COLORS[speaker] || SPEAKER_COLORS['UNKNOWN']

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function TranscriptEditor({
  episode,
  onNotification,
  onFlaggedSegmentsChange,
  onCharacterAppearancesChange,
  onChaptersChange,
  onMarkedSamplesChange,
  onSpeakersChange,
  onSpeakerNamesChange,
  onVoiceLibraryChange,
  onAudioDropInstancesChange,
  onAudioDropsChange,
  onSegmentsChange,
  selectedSegmentIdx,
  onSelectedSegmentChange,
}) {
  const [transcript, setTranscript] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('speakers')
  const [speakerNames, setSpeakerNames] = useState({})
  const [voiceLibrary, setVoiceLibrary] = useState([])
  const [characters, setCharacters] = useState([])
  const [chapterTypes, setChapterTypes] = useState([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [saving, setSaving] = useState(false)

  // Local state for segment data
  const [flaggedSegments, setFlaggedSegments] = useState({})
  const [characterAppearances, setCharacterAppearances] = useState([])
  const [episodeChapters, setEpisodeChapters] = useState([])
  const [markedSamples, setMarkedSamples] = useState({})

  // Audio drops state
  const [audioDrops, setAudioDrops] = useState([])
  const [audioDropInstances, setAudioDropInstances] = useState([])

  // Inline picker state
  const [activePicker, setActivePicker] = useState(null)
  const [newCharacterName, setNewCharacterName] = useState('')
  const [newDropName, setNewDropName] = useState('')
  const [speakerPickerIdx, setSpeakerPickerIdx] = useState(null)  // segment idx for multi-speaker picker
  const [speakerPickerSelected, setSpeakerPickerSelected] = useState([])  // selected speaker IDs

  // Audio state
  const [audioPath, setAudioPath] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)

  const audioRef = useRef(null)
  const transcriptContainerRef = useRef(null)
  const segmentRefs = useRef({})

  // Load transcript when episode changes
  useEffect(() => {
    if (episode?.id) {
      loadTranscript()
      loadAudioPath()
    }
  }, [episode?.id])

  const loadTranscript = async () => {
    try {
      setLoading(true)
      setError(null)

      const [data, voices, types, chapters, flags, charAppearances, allCharacters, drops, dropInstances] = await Promise.all([
        episodesAPI.getTranscript(episode.id),
        speakersAPI.getVoiceLibrary().catch(() => []),
        contentAPI.getChapterTypes().catch(() => []),
        contentAPI.getEpisodeChapters(episode.id).catch(() => []),
        contentAPI.getFlaggedSegments(episode.id).catch(() => []),
        contentAPI.getCharacterAppearancesForEpisode(episode.id).catch(() => []),
        contentAPI.getCharacters().catch(() => []),
        contentAPI.getAudioDrops().catch(() => []),
        contentAPI.getAudioDropInstances(episode.id).catch(() => [])
      ])

      setTranscript(data)
      setVoiceLibrary(voices)
      setChapterTypes(types)
      setCharacters(allCharacters)
      setAudioDrops(drops)
      onAudioDropsChange?.(drops)
      setAudioDropInstances(dropInstances)
      onAudioDropInstancesChange?.(dropInstances)

      setEpisodeChapters(chapters)
      setCharacterAppearances(charAppearances)
      onChaptersChange?.(chapters)
      onCharacterAppearancesChange?.(charAppearances)

      const flagsMap = {}
      flags.forEach(flag => { flagsMap[flag.segment_idx] = flag })
      setFlaggedSegments(flagsMap)
      onFlaggedSegmentsChange?.(flagsMap)

      if (data.speaker_names) {
        setSpeakerNames(data.speaker_names)
      }
    } catch (err) {
      console.error('Error loading transcript:', err)
      setError(err.message || 'Failed to load transcript')
    } finally {
      setLoading(false)
    }
  }

  const loadAudioPath = async () => {
    try {
      const path = await episodesAPI.getAudioPath(episode.id)
      if (path) {
        setAudioPath(convertFileSrc(path))
      }
    } catch (err) {
      console.error('Failed to load audio path:', err)
    }
  }

  // Parse segments
  const segments = useMemo(() => {
    if (!transcript?.segments_json) return null
    try {
      const parsed = JSON.parse(transcript.segments_json)
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
    } catch (e) {
      return null
    }
  }, [transcript?.segments_json])

  useEffect(() => {
    onSegmentsChange?.(segments)
  }, [segments])

  const uniqueSpeakers = useMemo(() => {
    if (!segments) return []
    const speakers = new Set()
    segments.forEach(seg => {
      if (seg.speaker && seg.speaker !== 'UNKNOWN') speakers.add(seg.speaker)
    })
    return Array.from(speakers).sort()
  }, [segments])

  useEffect(() => {
    onSpeakersChange?.(uniqueSpeakers)
  }, [uniqueSpeakers])

  useEffect(() => {
    onSpeakerNamesChange?.(speakerNames)
  }, [speakerNames])

  useEffect(() => {
    onVoiceLibraryChange?.(voiceLibrary)
  }, [voiceLibrary])

  const hasSpeakerLabels = useMemo(() => {
    return segments?.some(seg => seg.speaker && seg.speaker !== 'UNKNOWN') ?? false
  }, [segments])

  // Timestamp helpers
  const parseTimestampToSeconds = useCallback((segment) => {
    if (segment.timestamps?.from) {
      const ts = segment.timestamps.from.replace(',', '.')
      const parts = ts.split(':')
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
      }
    }
    return typeof segment.start === 'number' ? segment.start : 0
  }, [])

  const getSegmentEndTime = useCallback((segment) => {
    if (segment.timestamps?.to) {
      const ts = segment.timestamps.to.replace(',', '.')
      const parts = ts.split(':')
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
      }
    }
    return typeof segment.end === 'number' ? segment.end : parseTimestampToSeconds(segment) + 10
  }, [parseTimestampToSeconds])

  const formatTimestamp = (segment) => {
    if (segment.timestamps?.from) {
      return segment.timestamps.from.replace(',', '.').slice(0, 8)
    }
    if (typeof segment.start === 'number') {
      return formatTime(segment.start)
    }
    return ''
  }

  // Current segment based on playback time (stays highlighted when paused)
  const currentSegmentIdx = useMemo(() => {
    if (!segments || currentTime <= 0) return -1
    for (let i = 0; i < segments.length; i++) {
      const start = parseTimestampToSeconds(segments[i])
      const end = getSegmentEndTime(segments[i])
      if (currentTime >= start && currentTime < end) return i
    }
    return -1
  }, [segments, currentTime, parseTimestampToSeconds, getSegmentEndTime])

  // Auto-scroll to current segment
  useEffect(() => {
    if (autoScroll && currentSegmentIdx >= 0 && segmentRefs.current[currentSegmentIdx]) {
      segmentRefs.current[currentSegmentIdx].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [currentSegmentIdx, autoScroll])

  // Audio controls — re-attach when audioPath changes OR when loading finishes
  // (the <audio> element only exists in the DOM after loading completes)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleDurationChange = () => setDuration(audio.duration)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => { setIsPlaying(false) }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    // If audio already has duration (cached/preloaded), sync it
    if (audio.duration && !isNaN(audio.duration)) {
      setDuration(audio.duration)
    }

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('durationchange', handleDurationChange)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [audioPath, loading])

  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play().catch(err => {
        console.error('Audio play failed:', err)
        onNotification?.('Audio playback failed — file may be missing', 'error')
      })
    }
  }

  const seekTo = (time) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = time
    setCurrentTime(time)
  }

  const seekToSegment = (segment) => {
    const time = parseTimestampToSeconds(segment)
    seekTo(time)
    if (!isPlaying && audioRef.current) {
      audioRef.current.play().catch(err => console.error('Audio play failed:', err))
    }
  }

  const seekToSegmentIdx = (idx) => {
    if (segments?.[idx]) {
      seekToSegment(segments[idx])
      segmentRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const skip = (seconds) => {
    if (!audioRef.current) return
    seekTo(Math.max(0, Math.min(duration, currentTime + seconds)))
  }

  // Flag operations
  const createFlag = async (idx, flagType, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null) => {
    try {
      const speakerIdsJson = speakerIds ? JSON.stringify(speakerIds) : null
      const id = await contentAPI.createFlaggedSegment(episode.id, idx, flagType, correctedSpeaker, characterId, notes, speakerIdsJson)
      const newFlags = {
        ...flaggedSegments,
        [idx]: { id, episode_id: episode.id, segment_idx: idx, flag_type: flagType, corrected_speaker: correctedSpeaker, character_id: characterId, notes, speaker_ids: speakerIdsJson, resolved: false }
      }
      setFlaggedSegments(newFlags)
      onFlaggedSegmentsChange?.(newFlags)
      setActivePicker(null)
      setSpeakerPickerIdx(null)
      setSpeakerPickerSelected([])
    } catch (err) {
      onNotification?.(`Failed to create flag: ${err.message}`, 'error')
    }
  }

  const deleteFlag = async (idx) => {
    const flag = flaggedSegments[idx]
    if (!flag) return
    try {
      await contentAPI.deleteFlaggedSegment(flag.id)
      const newFlags = { ...flaggedSegments }
      delete newFlags[idx]
      setFlaggedSegments(newFlags)
      onFlaggedSegmentsChange?.(newFlags)
    } catch (err) {
      onNotification?.(`Failed to delete flag: ${err.message}`, 'error')
    }
  }

  // Character operations
  const addCharacterToSegment = async (idx, characterId) => {
    const segment = segments[idx]
    if (!segment) return
    try {
      await contentAPI.addCharacterAppearance(characterId, episode.id, parseTimestampToSeconds(segment), getSegmentEndTime(segment), idx)
      const appearances = await contentAPI.getCharacterAppearancesForEpisode(episode.id)
      setCharacterAppearances(appearances)
      onCharacterAppearancesChange?.(appearances)
      setActivePicker(null)
    } catch (err) {
      onNotification?.(`Failed to add character: ${err.message}`, 'error')
    }
  }

  const createCharacterAndAdd = async (idx, name) => {
    if (!name.trim()) return
    try {
      const characterId = await contentAPI.createCharacter(name.trim(), null, null, null)
      await addCharacterToSegment(idx, characterId)
      const allCharacters = await contentAPI.getCharacters()
      setCharacters(allCharacters)
      setNewCharacterName('')
    } catch (err) {
      onNotification?.(`Failed to create character: ${err.message}`, 'error')
    }
  }

  const removeCharacterFromSegment = async (appearanceId) => {
    try {
      await contentAPI.deleteCharacterAppearance(appearanceId)
      const appearances = await contentAPI.getCharacterAppearancesForEpisode(episode.id)
      setCharacterAppearances(appearances)
      onCharacterAppearancesChange?.(appearances)
    } catch (err) {
      onNotification?.(`Failed to remove character: ${err.message}`, 'error')
    }
  }

  // Chapter operations
  const createChapter = async (chapterTypeId, segmentIdx) => {
    if (!segments || segmentIdx == null) return
    const segment = segments[segmentIdx]
    const startTime = segment.start ?? parseTimestampToSeconds(segment)
    const endTime = segment.end ?? getSegmentEndTime(segment)
    try {
      await contentAPI.createEpisodeChapter(episode.id, chapterTypeId, null, startTime, endTime, segmentIdx, segmentIdx)
      const chapters = await contentAPI.getEpisodeChapters(episode.id)
      setEpisodeChapters(chapters)
      onChaptersChange?.(chapters)
      setActivePicker(null)
    } catch (err) {
      onNotification?.(`Failed to create chapter: ${err.message}`, 'error')
    }
  }

  const deleteChapter = async (chapterId) => {
    try {
      await contentAPI.deleteEpisodeChapter(chapterId)
      const chapters = await contentAPI.getEpisodeChapters(episode.id)
      setEpisodeChapters(chapters)
      onChaptersChange?.(chapters)
    } catch (err) {
      onNotification?.(`Failed to delete chapter: ${err.message}`, 'error')
    }
  }

  // Audio drop operations
  const addAudioDropToSegment = async (idx, audioDropId) => {
    const segment = segments[idx]
    if (!segment) return
    try {
      await contentAPI.addAudioDropInstance(audioDropId, episode.id, idx, parseTimestampToSeconds(segment), getSegmentEndTime(segment))
      const instances = await contentAPI.getAudioDropInstances(episode.id)
      setAudioDropInstances(instances)
      onAudioDropInstancesChange?.(instances)
      setActivePicker(null)
    } catch (err) {
      onNotification?.(`Failed to add audio drop: ${err.message}`, 'error')
    }
  }

  const createDropAndAdd = async (idx, name) => {
    if (!name.trim()) return
    try {
      const dropId = await contentAPI.createAudioDrop(name.trim())
      await addAudioDropToSegment(idx, dropId)
      const allDrops = await contentAPI.getAudioDrops()
      setAudioDrops(allDrops)
      setNewDropName('')
    } catch (err) {
      onNotification?.(`Failed to create audio drop: ${err.message}`, 'error')
    }
  }

  const removeAudioDropInstance = async (instanceId) => {
    try {
      await contentAPI.deleteAudioDropInstance(instanceId)
      const instances = await contentAPI.getAudioDropInstances(episode.id)
      setAudioDropInstances(instances)
      onAudioDropInstancesChange?.(instances)
    } catch (err) {
      onNotification?.(`Failed to remove audio drop: ${err.message}`, 'error')
    }
  }

  // Voice sample operations
  const toggleVoiceSample = (idx) => {
    const newSamples = { ...markedSamples }
    if (newSamples[idx]) {
      delete newSamples[idx]
    } else {
      newSamples[idx] = true
    }
    setMarkedSamples(newSamples)
    onMarkedSamplesChange?.(newSamples)
    setHasUnsavedChanges(true)
  }

  // Speaker name assignment
  const handleAssignSpeakerName = (originalLabel, displayName) => {
    setSpeakerNames(prev => ({ ...prev, [originalLabel]: displayName }))
    setHasUnsavedChanges(true)
    setActivePicker(null)
  }

  // Helpers
  const getCharacterForSegment = (idx) => characterAppearances.find(ca => ca.segment_idx === idx)
  const getChapterForSegment = (idx) => episodeChapters.find(ch => ch.start_segment_idx <= idx && ch.end_segment_idx >= idx)
  const getDropsForSegment = (idx) => audioDropInstances.filter(adi => adi.segment_idx === idx)
  const getDropOccurrence = (instance) => {
    const sameDropInEpisode = audioDropInstances.filter(adi => adi.audio_drop_id === instance.audio_drop_id)
    const position = sameDropInEpisode.findIndex(adi => adi.id === instance.id) + 1
    return { position, total: sameDropInEpisode.length }
  }

  // Filter segments by search
  const filteredSegments = useMemo(() => {
    if (!segments) return null
    if (!searchQuery) return segments
    const query = searchQuery.toLowerCase()
    return segments.filter(seg => seg.text?.toLowerCase().includes(query))
  }, [segments, searchQuery])

  // Save changes
  const saveEdits = async () => {
    if (!hasUnsavedChanges) return
    try {
      setSaving(true)
      await episodesAPI.updateSpeakerNames(episode.id, speakerNames)
      if (Object.keys(markedSamples).length > 0 && segments) {
        const samplesToSave = Object.keys(markedSamples).map(idx => {
          const segment = segments[parseInt(idx)]
          return {
            speaker: segment.speaker,
            speakerName: speakerNames[segment.speaker] || segment.speaker,
            startTime: parseTimestampToSeconds(segment),
            endTime: getSegmentEndTime(segment),
            text: segment.text
          }
        })
        await episodesAPI.saveVoiceSamples(episode.id, samplesToSave).catch(() => {})
      }
      setHasUnsavedChanges(false)
      onNotification?.('Changes saved', 'success')
    } catch (err) {
      onNotification?.(`Failed to save: ${err.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  // Seek to first segment from a speaker
  const seekToSpeaker = useCallback((speakerId) => {
    if (!segments) return
    const idx = segments.findIndex(seg => seg.speaker === speakerId)
    if (idx >= 0) {
      seekToSegmentIdx(idx)
    }
  }, [segments])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (!segments) return

      switch (e.key) {
        case 'j':
        case 'J': {
          e.preventDefault()
          const nextIdx = selectedSegmentIdx != null ? Math.min(selectedSegmentIdx + 1, segments.length - 1) : 0
          onSelectedSegmentChange?.(nextIdx)
          segmentRefs.current[nextIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          break
        }
        case 'k':
        case 'K': {
          e.preventDefault()
          const prevIdx = selectedSegmentIdx != null ? Math.max(selectedSegmentIdx - 1, 0) : 0
          onSelectedSegmentChange?.(prevIdx)
          segmentRefs.current[prevIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          break
        }
        case ' ': {
          e.preventDefault()
          togglePlay()
          break
        }
        case 'f':
        case 'F': {
          if (selectedSegmentIdx != null) {
            e.preventDefault()
            setActivePicker(activePicker === 'flag' ? null : 'flag')
          }
          break
        }
        case 'c':
        case 'C': {
          if (selectedSegmentIdx != null) {
            e.preventDefault()
            setActivePicker(activePicker === 'character' ? null : 'character')
          }
          break
        }
        case 'h':
        case 'H': {
          if (selectedSegmentIdx != null) {
            e.preventDefault()
            setActivePicker(activePicker === 'chapter' ? null : 'chapter')
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          if (activePicker) {
            setActivePicker(null)
          } else {
            onSelectedSegmentChange?.(null)
          }
          break
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [segments, selectedSegmentIdx, activePicker])

  // Expose global functions for parent
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__transcriptEditorSeekToSegment = seekToSegmentIdx
      window.__transcriptEditorSeekToSpeaker = seekToSpeaker
      window.__transcriptEditorAssignSpeakerName = handleAssignSpeakerName
      window.__transcriptEditorAddAudioDrop = addAudioDropToSegment
      window.__transcriptEditorCreateFlag = createFlag
      window.__transcriptEditorAddCharacter = addCharacterToSegment
      window.__transcriptEditorCreateChapter = createChapter
      window.__transcriptEditorDeleteFlag = deleteFlag
      window.__transcriptEditorRemoveCharacter = removeCharacterFromSegment
      window.__transcriptEditorDeleteChapter = deleteChapter
      window.__transcriptEditorToggleVoiceSample = toggleVoiceSample
      window.__transcriptEditorRemoveAudioDrop = removeAudioDropInstance
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__transcriptEditorSeekToSegment
        delete window.__transcriptEditorSeekToSpeaker
        delete window.__transcriptEditorAssignSpeakerName
        delete window.__transcriptEditorAddAudioDrop
        delete window.__transcriptEditorCreateFlag
        delete window.__transcriptEditorAddCharacter
        delete window.__transcriptEditorCreateChapter
        delete window.__transcriptEditorDeleteFlag
        delete window.__transcriptEditorRemoveCharacter
        delete window.__transcriptEditorDeleteChapter
        delete window.__transcriptEditorToggleVoiceSample
        delete window.__transcriptEditorRemoveAudioDrop
      }
    }
  })

  // ---- Inline Picker Component ----
  const renderActionPicker = (pickerType, idx) => {
    if (pickerType === 'flag') {
      // Show speaker checklist for multiple_speakers flag
      if (speakerPickerIdx === idx) {
        return (
          <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Select speakers present</div>
            {uniqueSpeakers.map(spk => {
              const displayName = speakerNames[spk] || spk
              const isSelected = speakerPickerSelected.includes(spk)
              const color = getSpeakerColor(spk)
              return (
                <label key={spk} className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-50 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      e.stopPropagation()
                      setSpeakerPickerSelected(prev =>
                        isSelected ? prev.filter(s => s !== spk) : [...prev, spk]
                      )
                    }}
                    className="rounded"
                  />
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.hex }} />
                  <span>{displayName}</span>
                </label>
              )
            })}
            <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
              <button onClick={(e) => {
                e.stopPropagation()
                if (speakerPickerSelected.length >= 2) {
                  createFlag(idx, 'multiple_speakers', null, null, null, speakerPickerSelected)
                }
              }} disabled={speakerPickerSelected.length < 2} className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">
                Save ({speakerPickerSelected.length} selected)
              </button>
              <button onClick={(e) => {
                e.stopPropagation()
                setSpeakerPickerIdx(null)
                setSpeakerPickerSelected([])
              }} className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        )
      }

      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Flag type</div>
          {FLAG_TYPES.map(ft => (
            <button key={ft.id} onClick={(e) => {
              e.stopPropagation()
              if (ft.needsSpeaker) {
                const speaker = prompt('Who should this be?')
                if (speaker) createFlag(idx, ft.id, speaker)
              } else if (ft.needsSpeakers) {
                // Show inline speaker checklist
                setSpeakerPickerIdx(idx)
                setSpeakerPickerSelected([])
              } else if (ft.needsNotes) {
                const notes = prompt('Add a note:')
                if (notes) createFlag(idx, ft.id, null, null, notes)
              } else {
                createFlag(idx, ft.id)
              }
            }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-red-50 flex items-center gap-2">
              <span>{ft.icon}</span> {ft.label}
            </button>
          ))}
        </div>
      )
    }
    if (pickerType === 'character') {
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Character</div>
          {characters.slice(0, 8).map(c => (
            <button key={c.id} onClick={(e) => { e.stopPropagation(); addCharacterToSegment(idx, c.id) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-pink-50 text-pink-800 flex items-center gap-2">
              <span>🎭</span> {c.name}
            </button>
          ))}
          <input type="text" placeholder="+ New character..." value={newCharacterName} onChange={(e) => setNewCharacterName(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && newCharacterName.trim()) createCharacterAndAdd(idx, newCharacterName)
          }} className="w-full mt-1 px-2 py-1.5 text-sm border rounded" onClick={(e) => e.stopPropagation()} />
        </div>
      )
    }
    if (pickerType === 'chapter') {
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Chapter type</div>
          {chapterTypes.map(ct => (
            <button key={ct.id} onClick={(e) => { e.stopPropagation(); createChapter(ct.id, idx) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-indigo-50 flex items-center gap-2">
              <span>{ct.icon}</span> <span style={{ color: ct.color }}>{ct.name}</span>
            </button>
          ))}
        </div>
      )
    }
    if (pickerType === 'speaker') {
      const segment = segments?.[idx]
      if (!segment) return null
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Assign speaker</div>
          {voiceLibrary.map(v => (
            <button key={v.name} onClick={(e) => { e.stopPropagation(); handleAssignSpeakerName(segment.speaker, v.name) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-yellow-50 text-yellow-800 flex items-center gap-2">
              <span>🎤</span> {v.short_name || v.name}
            </button>
          ))}
        </div>
      )
    }
    if (pickerType === 'audiodrop') {
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Audio drop</div>
          {audioDrops.map(drop => (
            <button key={drop.id} onClick={(e) => { e.stopPropagation(); addAudioDropToSegment(idx, drop.id) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-teal-50 text-teal-800 flex items-center gap-2">
              <span>🔊</span> {drop.name}
            </button>
          ))}
          <input type="text" placeholder="+ New drop..." value={newDropName} onChange={(e) => setNewDropName(e.target.value)} onKeyDown={(e) => {
            if (e.key === 'Enter' && newDropName.trim()) createDropAndAdd(idx, newDropName)
          }} className="w-full mt-1 px-2 py-1.5 text-sm border rounded" onClick={(e) => e.stopPropagation()} />
        </div>
      )
    }
    return null
  }

  // ---- Badge rendering (below text) ----
  const renderBadges = (idx) => {
    const flag = flaggedSegments[idx]
    const character = getCharacterForSegment(idx)
    const chapter = getChapterForSegment(idx)
    const drops = getDropsForSegment(idx)
    const hasSample = markedSamples[idx]

    if (!flag && !character && !chapter && drops.length === 0 && !hasSample) return null

    return (
      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-200/50">
        {flag && (
          <span className={`px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            flag.flag_type === 'wrong_speaker' ? 'bg-red-100 text-red-700' :
            flag.flag_type === 'character_voice' ? 'bg-pink-100 text-pink-700' :
            'bg-yellow-100 text-yellow-700'
          }`} onClick={(e) => { e.stopPropagation(); deleteFlag(idx) }} title="Click to remove flag">
            {FLAG_TYPES.find(f => f.id === flag.flag_type)?.icon || '🚩'}{' '}
            {flag.flag_type === 'multiple_speakers' && flag.speaker_ids
              ? (() => {
                  try {
                    const ids = JSON.parse(flag.speaker_ids)
                    const names = ids.map(id => speakerNames[id] || id)
                    return `Multiple: ${names.join(', ')}`
                  } catch { return 'Multiple Speakers' }
                })()
              : (FLAG_TYPES.find(f => f.id === flag.flag_type)?.label || 'Flag')
            }
          </span>
        )}
        {character && (
          <span className="px-2 py-1 rounded text-xs font-medium bg-pink-100 text-pink-700 cursor-pointer" onClick={(e) => { e.stopPropagation(); removeCharacterFromSegment(character.id) }} title="Click to remove">
            🎭 {character.character_name}
          </span>
        )}
        {chapter && (
          <span className="px-2 py-1 rounded text-xs font-medium cursor-pointer" style={{ backgroundColor: chapter.chapter_type_color + '33', color: chapter.chapter_type_color }} onClick={(e) => { e.stopPropagation(); deleteChapter(chapter.id) }} title="Click to remove">
            {chapter.chapter_type_icon} {chapter.chapter_type_name}
          </span>
        )}
        {drops.map(dropInst => {
          const occ = getDropOccurrence(dropInst)
          return (
            <span key={dropInst.id} className="px-2 py-1 rounded text-xs font-medium bg-teal-100 text-teal-700 cursor-pointer" onClick={(e) => { e.stopPropagation(); removeAudioDropInstance(dropInst.id) }} title={`${dropInst.audio_drop_name}${occ.total > 1 ? ` (${occ.position} of ${occ.total})` : ''} — click to remove`}>
              🔊 {dropInst.audio_drop_name}
            </span>
          )
        })}
        {hasSample && (
          <span className="px-2 py-1 bg-yellow-400 text-yellow-900 rounded text-xs font-medium cursor-pointer" onClick={(e) => { e.stopPropagation(); toggleVoiceSample(idx) }}>
            ⭐ Sample
          </span>
        )}
      </div>
    )
  }

  // ---- Expanded Toolbar (on selected segment) ----
  const renderToolbar = (idx) => {
    if (selectedSegmentIdx !== idx) return null
    return (
      <div className="overflow-hidden transition-all duration-200 ease-in-out" style={{ maxHeight: selectedSegmentIdx === idx ? '500px' : '0' }}>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            <button onClick={(e) => { e.stopPropagation(); setActivePicker(activePicker === 'flag' ? null : 'flag') }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activePicker === 'flag' ? 'bg-red-100 text-red-700 ring-1 ring-red-300' : 'bg-white text-gray-600 hover:bg-red-50 border border-gray-200'}`}>
              🚩 Flag
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker(activePicker === 'character' ? null : 'character') }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activePicker === 'character' ? 'bg-pink-100 text-pink-700 ring-1 ring-pink-300' : 'bg-white text-gray-600 hover:bg-pink-50 border border-gray-200'}`}>
              🎭 Character
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker(activePicker === 'chapter' ? null : 'chapter') }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activePicker === 'chapter' ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300' : 'bg-white text-gray-600 hover:bg-indigo-50 border border-gray-200'}`}>
              📑 Chapter
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker(activePicker === 'audiodrop' ? null : 'audiodrop') }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activePicker === 'audiodrop' ? 'bg-teal-100 text-teal-700 ring-1 ring-teal-300' : 'bg-white text-gray-600 hover:bg-teal-50 border border-gray-200'}`}>
              🔊 Drop
            </button>
            <button onClick={(e) => { e.stopPropagation(); toggleVoiceSample(idx) }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${markedSamples[idx] ? 'bg-yellow-300 text-yellow-900 ring-1 ring-yellow-400' : 'bg-white text-gray-600 hover:bg-yellow-50 border border-gray-200'}`}>
              {markedSamples[idx] ? '⭐ Unmark' : '☆ Sample'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker(activePicker === 'speaker' ? null : 'speaker') }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activePicker === 'speaker' ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300' : 'bg-white text-gray-600 hover:bg-purple-50 border border-gray-200'}`}>
              ✎ Speaker
            </button>
          </div>
          {activePicker && renderActionPicker(activePicker, idx)}
        </div>
      </div>
    )
  }

  if (!episode) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-4">📄</div>
          <p>Select an episode to view transcript</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-gray-500">Loading transcript...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-red-500 text-4xl mb-4">⚠</div>
          <div className="text-red-600 font-medium mb-4">{error}</div>
          <button onClick={loadTranscript} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!transcript) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-4">📄</div>
          <p>No transcript available for this episode</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header with episode info */}
      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-lg font-bold text-gray-800 truncate">{episode.title}</h2>
        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500 flex-wrap">
          {transcript?.language && <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{transcript.language}</span>}
          {transcript?.has_diarization && (
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
              👥 {transcript.num_speakers} speakers
            </span>
          )}
          {episodeChapters.length > 0 && (
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">
              📑 {episodeChapters.length} chapters
            </span>
          )}
          {characterAppearances.length > 0 && (
            <span className="px-2 py-0.5 bg-pink-100 text-pink-700 rounded text-xs">
              🎭 {characterAppearances.length} characters
            </span>
          )}
          {audioDropInstances.length > 0 && (
            <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded text-xs">
              🔊 {audioDropInstances.length} drops
            </span>
          )}
          {Object.keys(flaggedSegments).length > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">
              🚩 {Object.keys(flaggedSegments).length} flags
            </span>
          )}
          {episode.is_transcribed && (
            <button onClick={async () => {
              if (!confirm('Reprocess diarization for this episode? This will use any speaker corrections as hints to improve results.')) return
              try {
                await episodesAPI.reprocessDiarization(episode.id)
                onNotification?.('Episode queued for re-diarization with hints', 'success')
              } catch (err) {
                onNotification?.(`Failed to queue re-diarization: ${err.message}`, 'error')
              }
            }} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs hover:bg-orange-200 transition-colors cursor-pointer" title="Reprocess diarization using speaker correction flags as hints">
              🔄 Reprocess Diarization
            </button>
          )}
          {hasUnsavedChanges && (
            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">Unsaved changes</span>
          )}
        </div>
      </div>

      {/* Audio Player */}
      {audioPath && (
        <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex-shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={togglePlay} className="w-10 h-10 flex items-center justify-center bg-purple-500 hover:bg-purple-600 text-white rounded-full shadow-md transition-colors">
              {isPlaying ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              ) : (
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <button onClick={() => skip(-10)} className="p-2 text-gray-600 hover:text-purple-600">-10s</button>
            <button onClick={() => skip(10)} className="p-2 text-gray-600 hover:text-purple-600">+10s</button>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-xs text-gray-500 w-12 text-right font-mono">{formatTime(currentTime)}</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full cursor-pointer" onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const percent = (e.clientX - rect.left) / rect.width
                seekTo(percent * duration)
              }}>
                <div className="h-full bg-purple-500 rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
              </div>
              <span className="text-xs text-gray-500 w-12 font-mono">{formatTime(duration)}</span>
            </div>
            <button onClick={() => {
              const rates = [1, 1.25, 1.5, 1.75, 2]
              const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length]
              setPlaybackRate(nextRate)
              if (audioRef.current) audioRef.current.playbackRate = nextRate
            }} className="px-2 py-1 text-xs font-medium text-gray-600 bg-white rounded border">
              {playbackRate}x
            </button>
            <button onClick={() => setAutoScroll(!autoScroll)} className={`p-2 rounded ${autoScroll ? 'text-purple-600 bg-purple-100' : 'text-gray-400'}`} title="Auto-scroll">
              ↓
            </button>
          </div>
          <audio ref={audioRef} src={audioPath} preload="metadata" />
        </div>
      )}

      {/* Search and View Mode */}
      <div className="px-4 py-3 border-b border-gray-200 flex gap-3 flex-shrink-0 items-center">
        <input
          type="text"
          placeholder="Search in transcript..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {hasSpeakerLabels && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setViewMode('speakers')} className={`px-3 py-2 text-sm ${viewMode === 'speakers' ? 'bg-purple-500 text-white' : 'bg-white text-gray-600'}`}>
              By Speaker
            </button>
            <button onClick={() => setViewMode('plain')} className={`px-3 py-2 text-sm ${viewMode === 'plain' ? 'bg-purple-500 text-white' : 'bg-white text-gray-600'}`}>
              Plain
            </button>
          </div>
        )}
        {hasUnsavedChanges && (
          <button onClick={saveEdits} disabled={saving} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
        <span className="text-[10px] text-gray-400">
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">J</kbd>/<kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">K</kbd> navigate
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">Space</kbd> play/pause
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">F</kbd> flag
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">C</kbd> character
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">H</kbd> chapter
          <span className="mx-2">·</span>
          <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px]">Esc</kbd> close
        </span>
      </div>

      {/* Transcript Content */}
      <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto p-4">
        {hasSpeakerLabels && viewMode === 'speakers' && filteredSegments ? (
          <div className="space-y-3">
            {filteredSegments.map((segment, idx) => {
              const colors = getSpeakerColor(segment.speaker)
              const displayName = speakerNames[segment.speaker] || segment.speaker
              const isCurrent = currentSegmentIdx === idx
              const isSelected = selectedSegmentIdx === idx
              const flag = flaggedSegments[idx]

              // Consecutive same-speaker: show name only on first
              const prevSegment = idx > 0 ? filteredSegments[idx - 1] : null
              const isContinuation = prevSegment && prevSegment.speaker === segment.speaker

              return (
                <div
                  key={idx}
                  ref={el => segmentRefs.current[idx] = el}
                  className={`group rounded-lg overflow-hidden transition-all cursor-pointer border ${
                    isSelected ? 'ring-2 ring-purple-500 shadow-md border-purple-300' :
                    isCurrent ? `ring-2 ${colors.ring} shadow-md border-transparent` :
                    flag ? 'ring-1 ring-red-300 border-red-200' :
                    'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                  onClick={() => {
                    onSelectedSegmentChange?.(isSelected ? null : idx)
                    setActivePicker(null)
                  }}
                >
                  <div className="flex">
                    {/* Left: Speaker Column */}
                    <div
                      className="w-[100px] flex-shrink-0 flex items-start justify-center pt-4 pb-3"
                      style={{ backgroundColor: colors.hex }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectedSegmentChange?.(idx)
                        setActivePicker('speaker')
                      }}
                    >
                      {!isContinuation ? (
                        <span className="text-xs font-semibold text-gray-700 text-center leading-tight cursor-pointer hover:underline">
                          {displayName}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">⋮</span>
                      )}
                    </div>

                    {/* Right: Content Column */}
                    <div
                      className="flex-1 min-w-0 px-5 py-4"
                      style={{ borderLeft: `4px solid ${colors.borderHex}` }}
                    >
                      {/* Timestamp + playing indicator */}
                      <div className="flex items-center gap-3 mb-2">
                        <button onClick={(e) => { e.stopPropagation(); seekToSegment(segment) }} className="text-xs text-gray-400 hover:text-purple-600 font-mono">
                          {formatTimestamp(segment)}
                        </button>
                        {isCurrent && <span className="text-xs text-purple-600 font-medium animate-pulse">▶ NOW</span>}
                      </div>

                      {/* Segment text */}
                      <p className={`text-gray-700 leading-relaxed ${isCurrent ? 'font-medium' : ''}`}>{segment.text?.trim()}</p>

                      {/* Badges below text */}
                      {renderBadges(idx)}
                    </div>
                  </div>

                  {/* Expanded Toolbar */}
                  {renderToolbar(idx)}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{transcript.full_text || 'No transcript text available'}</div>
        )}
      </div>
    </div>
  )
}
