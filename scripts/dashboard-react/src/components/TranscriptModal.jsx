import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { episodesAPI, speakersAPI, contentAPI, searchAPI } from '../services/api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useConfirm } from '../hooks/useConfirm'

// Flag types for segment issues
const FLAG_TYPES = [
  { id: 'wrong_speaker', label: 'Wrong Speaker', icon: '👤', description: 'Speaker assignment is incorrect', needsSpeaker: true },
  { id: 'character_voice', label: 'Character Voice', icon: '🎭', description: 'This is a character speaking', needsCharacter: true },
  { id: 'multiple_speakers', label: 'Multiple Speakers', icon: '👥', description: 'Overlapping speech from multiple people' },
  { id: 'audio_issue', label: 'Audio Issue', icon: '🔇', description: 'Transcription error or audio problem' },
  { id: 'other', label: 'Other', icon: '📝', description: 'Add a note about this segment', needsNotes: true },
]

// Speaker color palette
const SPEAKER_COLORS = {
  'SPEAKER_00': { bg: 'bg-blue-100', text: 'text-blue-700', label: 'bg-blue-200 text-blue-800', border: 'border-blue-300', ring: 'ring-blue-400' },
  'SPEAKER_01': { bg: 'bg-green-100', text: 'text-green-700', label: 'bg-green-200 text-green-800', border: 'border-green-300', ring: 'ring-green-400' },
  'SPEAKER_02': { bg: 'bg-orange-100', text: 'text-orange-700', label: 'bg-orange-200 text-orange-800', border: 'border-orange-300', ring: 'ring-orange-400' },
  'SPEAKER_03': { bg: 'bg-purple-100', text: 'text-purple-700', label: 'bg-purple-200 text-purple-800', border: 'border-purple-300', ring: 'ring-purple-400' },
  'SPEAKER_04': { bg: 'bg-pink-100', text: 'text-pink-700', label: 'bg-pink-200 text-pink-800', border: 'border-pink-300', ring: 'ring-pink-400' },
  'SPEAKER_05': { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'bg-cyan-200 text-cyan-800', border: 'border-cyan-300', ring: 'ring-cyan-400' },
  'UNKNOWN': { bg: 'bg-gray-100', text: 'text-gray-600', label: 'bg-gray-200 text-gray-600', border: 'border-gray-300', ring: 'ring-gray-400' },
}

// Known hosts/speakers for quick assignment
const KNOWN_SPEAKERS = [
  { id: 'Matt Donnelly', short: 'Matt' },
  { id: 'Paul Mattingly', short: 'Paul' },
  { id: 'Jacob Smith', short: 'Jacob' },
]

const getSpeakerColor = (speaker) => {
  return SPEAKER_COLORS[speaker] || SPEAKER_COLORS['UNKNOWN']
}

// Format seconds to MM:SS or HH:MM:SS
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

export default function TranscriptModal({ episode, onClose }) {
  const confirm = useConfirm()
  const [transcript, setTranscript] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('speakers') // 'speakers' or 'plain'
  const [speakerNames, setSpeakerNames] = useState({}) // Custom speaker names
  const [editingSpeakers, setEditingSpeakers] = useState(false)
  const [quickFixSpeaker, setQuickFixSpeaker] = useState(null) // For quick fix dropdown
  const [savingNames, setSavingNames] = useState(false)
  const [editingSegmentIdx, setEditingSegmentIdx] = useState(null)
  const [segmentEdits, setSegmentEdits] = useState({})
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [audioPath, setAudioPath] = useState(null)
  const [markedSamples, setMarkedSamples] = useState({}) // {idx: true} for segments marked as good voice samples
  const [flaggedSegments, setFlaggedSegments] = useState({}) // {segmentIdx: FlaggedSegment} - persisted flags from database
  const [voiceLibrary, setVoiceLibrary] = useState([]) // Speakers from voice library
  const [runningDiarization, setRunningDiarization] = useState(false) // Running diarization process
  const [chapterTypes, setChapterTypes] = useState([]) // Available chapter types
  const [episodeChapters, setEpisodeChapters] = useState([]) // Chapters for this episode
  const [characterAppearances, setCharacterAppearances] = useState([]) // Character appearances for this episode
  const [characters, setCharacters] = useState([]) // All available characters
  const [chapterSelection, setChapterSelection] = useState(null) // {startIdx, endIdx} for chapter marking
  const [showActionsMenu, setShowActionsMenu] = useState(null) // segment idx where actions menu is shown
  const [actionsSubmenu, setActionsSubmenu] = useState(null) // 'flag', 'character', 'chapter', 'speaker'
  const [analyzingContent, setAnalyzingContent] = useState(false) // Content analysis in progress
  const [detectedContent, setDetectedContent] = useState(null) // Results from content analysis
  const [showContentPanel, setShowContentPanel] = useState(false) // Show detected content panel
  const [newCharacterName, setNewCharacterName] = useState('') // For quick character creation

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)

  const audioRef = useRef(null)
  const transcriptContainerRef = useRef(null)
  const segmentRefs = useRef({})
  const initialScrollDoneRef = useRef(false)

  useEffect(() => {
    if (episode?.id) {
      loadTranscript()
    }
  }, [episode])

  const loadTranscript = async () => {
    try {
      setLoading(true)
      setError(null)

      // Load transcript, voice library, chapter types, episode chapters, flagged segments, and characters in parallel
      const [data, voices, types, chapters, flags, charAppearances, allCharacters] = await Promise.all([
        episodesAPI.getTranscript(episode.id),
        speakersAPI.getVoiceLibrary().catch(() => []),
        contentAPI.getChapterTypes().catch(() => []),
        contentAPI.getEpisodeChapters(episode.id).catch(() => []),
        contentAPI.getFlaggedSegments(episode.id).catch(() => []),
        contentAPI.getCharacterAppearancesForEpisode(episode.id).catch(() => []),
        contentAPI.getCharacters().catch(() => [])
      ])

      setTranscript(data)
      setVoiceLibrary(voices)
      setChapterTypes(types)
      setEpisodeChapters(chapters)
      setCharacterAppearances(charAppearances)
      setCharacters(allCharacters)

      // Convert flags array to map by segment_idx for easy lookup
      const flagsMap = {}
      flags.forEach(flag => {
        flagsMap[flag.segment_idx] = flag
      })
      setFlaggedSegments(flagsMap)

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

  // Parse segments from JSON
  const segments = useMemo(() => {
    if (!transcript?.segments_json) return null
    try {
      const parsed = JSON.parse(transcript.segments_json)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    } catch (e) {
      console.error('Failed to parse segments JSON:', e)
    }
    return null
  }, [transcript?.segments_json])

  // Get unique speakers from segments
  const uniqueSpeakers = useMemo(() => {
    if (!segments) return []
    const speakers = new Set()
    segments.forEach(seg => {
      if (seg.speaker && seg.speaker !== 'UNKNOWN') {
        speakers.add(seg.speaker)
      }
    })
    return Array.from(speakers).sort()
  }, [segments])

  // Check if segments have speaker labels
  const hasSpeakerLabels = useMemo(() => {
    if (!segments) return false
    return segments.some(seg => seg.speaker && seg.speaker !== 'UNKNOWN')
  }, [segments])

  // Get display name for a speaker
  const getSpeakerDisplayName = (speakerId) => {
    return speakerNames[speakerId] || speakerId
  }

  // Parse timestamp to seconds
  const parseTimestampToSeconds = useCallback((segment) => {
    if (segment.timestamps?.from) {
      const ts = segment.timestamps.from.replace(',', '.')
      const parts = ts.split(':')
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
      }
    }
    if (typeof segment.start === 'number') {
      return segment.start
    }
    return 0
  }, [])

  // Get segment end time
  const getSegmentEndTime = useCallback((segment) => {
    if (segment.timestamps?.to) {
      const ts = segment.timestamps.to.replace(',', '.')
      const parts = ts.split(':')
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
      }
    }
    if (typeof segment.end === 'number') {
      return segment.end
    }
    return parseTimestampToSeconds(segment) + 10 // fallback
  }, [parseTimestampToSeconds])

  // Find current segment based on playback time
  const currentSegmentIdx = useMemo(() => {
    if (!segments || !isPlaying) return -1
    for (let i = 0; i < segments.length; i++) {
      const start = parseTimestampToSeconds(segments[i])
      const end = getSegmentEndTime(segments[i])
      if (currentTime >= start && currentTime < end) {
        return i
      }
    }
    return -1
  }, [segments, currentTime, isPlaying, parseTimestampToSeconds, getSegmentEndTime])

  // Auto-scroll to current segment
  useEffect(() => {
    if (autoScroll && currentSegmentIdx >= 0 && segmentRefs.current[currentSegmentIdx]) {
      segmentRefs.current[currentSegmentIdx].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [currentSegmentIdx, autoScroll])

  // Format timestamp for display
  const formatTimestamp = (segment) => {
    if (segment.timestamps?.from) {
      return segment.timestamps.from.replace(',', '.').slice(0, 8)
    }
    if (typeof segment.start === 'number') {
      const mins = Math.floor(segment.start / 60)
      const secs = Math.floor(segment.start % 60)
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return ''
  }

  const highlightText = (text) => {
    if (!searchQuery || !text) return text
    try {
      const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      const parts = text.split(regex)
      return parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="bg-yellow-200">{part}</mark> : part
      )
    } catch {
      return text
    }
  }

  // Filter segments by search query
  const filteredSegments = useMemo(() => {
    if (!segments) return null
    if (!searchQuery) return segments
    const query = searchQuery.toLowerCase()
    return segments.filter(seg =>
      seg.text?.toLowerCase().includes(query)
    )
  }, [segments, searchQuery])

  // Handle speaker name change
  const handleSpeakerNameChange = (speakerId, newName) => {
    setSpeakerNames(prev => ({
      ...prev,
      [speakerId]: newName
    }))
  }

  // Save speaker names to backend
  const saveSpeakerNames = async () => {
    try {
      setSavingNames(true)
      await episodesAPI.updateSpeakerNames(episode.id, speakerNames)
      setEditingSpeakers(false)
    } catch (err) {
      console.error('Failed to save speaker names:', err)
      alert('Failed to save speaker names: ' + err.message)
    } finally {
      setSavingNames(false)
    }
  }

  // Get the effective speaker for a segment
  const getSegmentSpeaker = (segment, idx) => {
    return segmentEdits[idx]?.speaker ?? segment.speaker
  }

  // Get the effective text for a segment
  const getSegmentText = (segment, idx) => {
    return segmentEdits[idx]?.text ?? segment.text
  }

  // Handle clicking on a speaker label to edit
  const handleSpeakerClick = (idx) => {
    setEditingSegmentIdx(editingSegmentIdx === idx ? null : idx)
  }

  // Handle assigning a name to a speaker label
  const handleAssignSpeakerName = (originalLabel, displayName) => {
    setSpeakerNames(prev => ({
      ...prev,
      [originalLabel]: displayName
    }))
    setHasUnsavedChanges(true)
    setEditingSegmentIdx(null)
  }

  // Toggle marking a segment as a good voice sample
  const toggleVoiceSample = (idx) => {
    setMarkedSamples(prev => {
      const newMarked = { ...prev }
      if (newMarked[idx]) {
        delete newMarked[idx]
      } else {
        newMarked[idx] = true
      }
      return newMarked
    })
    setHasUnsavedChanges(true)
  }

  // Create a flagged segment (persisted to database)
  const createFlag = async (idx, flagType, correctedSpeaker = null, characterId = null, notes = null) => {
    try {
      const id = await contentAPI.createFlaggedSegment(
        episode.id,
        idx,
        flagType,
        correctedSpeaker,
        characterId,
        notes
      )
      // Update local state
      setFlaggedSegments(prev => ({
        ...prev,
        [idx]: {
          id,
          episode_id: episode.id,
          segment_idx: idx,
          flag_type: flagType,
          corrected_speaker: correctedSpeaker,
          character_id: characterId,
          notes,
          resolved: false
        }
      }))
      setShowActionsMenu(null)
      setActionsSubmenu(null)
    } catch (err) {
      console.error('Error creating flag:', err)
      alert(`Failed to create flag: ${err.message}`)
    }
  }

  // Delete a flagged segment
  const deleteFlag = async (idx) => {
    const flag = flaggedSegments[idx]
    if (!flag) return

    try {
      await contentAPI.deleteFlaggedSegment(flag.id)
      setFlaggedSegments(prev => {
        const newFlags = { ...prev }
        delete newFlags[idx]
        return newFlags
      })
    } catch (err) {
      console.error('Error deleting flag:', err)
      alert(`Failed to delete flag: ${err.message}`)
    }
  }

  // Add character appearance to a segment
  const addCharacterToSegment = async (idx, characterId) => {
    const segment = segments[idx]
    if (!segment) return

    try {
      const id = await contentAPI.addCharacterAppearance(
        characterId,
        episode.id,
        parseTimestampToSeconds(segment),
        getSegmentEndTime(segment),
        idx
      )
      // Reload character appearances
      const appearances = await contentAPI.getCharacterAppearancesForEpisode(episode.id)
      setCharacterAppearances(appearances)
      setShowActionsMenu(null)
      setActionsSubmenu(null)
    } catch (err) {
      console.error('Error adding character appearance:', err)
      alert(`Failed to add character: ${err.message}`)
    }
  }

  // Create a new character and add to segment
  const createCharacterAndAdd = async (idx, name) => {
    if (!name.trim()) return

    try {
      const characterId = await contentAPI.createCharacter(name.trim(), null, null, null)
      await addCharacterToSegment(idx, characterId)
      // Reload characters list
      const allCharacters = await contentAPI.getCharacters()
      setCharacters(allCharacters)
      setNewCharacterName('')
    } catch (err) {
      console.error('Error creating character:', err)
      alert(`Failed to create character: ${err.message}`)
    }
  }

  // Delete character appearance from a segment
  const removeCharacterFromSegment = async (appearanceId) => {
    try {
      await contentAPI.deleteCharacterAppearance(appearanceId)
      const appearances = await contentAPI.getCharacterAppearancesForEpisode(episode.id)
      setCharacterAppearances(appearances)
    } catch (err) {
      console.error('Error removing character:', err)
    }
  }

  // Get character appearance for a segment
  const getCharacterForSegment = (idx) => {
    return characterAppearances.find(ca => ca.segment_idx === idx)
  }

  // Get count of flagged segments
  const flaggedCount = Object.keys(flaggedSegments).length
  const unresolvedFlagCount = Object.values(flaggedSegments).filter(f => !f.resolved).length

  // Run diarization for episodes without speaker data
  const handleRunDiarization = async () => {
    if (runningDiarization) return

    try {
      setRunningDiarization(true)
      await episodesAPI.retryDiarization(episode.id)
      // Reload transcript to get the new diarization data
      await loadTranscript()
    } catch (err) {
      console.error('Error running diarization:', err)
      alert(`Diarization failed: ${err.message || 'Unknown error'}`)
    } finally {
      setRunningDiarization(false)
    }
  }

  // Create a chapter from a segment
  const createChapter = async (chapterTypeId, segmentIdx) => {
    if (!segments || segmentIdx == null) return

    const segment = segments[segmentIdx]
    const startTime = segment.start ?? parseTimestampToSeconds(segment)
    const endTime = segment.end ?? getSegmentEndTime(segment)

    try {
      await contentAPI.createEpisodeChapter(
        episode.id,
        chapterTypeId,
        null, // title - use chapter type name
        startTime,
        endTime,
        segmentIdx,
        segmentIdx
      )
      // Reload chapters
      const chapters = await contentAPI.getEpisodeChapters(episode.id)
      setEpisodeChapters(chapters)
      setShowActionsMenu(null)
      setActionsSubmenu(null)
    } catch (err) {
      console.error('Error creating chapter:', err)
      alert(`Failed to create chapter: ${err.message}`)
    }
  }

  // Delete a chapter
  const deleteChapter = async (chapterId) => {
    try {
      await contentAPI.deleteEpisodeChapter(chapterId)
      const chapters = await contentAPI.getEpisodeChapters(episode.id)
      setEpisodeChapters(chapters)
    } catch (err) {
      console.error('Error deleting chapter:', err)
    }
  }

  // Load detected content for this episode
  const loadDetectedContent = async () => {
    try {
      const content = await searchAPI.getDetectedContent(episode.id)
      setDetectedContent(content)
    } catch (err) {
      console.error('Error loading detected content:', err)
    }
  }

  // Run content analysis on this transcript
  const handleAnalyzeContent = async (useLlm = true) => {
    if (analyzingContent) return

    try {
      setAnalyzingContent(true)
      const result = await episodesAPI.analyzeEpisodeContent(episode.id, useLlm)

      // Combine with any existing detected content
      const allContent = [
        ...(result.characters || []).map(c => ({ ...c, content_type: 'character' })),
        ...(result.commercials || []).map(c => ({ ...c, content_type: 'commercial' })),
        ...(result.bits || []).map(c => ({ ...c, content_type: 'bit' })),
      ]
      setDetectedContent(allContent)
      setShowContentPanel(true)
    } catch (err) {
      console.error('Error analyzing content:', err)
      alert(`Content analysis failed: ${err.message || 'Unknown error'}`)
    } finally {
      setAnalyzingContent(false)
    }
  }

  // Load detected content on mount
  useEffect(() => {
    if (episode?.id) {
      loadDetectedContent()
    }
  }, [episode?.id])

  // Scroll to the initial segment when segments first load (e.g. from search result)
  useEffect(() => {
    if (!segments || !episode?.initialTimestamp || initialScrollDoneRef.current) return
    initialScrollDoneRef.current = true

    // Use segment_idx directly if provided (from search results), else find by timestamp
    let targetIdx = episode.initialSegmentIdx != null ? episode.initialSegmentIdx : null
    if (targetIdx == null) {
      let closestDelta = Infinity
      segments.forEach((seg, idx) => {
        const delta = Math.abs(parseTimestampToSeconds(seg) - episode.initialTimestamp)
        if (delta < closestDelta) {
          closestDelta = delta
          targetIdx = idx
        }
      })
    }

    if (targetIdx == null) return
    setTimeout(() => {
      if (segmentRefs.current[targetIdx]) {
        segmentRefs.current[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 200)
  }, [segments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get chapter for a segment index
  const getChapterForSegment = (segmentIdx) => {
    return episodeChapters.find(ch =>
      ch.start_segment_idx <= segmentIdx && ch.end_segment_idx >= segmentIdx
    )
  }

  // Get count of marked samples per speaker
  const markedSampleCounts = useMemo(() => {
    const counts = {}
    Object.keys(markedSamples).forEach(idx => {
      const segment = segments?.[parseInt(idx)]
      if (segment?.speaker) {
        counts[segment.speaker] = (counts[segment.speaker] || 0) + 1
      }
    })
    return counts
  }, [markedSamples, segments])

  // Save all edits to backend
  const saveEdits = async () => {
    if (!hasUnsavedChanges) return

    try {
      setSaving(true)
      // Save speaker names
      await episodesAPI.updateSpeakerNames(episode.id, speakerNames)
      // Save segment edits if any
      if (Object.keys(segmentEdits).length > 0) {
        await episodesAPI.saveTranscriptEdits(episode.id, segmentEdits)
      }
      // Save voice samples if any marked
      if (Object.keys(markedSamples).length > 0 && segments) {
        const samplesToSave = Object.keys(markedSamples).map(idx => {
          const segIdx = parseInt(idx)
          const segment = segments[segIdx]
          const speakerName = speakerNames[segment.speaker] || segment.speaker
          return {
            speaker: segment.speaker,
            speakerName,
            startTime: parseTimestampToSeconds(segment),
            endTime: getSegmentEndTime(segment),
            text: segment.text,
            segmentIdx: segIdx,
          }
        })
        try {
          await episodesAPI.saveVoiceSamples(episode.id, samplesToSave)
          console.log(`Saved ${samplesToSave.length} voice samples`)
        } catch (err) {
          console.error('Failed to save voice samples:', err)
          // Don't fail the whole save if voice samples fail
        }
      }
      setHasUnsavedChanges(false)
      setSegmentEdits({})
      setMarkedSamples({})
      loadTranscript()
    } catch (err) {
      console.error('Failed to save edits:', err)
      alert('Failed to save edits: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // Load audio path
  useEffect(() => {
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
    if (episode?.id) {
      loadAudioPath()
    }
  }, [episode])

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleDurationChange = () => setDuration(audio.duration)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('durationchange', handleDurationChange)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [audioPath])

  // Playback controls
  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
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
    if (!isPlaying) {
      audioRef.current?.play()
    }
  }

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    const time = percent * duration
    seekTo(time)
  }

  const skip = (seconds) => {
    if (!audioRef.current) return
    seekTo(Math.max(0, Math.min(duration, currentTime + seconds)))
  }

  const changePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2]
    const currentIdx = rates.indexOf(playbackRate)
    const nextRate = rates[(currentIdx + 1) % rates.length]
    setPlaybackRate(nextRate)
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate
    }
  }

  const episodeTitle = episode?.title || 'Transcript'

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-gray-800 truncate">{episodeTitle}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {transcript?.language && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                    {transcript.language}
                  </span>
                )}
                {transcript?.has_diarization ? (
                  <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs flex items-center gap-1">
                    👥 {transcript.num_speakers} speakers
                  </span>
                ) : transcript && (
                  <button
                    onClick={handleRunDiarization}
                    disabled={runningDiarization}
                    className="px-2 py-0.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
                    title="Run speaker diarization to identify who is speaking"
                  >
                    {runningDiarization ? (
                      <>
                        <span className="animate-spin">⏳</span> Running...
                      </>
                    ) : (
                      <>
                        👤 No speaker data - <span className="underline">Run Diarization</span>
                      </>
                    )}
                  </button>
                )}
                {/* Content Analysis Button */}
                <button
                  onClick={() => handleAnalyzeContent(true)}
                  disabled={analyzingContent}
                  className="px-2 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded text-xs flex items-center gap-1 transition-colors disabled:opacity-50"
                  title="Analyze transcript for characters, commercials, and bits"
                >
                  {analyzingContent ? (
                    <>
                      <span className="animate-spin">⏳</span> Analyzing...
                    </>
                  ) : (
                    <>
                      🔬 Analyze Content
                    </>
                  )}
                </button>
                {detectedContent && detectedContent.length > 0 && (
                  <button
                    onClick={() => setShowContentPanel(!showContentPanel)}
                    className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 transition-colors ${
                      showContentPanel
                        ? 'bg-indigo-500 text-white'
                        : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    }`}
                  >
                    🎭 {detectedContent.length} items found
                  </button>
                )}
              </div>
            </div>
            <button
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {/* Audio Player */}
        {audioPath && (
          <div className="px-6 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100">
            <div className="flex items-center gap-4">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="w-12 h-12 flex items-center justify-center bg-purple-500 hover:bg-purple-600 text-white rounded-full shadow-md transition-colors"
              >
                {isPlaying ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Skip buttons */}
              <button
                onClick={() => skip(-10)}
                className="p-2 text-gray-600 hover:text-purple-600 transition-colors"
                title="Back 10s"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                </svg>
              </button>
              <button
                onClick={() => skip(10)}
                className="p-2 text-gray-600 hover:text-purple-600 transition-colors"
                title="Forward 10s"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                </svg>
              </button>

              {/* Progress bar */}
              <div className="flex-1 flex items-center gap-3">
                <span className="text-xs text-gray-500 w-12 text-right font-mono">
                  {formatTime(currentTime)}
                </span>
                <div
                  className="flex-1 h-2 bg-gray-200 rounded-full cursor-pointer relative group"
                  onClick={handleSeek}
                >
                  <div
                    className="h-full bg-purple-500 rounded-full relative"
                    style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-purple-600 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <span className="text-xs text-gray-500 w-12 font-mono">
                  {formatTime(duration)}
                </span>
              </div>

              {/* Playback rate */}
              <button
                onClick={changePlaybackRate}
                className="px-2 py-1 text-xs font-medium text-gray-600 hover:text-purple-600 bg-white rounded border border-gray-200 transition-colors"
                title="Playback speed"
              >
                {playbackRate}x
              </button>

              {/* Auto-scroll toggle */}
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`p-2 rounded transition-colors ${
                  autoScroll ? 'text-purple-600 bg-purple-100' : 'text-gray-400 hover:text-gray-600'
                }`}
                title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </button>
            </div>
            <audio
              ref={audioRef}
              src={audioPath}
              preload="metadata"
              onLoadedMetadata={() => {
                if (episode?.initialTimestamp && audioRef.current) {
                  audioRef.current.currentTime = episode.initialTimestamp
                  setCurrentTime(episode.initialTimestamp)
                }
              }}
            />
          </div>
        )}

        {/* Detected Content Panel */}
        {showContentPanel && detectedContent && detectedContent.length > 0 && (
          <div className="px-6 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-indigo-800">Detected Content</h3>
              <button
                onClick={() => setShowContentPanel(false)}
                className="text-indigo-400 hover:text-indigo-600 text-sm"
              >
                Hide
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {detectedContent.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-2 rounded-lg border cursor-pointer hover:shadow-md transition-all ${
                    item.content_type === 'character'
                      ? 'bg-pink-50 border-pink-200'
                      : item.content_type === 'commercial'
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-green-50 border-green-200'
                  }`}
                  onClick={() => {
                    if (item.start_time != null) {
                      seekTo(item.start_time)
                      if (!isPlaying && audioRef.current) {
                        audioRef.current.play()
                      }
                    }
                  }}
                  title={item.raw_text || item.description}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {item.content_type === 'character' ? '🎭' : item.content_type === 'commercial' ? '📺' : '😂'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-800 truncate">{item.name}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className={`px-1.5 py-0.5 rounded ${
                          item.content_type === 'character'
                            ? 'bg-pink-200 text-pink-700'
                            : item.content_type === 'commercial'
                            ? 'bg-orange-200 text-orange-700'
                            : 'bg-green-200 text-green-700'
                        }`}>
                          {item.content_type}
                        </span>
                        {item.start_time != null && (
                          <span className="font-mono">{formatTime(item.start_time)}</span>
                        )}
                        {item.confidence != null && (
                          <span>{Math.round(item.confidence * 100)}%</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {item.description && (
                    <p className="text-xs text-gray-600 mt-1 line-clamp-1">{item.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4 flex-1 overflow-hidden min-h-0 flex flex-col">
          {loading ? (
            <div className="text-center py-12">
              <div className="w-10 h-10 border-4 border-purple-200 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
              <div className="text-gray-500">Loading transcript...</div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="text-red-500 text-4xl mb-4">⚠️</div>
              <div className="text-red-600 font-medium">{error}</div>
              <button
                onClick={loadTranscript}
                className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
              >
                Try Again
              </button>
            </div>
          ) : transcript ? (
            <>
              {/* Speaker Names Editor */}
              {hasSpeakerLabels && uniqueSpeakers.length > 0 && (
                <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200 flex-shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-purple-800">Speaker Names</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-purple-600">Click to preview</span>
                      {!editingSpeakers ? (
                        <button
                          onClick={() => setEditingSpeakers(true)}
                          className="text-xs px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors"
                        >
                          Edit Names
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingSpeakers(false)}
                            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={saveSpeakerNames}
                            disabled={savingNames}
                            className="text-xs px-2 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded transition-colors disabled:opacity-50"
                          >
                            {savingNames ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {uniqueSpeakers.map(speakerId => {
                      const colors = getSpeakerColor(speakerId)
                      const displayName = getSpeakerDisplayName(speakerId)
                      // Find first segment index for this speaker
                      const firstSegmentIdx = segments?.findIndex(seg => seg.speaker === speakerId) ?? -1
                      const firstSegment = firstSegmentIdx >= 0 ? segments[firstSegmentIdx] : null

                      return (
                        <div
                          key={speakerId}
                          className={`flex items-center gap-2 px-2 py-1 rounded ${colors.bg} ${colors.border} border cursor-pointer hover:shadow-md transition-shadow`}
                          onClick={() => {
                            if (firstSegment && !editingSpeakers) {
                              // Scroll to and play the first segment
                              seekToSegment(firstSegment)
                              // Also scroll the transcript to that segment
                              if (segmentRefs.current[firstSegmentIdx]) {
                                segmentRefs.current[firstSegmentIdx].scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'center'
                                })
                              }
                            }
                          }}
                          title={editingSpeakers ? '' : `Click to hear ${speakerId}`}
                        >
                          <span className={`text-xs ${colors.text}`}>{speakerId}:</span>
                          {editingSpeakers ? (
                            <input
                              type="text"
                              value={speakerNames[speakerId] || ''}
                              onChange={(e) => handleSpeakerNameChange(speakerId, e.target.value)}
                              placeholder="Enter name..."
                              className="text-sm px-2 py-0.5 border border-gray-300 rounded w-24 focus:outline-none focus:ring-1 focus:ring-purple-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className={`text-sm font-medium ${colors.text}`}>
                              {displayName !== speakerId ? displayName : '(unnamed)'}
                            </span>
                          )}
                          {!editingSpeakers && (
                            <span className="text-xs opacity-50">▶</span>
                          )}
                          {/* Quick fix button for unnamed speakers */}
                          {!editingSpeakers && displayName === speakerId && voiceLibrary.length > 0 && (
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setQuickFixSpeaker(quickFixSpeaker === speakerId ? null : speakerId)
                                }}
                                className="px-1.5 py-0.5 text-xs bg-red-100 hover:bg-red-200 text-red-600 rounded transition-colors"
                              >
                                Fix
                              </button>
                              {/* Quick assign dropdown */}
                              {quickFixSpeaker === speakerId && (
                                <div className="absolute left-0 top-full z-20 mt-1 p-2 bg-white rounded-lg shadow-xl border border-gray-200 min-w-32">
                                  <div className="text-xs text-gray-500 mb-2">Choose speaker:</div>
                                  <div className="flex flex-col gap-1">
                                    {voiceLibrary.map(v => (
                                      <button
                                        key={v.name}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleSpeakerNameChange(speakerId, v.name)
                                          setQuickFixSpeaker(null)
                                          setHasUnsavedChanges(true)
                                        }}
                                        className="px-2 py-1 text-xs text-left bg-yellow-50 hover:bg-yellow-100 text-yellow-800 rounded transition-colors"
                                      >
                                        {v.short_name || v.name}
                                      </button>
                                    ))}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setQuickFixSpeaker(null)
                                      }}
                                      className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors mt-1 border-t"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {markedSampleCounts[speakerId] > 0 && (
                            <span className="px-1.5 py-0.5 bg-yellow-400 text-yellow-900 rounded text-xs font-medium">
                              ⭐{markedSampleCounts[speakerId]}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Search and View Toggle */}
              <div className="mb-4 flex gap-3 flex-shrink-0">
                <input
                  type="text"
                  placeholder="Search in transcript..."
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {hasSpeakerLabels && (
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setViewMode('speakers')}
                      className={`px-3 py-2 text-sm font-medium transition-colors ${
                        viewMode === 'speakers'
                          ? 'bg-purple-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      By Speaker
                    </button>
                    <button
                      onClick={() => setViewMode('plain')}
                      className={`px-3 py-2 text-sm font-medium transition-colors ${
                        viewMode === 'plain'
                          ? 'bg-purple-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Plain Text
                    </button>
                  </div>
                )}
              </div>

              {/* Transcript Content */}
              <div
                ref={transcriptContainerRef}
                className="bg-gray-50 p-4 rounded-lg text-sm leading-relaxed flex-1 overflow-y-auto"
              >
                {hasSpeakerLabels && viewMode === 'speakers' && filteredSegments ? (
                  <div className="space-y-3">
                    {filteredSegments.map((segment, idx) => {
                      const effectiveSpeaker = getSegmentSpeaker(segment, idx)
                      const effectiveText = getSegmentText(segment, idx)
                      const colors = getSpeakerColor(effectiveSpeaker)
                      const timestamp = formatTimestamp(segment)
                      const displayName = speakerNames[effectiveSpeaker] || effectiveSpeaker
                      const isEditing = editingSegmentIdx === idx
                      const wasEdited = segmentEdits[idx]?.speaker || segmentEdits[idx]?.text
                      const isCurrent = currentSegmentIdx === idx

                      const isFlagged = flaggedSegments[idx]

                      return (
                        <div
                          key={idx}
                          ref={el => segmentRefs.current[idx] = el}
                          className={`p-3 rounded-lg transition-all ${colors.bg} ${
                            isFlagged ? 'ring-2 ring-red-500 bg-red-50' : ''
                          } ${wasEdited ? 'ring-2 ring-yellow-400' : ''
                          } ${isCurrent ? `ring-2 ${colors.ring} shadow-md` : ''}`}
                        >
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {/* Clickable speaker label */}
                            <button
                              onClick={() => handleSpeakerClick(idx)}
                              className={`px-2 py-0.5 rounded text-xs font-medium ${colors.label} hover:opacity-80 transition-opacity cursor-pointer`}
                              title="Click to change speaker"
                            >
                              {displayName}
                              <span className="ml-1 opacity-50">▼</span>
                            </button>
                            {/* Clickable timestamp */}
                            {timestamp && (
                              <button
                                onClick={() => seekToSegment(segment)}
                                className="text-xs text-gray-400 hover:text-purple-600 transition-colors"
                                title="Jump to this time"
                              >
                                {timestamp}
                              </button>
                            )}
                            {/* Status badges: flag, character, chapter, voice sample */}
                            {flaggedSegments[idx] && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs font-medium flex items-center gap-1 cursor-pointer ${
                                  flaggedSegments[idx].flag_type === 'wrong_speaker' ? 'bg-red-100 text-red-700' :
                                  flaggedSegments[idx].flag_type === 'character_voice' ? 'bg-pink-100 text-pink-700' :
                                  flaggedSegments[idx].flag_type === 'multiple_speakers' ? 'bg-orange-100 text-orange-700' :
                                  flaggedSegments[idx].flag_type === 'audio_issue' ? 'bg-gray-100 text-gray-700' :
                                  'bg-yellow-100 text-yellow-700'
                                }`}
                                title={`${FLAG_TYPES.find(f => f.id === flaggedSegments[idx].flag_type)?.label || 'Flagged'}${flaggedSegments[idx].corrected_speaker ? ` → ${flaggedSegments[idx].corrected_speaker}` : ''}${flaggedSegments[idx].notes ? `: ${flaggedSegments[idx].notes}` : ''}`}
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  if (await confirm('Remove this flag?')) deleteFlag(idx)
                                }}
                              >
                                {FLAG_TYPES.find(f => f.id === flaggedSegments[idx].flag_type)?.icon || '🚩'}
                                {flaggedSegments[idx].corrected_speaker && <span className="text-[10px]">→{flaggedSegments[idx].corrected_speaker}</span>}
                              </span>
                            )}
                            {(() => {
                              const charAppearance = getCharacterForSegment(idx)
                              return charAppearance && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-xs font-medium bg-pink-100 text-pink-700 flex items-center gap-1 cursor-pointer"
                                  title={`Character: ${charAppearance.character_name}`}
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (await confirm(`Remove ${charAppearance.character_name} from this segment?`)) removeCharacterFromSegment(charAppearance.id)
                                  }}
                                >
                                  🎭 {charAppearance.character_name}
                                </span>
                              )
                            })()}
                            {(() => {
                              const chapter = getChapterForSegment(idx)
                              return chapter && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer"
                                  style={{ backgroundColor: chapter.chapter_type_color + '33', color: chapter.chapter_type_color }}
                                  title={`${chapter.chapter_type_name}${chapter.title ? ': ' + chapter.title : ''} (click to remove)`}
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (await confirm(`Remove chapter "${chapter.chapter_type_name}"?`)) deleteChapter(chapter.id)
                                  }}
                                >
                                  {chapter.chapter_type_icon} {chapter.chapter_type_name}
                                </span>
                              )
                            })()}
                            {markedSamples[idx] && (
                              <span
                                className="px-1.5 py-0.5 bg-yellow-400 text-yellow-900 rounded text-xs font-medium cursor-pointer"
                                title="Voice sample marked (click to unmark)"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleVoiceSample(idx)
                                }}
                              >
                                ⭐
                              </span>
                            )}
                            {/* Actions menu button (...) */}
                            <div className="relative ml-auto">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setShowActionsMenu(showActionsMenu === idx ? null : idx)
                                  setActionsSubmenu(null)
                                }}
                                className={`p-1 rounded transition-colors ${
                                  showActionsMenu === idx
                                    ? 'bg-purple-500 text-white'
                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                                }`}
                                title="Segment actions"
                              >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                                </svg>
                              </button>
                              {/* Actions dropdown menu */}
                              {showActionsMenu === idx && (
                                <div className="absolute right-0 top-full z-30 mt-1 p-1 bg-white rounded-lg shadow-xl border border-gray-200 min-w-48">
                                  {/* Change Speaker */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActionsSubmenu(actionsSubmenu === 'speaker' ? null : 'speaker')
                                    }}
                                    className={`w-full px-3 py-2 text-xs text-left rounded flex items-center gap-2 transition-colors ${
                                      actionsSubmenu === 'speaker' ? 'bg-purple-100 text-purple-700' : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <span>✏️</span>
                                    <span>Change Speaker</span>
                                    <span className="ml-auto text-gray-400">▶</span>
                                  </button>
                                  {/* Flag Issue */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActionsSubmenu(actionsSubmenu === 'flag' ? null : 'flag')
                                    }}
                                    className={`w-full px-3 py-2 text-xs text-left rounded flex items-center gap-2 transition-colors ${
                                      actionsSubmenu === 'flag' ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <span>🚩</span>
                                    <span>Flag Issue</span>
                                    <span className="ml-auto text-gray-400">▶</span>
                                  </button>
                                  {/* Mark Character */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActionsSubmenu(actionsSubmenu === 'character' ? null : 'character')
                                    }}
                                    className={`w-full px-3 py-2 text-xs text-left rounded flex items-center gap-2 transition-colors ${
                                      actionsSubmenu === 'character' ? 'bg-pink-100 text-pink-700' : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <span>🎭</span>
                                    <span>Mark Character</span>
                                    <span className="ml-auto text-gray-400">▶</span>
                                  </button>
                                  {/* Mark Audio Sample */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleVoiceSample(idx)
                                      setShowActionsMenu(null)
                                    }}
                                    className="w-full px-3 py-2 text-xs text-left rounded flex items-center gap-2 hover:bg-gray-100 transition-colors"
                                  >
                                    <span>{markedSamples[idx] ? '⭐' : '☆'}</span>
                                    <span>{markedSamples[idx] ? 'Unmark Audio Sample' : 'Mark Audio Sample'}</span>
                                  </button>
                                  {/* Mark Chapter */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActionsSubmenu(actionsSubmenu === 'chapter' ? null : 'chapter')
                                    }}
                                    className={`w-full px-3 py-2 text-xs text-left rounded flex items-center gap-2 transition-colors ${
                                      actionsSubmenu === 'chapter' ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <span>📑</span>
                                    <span>Mark Chapter</span>
                                    <span className="ml-auto text-gray-400">▶</span>
                                  </button>

                                  {/* Speaker submenu */}
                                  {actionsSubmenu === 'speaker' && (
                                    <div className="mt-1 pt-1 border-t border-gray-100">
                                      <div className="px-3 py-1 text-[10px] text-gray-400 uppercase">Assign name to {segment.speaker}:</div>
                                      {voiceLibrary.map(speaker => (
                                        <button
                                          key={speaker.name}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleAssignSpeakerName(segment.speaker, speaker.name)
                                            setShowActionsMenu(null)
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded flex items-center gap-2 hover:bg-yellow-50 text-yellow-800"
                                        >
                                          <span>🎤</span>
                                          <span>{speaker.short_name || speaker.name}</span>
                                        </button>
                                      ))}
                                      {voiceLibrary.length === 0 && KNOWN_SPEAKERS.map(speaker => (
                                        <button
                                          key={speaker.id}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleAssignSpeakerName(segment.speaker, speaker.id)
                                            setShowActionsMenu(null)
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded hover:bg-purple-50 text-purple-800"
                                        >
                                          {speaker.short}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  {/* Flag submenu */}
                                  {actionsSubmenu === 'flag' && (
                                    <div className="mt-1 pt-1 border-t border-gray-100">
                                      <div className="px-3 py-1 text-[10px] text-gray-400 uppercase">Flag type:</div>
                                      {FLAG_TYPES.map(flagType => (
                                        <button
                                          key={flagType.id}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            if (flagType.needsSpeaker) {
                                              // Show speaker picker for wrong_speaker
                                              const speaker = prompt(`Who should this be assigned to?\n\nCurrent: ${segment.speaker}\nEnter name:`)
                                              if (speaker) {
                                                createFlag(idx, flagType.id, speaker, null, null)
                                              }
                                            } else if (flagType.needsCharacter) {
                                              // Show character picker
                                              setActionsSubmenu('flag-character')
                                            } else if (flagType.needsNotes) {
                                              const notes = prompt('Add a note about this segment:')
                                              if (notes) {
                                                createFlag(idx, flagType.id, null, null, notes)
                                              }
                                            } else {
                                              createFlag(idx, flagType.id, null, null, null)
                                            }
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded flex items-center gap-2 hover:bg-red-50"
                                          title={flagType.description}
                                        >
                                          <span>{flagType.icon}</span>
                                          <span>{flagType.label}</span>
                                        </button>
                                      ))}
                                      {flaggedSegments[idx] && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            deleteFlag(idx)
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded flex items-center gap-2 hover:bg-gray-100 text-gray-500 mt-1 border-t border-gray-100"
                                        >
                                          <span>✖️</span>
                                          <span>Remove Flag</span>
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  {/* Flag character submenu (for character_voice flag) */}
                                  {actionsSubmenu === 'flag-character' && (
                                    <div className="mt-1 pt-1 border-t border-gray-100">
                                      <div className="px-3 py-1 text-[10px] text-gray-400 uppercase">Which character?</div>
                                      {characters.slice(0, 8).map(char => (
                                        <button
                                          key={char.id}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            createFlag(idx, 'character_voice', null, char.id, null)
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded flex items-center gap-2 hover:bg-pink-50 text-pink-800"
                                        >
                                          <span>🎭</span>
                                          <span>{char.name}</span>
                                        </button>
                                      ))}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setActionsSubmenu('flag')
                                        }}
                                        className="w-full px-3 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded mt-1 border-t"
                                      >
                                        ← Back
                                      </button>
                                    </div>
                                  )}

                                  {/* Character submenu */}
                                  {actionsSubmenu === 'character' && (
                                    <div className="mt-1 pt-1 border-t border-gray-100">
                                      <div className="px-3 py-1 text-[10px] text-gray-400 uppercase">Select character:</div>
                                      {characters.slice(0, 8).map(char => (
                                        <button
                                          key={char.id}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            addCharacterToSegment(idx, char.id)
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded flex items-center gap-2 hover:bg-pink-50 text-pink-800"
                                        >
                                          <span>🎭</span>
                                          <span>{char.name}</span>
                                          {char.appearance_count > 0 && (
                                            <span className="ml-auto text-[10px] text-gray-400">({char.appearance_count})</span>
                                          )}
                                        </button>
                                      ))}
                                      <div className="px-2 py-1 mt-1 border-t border-gray-100">
                                        <input
                                          type="text"
                                          placeholder="+ New character..."
                                          value={newCharacterName}
                                          onChange={(e) => setNewCharacterName(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newCharacterName.trim()) {
                                              e.stopPropagation()
                                              createCharacterAndAdd(idx, newCharacterName)
                                            }
                                          }}
                                          className="w-full px-2 py-1 text-xs border rounded"
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                      </div>
                                    </div>
                                  )}

                                  {/* Chapter submenu */}
                                  {actionsSubmenu === 'chapter' && (
                                    <div className="mt-1 pt-1 border-t border-gray-100">
                                      <div className="px-3 py-1 text-[10px] text-gray-400 uppercase">Chapter type:</div>
                                      {chapterTypes.map(type => (
                                        <button
                                          key={type.id}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            createChapter(type.id, idx)
                                          }}
                                          className="w-full px-3 py-1.5 text-xs text-left rounded flex items-center gap-2 hover:bg-indigo-50"
                                        >
                                          <span>{type.icon}</span>
                                          <span style={{ color: type.color }}>{type.name}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Current indicator */}
                            {isCurrent && (
                              <span className="text-xs text-purple-600 font-medium animate-pulse">
                                ▶ Playing
                              </span>
                            )}
                            {wasEdited && (
                              <span className="text-xs text-yellow-600 font-medium">edited</span>
                            )}
                          </div>

                          {/* Speaker selection dropdown */}
                          {isEditing && (
                            <div className="mb-2 p-2 bg-white rounded border shadow-lg">
                              <div className="text-xs text-gray-500 mb-2">
                                Assign name to <span className="font-mono font-medium">{segment.speaker}</span>:
                              </div>
                              {/* Audio samples speakers (preferred) */}
                              {voiceLibrary.length > 0 && (
                                <div className="mb-2">
                                  <div className="text-xs text-yellow-600 mb-1 flex items-center gap-1">
                                    <span>🎤</span> Audio Samples:
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {voiceLibrary.map(speaker => (
                                      <button
                                        key={speaker.name}
                                        onClick={() => handleAssignSpeakerName(segment.speaker, speaker.name)}
                                        className="px-2 py-1 text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded transition-colors flex items-center gap-1"
                                      >
                                        <span className="w-4 h-4 rounded-full bg-yellow-500 text-white text-[10px] flex items-center justify-center font-bold">
                                          {speaker.short_name?.charAt(0) || speaker.name.charAt(0)}
                                        </span>
                                        {speaker.short_name || speaker.name.split(' ')[0]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* Fallback known speakers */}
                              {voiceLibrary.length === 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {KNOWN_SPEAKERS.map(speaker => (
                                    <button
                                      key={speaker.id}
                                      onClick={() => handleAssignSpeakerName(segment.speaker, speaker.id)}
                                      className="px-2 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 rounded transition-colors"
                                    >
                                      {speaker.short}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Or type custom name..."
                                  className="flex-1 px-2 py-1 text-xs border rounded"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.target.value) {
                                      handleAssignSpeakerName(segment.speaker, e.target.value)
                                    }
                                  }}
                                />
                              </div>
                              <div className="text-xs text-gray-400 mt-1">
                                This will update all "{segment.speaker}" segments
                              </div>
                            </div>
                          )}

                          <p className={`${colors.text} ${isCurrent ? 'font-medium' : ''}`}>
                            {highlightText(effectiveText?.trim())}
                          </p>
                        </div>
                      )
                    })}
                    {filteredSegments.length === 0 && searchQuery && (
                      <p className="text-gray-400 text-center py-4">No matches found</p>
                    )}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap font-sans">
                    {highlightText(transcript.full_text || 'No transcript text available')}
                  </div>
                )}
              </div>

              {/* Unsaved changes indicator */}
              {hasUnsavedChanges && (
                <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center justify-between flex-shrink-0">
                  <div className="text-sm text-yellow-700 flex flex-wrap items-center gap-2">
                    <span>Unsaved changes</span>
                    {Object.keys(markedSamples).length > 0 && (
                      <span className="px-2 py-0.5 bg-yellow-200 rounded text-xs">
                        ⭐ {Object.keys(markedSamples).length} audio sample{Object.keys(markedSamples).length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {flaggedCount > 0 && (
                      <span className="px-2 py-0.5 bg-red-200 text-red-700 rounded text-xs">
                        🚩 {flaggedCount} flagged segment{flaggedCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={saveEdits}
                    disabled={saving}
                    className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}

              {/* Transcript path info */}
              {transcript.transcript_path && (
                <div className="mt-3 text-xs text-gray-400 truncate flex-shrink-0">
                  📁 {transcript.transcript_path}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-400">
              No transcript available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end flex-shrink-0">
          <button
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
