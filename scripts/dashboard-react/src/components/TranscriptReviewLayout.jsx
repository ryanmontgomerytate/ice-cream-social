import { useState, useCallback } from 'react'
import EpisodeSidebar from './EpisodeSidebar'
import TranscriptEditor from './TranscriptEditor'
import PropertiesPanel from './PropertiesPanel'

/**
 * TranscriptReviewLayout - Master-detail layout for transcript review
 *
 * Layout:
 * ┌─────────────┬────────────────────────┬───────────────────┐
 * │  Episodes   │   Transcript Editor    │   Properties      │
 * │  Sidebar    │   (Full Width)         │   Panel           │
 * │  (Left)     │                        │   (Right)         │
 * └─────────────┴────────────────────────┴───────────────────┘
 *
 * When an episode is selected, the sidebar collapses to a thin strip.
 * Click the strip to re-expand and browse episodes again.
 */
export default function TranscriptReviewLayout({ onNotification }) {
  const [selectedEpisode, setSelectedEpisode] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Shared state between TranscriptEditor and PropertiesPanel
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

  // Handle episode selection — collapse sidebar when viewing transcript
  const handleSelectEpisode = useCallback((episode) => {
    setSelectedEpisode(episode)
    setSidebarCollapsed(true)
    // Reset state for new episode
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
  }, [])

  // PropertiesPanel callbacks — route through TranscriptEditor's window globals
  const handleDeleteFlag = useCallback((idx) => {
    window.__transcriptEditorDeleteFlag?.(idx)
  }, [])

  const handleRemoveCharacter = useCallback((appearanceId) => {
    window.__transcriptEditorRemoveCharacter?.(appearanceId)
  }, [])

  const handleDeleteChapter = useCallback((chapterId) => {
    window.__transcriptEditorDeleteChapter?.(chapterId)
  }, [])

  const handleToggleVoiceSample = useCallback((idx) => {
    window.__transcriptEditorToggleVoiceSample?.(idx)
  }, [])

  const handleSeekToSegment = useCallback((idx) => {
    if (typeof window !== 'undefined' && window.__transcriptEditorSeekToSegment) {
      window.__transcriptEditorSeekToSegment(idx)
    }
  }, [])

  const handleRemoveAudioDrop = useCallback((instanceId) => {
    window.__transcriptEditorRemoveAudioDrop?.(instanceId)
  }, [])

  const handleSeekToSpeaker = useCallback((speakerId) => {
    if (typeof window !== 'undefined' && window.__transcriptEditorSeekToSpeaker) {
      window.__transcriptEditorSeekToSpeaker(speakerId)
    }
  }, [])

  const handleAssignSpeakerName = useCallback((speakerId, name) => {
    setSpeakerNames(prev => ({ ...prev, [speakerId]: name }))
    if (typeof window !== 'undefined' && window.__transcriptEditorAssignSpeakerName) {
      window.__transcriptEditorAssignSpeakerName(speakerId, name)
    }
  }, [])

  return (
    <div className="h-[calc(100vh-220px)] flex bg-gray-100 rounded-xl overflow-hidden shadow-lg border border-gray-200">
      {/* Left Sidebar - Episodes (collapsible like PropertiesPanel) */}
      {sidebarCollapsed ? (
        <div className="w-12 h-full bg-white border-r border-gray-200 flex flex-col items-center py-4 flex-shrink-0">
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Browse episodes"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
          {selectedEpisode && (
            <div className="mt-4 flex-1 flex items-start justify-center overflow-hidden">
              <span
                className="text-[10px] text-gray-500 font-medium whitespace-nowrap"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                title={selectedEpisode.title}
              >
                {selectedEpisode.title?.length > 40
                  ? selectedEpisode.title.slice(0, 40) + '…'
                  : selectedEpisode.title}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="w-80 flex-shrink-0 flex flex-col h-full">
          {/* Collapse button row at top of sidebar */}
          <div className="px-3 py-2 border-b border-gray-200 bg-white flex items-center justify-end flex-shrink-0">
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <EpisodeSidebar
              selectedEpisodeId={selectedEpisode?.id}
              onSelectEpisode={handleSelectEpisode}
              onNotification={onNotification}
            />
          </div>
        </div>
      )}

      {/* Center - Transcript Editor */}
      <div className="flex-1 min-w-0">
        <TranscriptEditor
          episode={selectedEpisode}
          onNotification={onNotification}
          onFlaggedSegmentsChange={setFlaggedSegments}
          onCharacterAppearancesChange={setCharacterAppearances}
          onChaptersChange={setEpisodeChapters}
          onMarkedSamplesChange={setMarkedSamples}
          onSpeakersChange={setSpeakers}
          onSpeakerNamesChange={setSpeakerNames}
          onVoiceLibraryChange={setVoiceLibrary}
          onAudioDropInstancesChange={setAudioDropInstances}
          onAudioDropsChange={setAudioDrops}
          onSegmentsChange={setSegments}
          selectedSegmentIdx={selectedSegmentIdx}
          onSelectedSegmentChange={setSelectedSegmentIdx}
        />
      </div>

      {/* Right Sidebar - Properties Panel */}
      <PropertiesPanel
        episode={selectedEpisode}
        flaggedSegments={flaggedSegments}
        characterAppearances={characterAppearances}
        episodeChapters={episodeChapters}
        characters={characters}
        chapterTypes={chapterTypes}
        voiceLibrary={voiceLibrary}
        markedSamples={markedSamples}
        speakers={speakers}
        speakerNames={speakerNames}
        audioDropInstances={audioDropInstances}
        audioDrops={audioDrops}
        segments={segments}
        selectedSegmentIdx={selectedSegmentIdx}
        onDeleteFlag={handleDeleteFlag}
        onRemoveCharacter={handleRemoveCharacter}
        onDeleteChapter={handleDeleteChapter}
        onToggleVoiceSample={handleToggleVoiceSample}
        onSeekToSegment={handleSeekToSegment}
        onAssignSpeakerName={handleAssignSpeakerName}
        onSeekToSpeaker={handleSeekToSpeaker}
        onRemoveAudioDrop={handleRemoveAudioDrop}
      />
    </div>
  )
}
