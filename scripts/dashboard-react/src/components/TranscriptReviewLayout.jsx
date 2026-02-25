import { useState, useCallback, useEffect } from 'react'
import { episodesAPI } from '../services/api'
import EpisodeSidebar from './EpisodeSidebar'
import TranscriptEditor from './TranscriptEditor'
import PropertiesPanel from './PropertiesPanel'
import {
  TranscriptReviewErrorBoundary,
  TranscriptReviewProvider,
  useTranscriptReview,
} from './TranscriptReviewContext'

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
 *
 * All shared state (flags, characters, chapters, speakers, etc.) lives in
 * TranscriptReviewContext so TranscriptEditor and PropertiesPanel can
 * communicate without window globals or deep prop drilling.
 */
export default function TranscriptReviewLayout({ onNotification, isVisible, openEpisodeId, onOpenEpisodeHandled }) {
  const [selectedEpisode, setSelectedEpisode] = useState(null)

  return (
    <TranscriptReviewProvider episode={selectedEpisode} onNotification={onNotification} isVisible={isVisible}>
      <TranscriptReviewErrorBoundary>
        <TranscriptReviewLayoutInner
          selectedEpisode={selectedEpisode}
          setSelectedEpisode={setSelectedEpisode}
          onNotification={onNotification}
          openEpisodeId={openEpisodeId}
          onOpenEpisodeHandled={onOpenEpisodeHandled}
        />
      </TranscriptReviewErrorBoundary>
    </TranscriptReviewProvider>
  )
}

// ---------------------------------------------------------------------------
// Inner layout — has access to TranscriptReviewContext
// ---------------------------------------------------------------------------
function TranscriptReviewLayoutInner({ selectedEpisode, setSelectedEpisode, onNotification, openEpisodeId, onOpenEpisodeHandled }) {
  const { resetState } = useTranscriptReview()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [hasTranscript, setHasTranscript] = useState(false)
  const [transcriptLoading, setTranscriptLoading] = useState(false)

  // Handle closing transcript — deselect episode, expand library
  const handleCloseEpisode = useCallback(() => {
    setSelectedEpisode(null)
    setSidebarCollapsed(false)
    setHasTranscript(false)
    setTranscriptLoading(false)
    resetState()
  }, [resetState, setSelectedEpisode])

  // Handle episode selection — collapse sidebar when viewing transcript
  const handleSelectEpisode = useCallback((episode) => {
    setSelectedEpisode(episode)
    setSidebarCollapsed(true)
    setHasTranscript(false)
    setTranscriptLoading(true)
    resetState()
  }, [resetState, setSelectedEpisode])

  const handleTranscriptLoaded = useCallback((loaded) => {
    setHasTranscript(loaded)
    setTranscriptLoading(false)
  }, [])

  // When openEpisodeId is set from outside (e.g. Stats tab), fetch and open that episode
  useEffect(() => {
    if (!openEpisodeId) return
    episodesAPI.getEpisode(openEpisodeId)
      .then(episode => {
        if (episode) handleSelectEpisode(episode)
      })
      .catch(() => {})
      .finally(() => onOpenEpisodeHandled?.())
  }, [openEpisodeId])

  // Show editor layout when transcript is loaded OR while loading (so spinner is visible)
  const showEditorPanels = selectedEpisode && (hasTranscript || transcriptLoading)

  return (
    <div className="h-[calc(100vh-170px)] min-h-0 flex bg-gray-100 rounded-xl overflow-hidden shadow-lg border border-gray-200">
      {/* Left Sidebar - Episodes */}
      {sidebarCollapsed && showEditorPanels ? (
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
        <div className={`${showEditorPanels ? 'w-80' : 'flex-1'} flex-shrink-0 flex flex-col h-full`}>
          {/* Collapse button row at top of sidebar - only when transcript is showing */}
          {showEditorPanels && (
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
          )}
          <div className="flex-1 min-h-0">
            <EpisodeSidebar
              selectedEpisodeId={selectedEpisode?.id}
              onSelectEpisode={handleSelectEpisode}
              onNotification={onNotification}
            />
          </div>
        </div>
      )}

      {/* Center - Transcript Editor (hidden when library is expanded) */}
      {selectedEpisode && (
        <div className={`${showEditorPanels ? 'flex-1 min-h-0 overflow-y-auto' : 'w-0 overflow-hidden'} min-w-0 h-full`}>
          <TranscriptEditor
            onClose={handleCloseEpisode}
            onTranscriptLoaded={handleTranscriptLoaded}
          />
        </div>
      )}

      {/* Right Sidebar - Properties Panel (only when transcript is loaded) */}
      {showEditorPanels && (
        <PropertiesPanel />
      )}
    </div>
  )
}
