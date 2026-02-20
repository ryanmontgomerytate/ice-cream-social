import { useState, useEffect, useCallback, useRef } from 'react'
import { wikiAPI, contentAPI, isTauri } from '../services/api'
import { useTranscriptReview } from './TranscriptReviewContext'

// Flag types
const FLAG_TYPES = [
  { id: 'wrong_speaker', label: 'Wrong Speaker', icon: '👤', color: 'red' },
  { id: 'character_voice', label: 'Character Voice', icon: '🎭', color: 'pink' },
  { id: 'multiple_speakers', label: 'Multiple Speakers', icon: '👥', color: 'orange' },
  { id: 'audio_issue', label: 'Audio Issue', icon: '🔇', color: 'gray' },
  { id: 'other', label: 'Other', icon: '📝', color: 'yellow' },
]

// Accordion Section Header
function SectionHeader({ open, onClick, icon, label, count, color = 'gray' }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center justify-between text-xs font-medium transition-colors border-b border-gray-100 ${
        open ? `bg-${color}-50 text-${color}-700` : 'bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span>{label}</span>
        {count > 0 && (
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
            open ? `bg-${color}-100 text-${color}-700` : 'bg-gray-100 text-gray-500'
          }`}>
            {count}
          </span>
        )}
      </div>
      <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  )
}

// Speaker color palette — 12 colors, cycles for SPEAKER_12+
const SPEAKER_COLOR_PALETTE = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300' },
  { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
  { bg: 'bg-lime-100', text: 'text-lime-700', border: 'border-lime-300' },
]

const getSpeakerColor = (speaker) => {
  const match = speaker?.match(/^SPEAKER_(\d+)$/)
  if (match) {
    const idx = parseInt(match[1], 10) % SPEAKER_COLOR_PALETTE.length
    return SPEAKER_COLOR_PALETTE[idx]
  }
  return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' }
}

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Qwen Classification Card
// ---------------------------------------------------------------------------
function QwenClassificationCard({ classification: c, onApprove, onReject, onSeek }) {
  const pct = Math.round((c.confidence ?? 0) * 100)
  return (
    <div className="rounded border border-violet-200 bg-violet-50 p-2 space-y-1.5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-1">
        <button
          onClick={onSeek}
          className="text-xs font-medium text-violet-700 hover:underline truncate flex-1 text-left"
          title="Jump to segment"
        >
          Seg {c.segment_idx}
          {c.segment_start_time != null && (
            <span className="ml-1 text-violet-400 font-normal">
              {Math.floor(c.segment_start_time / 60)}:{String(Math.floor(c.segment_start_time % 60)).padStart(2, '0')}
            </span>
          )}
        </button>
        {c.is_performance_bit ? (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-pink-100 text-pink-700 flex-shrink-0">🎭 bit</span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500 flex-shrink-0">normal</span>
        )}
      </div>

      {/* Segment text preview */}
      {c.segment_text && (
        <p className="text-[11px] text-gray-600 line-clamp-2 italic">"{c.segment_text}"</p>
      )}

      {/* Character name */}
      {c.character_name && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-pink-600 font-medium">Character:</span>
          <span className="text-[11px] text-pink-700">{c.character_name}</span>
        </div>
      )}

      {/* Tone description */}
      {c.tone_description && (
        <p className="text-[10px] text-gray-500">{c.tone_description}</p>
      )}

      {/* Confidence bar */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-gray-400 flex-shrink-0">Confidence</span>
        <div className="flex-1 bg-gray-200 rounded-full h-1">
          <div
            className={`h-1 rounded-full ${pct >= 70 ? 'bg-green-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 flex-shrink-0">{pct}%</span>
      </div>

      {/* Speaker note */}
      {c.speaker_note && (
        <p className="text-[10px] text-gray-400 italic line-clamp-2">{c.speaker_note}</p>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 pt-0.5">
        <button
          onClick={onApprove}
          className="flex-1 py-1 text-[11px] rounded bg-green-100 hover:bg-green-200 text-green-700 font-medium transition-colors"
        >
          ✓ Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 py-1 text-[11px] rounded bg-red-100 hover:bg-red-200 text-red-700 font-medium transition-colors"
        >
          ✗ Reject
        </button>
      </div>
    </div>
  )
}

export default function PropertiesPanel() {
  const {
    episode,
    flaggedSegments,
    characterAppearances,
    episodeChapters,
    characters,
    chapterTypes,
    voiceLibrary,
    markedSamples,
    speakers,
    speakerNames,
    audioDropInstances,
    audioDrops,
    segments,
    selectedSegmentIdx,
    // Action proxies
    deleteFlag,
    removeCharacter,
    deleteChapter,
    toggleVoiceSample,
    seekToSegment,
    assignSpeakerName,
    assignAudioDrop,
    seekToSpeaker,
    removeAudioDropInstance,
  } = useTranscriptReview()

  const [openSections, setOpenSections] = useState({ flags: true })
  const [collapsed, setCollapsed] = useState(false)
  const [editingSpeaker, setEditingSpeaker] = useState(null)
  const [wikiMeta, setWikiMeta] = useState(null)
  const [wikiLoading, setWikiLoading] = useState(false)
  const [wikiSyncing, setWikiSyncing] = useState(false)

  // Qwen classification state
  const [qwenClassifications, setQwenClassifications] = useState([])
  const [qwenRunning, setQwenRunning] = useState(false)
  const [qwenProgress, setQwenProgress] = useState(0)
  const [qwenError, setQwenError] = useState(null)
  const qwenUnlistenRef = useRef(null)

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Load wiki metadata when episode changes
  useEffect(() => {
    if (!episode?.id) {
      setWikiMeta(null)
      return
    }
    let cancelled = false
    const load = async () => {
      setWikiLoading(true)
      try {
        const meta = await wikiAPI.getWikiEpisodeMeta(episode.id)
        if (!cancelled) setWikiMeta(meta)
      } catch (e) {
        console.error('Failed to load wiki meta:', e)
      } finally {
        if (!cancelled) setWikiLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [episode?.id])

  const handleSyncWiki = async () => {
    if (!episode?.category_number && !episode?.episode_number) return
    setWikiSyncing(true)
    try {
      const epNum = episode.category_number || episode.episode_number
      await wikiAPI.syncWikiEpisode(epNum)
      // Reload the meta
      const meta = await wikiAPI.getWikiEpisodeMeta(episode.id)
      setWikiMeta(meta)
    } catch (e) {
      console.error('Wiki sync failed:', e)
    } finally {
      setWikiSyncing(false)
    }
  }

  // Load existing classifications when episode changes
  useEffect(() => {
    if (!episode?.id) {
      setQwenClassifications([])
      return
    }
    let cancelled = false
    contentAPI.getSegmentClassifications(episode.id)
      .then(list => { if (!cancelled) setQwenClassifications(list || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [episode?.id])

  // Set up Tauri event listeners for Qwen progress + completion
  useEffect(() => {
    if (!isTauri) return
    let unlistenProgress = null
    let unlistenComplete = null

    const setup = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlistenProgress = await listen('qwen_progress', (event) => {
          if (event.payload?.episode_id === episode?.id) {
            setQwenProgress(event.payload.progress ?? 0)
          }
        })
        unlistenComplete = await listen('qwen_complete', async (event) => {
          if (event.payload?.episode_id === episode?.id) {
            setQwenRunning(false)
            setQwenProgress(100)
            // Reload classifications
            try {
              const list = await contentAPI.getSegmentClassifications(episode.id)
              setQwenClassifications(list || [])
              if (!openSections.qwen) {
                setOpenSections(prev => ({ ...prev, qwen: true }))
              }
            } catch (e) {
              console.error('Failed to reload qwen classifications:', e)
            }
          }
        })
        qwenUnlistenRef.current = () => {
          unlistenProgress?.()
          unlistenComplete?.()
        }
      } catch (e) {
        console.error('Failed to set up Qwen event listeners:', e)
      }
    }

    setup()
    return () => { qwenUnlistenRef.current?.() }
  }, [episode?.id])

  const handleRunQwen = useCallback(async (mode) => {
    if (!episode?.id || qwenRunning) return
    setQwenError(null)
    setQwenRunning(true)
    setQwenProgress(0)

    let indices = []
    if (mode === 'flagged') {
      // Only analyze character_voice flags — Qwen is specifically for character/performance bit detection
      indices = Object.keys(flaggedSegments)
        .filter(idx => flaggedSegments[idx]?.flag_type === 'character_voice')
        .map(Number)
    } else if (mode === 'all' && segments) {
      indices = segments.map((_, i) => i)
    }

    if (indices.length === 0) {
      setQwenError('No character voice flags to analyze. Flag segments as "Character Voice" first.')
      setQwenRunning(false)
      return
    }

    try {
      await contentAPI.runQwenClassification(episode.id, indices)
      // qwen_complete event will handle the rest
    } catch (e) {
      console.error('Qwen classification error:', e)
      setQwenError(e?.message || String(e))
      setQwenRunning(false)
    }
  }, [episode?.id, qwenRunning, flaggedSegments, segments])

  const handleApprove = useCallback(async (id) => {
    try {
      await contentAPI.approveSegmentClassification(id)
      setQwenClassifications(prev =>
        prev.map(c => c.id === id ? { ...c, approved: 1 } : c)
      )
    } catch (e) {
      console.error('Failed to approve classification:', e)
    }
  }, [])

  const handleReject = useCallback(async (id) => {
    try {
      await contentAPI.rejectSegmentClassification(id)
      setQwenClassifications(prev =>
        prev.map(c => c.id === id ? { ...c, approved: -1 } : c)
      )
    } catch (e) {
      console.error('Failed to reject classification:', e)
    }
  }, [])

  const handleApproveAll = useCallback(async () => {
    const pending = qwenClassifications.filter(c => c.approved === 0)
    for (const c of pending) {
      await handleApprove(c.id)
    }
  }, [qwenClassifications, handleApprove])

  const flagCount = Object.keys(flaggedSegments).length
  const characterFlagCount = Object.values(flaggedSegments).filter(f => f?.flag_type === 'character_voice').length
  const characterCount = characterAppearances.length
  const chapterCount = episodeChapters.length
  const sampleCount = Object.keys(markedSamples).length
  const qwenPendingCount = qwenClassifications.filter(c => c.approved === 0).length
  // Deduplicate speakers with the same display name
  const deduplicatedSpeakers = speakers.filter((speakerId, idx) => {
    const displayName = speakerNames[speakerId]
    if (!displayName) return true // unnamed — always show
    return speakers.findIndex(s => speakerNames[s] === displayName) === idx
  })
  const speakerCount = deduplicatedSpeakers.length
  const dropCount = audioDropInstances.length

  const getSegmentTime = (idx) => {
    if (!segments?.[idx]) return null
    const seg = segments[idx]
    if (seg.timestamps?.from) {
      const ts = seg.timestamps.from.replace(',', '.')
      const parts = ts.split(':')
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
      }
    }
    return typeof seg.start === 'number' ? seg.start : 0
  }

  if (collapsed) {
    return (
      <div className="w-12 h-full bg-gray-50 border-l border-gray-200 flex flex-col items-center py-4">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          title="Expand panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
        <div className="mt-4 space-y-3">
          {flagCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-medium">
              {flagCount}
            </div>
          )}
          {characterCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-xs font-medium">
              {characterCount}
            </div>
          )}
          {chapterCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-medium">
              {chapterCount}
            </div>
          )}
          {dropCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center text-xs font-medium">
              {dropCount}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-72 h-full bg-gray-50 border-l border-gray-200 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h3 className="font-semibold text-gray-700 text-sm">Properties</h3>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
          title="Collapse panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Speakers Section (always visible) */}
      {speakerCount > 0 && (
        <div className="p-3 border-b border-gray-200 bg-purple-50 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-purple-800 flex items-center gap-1">
              👥 {speakerCount} speakers
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {deduplicatedSpeakers.map(speakerId => {
              const colors = getSpeakerColor(speakerId)
              const displayName = speakerNames[speakerId]
              const isEditing = editingSpeaker === speakerId

              return (
                <div key={speakerId} className="relative">
                  <button
                    onClick={() => seekToSpeaker?.(speakerId)}
                    className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${colors.bg} ${colors.text} ${colors.border} border hover:shadow-sm transition-all`}
                    title={`Click to hear ${speakerId}`}
                  >
                    {displayName && audioDrops.some(d => d.name === displayName) && <span title="Sound bite">🔊 </span>}{displayName || speakerId}
                    <span className="opacity-50 text-[10px]">▶</span>
                  </button>
                  {/* Quick assign button for unnamed speakers */}
                  {!displayName && voiceLibrary.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSpeaker(isEditing ? null : speakerId)
                      }}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] font-bold hover:bg-red-600"
                      title="Assign name"
                    >
                      !
                    </button>
                  )}
                  {/* Dropdown for voice library / audio drop selection */}
                  {isEditing && (
                    <div className="absolute left-0 top-full z-20 mt-1 p-2 bg-white rounded-lg shadow-xl border border-gray-200 min-w-32 max-h-48 overflow-y-auto">
                      <div className="text-[10px] text-gray-500 mb-1">Speaker:</div>
                      {voiceLibrary.map(v => (
                        <button
                          key={v.name}
                          onClick={(e) => {
                            e.stopPropagation()
                            assignSpeakerName?.(speakerId, v.name)
                            setEditingSpeaker(null)
                          }}
                          className="block w-full px-2 py-1 text-xs text-left hover:bg-yellow-50 text-yellow-800 rounded"
                        >
                          🎤 {v.short_name || v.name}
                        </button>
                      ))}
                      {audioDrops.length > 0 && (
                        <>
                          <div className="text-[10px] text-gray-500 mb-1 mt-2 border-t border-gray-100 pt-1">Sound Bite:</div>
                          {audioDrops.map(drop => (
                            <button
                              key={drop.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                assignAudioDrop?.(speakerId, drop)
                                setEditingSpeaker(null)
                              }}
                              className="block w-full px-2 py-1 text-xs text-left hover:bg-teal-50 text-teal-800 rounded"
                            >
                              🔊 {drop.name}
                            </button>
                          ))}
                        </>
                      )}
                      <button
                        onClick={() => setEditingSpeaker(null)}
                        className="block w-full px-2 py-1 text-xs text-gray-400 hover:text-gray-600 mt-1 border-t"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}


      {/* Accordion Sections */}
      <div className="flex-1 overflow-y-auto">

        {/* Flags Section */}
        <SectionHeader open={openSections.flags} onClick={() => toggleSection('flags')} icon="🚩" label="Flags" count={flagCount} color="red" />
        {openSections.flags && (
          <div className="p-3 space-y-2 border-b border-gray-100">
            {flagCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-2">
                No flagged segments.<br/>
                Use the ... menu on segments to flag issues.
              </p>
            ) : (
              Object.entries(flaggedSegments).map(([idx, flag]) => {
                const flagType = FLAG_TYPES.find(f => f.id === flag.flag_type)
                return (
                  <div
                    key={flag.id}
                    className={`p-2 rounded-lg border cursor-pointer hover:shadow-sm transition-shadow ${
                      flag.flag_type === 'wrong_speaker' ? 'bg-red-50 border-red-200' :
                      flag.flag_type === 'character_voice' ? 'bg-pink-50 border-pink-200' :
                      flag.flag_type === 'multiple_speakers' ? 'bg-orange-50 border-orange-200' :
                      flag.flag_type === 'audio_issue' ? 'bg-gray-50 border-gray-200' :
                      'bg-yellow-50 border-yellow-200'
                    }`}
                    onClick={() => seekToSegment?.(parseInt(idx))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{flagType?.icon || '🚩'}</span>
                        <span className="text-xs font-medium">{flagType?.label || 'Flag'}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteFlag?.(parseInt(idx))
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Segment #{idx}
                      {flag.corrected_speaker && <span className="ml-2">→ {flag.corrected_speaker}</span>}
                    </div>
                    {flag.notes && (
                      <div className="text-xs text-gray-600 mt-1 italic">"{flag.notes}"</div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Characters Section */}
        <SectionHeader open={openSections.characters} onClick={() => toggleSection('characters')} icon="🎭" label="Characters" count={characterCount} color="pink" />
        {openSections.characters && (
          <div className="p-3 space-y-2 border-b border-gray-100">
            {characterCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-2">
                No character appearances marked.<br/>
                Use the ... menu on segments to mark characters.
              </p>
            ) : (
              characterAppearances.map(appearance => (
                <div
                  key={appearance.id}
                  className="p-2 rounded-lg bg-pink-50 border border-pink-200 cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => seekToSegment?.(appearance.segment_idx)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>🎭</span>
                      <span className="text-xs font-medium text-pink-800">{appearance.character_name}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeCharacter?.(appearance.id)
                      }}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Segment #{appearance.segment_idx}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Chapters Section */}
        <SectionHeader open={openSections.chapters} onClick={() => toggleSection('chapters')} icon="📑" label="Chapters" count={chapterCount} color="indigo" />
        {openSections.chapters && (
          <div className="p-3 space-y-2 border-b border-gray-100">
            {chapterCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-2">
                No chapters marked.<br/>
                Use the ... menu on segments to mark chapters.
              </p>
            ) : (
              episodeChapters.map(chapter => (
                <div
                  key={chapter.id}
                  className="p-2 rounded-lg border cursor-pointer hover:shadow-sm transition-shadow"
                  style={{
                    backgroundColor: chapter.chapter_type_color + '20',
                    borderColor: chapter.chapter_type_color + '60'
                  }}
                  onClick={() => seekToSegment?.(chapter.start_segment_idx)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{chapter.chapter_type_icon}</span>
                      <span className="text-xs font-medium" style={{ color: chapter.chapter_type_color }}>
                        {chapter.chapter_type_name}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteChapter?.(chapter.id)
                      }}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {chapter.title && (
                    <div className="text-xs text-gray-700 mt-1">{chapter.title}</div>
                  )}
                  <div className="text-[10px] text-gray-500 mt-1">
                    Segments #{chapter.start_segment_idx} - #{chapter.end_segment_idx}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Drops Section */}
        <SectionHeader open={openSections.drops} onClick={() => toggleSection('drops')} icon="🔊" label="Sound Bites" count={dropCount} color="teal" />
        {openSections.drops && (
          <div className="p-3 space-y-2 border-b border-gray-100">
            {dropCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-2">
                No sound bites tagged.<br/>
                Select a segment and use the Sound Bite action.
              </p>
            ) : (
              audioDropInstances.map(instance => {
                const sameDropInEpisode = audioDropInstances.filter(adi => adi.audio_drop_id === instance.audio_drop_id)
                const occPosition = sameDropInEpisode.findIndex(adi => adi.id === instance.id) + 1
                const occTotal = sameDropInEpisode.length

                return (
                  <div
                    key={instance.id}
                    className="p-2 rounded-lg bg-teal-50 border border-teal-200 cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => seekToSegment?.(instance.segment_idx)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>🔊</span>
                        <span className="text-xs font-medium text-teal-800">
                          {instance.audio_drop_name}
                          {occTotal > 1 && <span className="text-[10px] text-teal-500 ml-1">({occPosition}/{occTotal})</span>}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeAudioDropInstance?.(instance.id)
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Segment #{instance.segment_idx}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Audio IDs Section */}
        <SectionHeader open={openSections.samples} onClick={() => toggleSection('samples')} icon="⭐" label="Audio IDs" count={sampleCount} color="yellow" />
        {openSections.samples && (
          <div className="p-3 space-y-2 border-b border-gray-100">
            {sampleCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-2">
                No audio IDs marked.<br/>
                Use the ... menu on segments to mark good audio IDs.
              </p>
            ) : (
              <>
                <div className="text-xs text-gray-600 mb-2">
                  {sampleCount} audio ID{sampleCount !== 1 ? 's' : ''} marked
                </div>
                {Object.keys(markedSamples).map(idx => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-yellow-50 border border-yellow-200 cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => seekToSegment?.(parseInt(idx))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>⭐</span>
                        <span className="text-xs font-medium text-yellow-800">Segment #{idx}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleVoiceSample?.(parseInt(idx))
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Wiki Section */}
        <SectionHeader open={openSections.wiki} onClick={() => toggleSection('wiki')} icon="📖" label="Wiki" count={wikiMeta ? 1 : 0} color="blue" />
        {openSections.wiki && (
          <div className="p-3 space-y-3 border-b border-gray-100">
            {wikiLoading ? (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
                <div className="text-xs text-gray-500">Loading wiki data...</div>
              </div>
            ) : wikiMeta ? (
              <>
                {/* Wiki link */}
                <div className="flex items-center justify-between">
                  <a
                    href={wikiMeta.wiki_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline truncate"
                  >
                    View on Fandom Wiki
                  </a>
                  <button
                    onClick={handleSyncWiki}
                    disabled={wikiSyncing}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 disabled:opacity-50"
                  >
                    {wikiSyncing ? 'Syncing...' : 'Re-sync'}
                  </button>
                </div>

                {/* Air date */}
                {wikiMeta.air_date && (
                  <div className="text-xs">
                    <span className="text-gray-400">Air date:</span>{' '}
                    <span className="text-gray-700">{wikiMeta.air_date}</span>
                  </div>
                )}

                {/* Summary / Topics */}
                {wikiMeta.summary && (
                  <div>
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">Summary</div>
                    <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto bg-white rounded border p-2">
                      {wikiMeta.summary}
                    </div>
                  </div>
                )}

                {/* Bits & Characters */}
                {wikiMeta.bits_json && (() => {
                  try {
                    const bits = JSON.parse(wikiMeta.bits_json)
                    if (bits.length === 0) return null
                    return (
                      <div>
                        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">Bits & Characters</div>
                        <div className="space-y-1">
                          {bits.map((bit, i) => (
                            <div key={i} className="text-xs text-gray-600 py-0.5 flex gap-1.5">
                              <span className="text-amber-500 flex-shrink-0">-</span>
                              <span>{bit.replace(/^- /, '')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  } catch { return null }
                })()}

                {/* Scoopmail */}
                {wikiMeta.scoopmail_json && (() => {
                  try {
                    const items = JSON.parse(wikiMeta.scoopmail_json)
                    if (items.length === 0) return null
                    return (
                      <div>
                        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">Scoopmail</div>
                        <div className="space-y-1">
                          {items.map((item, i) => (
                            <div key={i} className="text-xs text-gray-600 py-0.5 flex gap-1.5">
                              <span className="text-blue-400 flex-shrink-0">-</span>
                              <span>{item.replace(/^- /, '')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  } catch { return null }
                })()}

                {/* Jock vs Nerd */}
                {wikiMeta.jock_vs_nerd && (
                  <div>
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">Jock vs Nerd</div>
                    <div className="text-xs text-gray-600 bg-white rounded border p-2">
                      {wikiMeta.jock_vs_nerd}
                    </div>
                  </div>
                )}

                {/* Attribution */}
                <div className="text-[9px] text-gray-300 pt-2 border-t border-gray-100">
                  Data from <a href="https://heyscoops.fandom.com" target="_blank" rel="noopener noreferrer" className="underline">HeyScoops Wiki</a> (CC BY-SA 3.0)
                </div>
              </>
            ) : (
              <div className="text-center py-2">
                <p className="text-xs text-gray-500 mb-3">
                  No wiki data for this episode.
                </p>
                {(episode?.category_number || episode?.episode_number) && (
                  <button
                    onClick={handleSyncWiki}
                    disabled={wikiSyncing}
                    className="px-3 py-1.5 text-xs rounded bg-blue-100 hover:bg-blue-200 text-blue-700 disabled:opacity-50"
                  >
                    {wikiSyncing ? 'Syncing from wiki...' : 'Fetch from Fandom Wiki'}
                  </button>
                )}
                {!episode?.category_number && !episode?.episode_number && (
                  <p className="text-[10px] text-gray-400 mt-2">
                    Episode has no number — can't match to wiki.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Qwen Classification Section */}
        {isTauri && episode?.is_downloaded && (
          <div className="border-b border-gray-100">
            <SectionHeader
              open={!!openSections.qwen}
              onClick={() => toggleSection('qwen')}
              icon="🤖"
              label="Qwen Analysis"
              count={qwenPendingCount}
              color="violet"
            />
            {openSections.qwen && (
              <div className="p-3 space-y-3">
                {/* Run buttons */}
                {!qwenRunning ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRunQwen('flagged')}
                      disabled={characterFlagCount === 0}
                      className="flex-1 px-2 py-1.5 text-xs rounded bg-violet-100 hover:bg-violet-200 text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title={characterFlagCount === 0 ? 'Flag segments as "Character Voice" first' : `Analyze ${characterFlagCount} character voice flag(s)`}
                    >
                      Analyze Character Flags ({characterFlagCount})
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-violet-700">
                      <span>Running Qwen...</span>
                      <span>{qwenProgress}%</span>
                    </div>
                    <div className="w-full bg-violet-100 rounded-full h-1.5">
                      <div
                        className="bg-violet-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${qwenProgress}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-400">Model takes ~13× realtime — be patient</p>
                  </div>
                )}

                {qwenError && (
                  <div className="p-2 rounded bg-red-50 border border-red-200">
                    <p className="text-xs text-red-600">{qwenError}</p>
                  </div>
                )}

                {/* Pending classifications */}
                {qwenClassifications.filter(c => c.approved === 0).length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                        Pending Review ({qwenPendingCount})
                      </span>
                      <button
                        onClick={handleApproveAll}
                        className="text-[10px] px-2 py-0.5 rounded bg-green-100 hover:bg-green-200 text-green-700"
                      >
                        Approve All
                      </button>
                    </div>
                    {qwenClassifications.filter(c => c.approved === 0).map(c => (
                      <QwenClassificationCard
                        key={c.id}
                        classification={c}
                        onApprove={() => handleApprove(c.id)}
                        onReject={() => handleReject(c.id)}
                        onSeek={() => seekToSegment?.(c.segment_idx)}
                      />
                    ))}
                  </div>
                )}

                {/* Approved classifications */}
                {qwenClassifications.filter(c => c.approved === 1).length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                      Approved ({qwenClassifications.filter(c => c.approved === 1).length})
                    </span>
                    {qwenClassifications.filter(c => c.approved === 1).map(c => (
                      <div key={c.id} className="px-2 py-1 rounded bg-green-50 border border-green-100 flex items-center gap-1.5">
                        <span className="text-green-500 text-xs">✓</span>
                        <span className="text-xs text-green-700 truncate flex-1">
                          {c.character_name || 'Performance bit'} @ seg {c.segment_idx}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {qwenClassifications.length === 0 && !qwenRunning && (
                  <p className="text-xs text-gray-400 text-center py-2">
                    No classifications yet. Flag segments as "character_voice" then analyze.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Footer with episode info */}
      {episode && (
        <div className="p-3 border-t border-gray-200 flex-shrink-0">
          <div className="text-xs text-gray-500 truncate" title={episode.title}>
            {episode.title}
          </div>
        </div>
      )}
    </div>
  )
}
