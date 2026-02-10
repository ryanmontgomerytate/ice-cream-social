import { useState } from 'react'

// Flag types
const FLAG_TYPES = [
  { id: 'wrong_speaker', label: 'Wrong Speaker', icon: '👤', color: 'red' },
  { id: 'character_voice', label: 'Character Voice', icon: '🎭', color: 'pink' },
  { id: 'multiple_speakers', label: 'Multiple Speakers', icon: '👥', color: 'orange' },
  { id: 'audio_issue', label: 'Audio Issue', icon: '🔇', color: 'gray' },
  { id: 'other', label: 'Other', icon: '📝', color: 'yellow' },
]

// Tab Button component
function TabButton({ active, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-2 py-2 text-xs font-medium transition-colors relative ${
        active
          ? 'text-purple-700 border-b-2 border-purple-500'
          : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent'
      }`}
    >
      {children}
      {count > 0 && (
        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
          active ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

// Speaker color palette
const SPEAKER_COLORS = {
  'SPEAKER_00': { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  'SPEAKER_01': { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  'SPEAKER_02': { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  'SPEAKER_03': { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  'SPEAKER_04': { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  'SPEAKER_05': { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
}

const getSpeakerColor = (speaker) => SPEAKER_COLORS[speaker] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' }

const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PropertiesPanel({
  episode,
  flaggedSegments = {},
  characterAppearances = [],
  episodeChapters = [],
  characters = [],
  chapterTypes = [],
  voiceLibrary = [],
  markedSamples = {},
  speakers = [],
  speakerNames = {},
  audioDropInstances = [],
  audioDrops = [],
  segments = null,
  selectedSegmentIdx = null,
  onCreateFlag,
  onDeleteFlag,
  onAddCharacter,
  onRemoveCharacter,
  onCreateChapter,
  onDeleteChapter,
  onToggleVoiceSample,
  onSeekToSegment,
  onAssignSpeakerName,
  onSeekToSpeaker,
  onRemoveAudioDrop
}) {
  const [activeTab, setActiveTab] = useState('flags')
  const [collapsed, setCollapsed] = useState(false)
  const [editingSpeaker, setEditingSpeaker] = useState(null)

  const flagCount = Object.keys(flaggedSegments).length
  const characterCount = characterAppearances.length
  const chapterCount = episodeChapters.length
  const sampleCount = Object.keys(markedSamples).length
  const speakerCount = speakers.length
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
            {speakers.map(speakerId => {
              const colors = getSpeakerColor(speakerId)
              const displayName = speakerNames[speakerId]
              const isEditing = editingSpeaker === speakerId

              return (
                <div key={speakerId} className="relative">
                  <button
                    onClick={() => onSeekToSpeaker?.(speakerId)}
                    className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${colors.bg} ${colors.text} ${colors.border} border hover:shadow-sm transition-all`}
                    title={`Click to hear ${speakerId}`}
                  >
                    {displayName || speakerId}
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
                  {/* Dropdown for voice library selection */}
                  {isEditing && (
                    <div className="absolute left-0 top-full z-20 mt-1 p-2 bg-white rounded-lg shadow-xl border border-gray-200 min-w-32">
                      <div className="text-[10px] text-gray-500 mb-1">Assign:</div>
                      {voiceLibrary.map(v => (
                        <button
                          key={v.name}
                          onClick={(e) => {
                            e.stopPropagation()
                            onAssignSpeakerName?.(speakerId, v.name)
                            setEditingSpeaker(null)
                          }}
                          className="block w-full px-2 py-1 text-xs text-left hover:bg-yellow-50 text-yellow-800 rounded"
                        >
                          {v.short_name || v.name}
                        </button>
                      ))}
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


      {/* Tabs */}
      <div className="flex border-b border-gray-200 flex-shrink-0 overflow-x-auto">
        <TabButton active={activeTab === 'flags'} onClick={() => setActiveTab('flags')} count={flagCount}>
          Flags
        </TabButton>
        <TabButton active={activeTab === 'characters'} onClick={() => setActiveTab('characters')} count={characterCount}>
          Chars
        </TabButton>
        <TabButton active={activeTab === 'chapters'} onClick={() => setActiveTab('chapters')} count={chapterCount}>
          Chaps
        </TabButton>
        <TabButton active={activeTab === 'drops'} onClick={() => setActiveTab('drops')} count={dropCount}>
          Drops
        </TabButton>
        <TabButton active={activeTab === 'samples'} onClick={() => setActiveTab('samples')} count={sampleCount}>
          Samples
        </TabButton>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Flags Tab */}
        {activeTab === 'flags' && (
          <div className="space-y-2">
            {flagCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">
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
                    onClick={() => onSeekToSegment?.(parseInt(idx))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{flagType?.icon || '🚩'}</span>
                        <span className="text-xs font-medium">{flagType?.label || 'Flag'}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteFlag?.(parseInt(idx))
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

        {/* Characters Tab */}
        {activeTab === 'characters' && (
          <div className="space-y-2">
            {characterCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">
                No character appearances marked.<br/>
                Use the ... menu on segments to mark characters.
              </p>
            ) : (
              characterAppearances.map(appearance => (
                <div
                  key={appearance.id}
                  className="p-2 rounded-lg bg-pink-50 border border-pink-200 cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => onSeekToSegment?.(appearance.segment_idx)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>🎭</span>
                      <span className="text-xs font-medium text-pink-800">{appearance.character_name}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveCharacter?.(appearance.id)
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

        {/* Chapters Tab */}
        {activeTab === 'chapters' && (
          <div className="space-y-2">
            {chapterCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">
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
                  onClick={() => onSeekToSegment?.(chapter.start_segment_idx)}
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
                        onDeleteChapter?.(chapter.id)
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

        {/* Drops Tab */}
        {activeTab === 'drops' && (
          <div className="space-y-2">
            {dropCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">
                No audio drops tagged.<br/>
                Select a segment and use the Audio Drop action.
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
                    onClick={() => onSeekToSegment?.(instance.segment_idx)}
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
                          onRemoveAudioDrop?.(instance.id)
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

        {/* Voice Samples Tab */}
        {activeTab === 'samples' && (
          <div className="space-y-2">
            {sampleCount === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">
                No voice samples marked.<br/>
                Use the ... menu on segments to mark good voice samples.
              </p>
            ) : (
              <div>
                <div className="text-xs text-gray-600 mb-2">
                  {sampleCount} sample{sampleCount !== 1 ? 's' : ''} marked
                </div>
                {Object.keys(markedSamples).map(idx => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-yellow-50 border border-yellow-200 cursor-pointer hover:shadow-sm transition-shadow"
                    onClick={() => onSeekToSegment?.(parseInt(idx))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>⭐</span>
                        <span className="text-xs font-medium text-yellow-800">Segment #{idx}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleVoiceSample?.(parseInt(idx))
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
