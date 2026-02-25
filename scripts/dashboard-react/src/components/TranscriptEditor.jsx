import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { episodesAPI, speakersAPI, contentAPI, isTauri } from '../services/api'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranscriptReview } from './TranscriptReviewContext'

// Flag types for segment issues
const FLAG_TYPES = [
  { id: 'wrong_speaker', label: 'Wrong Speaker', icon: '👤', needsSpeaker: true },
  { id: 'character_voice', label: 'Character Voice', icon: '🎭', needsCharacter: true },
  { id: 'multiple_speakers', label: 'Multiple Speakers', icon: '👥', needsSpeakers: true },
  { id: 'misspelling', label: 'Misspelling', icon: '✏️', needsCorrection: true },
  { id: 'missing_word', label: 'Missing Word', icon: '➕', needsCorrection: true },
  { id: 'audio_issue', label: 'Audio Issue', icon: '🔇' },
  { id: 'other', label: 'Other', icon: '📝', needsNotes: true },
]

// Speaker color palette with hex values for left column backgrounds
const SPEAKER_COLOR_PALETTE = [
  { bg: 'bg-blue-100', text: 'text-blue-700', label: 'bg-blue-200 text-blue-800', border: 'border-blue-300', ring: 'ring-blue-400', hex: '#dbeafe', borderHex: '#93c5fd' },
  { bg: 'bg-green-100', text: 'text-green-700', label: 'bg-green-200 text-green-800', border: 'border-green-300', ring: 'ring-green-400', hex: '#dcfce7', borderHex: '#86efac' },
  { bg: 'bg-orange-100', text: 'text-orange-700', label: 'bg-orange-200 text-orange-800', border: 'border-orange-300', ring: 'ring-orange-400', hex: '#ffedd5', borderHex: '#fdba74' },
  { bg: 'bg-purple-100', text: 'text-purple-700', label: 'bg-purple-200 text-purple-800', border: 'border-purple-300', ring: 'ring-purple-400', hex: '#f3e8ff', borderHex: '#c084fc' },
  { bg: 'bg-pink-100', text: 'text-pink-700', label: 'bg-pink-200 text-pink-800', border: 'border-pink-300', ring: 'ring-pink-400', hex: '#fce7f3', borderHex: '#f9a8d4' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'bg-cyan-200 text-cyan-800', border: 'border-cyan-300', ring: 'ring-cyan-400', hex: '#cffafe', borderHex: '#67e8f9' },
  { bg: 'bg-red-100', text: 'text-red-700', label: 'bg-red-200 text-red-800', border: 'border-red-300', ring: 'ring-red-400', hex: '#fee2e2', borderHex: '#fca5a5' },
  { bg: 'bg-teal-100', text: 'text-teal-700', label: 'bg-teal-200 text-teal-800', border: 'border-teal-300', ring: 'ring-teal-400', hex: '#ccfbf1', borderHex: '#5eead4' },
  { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'bg-yellow-200 text-yellow-800', border: 'border-yellow-300', ring: 'ring-yellow-400', hex: '#fef9c3', borderHex: '#fde047' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'bg-indigo-200 text-indigo-800', border: 'border-indigo-300', ring: 'ring-indigo-400', hex: '#e0e7ff', borderHex: '#a5b4fc' },
  { bg: 'bg-rose-100', text: 'text-rose-700', label: 'bg-rose-200 text-rose-800', border: 'border-rose-300', ring: 'ring-rose-400', hex: '#ffe4e6', borderHex: '#fda4af' },
  { bg: 'bg-lime-100', text: 'text-lime-700', label: 'bg-lime-200 text-lime-800', border: 'border-lime-300', ring: 'ring-lime-400', hex: '#ecfccb', borderHex: '#bef264' },
]
const SPEAKER_COLORS_UNKNOWN = { bg: 'bg-gray-100', text: 'text-gray-600', label: 'bg-gray-200 text-gray-600', border: 'border-gray-300', ring: 'ring-gray-400', hex: '#f3f4f6', borderHex: '#d1d5db' }

const getSpeakerColor = (speaker) => {
  const match = speaker?.match(/^SPEAKER_(\d+)$/)
  if (match) {
    const idx = parseInt(match[1], 10) % SPEAKER_COLOR_PALETTE.length
    return SPEAKER_COLOR_PALETTE[idx]
  }
  return SPEAKER_COLORS_UNKNOWN
}

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

export default function TranscriptEditor({ onClose, onTranscriptLoaded }) {
  // All shared state comes from context
  const {
    episode,
    onNotification,
    isVisible,
    flaggedSegments, setFlaggedSegments,
    characterAppearances, setCharacterAppearances,
    episodeChapters, setEpisodeChapters,
    markedSamples, setMarkedSamples,
    characters, setCharacters,
    chapterTypes, setChapterTypes,
    voiceLibrary, setVoiceLibrary,
    setSpeakers,
    speakerNames, setSpeakerNames,
    audioDropInstances, setAudioDropInstances,
    audioDrops, setAudioDrops,
    setSegments: setCtxSegments,
    selectedSegmentIdx, setSelectedSegmentIdx,
    polishRunning,
    registerHandlers,
  } = useTranscriptReview()

  // Internal-only state (not shared with PropertiesPanel)
  const [transcript, setTranscript] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('speakers')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [savedToastMessage, setSavedToastMessage] = useState('Saved')
  const savedToastTimerRef = useRef(null)
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessBackend, setReprocessBackend] = useState('current')
  const [currentEmbeddingBackend, setCurrentEmbeddingBackend] = useState('pyannote')
  const [compareRunning, setCompareRunning] = useState(false)
  const [compareResults, setCompareResults] = useState(null)
  const [compareExpanded, setCompareExpanded] = useState(true)
  const [rebuildingBackend, setRebuildingBackend] = useState(null)
  const [diarizationLocked, setDiarizationLocked] = useState(false)
  const [autoLabeling, setAutoLabeling] = useState(false)
  const [episodeImageError, setEpisodeImageError] = useState(false)

  // Episode speaker assignments (authoritative speaker/sound bite mappings from DB)
  const [episodeSpeakerAssignments, setEpisodeSpeakerAssignments] = useState([])

  // Inline picker state
  const [activePicker, setActivePicker] = useState(null)
  const [newCharacterName, setNewCharacterName] = useState('')
  const [newDropName, setNewDropName] = useState('')
  const [newSpeakerName, setNewSpeakerName] = useState('')
  const [flagInlineInput, setFlagInlineInput] = useState('') // for wrong_speaker / other inline inputs
  const [speakerPickerIdx, setSpeakerPickerIdx] = useState(null)  // segment idx for multi-speaker picker
  const [speakerPickerSelected, setSpeakerPickerSelected] = useState([])  // selected speaker IDs
  const [chapterRangeStart, setChapterRangeStart] = useState(null)
  const [chapterRangeType, setChapterRangeType] = useState(null)
  const [chapterRangeEndInput, setChapterRangeEndInput] = useState('')

  // Audio state
  const [audioPath, setAudioPath] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [playingClipIdx, setPlayingClipIdx] = useState(null)
  const [sampleTrimmer, setSampleTrimmer] = useState(null) // { idx, inPoint, outPoint }

  const audioRef = useRef(null)
  const transcriptContainerRef = useRef(null)
  const segmentRefs = useRef({})
  const clipEndRef = useRef(null)
  const clipStartRef = useRef(null)

  const episodeImageUrl = useMemo(() => {
    if (episode?.image_url) return episode.image_url
    const rawNum = episode?.episode_number?.toString() || ''
    const cleanNum = rawNum.replace(/[^0-9]/g, '')
    if (!cleanNum) return null
    return `https://heyscoops.fandom.com/wiki/Special:FilePath/ICS_${cleanNum}.png`
  }, [episode?.image_url, episode?.episode_number])

  const flashSavedToast = useCallback((message = '✓ Saved') => {
    setSavedToastMessage(message)
    setSavedToast(true)
    if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current)
    savedToastTimerRef.current = setTimeout(() => {
      setSavedToast(false)
    }, 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current)
    }
  }, [])

  // Load transcript when episode changes; clear lock on episode switch
  useEffect(() => {
    if (episode?.id) {
      loadTranscript()
      loadAudioPath()
      setReprocessing(false)
      setCompareRunning(false)
      setCompareResults(null)
      setCompareExpanded(true)
      setRebuildingBackend(null)
      setDiarizationLocked(false)
      speakersAPI.getEmbeddingModel().then((backend) => {
        setCurrentEmbeddingBackend(backend || 'pyannote')
      }).catch(() => {
        setCurrentEmbeddingBackend('pyannote')
      })
    }
  }, [episode?.id])

  useEffect(() => {
    setEpisodeImageError(false)
  }, [episodeImageUrl])

  // Refresh voice library + character data when tab becomes visible
  const prevVisibleRef = useRef(false)
  useEffect(() => {
    if (isVisible && !prevVisibleRef.current && episode?.id) {
      speakersAPI.getVoiceLibrary().then(voices => setVoiceLibrary(voices)).catch(() => {})
      // Fix 1a: refresh character appearances and character list (catches edits made in Characters tab)
      Promise.all([
        contentAPI.getCharacterAppearancesForEpisode(episode.id).catch(() => null),
        contentAPI.getCharacters().catch(() => null),
      ]).then(([appearances, chars]) => {
        if (appearances) setCharacterAppearances(appearances)
        if (chars) setCharacters(chars)
      })
    }
    prevVisibleRef.current = isVisible
  }, [isVisible])

  // Issue 9a: refresh voice library when speaker picker opens so newly added speakers appear
  useEffect(() => {
    if (activePicker === 'speaker' || activePicker === 'flag-wrong-speaker') {
      speakersAPI.getVoiceLibrary().then(voices => setVoiceLibrary(voices)).catch(() => {})
    }
  }, [activePicker])

  // Unlock when this episode's diarization completes
  useEffect(() => {
    if (!diarizationLocked || !isTauri) return
    let unlisten
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('transcription_complete', (event) => {
        if (event.payload === episode?.id) {
          setDiarizationLocked(false)
          setReprocessing(false)
          loadTranscript() // Reload so new speaker names are visible immediately
        }
      }).then(fn => { unlisten = fn })
    })
    return () => { if (unlisten) unlisten() }
  }, [diarizationLocked, episode?.id])

  const loadTranscript = async () => {
    try {
      setLoading(true)
      setError(null)

      const [data, voices, types, chapters, flags, charAppearances, allCharacters, drops, dropInstances, speakerAssignments] = await Promise.all([
        episodesAPI.getTranscript(episode.id),
        speakersAPI.getVoiceLibrary().catch(() => []),
        contentAPI.getChapterTypes().catch(() => []),
        contentAPI.getEpisodeChapters(episode.id).catch(() => []),
        contentAPI.getFlaggedSegments(episode.id).catch(() => []),
        contentAPI.getCharacterAppearancesForEpisode(episode.id).catch(() => []),
        contentAPI.getCharacters().catch(() => []),
        contentAPI.getAudioDrops().catch(() => []),
        contentAPI.getAudioDropInstances(episode.id).catch(() => []),
        speakersAPI.getEpisodeSpeakerAssignments(episode.id).catch(() => [])
      ])

      setTranscript(data)
      onTranscriptLoaded?.(true)
      setVoiceLibrary(voices)
      setChapterTypes(types)
      setCharacters(allCharacters)
      setAudioDrops(drops)
      setAudioDropInstances(dropInstances)

      setEpisodeChapters(chapters)
      setCharacterAppearances(charAppearances)

      const flagsMap = {}
      flags.forEach(flag => { if (!flag.resolved) flagsMap[flag.segment_idx] = flag })
      setFlaggedSegments(flagsMap)

      setEpisodeSpeakerAssignments(speakerAssignments)

      // Restore marked samples from transcript JSON (store {startTime,endTime} for trim support)
      if (data.marked_samples && Array.isArray(data.marked_samples)) {
        let segsForRestore = []
        try { segsForRestore = JSON.parse(data.segments_json || '[]') } catch (_) {}
        const samplesMap = {}
        data.marked_samples.forEach(idx => {
          const seg = segsForRestore[idx]
          samplesMap[idx] = seg
            ? { startTime: parseTimestampToSeconds(seg), endTime: getSegmentEndTime(seg) }
            : { startTime: 0, endTime: 0 }
        })
        setMarkedSamples(samplesMap)
      }

      // Build speaker names: start from JSON, then overlay DB assignments
      const names = { ...(data.speaker_names || {}) }

      // Literal speaker names baked into segment JSON (e.g. "Jacob Smith" instead
      // of SPEAKER_XX) from older transcripts need to map to themselves so that
      // displayName is truthy. Without this, the ! badge appears and deduplication
      // fails when the same person also has a SPEAKER_XX → name DB mapping.
      if (data.segments_json) {
        try {
          JSON.parse(data.segments_json).forEach(seg => {
            if (seg.speaker && seg.speaker !== 'UNKNOWN' && !seg.speaker.match(/^SPEAKER_\d+$/) && !names[seg.speaker]) {
              names[seg.speaker] = seg.speaker
            }
          })
        } catch (_) {}
      }

      for (const assignment of speakerAssignments) {
        if (assignment.speaker_name) {
          names[assignment.diarization_label] = assignment.speaker_name
        } else if (assignment.audio_drop_name) {
          names[assignment.diarization_label] = assignment.audio_drop_name
        }
      }
      setSpeakerNames(names)
    } catch (err) {
      console.error('Error loading transcript:', err)
      setError(err.message || 'Failed to load transcript')
      onTranscriptLoaded?.(false)
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

  // Parse segments (local derived value; synced to context for PropertiesPanel)
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
    setCtxSegments(segments)
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
    setSpeakers(uniqueSpeakers)
  }, [uniqueSpeakers])

  // Close trimmer when user selects a different segment
  useEffect(() => {
    if (sampleTrimmer !== null && sampleTrimmer.idx !== selectedSegmentIdx) {
      setSampleTrimmer(null)
    }
  }, [selectedSegmentIdx])

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
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      if (clipEndRef.current !== null && audio.currentTime >= clipEndRef.current) {
        // Seek back to clip start before pausing so the playhead doesn't sit at
        // the clip boundary — pressing main ▶ after this won't drift into the next clip
        if (clipStartRef.current !== null) {
          audio.currentTime = clipStartRef.current
          setCurrentTime(clipStartRef.current)
        }
        audio.pause()
        // handlePause will clear clip mode and reset the button to ▶ clip
      }
    }
    const handleDurationChange = () => setDuration(audio.duration)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => {
      setIsPlaying(false)
      clipEndRef.current = null
      clipStartRef.current = null
      setPlayingClipIdx(null)
    }
    const handleEnded = () => { setIsPlaying(false) }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)

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
    clipEndRef.current = null
    clipStartRef.current = null
    setPlayingClipIdx(null)
    seekTo(time)
    if (!isPlaying && audioRef.current) {
      audioRef.current.play().catch(err => console.error('Audio play failed:', err))
    }
  }

  const playClipOnly = (segment, idx) => {
    const startTime = parseTimestampToSeconds(segment)
    const endTime = getSegmentEndTime(segment)
    clipStartRef.current = startTime
    clipEndRef.current = endTime
    setPlayingClipIdx(idx)
    if (audioRef.current) {
      audioRef.current.currentTime = startTime
      setCurrentTime(startTime)
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

  const pausePlaybackForReview = () => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause()
    }
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
      setActivePicker(null)
      setSpeakerPickerIdx(null)
      setSpeakerPickerSelected([])
      flashSavedToast('✓ Flag saved')
    } catch (err) {
      onNotification?.(`Failed to create flag: ${err.message}`, 'error')
    }
  }

  const createCharacterAndFlagIt = async (idx, name) => {
    try {
      const characterId = await contentAPI.createCharacter(name.trim(), null, null, null, null)
      setCharacters(prev => [...prev, { id: characterId, name: name.trim() }])
      setNewCharacterName('')
      await createFlag(idx, 'character_voice', null, characterId)
    } catch (err) {
      onNotification?.(`Failed to create character: ${err.message}`, 'error')
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
      flashSavedToast('✓ Flag removed')
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
      setActivePicker(null)
      flashSavedToast('✓ Character saved')
    } catch (err) {
      onNotification?.(`Failed to add character: ${err.message}`, 'error')
    }
  }

  const createCharacterAndAdd = async (idx, name) => {
    if (!name.trim()) return
    try {
      const characterId = await contentAPI.createCharacter(name.trim(), null, null, null, null)
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
      flashSavedToast('✓ Character removed')
    } catch (err) {
      onNotification?.(`Failed to remove character: ${err.message}`, 'error')
    }
  }

  // Chapter operations
  const createChapter = async (chapterTypeId, segmentIdx, endSegmentIdx = null) => {
    if (!segments || segmentIdx == null) return
    const startSegment = segments[segmentIdx]
    const endIdx = endSegmentIdx != null ? endSegmentIdx : segmentIdx
    const endSegment = segments[endIdx] || startSegment
    const startTime = startSegment.start ?? parseTimestampToSeconds(startSegment)
    const endTime = endSegment.end ?? getSegmentEndTime(endSegment)
    try {
      await contentAPI.createEpisodeChapter(episode.id, chapterTypeId, null, startTime, endTime, segmentIdx, endIdx)
      const chapters = await contentAPI.getEpisodeChapters(episode.id)
      setEpisodeChapters(chapters)
      setActivePicker(null)
      setChapterRangeStart(null)
      setChapterRangeType(null)
      setChapterRangeEndInput('')
      flashSavedToast('✓ Chapter saved')
    } catch (err) {
      onNotification?.(`Failed to create chapter: ${err.message}`, 'error')
    }
  }

  const submitChapterRange = async () => {
    if (chapterRangeStart == null || chapterRangeType == null) return
    const raw = chapterRangeEndInput.trim()
    const endIdx = raw ? parseInt(raw, 10) : chapterRangeStart
    if (Number.isNaN(endIdx)) {
      onNotification?.('Enter a valid end segment number', 'error')
      return
    }
    if (!segments || endIdx < 0 || endIdx >= segments.length) {
      onNotification?.('End segment is out of range', 'error')
      return
    }
    if (endIdx < chapterRangeStart) {
      onNotification?.('End segment must be after start segment', 'error')
      return
    }
    await createChapter(chapterRangeType, chapterRangeStart, endIdx)
  }

  const deleteChapter = async (chapterId) => {
    try {
      await contentAPI.deleteEpisodeChapter(chapterId)
      const chapters = await contentAPI.getEpisodeChapters(episode.id)
      setEpisodeChapters(chapters)
      flashSavedToast('✓ Chapter removed')
    } catch (err) {
      onNotification?.(`Failed to delete chapter: ${err.message}`, 'error')
    }
  }

  // Create a new audio drop and assign it to a diarization speaker label
  const createDropAndAssign = async (originalLabel, name) => {
    if (!name.trim()) return
    try {
      const dropId = await contentAPI.createAudioDrop(name.trim())
      const allDrops = await contentAPI.getAudioDrops()
      setAudioDrops(allDrops)
      setNewDropName('')
      await handleAssignAudioDrop(originalLabel, { id: dropId, name: name.trim() })
    } catch (err) {
      onNotification?.(`Failed to create sound bite: ${err.message}`, 'error')
    }
  }

  // Create a new speaker in the DB and assign to the diarization label
  const createSpeakerAndAssign = async (originalLabel, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    // Optimistic: assign immediately so UI updates without waiting for DB
    handleAssignSpeakerName(originalLabel, trimmed)
    setNewSpeakerName('')
    // Only create if not already in the voice library (avoids duplicate error)
    const alreadyExists = voiceLibrary.some(v => v.name === trimmed)
    if (!alreadyExists) {
      try {
        await speakersAPI.createSpeaker(trimmed, null, false)
      } catch (err) {
        // Non-fatal: speaker name is assigned in transcript even if DB save failed
        onNotification?.(`Could not save speaker "${trimmed}" to DB: ${err?.message || err}`, 'warning')
      }
    }
    try {
      const voices = await speakersAPI.getVoiceLibrary()
      setVoiceLibrary(voices)
    } catch {}
  }

  // Voice sample operations
  const toggleVoiceSample = (idx) => {
    if (markedSamples[idx]) {
      // Already marked — unmark it
      const newSamples = { ...markedSamples }
      delete newSamples[idx]
      setMarkedSamples(newSamples)
      setHasUnsavedChanges(true)
      if (sampleTrimmer?.idx === idx) setSampleTrimmer(null)
    } else if (sampleTrimmer?.idx === idx) {
      // Trimmer already open for this clip — close it (toggle off)
      setSampleTrimmer(null)
    } else {
      // Open trimmer so user can set in/out points before marking
      const segment = segments?.[idx]
      if (!segment) return
      setSampleTrimmer({
        idx,
        inPoint: parseTimestampToSeconds(segment),
        outPoint: getSegmentEndTime(segment),
      })
    }
  }

  const markTrimmedSample = () => {
    if (!sampleTrimmer) return
    const { idx, inPoint, outPoint } = sampleTrimmer
    const newSamples = { ...markedSamples }
    newSamples[idx] = { startTime: inPoint, endTime: outPoint }
    setMarkedSamples(newSamples)
    setHasUnsavedChanges(true)
    setSampleTrimmer(null)
    const segment = segments?.[idx]
    if (segment && isSoundBite(segment.speaker)) {
      const label = speakerNames[segment.speaker] || segment.speaker
      onNotification?.(`Sample trimmed for sound bite "${label}"`, 'info')
    }
  }

  const previewTrim = () => {
    if (!sampleTrimmer) return
    const { idx, inPoint, outPoint } = sampleTrimmer
    if (playingClipIdx === idx) {
      audioRef.current?.pause()
      return
    }
    clipStartRef.current = inPoint
    clipEndRef.current = outPoint
    setPlayingClipIdx(idx)
    if (audioRef.current) {
      audioRef.current.currentTime = inPoint
      setCurrentTime(inPoint)
      audioRef.current.play().catch(err => console.error('Audio play failed:', err))
    }
  }

  const setTrimIn = () => {
    if (!sampleTrimmer || !segments?.[sampleTrimmer.idx]) return
    const clipStart = parseTimestampToSeconds(segments[sampleTrimmer.idx])
    const newIn = Math.max(clipStart, Math.min(currentTime, sampleTrimmer.outPoint - 0.5))
    setSampleTrimmer({ ...sampleTrimmer, inPoint: newIn })
  }

  const setTrimOut = () => {
    if (!sampleTrimmer || !segments?.[sampleTrimmer.idx]) return
    const clipEnd = getSegmentEndTime(segments[sampleTrimmer.idx])
    const newOut = Math.min(clipEnd, Math.max(currentTime, sampleTrimmer.inPoint + 0.5))
    setSampleTrimmer({ ...sampleTrimmer, outPoint: newOut })
  }

  // Speaker name assignment (from TranscriptEditor's own picker)
  const handleAssignSpeakerName = (originalLabel, displayName) => {
    setSpeakerNames(prev => ({ ...prev, [originalLabel]: displayName }))
    setHasUnsavedChanges(true)
    setActivePicker(null)
  }

  // Audio drop assignment to diarization label (from TranscriptEditor's own picker)
  const handleAssignAudioDrop = async (originalLabel, drop) => {
    setSpeakerNames(prev => ({ ...prev, [originalLabel]: drop.name }))
    setActivePicker(null)
    try {
      await speakersAPI.linkEpisodeAudioDrop(episode.id, originalLabel, drop.id)
      setEpisodeSpeakerAssignments(prev => [
        ...prev.filter(a => a.diarization_label !== originalLabel),
        { diarization_label: originalLabel, audio_drop_id: drop.id, audio_drop_name: drop.name, speaker_id: null, speaker_name: null }
      ])
      flashSavedToast('✓ Sound bite linked')
    } catch (err) {
      console.error('Failed to link audio drop:', err)
    }
  }

  // Unassign speaker/drop from diarization label
  const handleUnassignSpeaker = async (originalLabel) => {
    setSpeakerNames(prev => {
      const next = { ...prev }
      delete next[originalLabel]
      return next
    })
    setActivePicker(null)
    setHasUnsavedChanges(true)
    setEpisodeSpeakerAssignments(prev => prev.filter(a => a.diarization_label !== originalLabel))
    try {
      await speakersAPI.unlinkEpisodeSpeaker(episode.id, originalLabel)
    } catch (err) {
      console.error('Failed to unlink speaker:', err)
    }
  }

  // Check if a diarization label is assigned to a sound bite (not a speaker)
  const isSoundBite = useCallback((speakerId) => {
    return episodeSpeakerAssignments.some(a => a.diarization_label === speakerId && a.audio_drop_id)
  }, [episodeSpeakerAssignments])

  // Helpers
  const getCharacterForSegment = (idx) => characterAppearances.find(ca => ca.segment_idx === idx)
  const getChapterForSegment = (idx) => episodeChapters.find(ch => ch.start_segment_idx <= idx && ch.end_segment_idx >= idx)
  const getDropsForSegment = (idx) => audioDropInstances.filter(adi => adi.segment_idx === idx)

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
      const sampleIndices = Object.keys(markedSamples).map(idx => parseInt(idx))
      await episodesAPI.updateSpeakerNames(episode.id, speakerNames, sampleIndices.length > 0 ? sampleIndices : null)
      const hasMarkedSamples = Object.keys(markedSamples).length > 0
      if (hasMarkedSamples && segments) {
        const samplesToSave = Object.keys(markedSamples).map(idx => {
          const segIdx = parseInt(idx)
          const segment = segments[segIdx]
          const trim = markedSamples[idx] // { startTime, endTime } from trimmer
          // If this segment is tagged as an audio drop instance, pass the drop ID
          // explicitly — the backend then skips the episode_speakers lookup (which
          // only covers full-episode diarization assignments, not per-clip tags).
          const segDrops = getDropsForSegment(segIdx)
          const primaryDrop = segDrops[0] ?? null
          return {
            speaker: segment.speaker,
            speakerName: primaryDrop?.audio_drop_name || flaggedSegments[segIdx]?.corrected_speaker || speakerNames[segment.speaker] || segment.speaker,
            startTime: trim?.startTime ?? parseTimestampToSeconds(segment),
            endTime: trim?.endTime ?? getSegmentEndTime(segment),
            text: segment.text,
            segmentIdx: segIdx,
            audioDropId: primaryDrop?.audio_drop_id ?? null,
          }
        })
        const savedSamples = await episodesAPI.saveVoiceSamples(episode.id, samplesToSave)
        if (savedSamples === 0) {
          onNotification?.(
            'No audio samples were extracted. Check speaker/drop mapping and audio clip boundaries.',
            'warning'
          )
        } else {
          const soundBiteSaved = samplesToSave.filter(s => isSoundBite(s.speaker)).length
          const speakerSaved = samplesToSave.length - soundBiteSaved
          const detail = []
          if (speakerSaved > 0) detail.push(`${speakerSaved} speaker`)
          if (soundBiteSaved > 0) detail.push(`${soundBiteSaved} sound bite`)
          onNotification?.(`Saved ${savedSamples} audio sample${savedSamples === 1 ? '' : 's'} (${detail.join(', ')})`, 'success')
        }
      }
      setHasUnsavedChanges(false)
      if (!hasMarkedSamples) {
        onNotification?.('Changes saved', 'success')
      }
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
          setSelectedSegmentIdx(nextIdx)
          segmentRefs.current[nextIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          break
        }
        case 'k':
        case 'K': {
          e.preventDefault()
          const prevIdx = selectedSegmentIdx != null ? Math.max(selectedSegmentIdx - 1, 0) : 0
          setSelectedSegmentIdx(prevIdx)
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
            setSelectedSegmentIdx(null)
          }
          break
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [segments, selectedSegmentIdx, activePicker])

  // Register handlers with context so PropertiesPanel can call them without window globals
  useEffect(() => {
    registerHandlers({
      deleteFlag,
      removeCharacter: removeCharacterFromSegment,
      deleteChapter,
      toggleVoiceSample,
      seekToSegment: seekToSegmentIdx,
      seekToSpeaker,
      // Called by context.assignSpeakerName (from PropertiesPanel) — just mark unsaved;
      // speakerNames already updated in context by the time this runs
      assignSpeakerName: (_label, _name) => { setHasUnsavedChanges(true) },
      // Called by context.assignAudioDrop (from PropertiesPanel) — persist immediately
      assignAudioDrop: async (label, drop) => {
        try {
          await speakersAPI.linkEpisodeAudioDrop(episode.id, label, drop.id)
          setEpisodeSpeakerAssignments(prev => [
            ...prev.filter(a => a.diarization_label !== label),
            { diarization_label: label, audio_drop_id: drop.id, audio_drop_name: drop.name, speaker_id: null, speaker_name: null }
          ])
        } catch (err) {
          console.error('Failed to link audio drop from PropertiesPanel:', err)
        }
      },
    })
  })

  // ---- Inline Picker Component ----
  const renderActionPicker = (pickerType, idx) => {
    if (pickerType === 'flag') {
      // Show speaker checklist for multiple_speakers flag
      if (speakerPickerIdx === idx) {
        return (
          <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Select speakers present</span>
              <button onClick={(e) => { e.stopPropagation(); setSpeakerPickerIdx(null); setActivePicker('flag') }} className="text-xs text-gray-400 hover:text-gray-600">← Back</button>
            </div>
            <div className="max-h-48 overflow-y-auto">
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
            </div>
            <div className="flex gap-1 mt-2 pt-2 border-t border-gray-100">
              <input
                type="text"
                placeholder="Add unlisted speaker..."
                value={flagInlineInput}
                onChange={(e) => { e.stopPropagation(); setFlagInlineInput(e.target.value) }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && flagInlineInput.trim()) {
                    const name = flagInlineInput.trim()
                    if (!speakerPickerSelected.includes(name)) setSpeakerPickerSelected(prev => [...prev, name])
                    setFlagInlineInput('')
                  }
                }}
                className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
                onClick={(e) => e.stopPropagation()}
              />
              <button onClick={(e) => {
                e.stopPropagation()
                const name = flagInlineInput.trim()
                if (name && !speakerPickerSelected.includes(name)) setSpeakerPickerSelected(prev => [...prev, name])
                setFlagInlineInput('')
              }} className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 flex-shrink-0">
                Add
              </button>
            </div>
            {speakerPickerSelected.filter(s => !uniqueSpeakers.includes(s)).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {speakerPickerSelected.filter(s => !uniqueSpeakers.includes(s)).map(name => (
                  <span key={name} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs flex items-center gap-1">
                    {name}
                    <button onClick={(e) => { e.stopPropagation(); setSpeakerPickerSelected(prev => prev.filter(s => s !== name)) }} className="hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-2">
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
                setActivePicker('flag')
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
                setFlagInlineInput('')
                setActivePicker('flag-wrong-speaker')
              } else if (ft.needsCharacter) {
                setNewCharacterName('')
                setActivePicker('flag-character')
              } else if (ft.needsSpeakers) {
                setSpeakerPickerIdx(idx)
                setSpeakerPickerSelected([])
                setFlagInlineInput('')
              } else if (ft.needsCorrection) {
                const seg = segments?.[idx]
                setFlagInlineInput(seg?.text?.trim() || '')
                setActivePicker(`flag-correction-${ft.id}`)
                if (seg) playClipOnly(seg, idx)
              } else if (ft.needsNotes) {
                setFlagInlineInput('')
                setActivePicker('flag-other')
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
    if (pickerType === 'flag-wrong-speaker') {
      const segment = segments?.[idx]
      // Filter out audio-drop entries from the speaker list (fix 3b)
      const audioDropNames = new Set(audioDrops.map(d => d.name))
      const speakerOnlyLibrary = voiceLibrary.filter(v => !audioDropNames.has(v.name) && !v.name.startsWith('🔊'))
      const unassignedLabels = uniqueSpeakers.filter(label => !speakerNames[label])
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-red-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">
            Who should this be? (current: {speakerNames[segment?.speaker] || segment?.speaker})
          </div>
          {unassignedLabels.length > 0 && (
            <>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Unassigned Labels</div>
              <div className="max-h-28 overflow-y-auto">
                {unassignedLabels.map(label => (
                  <button key={label} onClick={(e) => {
                    e.stopPropagation()
                    createFlag(idx, 'wrong_speaker', label)
                    setActivePicker(null)
                  }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-red-50 text-red-800 flex items-center gap-2">
                    <span>🏷️</span> {label}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-2 mb-1 px-1 border-t border-gray-100 pt-2">Known Speakers</div>
            </>
          )}
          <div className="max-h-48 overflow-y-auto">
          {speakerOnlyLibrary.map(v => (
            <button key={v.name} onClick={(e) => {
              e.stopPropagation()
              createFlag(idx, 'wrong_speaker', v.name)
              setActivePicker(null)
            }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-red-50 text-red-800 flex items-center gap-2">
              <span>🎤</span> {v.short_name || v.name}
            </button>
          ))}
          </div>
          {audioDrops.length > 0 && (
            <>
              <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-2 mb-1 px-1 border-t border-gray-100 pt-2">Sound Bites</div>
              {audioDrops.map(d => (
                <button key={d.id} onClick={(e) => {
                  e.stopPropagation()
                  createFlag(idx, 'wrong_speaker', d.name)
                  setActivePicker(null)
                }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-red-50 text-red-800 flex items-center gap-2">
                  <span>🔊</span> {d.name}
                </button>
              ))}
            </>
          )}
          <div className="flex gap-1 mt-1">
            <input
              type="text"
              placeholder="Or type a name..."
              value={flagInlineInput}
              onChange={(e) => setFlagInlineInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && flagInlineInput.trim()) {
                  createFlag(idx, 'wrong_speaker', flagInlineInput.trim())
                  setActivePicker(null)
                }
              }}
              className="flex-1 px-2 py-1.5 text-sm border border-red-200 rounded"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
            <button onClick={(e) => {
              e.stopPropagation()
              if (flagInlineInput.trim()) {
                createFlag(idx, 'wrong_speaker', flagInlineInput.trim())
                setActivePicker(null)
              }
            }} className="px-3 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">
              Save
            </button>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setActivePicker('flag') }} className="mt-1 text-xs text-gray-400 hover:text-gray-600">← Back</button>
        </div>
      )
    }
    if (pickerType === 'flag-character') {
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-pink-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Which character is speaking?</div>
          {characters.slice(0, 8).map(c => (
            <button key={c.id} onClick={(e) => {
              e.stopPropagation()
              createFlag(idx, 'character_voice', null, c.id)
              setActivePicker(null)
            }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-pink-50 text-pink-800 flex items-center gap-2">
              <span>🎭</span> {c.name}
            </button>
          ))}
          <div className="flex gap-1 mt-1">
            <input
              type="text"
              placeholder="Or type a character name..."
              value={newCharacterName}
              onChange={(e) => setNewCharacterName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && newCharacterName.trim()) createCharacterAndFlagIt(idx, newCharacterName)
              }}
              className="flex-1 px-2 py-1.5 text-sm border border-pink-200 rounded"
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
            <button onClick={(e) => {
              e.stopPropagation()
              if (newCharacterName.trim()) createCharacterAndFlagIt(idx, newCharacterName)
            }} className="px-3 py-1.5 text-xs bg-pink-500 text-white rounded hover:bg-pink-600">
              Save
            </button>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setActivePicker('flag') }} className="mt-1 text-xs text-gray-400 hover:text-gray-600">← Back</button>
        </div>
      )
    }
    if (pickerType?.startsWith('flag-correction-')) {
      const flagTypeId = pickerType.replace('flag-correction-', '')
      const isMissing = flagTypeId === 'missing_word'
      const seg = segments?.[idx]
      const originalText = seg?.text?.trim() || ''
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-amber-200 shadow-sm">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">
              {isMissing ? 'Add the missing word(s)' : 'What should this say?'}
            </span>
            <span className="text-[10px] font-medium text-gray-500">Clip #{idx}</span>
          </div>
          <div className="text-[10px] text-amber-600 mb-2 px-1">▶ clip playing — listen and correct below</div>
          <textarea
            value={flagInlineInput}
            onChange={(e) => setFlagInlineInput(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            rows={3}
            className="w-full px-2 py-1.5 text-sm border border-amber-200 rounded resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <button onClick={async (e) => {
              e.stopPropagation()
              const corrected = flagInlineInput.trim()
              await createFlag(idx, flagTypeId, null, null, originalText)
              if (corrected && corrected !== originalText) {
                try {
                  await episodesAPI.saveTranscriptEdits(episode.id, { [idx]: { text: corrected } })
                  await loadTranscript()
                  onNotification?.(isMissing ? 'Missing word added' : 'Spelling corrected', 'success')
                } catch (err) {
                  onNotification?.(`Failed to save correction: ${err.message}`, 'error')
                }
              }
              setActivePicker(null)
            }} className="px-3 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600">
              Save correction
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker('flag') }} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
        </div>
      )
    }
    if (pickerType === 'flag-other') {
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-yellow-200 shadow-sm">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Add a note about this segment</div>
          <input
            type="text"
            placeholder="Describe the issue..."
            value={flagInlineInput}
            onChange={(e) => setFlagInlineInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && flagInlineInput.trim()) {
                createFlag(idx, 'other', null, null, flagInlineInput.trim())
                setActivePicker(null)
              }
            }}
            className="w-full px-2 py-1.5 text-sm border border-yellow-200 rounded"
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
          <div className="flex gap-2 mt-1">
            <button onClick={(e) => {
              e.stopPropagation()
              if (flagInlineInput.trim()) {
                createFlag(idx, 'other', null, null, flagInlineInput.trim())
                setActivePicker(null)
              }
            }} className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600">
              Save
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker('flag') }} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">← Back</button>
          </div>
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
            <button key={ct.id} onClick={(e) => {
              e.stopPropagation()
              setChapterRangeStart(idx)
              setChapterRangeType(ct.id)
              setChapterRangeEndInput(String(idx))
            }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-indigo-50 flex items-center gap-2">
              <span>{ct.icon}</span> <span style={{ color: ct.color }}>{ct.name}</span>
            </button>
          ))}
          {chapterRangeStart === idx && chapterRangeType && (
            <div className="mt-2 p-2 rounded border border-indigo-200 bg-indigo-50">
              <div className="text-xs text-indigo-700">Start segment: #{chapterRangeStart}</div>
              <div className="flex gap-2 mt-2 items-center">
                <input
                  type="number"
                  min="0"
                  placeholder={`End at segment #${chapterRangeStart}`}
                  value={chapterRangeEndInput}
                  onChange={(e) => setChapterRangeEndInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') submitChapterRange()
                  }}
                  className="flex-1 px-2 py-1 text-xs border border-indigo-200 rounded"
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); submitChapterRange() }}
                  className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Save range
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); createChapter(chapterRangeType, chapterRangeStart) }}
                  className="px-2 py-1 text-xs bg-white text-indigo-700 rounded border border-indigo-200 hover:bg-indigo-100"
                >
                  Just this
                </button>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setChapterRangeStart(null)
                  setChapterRangeType(null)
                  setChapterRangeEndInput('')
                }}
                className="mt-2 text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )
    }
    if (pickerType === 'speaker') {
      const segment = segments?.[idx]
      if (!segment) return null
      const audioDropNames = new Set(audioDrops.map(d => d.name))
      const speakerOnlyLibrary = voiceLibrary.filter(v => !audioDropNames.has(v.name))
      return (
        <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm max-h-64 overflow-y-auto">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Assign to speaker</div>
          {speakerOnlyLibrary.map(v => (
            <button key={v.name} onClick={(e) => { e.stopPropagation(); handleAssignSpeakerName(segment.speaker, v.name) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-yellow-50 text-yellow-800 flex items-center gap-2">
              <span>🎤</span> {v.short_name || v.name}
            </button>
          ))}
          <input
            type="text"
            placeholder="+ New speaker..."
            value={newSpeakerName}
            onChange={(e) => setNewSpeakerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSpeakerName.trim()) createSpeakerAndAssign(segment.speaker, newSpeakerName)
            }}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="border-t border-gray-100 mt-2 pt-2">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1 px-1">Assign to sound bite</div>
            {audioDrops.map(drop => (
              <button key={drop.id} onClick={(e) => { e.stopPropagation(); handleAssignAudioDrop(segment.speaker, drop) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-teal-50 text-teal-800 flex items-center gap-2">
                <span>🔊</span> {drop.name}
              </button>
            ))}
            <input
              type="text"
              placeholder="+ New sound bite..."
              value={newDropName}
              onChange={(e) => setNewDropName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && newDropName.trim()) createDropAndAssign(segment.speaker, newDropName)
              }}
              className="w-full mt-1 px-2 py-1.5 text-sm border rounded"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {speakerNames[segment.speaker] && (
            <>
              <div className="border-t border-gray-100 mt-2 pt-2">
                <button onClick={(e) => { e.stopPropagation(); handleUnassignSpeaker(segment.speaker) }} className="w-full px-2 py-1.5 text-sm text-left rounded hover:bg-red-50 text-red-600 flex items-center gap-2">
                  <span>✕</span> Unassign
                </button>
              </div>
            </>
          )}
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
    const hasSample = markedSamples[idx]

    if (!flag && !character && !chapter && !hasSample) return null

    return (
      <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-200/50">
        {flag && (
          <span className={`px-2 py-1 rounded text-xs font-medium cursor-pointer ${
            flag.flag_type === 'wrong_speaker' ? 'bg-red-100 text-red-700' :
            flag.flag_type === 'character_voice' ? 'bg-pink-100 text-pink-700' :
            flag.flag_type === 'misspelling' ? 'bg-amber-100 text-amber-700' :
            flag.flag_type === 'missing_word' ? 'bg-violet-100 text-violet-700' :
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
          <span className="px-2 py-1 rounded text-xs font-medium bg-pink-100 text-pink-700 group/char inline-flex items-center gap-1" title={character.character_name}>
            🎭 {character.character_name}
            <button
              className="hidden group-hover/char:inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-pink-300 hover:bg-pink-500 text-pink-800 hover:text-white text-[9px] leading-none ml-0.5"
              onClick={(e) => { e.stopPropagation(); removeCharacterFromSegment(character.id) }}
              title="Remove character from this segment"
            >×</button>
          </span>
        )}
        {chapter && (
          <span className="px-2 py-1 rounded text-xs font-medium cursor-pointer" style={{ backgroundColor: chapter.chapter_type_color + '33', color: chapter.chapter_type_color }} onClick={(e) => { e.stopPropagation(); deleteChapter(chapter.id) }} title="Click to remove">
            {chapter.chapter_type_icon} {chapter.chapter_type_name}
          </span>
        )}
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
            <button onClick={(e) => { e.stopPropagation(); toggleVoiceSample(idx) }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${markedSamples[idx] ? 'bg-yellow-300 text-yellow-900 ring-1 ring-yellow-400' : sampleTrimmer?.idx === idx ? 'bg-yellow-100 text-yellow-800 ring-1 ring-yellow-300' : 'bg-white text-gray-600 hover:bg-yellow-50 border border-gray-200'}`}>
              {markedSamples[idx] ? '⭐ Unmark' : sampleTrimmer?.idx === idx ? '✂️ Trimming…' : '☆ Sample'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setActivePicker(activePicker === 'speaker' ? null : 'speaker') }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${activePicker === 'speaker' ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300' : 'bg-white text-gray-600 hover:bg-purple-50 border border-gray-200'}`}>
              ✎ Speaker
            </button>
            {hasUnsavedChanges && (
              <button
                onClick={(e) => { e.stopPropagation(); saveEdits() }}
                disabled={saving || diarizationLocked || polishRunning}
                className="ml-auto px-3 py-2 rounded-lg text-sm font-medium bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-50"
                title="Save episode changes"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {activePicker && renderActionPicker(activePicker, idx)}
          {sampleTrimmer?.idx === idx && (() => {
            const seg = segments[idx]
            const clipStart = parseTimestampToSeconds(seg)
            const clipEnd = getSegmentEndTime(seg)
            const clipDuration = Math.max(0.01, clipEnd - clipStart)
            const inPct = ((sampleTrimmer.inPoint - clipStart) / clipDuration) * 100
            const outPct = ((sampleTrimmer.outPoint - clipStart) / clipDuration) * 100
            const playPct = Math.max(0, Math.min(100, ((currentTime - clipStart) / clipDuration) * 100))
            const isPreviewing = playingClipIdx === idx
            const trimDuration = (sampleTrimmer.outPoint - sampleTrimmer.inPoint).toFixed(1)
            return (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-[11px]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-yellow-900">✂️ Sample Trimmer — seek to position, set in/out, then mark</span>
                  <button onClick={() => setSampleTrimmer(null)} className="text-gray-400 hover:text-gray-600 leading-none px-1">✕</button>
                </div>
                {/* Seek strip — click to seek within clip */}
                <div
                  className="relative h-8 mb-2 cursor-pointer select-none"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                    seekTo(clipStart + pct * clipDuration)
                  }}
                >
                  <div className="absolute inset-x-0 top-3 h-2 bg-gray-200 rounded-full" />
                  <div className="absolute top-3 h-2 bg-yellow-400 rounded-full" style={{ left: `${inPct}%`, right: `${100 - outPct}%` }} />
                  <div className="absolute top-0.5 w-0.5 h-7 bg-purple-500 rounded-full pointer-events-none" style={{ left: `${playPct}%` }} />
                  <div className="absolute top-0.5 w-[3px] h-7 bg-green-500 rounded pointer-events-none" style={{ left: `${inPct}%` }} title="In point" />
                  <div className="absolute top-0.5 w-[3px] h-7 bg-red-500 rounded pointer-events-none" style={{ left: `${outPct}%` }} title="Out point" />
                </div>
                {/* Time labels */}
                <div className="flex justify-between font-mono mb-2 px-0.5">
                  <span className="text-green-700">In: {formatTime(sampleTrimmer.inPoint)}</span>
                  <span className="text-gray-400">{trimDuration}s selected</span>
                  <span className="text-red-700">Out: {formatTime(sampleTrimmer.outPoint)}</span>
                </div>
                {/* Controls */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={setTrimIn}
                    className="flex-1 py-1.5 bg-green-100 hover:bg-green-200 text-green-800 rounded font-medium"
                    title="Set in-point to current playhead position"
                  >
                    [ Set In
                  </button>
                  <button
                    onClick={previewTrim}
                    className={`flex-none px-3 py-1.5 rounded font-medium ${isPreviewing ? 'bg-purple-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                    title={isPreviewing ? 'Stop preview' : 'Preview trimmed selection'}
                  >
                    {isPreviewing ? '⏹' : '▶'}
                  </button>
                  <button
                    onClick={setTrimOut}
                    className="flex-1 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded font-medium"
                    title="Set out-point to current playhead position"
                  >
                    Set Out ]
                  </button>
                  <button
                    onClick={markTrimmedSample}
                    className="flex-none py-1.5 px-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded font-medium"
                    title="Mark this trimmed range as voice sample"
                  >
                    ⭐ Mark
                  </button>
                </div>
              </div>
            )
          })()}
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
          <div className="text-gray-500 text-sm font-medium">Scooping up transcript...</div>
          <div className="text-gray-400 text-xs mt-1 max-w-xs mx-auto truncate">{episode?.title}</div>
        </div>
      </div>
    )
  }

  if (error) {
    const isFailed = episode?.transcription_status === 'failed'
    const transcriptionError = episode?.transcription_error
    const isDownloadFail = transcriptionError?.toLowerCase().includes('download')

    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md px-6">
          <div className="text-red-500 text-4xl mb-4">⚠</div>
          <div className="text-red-600 font-medium mb-2">Failed to load transcript</div>
          {isFailed && transcriptionError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
              <div className="text-xs font-medium text-red-700 mb-1">
                {isDownloadFail ? 'Download Error' : 'Processing Error'}
              </div>
              <div className="text-xs text-red-600">{transcriptionError}</div>
              {isDownloadFail && (
                <div className="text-xs text-gray-500 mt-2">
                  The audio file could not be downloaded from the RSS feed. This usually means the CDN link has expired or the file is temporarily unavailable.
                </div>
              )}
            </div>
          )}
          {!isFailed && (
            <div className="text-sm text-gray-500 mb-4">{error}</div>
          )}
          <div className="flex gap-2 justify-center">
            {isDownloadFail && (
              <button
                onClick={async () => {
                  try {
                    await episodesAPI.downloadEpisode(episode.id)
                    onNotification?.('Download started - episode will be queued when complete', 'success')
                  } catch (err) {
                    onNotification?.(`Download failed: ${err.message}`, 'error')
                  }
                }}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium"
              >
                Retry Download
              </button>
            )}
            <button onClick={loadTranscript} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm">
              Try Again
            </button>
          </div>
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
    <div className="min-h-full flex flex-col bg-white">
      {/* Header with episode info */}
      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
              title="Close transcript and return to library"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          )}
          {episodeImageUrl && !episodeImageError && (
            <img
              src={episodeImageUrl}
              alt=""
              onError={() => setEpisodeImageError(true)}
              className="w-10 h-10 rounded-md object-cover border border-gray-200 flex-shrink-0"
            />
          )}
          <h2 className="text-lg font-bold text-gray-800 truncate">{episode.title}</h2>
        </div>
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
          {Object.keys(flaggedSegments).length > 0 && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">
              🚩 {Object.keys(flaggedSegments).length} flags
            </span>
          )}
          {episode.is_transcribed && (() => {
            const hintCount = Object.values(flaggedSegments).filter(f =>
              ['wrong_speaker', 'multiple_speakers', 'character_voice'].includes(f.flag_type) && !f.resolved
            ).length
            const backendLabel = reprocessBackend === 'current'
              ? `Current (${currentEmbeddingBackend})`
              : reprocessBackend
            return (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex items-center rounded-md border border-orange-300 overflow-hidden">
                  <select
                    value={reprocessBackend}
                    onChange={(e) => setReprocessBackend(e.target.value)}
                    disabled={reprocessing || diarizationLocked}
                    className="px-2 py-1 text-xs bg-white text-orange-700 disabled:opacity-50 border-r border-orange-300"
                    title="Choose embedding backend for this reprocess run"
                  >
                    <option value="current">Backend: Current ({currentEmbeddingBackend})</option>
                    <option value="pyannote">Backend: pyannote</option>
                    <option value="ecapa-tdnn">Backend: ecapa-tdnn</option>
                  </select>
                  <button
                    disabled={reprocessing || diarizationLocked}
                    onClick={async () => {
                      setReprocessing(true)
                      try {
                        await episodesAPI.reprocessDiarization(episode.id, {
                          embeddingBackend: reprocessBackend === 'current' ? null : reprocessBackend,
                          prioritizeTop: true,
                        })
                        setDiarizationLocked(true)
                        onNotification?.(`Queued re-diarization (${backendLabel}) at top priority.`, 'success')
                      } catch (err) {
                        onNotification?.(`Failed to queue re-diarization: ${err.message}`, 'error')
                        setReprocessing(false)
                      }
                    }}
                    className={`px-3 py-1 text-xs font-medium transition-all duration-300 ${
                      reprocessing
                        ? 'bg-green-100 text-green-700 cursor-not-allowed'
                        : 'bg-orange-100 text-orange-700 hover:bg-orange-200 cursor-pointer'
                    }`}
                    title={hintCount > 0
                      ? `Reprocess with ${hintCount} speaker correction${hintCount > 1 ? 's' : ''} as hints. Runs at top queue priority.`
                      : 'Reprocess diarization (no corrections flagged). Runs at top queue priority.'}
                  >
                    {reprocessing ? '✓ Queued for Diarization' : '🔄 Reprocess Diarization'}
                  </button>
                </div>

                {transcript?.has_diarization && (
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={compareRunning}
                      onClick={async () => {
                        setCompareRunning(true)
                        try {
                          const result = await speakersAPI.compareEmbeddingBackends(episode.id)
                          setCompareResults(result)
                        } catch (err) {
                          onNotification?.(`Compare failed: ${err.message}`, 'error')
                        } finally {
                          setCompareRunning(false)
                        }
                      }}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200 disabled:opacity-50"
                      title="Run ECAPA vs pyannote compare for this episode"
                    >
                      {compareRunning ? 'Comparing…' : '⚖️ Compare Backends'}
                    </button>
                    <button
                      disabled={rebuildingBackend != null}
                      onClick={async () => {
                        setRebuildingBackend('ecapa-tdnn')
                        try {
                          const result = await speakersAPI.rebuildVoiceLibrary('ecapa-tdnn')
                          onNotification?.(`ECAPA prints rebuilt: ${result.rebuilt} clips across ${result.speaker_count} speakers`, 'success')
                        } catch (err) {
                          onNotification?.(`ECAPA rebuild failed: ${err.message}`, 'error')
                        } finally {
                          setRebuildingBackend(null)
                        }
                      }}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-violet-100 text-violet-700 border border-violet-300 hover:bg-violet-200 disabled:opacity-50"
                      title="Build ECAPA-TDNN voice prints from current samples"
                    >
                      {rebuildingBackend === 'ecapa-tdnn' ? 'Building ECAPA…' : 'Build ECAPA Prints'}
                    </button>
                    <button
                      disabled={rebuildingBackend != null}
                      onClick={async () => {
                        setRebuildingBackend('pyannote')
                        try {
                          const result = await speakersAPI.rebuildVoiceLibrary('pyannote')
                          onNotification?.(`pyannote prints rebuilt: ${result.rebuilt} clips across ${result.speaker_count} speakers`, 'success')
                        } catch (err) {
                          onNotification?.(`pyannote rebuild failed: ${err.message}`, 'error')
                        } finally {
                          setRebuildingBackend(null)
                        }
                      }}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-sky-100 text-sky-700 border border-sky-300 hover:bg-sky-200 disabled:opacity-50"
                      title="Build pyannote voice prints from current samples"
                    >
                      {rebuildingBackend === 'pyannote' ? 'Building pyannote…' : 'Build pyannote Prints'}
                    </button>
                  </div>
                )}

                {compareResults?.backend_errors && Object.keys(compareResults.backend_errors).length > 0 && (
                  <div className="w-full mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                    {Object.entries(compareResults.backend_errors).map(([backend, err]) => (
                      <div key={backend}>{backend}: {String(err)}</div>
                    ))}
                  </div>
                )}

                {compareResults?.results && (
                  <div className="w-full mt-2 border border-slate-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <div className="text-xs text-slate-600">
                        Compare Results • {compareResults.segments_tested || 0} diarization label{(compareResults.segments_tested || 0) === 1 ? '' : 's'}
                      </div>
                      <button
                        onClick={() => setCompareExpanded(prev => !prev)}
                        className="px-2 py-1 rounded text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
                        title={compareExpanded ? 'Collapse compare results' : 'Expand compare results'}
                      >
                        {compareExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    </div>
                    {compareExpanded && (
                      <div className="max-h-64 overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <th className="text-left px-2 py-1.5">Label</th>
                              <th className="text-left px-2 py-1.5">ECAPA-TDNN</th>
                              <th className="text-left px-2 py-1.5">pyannote</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(compareResults.results).map(([label, row]) => {
                              const ecapa = row['ecapa-tdnn'] || { name: null, confidence: 0 }
                              const pyannote = row.pyannote || { name: null, confidence: 0 }
                              const assignedLabel = speakerNames[label]
                              return (
                                <tr key={label} className="border-t border-slate-100">
                                  <td className="px-2 py-1.5 font-medium text-slate-800">
                                    <div>{label}</div>
                                    {assignedLabel && assignedLabel !== label && (
                                      <div className="text-[11px] text-slate-500 mt-0.5">{assignedLabel}</div>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-700">
                                    {ecapa.name || 'Unknown'} ({Math.round((ecapa.confidence || 0) * 100)}%)
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-700">
                                    {pyannote.name || 'Unknown'} ({Math.round((pyannote.confidence || 0) * 100)}%)
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
          {episode.is_transcribed && (
            <button
              disabled={autoLabeling || diarizationLocked}
              onClick={async () => {
                setAutoLabeling(true)
                try {
                  const count = await contentAPI.autoLabelChapters(episode.id, false)
                  if (count === 0) {
                    onNotification?.('No new chapters found — check your rules in Settings or enable "overwrite" if chapters already exist', 'info')
                  } else {
                    onNotification?.(`Auto-labeled ${count} chapter${count > 1 ? 's' : ''}`, 'success')
                    await loadTranscript()
                  }
                } catch (err) {
                  onNotification?.(`Auto-label failed: ${err.message}`, 'error')
                } finally {
                  setAutoLabeling(false)
                }
              }}
              className="px-2.5 py-1 rounded text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-300 hover:bg-indigo-200 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
              title="Auto-label chapters using rules from Settings → Chapter Label Rules"
            >
              {autoLabeling ? '⏳ Labeling…' : '📑 Auto-Label Chapters'}
            </button>
          )}
          {hasUnsavedChanges && (
            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">Unsaved changes</span>
          )}
        </div>
      </div>

      {/* Diarization Lock Banner */}
      {diarizationLocked && (
        <div className="px-4 py-3 bg-orange-50 border-b border-orange-200 flex items-center gap-3 flex-shrink-0">
          <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div>
            <span className="text-sm font-semibold text-orange-800">Re-diarization in progress</span>
            <span className="text-xs text-orange-600 ml-2">Editing locked until the worker finishes this episode</span>
          </div>
        </div>
      )}

      {/* Scoop Polish Banner */}
      {polishRunning && (
        <div className="px-4 py-3 bg-teal-50 border-b border-teal-200 flex items-center gap-3 flex-shrink-0">
          <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div>
            <span className="text-sm font-semibold text-teal-800">Scoop Polish in progress</span>
            <span className="text-xs text-teal-600 ml-2">Save disabled until complete</span>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 flex-shrink-0">
        {/* Audio Player */}
        {audioPath && (
          <div className="px-4 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100">
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
        <div className="bg-white px-4 py-3 border-b border-gray-200 flex gap-3 items-center">
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
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">● Unsaved changes</span>
              <button onClick={saveEdits} disabled={saving || diarizationLocked || polishRunning} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
          {savedToast && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">
              {savedToastMessage}
              <button onClick={() => { setSavedToast(false); if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current) }} className="ml-0.5 text-emerald-500 hover:text-emerald-800 leading-none font-bold">✕</button>
            </span>
          )}
        </div>

        {/* Keyboard shortcut hint */}
        <div className="px-4 py-1.5 border-b border-gray-100 bg-gray-50/50">
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
      </div>

      {/* Transcript Content */}
      <div ref={transcriptContainerRef} className="p-4">
        {hasSpeakerLabels && viewMode === 'speakers' && filteredSegments ? (
          <div className="space-y-3">
            {filteredSegments.map((segment, idx) => {
              const colors = getSpeakerColor(segment.speaker)
              const displayName = flaggedSegments[idx]?.corrected_speaker
                || speakerNames[segment.speaker] || segment.speaker
              const isCurrent = currentSegmentIdx === idx
              const isSelected = selectedSegmentIdx === idx
              const flag = flaggedSegments[idx]

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
                    pausePlaybackForReview()
                    setSelectedSegmentIdx(isSelected ? null : idx)
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
                        pausePlaybackForReview()
                        setSelectedSegmentIdx(idx)
                        setActivePicker('speaker')
                      }}
                    >
                      <span className="text-xs font-semibold text-gray-700 text-center leading-tight cursor-pointer hover:underline">
                        {isSoundBite(segment.speaker) && <span title="Sound bite">🔊 </span>}{displayName}
                      </span>
                    </div>

                    {/* Right: Content Column */}
                    <div
                      className="relative flex-1 min-w-0 px-5 py-4"
                      style={{ borderLeft: `4px solid ${colors.borderHex}` }}
                    >
                      {isSelected && hasUnsavedChanges && (
                        <button
                          onClick={(e) => { e.stopPropagation(); saveEdits() }}
                          disabled={saving || diarizationLocked || polishRunning}
                          className="absolute top-3 right-3 px-2.5 py-1 text-xs font-medium rounded bg-yellow-500 hover:bg-yellow-600 text-white disabled:opacity-50"
                          title="Save episode changes"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                      )}
                      {/* Timestamp + playing indicator */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[10px] text-gray-400 tabular-nums">Clip #{idx}</span>
                <button onClick={(e) => { e.stopPropagation(); seekToSegment(segment) }} className="text-xs text-gray-400 hover:text-purple-600 font-mono">
                  {formatTimestamp(segment)}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (playingClipIdx === idx) {
                      // Explicitly exit clip mode (works whether clip is playing or paused-at-start)
                      clipEndRef.current = null
                      clipStartRef.current = null
                      setPlayingClipIdx(null)
                      if (audioRef.current && !audioRef.current.paused) audioRef.current.pause()
                    } else {
                      playClipOnly(segment, idx)
                    }
                  }}
                  title={playingClipIdx === idx ? 'Stop clip' : 'Play this clip only'}
                  className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                    playingClipIdx === idx
                      ? 'text-purple-700 bg-purple-100 hover:bg-purple-200'
                      : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'
                  }`}
                >
                  {playingClipIdx === idx ? '⏹ clip' : '▶ clip'}
                </button>
                {isCurrent && playingClipIdx !== idx && <span className="text-xs text-purple-600 font-medium animate-pulse">▶ NOW</span>}
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
