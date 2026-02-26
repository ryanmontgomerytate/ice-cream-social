export function buildResolvedSpeakerNames(transcriptData, speakerAssignments = []) {
  const names = { ...((transcriptData && transcriptData.speaker_names) || {}) }

  // Preserve literal speaker labels already baked into transcript segments.
  // Some older transcripts store names directly instead of SPEAKER_XX labels.
  if (transcriptData?.segments_json) {
    try {
      const segments = JSON.parse(transcriptData.segments_json)
      if (Array.isArray(segments)) {
        segments.forEach(seg => {
          const label = seg?.speaker
          if (!label || label === 'UNKNOWN') return
          if (/^SPEAKER_\d+$/.test(label)) return
          if (!names[label]) names[label] = label
        })
      }
    } catch (_) {
      // Ignore malformed segments_json and fall back to transcript/DB maps.
    }
  }

  for (const assignment of speakerAssignments || []) {
    const label = assignment?.diarization_label
    if (!label) continue
    if (assignment.speaker_name) {
      names[label] = assignment.speaker_name
    } else if (assignment.audio_drop_name) {
      names[label] = assignment.audio_drop_name
    }
  }

  return names
}

