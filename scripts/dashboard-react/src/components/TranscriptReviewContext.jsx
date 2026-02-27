import { Component, createContext, useCallback, useContext, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const TranscriptReviewContext = createContext(null)

// ---------------------------------------------------------------------------
// Provider — holds all shared state between TranscriptEditor and PropertiesPanel
// ---------------------------------------------------------------------------
export function TranscriptReviewProvider({ episode, onNotification, isVisible, children }) {
  // Shared state
  const [flaggedSegments, setFlaggedSegments] = useState({})
  const [characterAppearances, setCharacterAppearances] = useState([])
  const [episodeChapters, setEpisodeChapters] = useState([])
  const [markedSamples, setMarkedSamples] = useState({})
  const [characters, setCharacters] = useState([])
  const [chapterTypes, setChapterTypes] = useState([])
  const [voiceLibrary, setVoiceLibrary] = useState([])
  const [speakers, setSpeakers] = useState([])
  const [speakerNames, setSpeakerNames] = useState({})
  const [audioDropInstances, setAudioDropInstances] = useState([])
  const [audioDrops, setAudioDrops] = useState([])
  const [segments, setSegments] = useState(null)
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(null)
  const [polishRunning, setPolishRunning] = useState(false)

  // Handler registry — TranscriptEditor registers its async operations here
  // so PropertiesPanel can trigger them without window globals.
  const handlersRef = useRef({})
  const registerHandlers = useCallback((handlers) => {
    handlersRef.current = handlers
  }, [])

  // Action proxies used by PropertiesPanel (delegate to TranscriptEditor)
  const deleteFlag = useCallback(
    (idx) => handlersRef.current.deleteFlag?.(idx),
    []
  )
  const removeCharacter = useCallback(
    (id) => handlersRef.current.removeCharacter?.(id),
    []
  )
  const deleteChapter = useCallback(
    (id) => handlersRef.current.deleteChapter?.(id),
    []
  )
  const toggleVoiceSample = useCallback(
    (idx) => handlersRef.current.toggleVoiceSample?.(idx),
    []
  )
  const seekToSegment = useCallback(
    (idx) => handlersRef.current.seekToSegment?.(idx),
    []
  )
  const seekToSpeaker = useCallback(
    (speakerId) => handlersRef.current.seekToSpeaker?.(speakerId),
    []
  )
  const playTrimmedSample = useCallback(
    (idx) => handlersRef.current.playTrimmedSample?.(idx),
    []
  )
  // assignSpeakerName: update display state, then notify TranscriptEditor to
  // mark unsaved changes (the actual DB write happens in TranscriptEditor.saveEdits)
  const assignSpeakerName = useCallback((label, name) => {
    setSpeakerNames(prev => ({ ...prev, [label]: name }))
    handlersRef.current.assignSpeakerName?.(label, name)
  }, [])

  // assignAudioDrop: update display state, then notify TranscriptEditor to
  // persist immediately via speakersAPI.linkEpisodeAudioDrop
  const assignAudioDrop = useCallback((label, drop) => {
    setSpeakerNames(prev => ({ ...prev, [label]: drop.name }))
    handlersRef.current.assignAudioDrop?.(label, drop)
  }, [])

  // Reset all shared state when the episode changes
  const resetState = useCallback(() => {
    setFlaggedSegments({})
    setCharacterAppearances([])
    setEpisodeChapters([])
    setMarkedSamples({})
    setSpeakers([])
    setSpeakerNames({})
    setAudioDropInstances([])
    setAudioDrops([])
    setSegments(null)
    setSelectedSegmentIdx(null)
    setPolishRunning(false)
    handlersRef.current = {}
  }, [])

  const value = {
    // Shared state + setters
    flaggedSegments, setFlaggedSegments,
    characterAppearances, setCharacterAppearances,
    episodeChapters, setEpisodeChapters,
    markedSamples, setMarkedSamples,
    characters, setCharacters,
    chapterTypes, setChapterTypes,
    voiceLibrary, setVoiceLibrary,
    speakers, setSpeakers,
    speakerNames, setSpeakerNames,
    audioDropInstances, setAudioDropInstances,
    audioDrops, setAudioDrops,
    segments, setSegments,
    selectedSegmentIdx, setSelectedSegmentIdx,
    polishRunning, setPolishRunning,
    // Handler registration (called by TranscriptEditor on every render)
    registerHandlers,
    // Action proxies (called by PropertiesPanel)
    deleteFlag,
    removeCharacter,
    deleteChapter,
    toggleVoiceSample,
    seekToSegment,
    seekToSpeaker,
    playTrimmedSample,
    assignSpeakerName,
    assignAudioDrop,
    // Passed-through context props
    episode,
    onNotification,
    isVisible,
    resetState,
  }

  return (
    <TranscriptReviewContext.Provider value={value}>
      {children}
    </TranscriptReviewContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useTranscriptReview() {
  const ctx = useContext(TranscriptReviewContext)
  if (!ctx) throw new Error('useTranscriptReview must be used within TranscriptReviewProvider')
  return ctx
}

// ---------------------------------------------------------------------------
// ErrorBoundary — catches render errors inside the review panels
// ---------------------------------------------------------------------------
export class TranscriptReviewErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('TranscriptReview render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-red-50">
          <div className="text-center p-6 max-w-sm">
            <div className="text-4xl mb-4">⚠️</div>
            <div className="text-red-600 font-medium mb-2">Something went wrong</div>
            <div className="text-sm text-gray-500 mb-4 font-mono">{this.state.error?.message}</div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
