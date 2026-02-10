/**
 * Tauri API Service - Handles communication with Rust backend via IPC
 * Falls back to HTTP when not running in Tauri
 */

// Check if running in Tauri (v2 detection)
export const isTauri = typeof window !== 'undefined' && window.__TAURI__ !== undefined;

// Debug logging for Tauri detection
console.log('Tauri detection:', {
  isTauri,
  hasWindow: typeof window !== 'undefined',
  hasTauriGlobal: typeof window !== 'undefined' && window.__TAURI__ !== undefined,
  tauriObject: typeof window !== 'undefined' ? window.__TAURI__ : 'N/A'
});

/**
 * Get Tauri invoke function
 */
async function getInvoke() {
  if (!isTauri) {
    throw new Error('Not running in Tauri');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

/**
 * Get Tauri listen function
 */
async function getListen() {
  if (!isTauri) {
    throw new Error('Not running in Tauri');
  }
  const { listen } = await import('@tauri-apps/api/event');
  return listen;
}

/**
 * Invoke a Tauri command
 */
async function tauriInvoke(command, args = {}) {
  const invoke = await getInvoke();
  return invoke(command, args);
}

// ============================================================================
// EPISODES API - Tauri Implementation
// ============================================================================

export const episodesAPI = {
  async getEpisodes(params = {}) {
    console.log('Tauri getEpisodes called with:', params);
    const result = await tauriInvoke('get_episodes', { filters: params });
    console.log('Tauri getEpisodes result:', result);
    return result;
  },

  async getEpisode(id) {
    return tauriInvoke('get_episode', { id });
  },

  async refreshFeed(source = 'patreon', force = false) {
    console.log('Tauri refreshFeed called:', source, force);
    // Note: Rust param is _force (unused), but Tauri still needs it passed
    const result = await tauriInvoke('refresh_feed', { source, force });
    console.log('Tauri refreshFeed result:', result);
    return result;
  },

  async getRefreshStatus(source) {
    // Refresh is synchronous in Tauri, returns immediately
    return { status: 'completed' };
  },

  async getTranscript(episodeId) {
    console.log('Tauri getTranscript called for episode:', episodeId);
    // Tauri v2 uses camelCase for JS args, converts to snake_case for Rust
    const result = await tauriInvoke('get_transcript', { episodeId });
    console.log('Tauri getTranscript result:', result);
    return result;
  },

  async getFeedSources() {
    console.log('Tauri getFeedSources called');
    const result = await tauriInvoke('get_feed_sources');
    console.log('Tauri getFeedSources result:', result);
    return result;
  },

  async downloadEpisode(episodeId) {
    console.log('Tauri downloadEpisode called for:', episodeId);
    const result = await tauriInvoke('download_episode', { episodeId });
    console.log('Tauri downloadEpisode result:', result);
    return result;
  },

  async updateSpeakerNames(episodeId, speakerNames) {
    console.log('Tauri updateSpeakerNames called for:', episodeId, speakerNames);
    const result = await tauriInvoke('update_speaker_names', { episodeId, speakerNames });
    console.log('Tauri updateSpeakerNames result:', result);
    return result;
  },

  async saveTranscriptEdits(episodeId, edits) {
    console.log('Tauri saveTranscriptEdits called for:', episodeId);
    const result = await tauriInvoke('save_transcript_edits', { episodeId, edits });
    console.log('Tauri saveTranscriptEdits result:', result);
    return result;
  },

  async retryDiarization(episodeId) {
    console.log('Tauri retryDiarization called for:', episodeId);
    const result = await tauriInvoke('retry_diarization', { episodeId });
    console.log('Tauri retryDiarization result:', result);
    return result;
  },

  async saveVoiceSamples(episodeId, samples) {
    console.log('Tauri saveVoiceSamples called for:', episodeId, samples);
    const result = await tauriInvoke('save_voice_samples', { episodeId, samples });
    console.log('Tauri saveVoiceSamples result:', result);
    return result;
  },

  async getAudioPath(episodeId) {
    console.log('Tauri getAudioPath called for:', episodeId);
    const result = await tauriInvoke('get_audio_path', { episodeId });
    return result;
  },

  async analyzeEpisodeContent(episodeId, useLlm = true) {
    console.log('Tauri analyzeEpisodeContent called for:', episodeId);
    const result = await tauriInvoke('analyze_episode_content', { episodeId, useLlm });
    console.log('Tauri analyzeEpisodeContent result:', result);
    return result;
  },

  async reprocessDiarization(episodeId) {
    console.log('Tauri reprocessDiarization called for:', episodeId);
    const result = await tauriInvoke('reprocess_diarization', { episodeId });
    console.log('Tauri reprocessDiarization result:', result);
    return result;
  },
};

// ============================================================================
// QUEUE API - Tauri Implementation
// ============================================================================

export const queueAPI = {
  async getQueue() {
    return tauriInvoke('get_queue');
  },

  async addToQueue(episodeId, priority = 0) {
    // Tauri v2 uses camelCase for JS args
    return tauriInvoke('add_to_queue', { episodeId, priority });
  },

  async removeFromQueue(episodeId) {
    return tauriInvoke('remove_from_queue', { episodeId });
  },

  async stopCurrent() {
    return tauriInvoke('stop_current_transcription');
  },

  async retryTranscription(episodeId) {
    return tauriInvoke('retry_transcription', { episodeId });
  },

  async getStatus() {
    return tauriInvoke('get_queue_status');
  },
};

// ============================================================================
// STATS API - Tauri Implementation
// ============================================================================

export const statsAPI = {
  async getStats() {
    console.log('Tauri getStats called');
    const result = await tauriInvoke('get_stats');
    console.log('Tauri getStats result:', result);
    return result;
  },
};

// ============================================================================
// WORKER API - Tauri Implementation
// ============================================================================

export const workerAPI = {
  async getStatus() {
    return tauriInvoke('get_worker_status');
  },
};

// ============================================================================
// EVENT LISTENERS - Replaces WebSocket
// ============================================================================

export async function setupEventListeners(handlers) {
  if (!isTauri) {
    console.log('Not in Tauri, skipping event listeners');
    return () => {};
  }

  const listen = await getListen();
  const unlisteners = [];

  if (handlers.onStatusUpdate) {
    const unlisten = await listen('status_update', (event) => {
      handlers.onStatusUpdate(event.payload);
    });
    unlisteners.push(unlisten);
  }

  if (handlers.onQueueUpdate) {
    const unlisten = await listen('queue_update', (event) => {
      handlers.onQueueUpdate(event.payload);
    });
    unlisteners.push(unlisten);
  }

  if (handlers.onStatsUpdate) {
    const unlisten = await listen('stats_update', (event) => {
      handlers.onStatsUpdate(event.payload);
    });
    unlisteners.push(unlisten);
  }

  if (handlers.onTranscriptionComplete) {
    const unlisten = await listen('transcription_complete', (event) => {
      handlers.onTranscriptionComplete(event.payload);
    });
    unlisteners.push(unlisten);
  }

  if (handlers.onTranscriptionFailed) {
    const unlisten = await listen('transcription_failed', (event) => {
      handlers.onTranscriptionFailed(event.payload);
    });
    unlisteners.push(unlisten);
  }

  // Return cleanup function
  return () => {
    unlisteners.forEach(unlisten => unlisten());
  };
}

// ============================================================================
// DIAGNOSTICS API - Error tracking and system status
// ============================================================================

export const diagnosticsAPI = {
  async getDiagnostics() {
    console.log('Tauri getDiagnostics called');
    const result = await tauriInvoke('get_diagnostics');
    console.log('Diagnostics result:', result);
    return result;
  },

  async clearErrors() {
    return tauriInvoke('clear_errors');
  },
};

// ============================================================================
// SETTINGS API - App configuration
// ============================================================================

export const settingsAPI = {
  async getSetting(key) {
    return tauriInvoke('get_setting', { key });
  },

  async setSetting(key, value) {
    return tauriInvoke('set_setting', { key, value });
  },

  async getAllSettings() {
    return tauriInvoke('get_all_settings');
  },
};

// ============================================================================
// SPEAKERS API - Speaker management
// ============================================================================

export const speakersAPI = {
  async getSpeakers() {
    return tauriInvoke('get_speakers');
  },

  async createSpeaker(name, shortName = null, isHost = false) {
    return tauriInvoke('create_speaker', { name, shortName, isHost });
  },

  async updateSpeaker(id, name, shortName = null, isHost = false) {
    return tauriInvoke('update_speaker', { id, name, shortName, isHost });
  },

  async deleteSpeaker(id) {
    return tauriInvoke('delete_speaker', { id });
  },

  async getSpeakerStats() {
    return tauriInvoke('get_speaker_stats');
  },

  async linkEpisodeSpeaker(episodeId, diarizationLabel, speakerId) {
    return tauriInvoke('link_episode_speaker', { episodeId, diarizationLabel, speakerId });
  },

  async getVoiceLibrary() {
    return tauriInvoke('get_voice_library');
  },

  async getVoiceSamplePath(speakerName) {
    return tauriInvoke('get_voice_sample_path', { speakerName });
  },
};

// ============================================================================
// CONTENT API - Chapters, Characters, Sponsors
// ============================================================================

export const contentAPI = {
  // Chapter Types
  async getChapterTypes() {
    return tauriInvoke('get_chapter_types');
  },

  async createChapterType(name, description, color, icon) {
    return tauriInvoke('create_chapter_type', { name, description, color, icon });
  },

  // Episode Chapters
  async getEpisodeChapters(episodeId) {
    return tauriInvoke('get_episode_chapters', { episodeId });
  },

  async createEpisodeChapter(episodeId, chapterTypeId, title, startTime, endTime, startSegmentIdx, endSegmentIdx) {
    return tauriInvoke('create_episode_chapter', {
      episodeId, chapterTypeId, title, startTime, endTime, startSegmentIdx, endSegmentIdx
    });
  },

  async deleteEpisodeChapter(chapterId) {
    return tauriInvoke('delete_episode_chapter', { chapterId });
  },

  // Characters
  async getCharacters() {
    return tauriInvoke('get_characters');
  },

  async createCharacter(name, shortName, description, catchphrase) {
    return tauriInvoke('create_character', { name, shortName, description, catchphrase });
  },

  async updateCharacter(id, name, shortName, description, catchphrase) {
    return tauriInvoke('update_character', { id, name, shortName, description, catchphrase });
  },

  async deleteCharacter(id) {
    return tauriInvoke('delete_character', { id });
  },

  async addCharacterAppearance(characterId, episodeId, startTime, endTime, segmentIdx) {
    return tauriInvoke('add_character_appearance', { characterId, episodeId, startTime, endTime, segmentIdx });
  },

  // Sponsors
  async getSponsors() {
    return tauriInvoke('get_sponsors');
  },

  async createSponsor(name, tagline, description, isReal) {
    return tauriInvoke('create_sponsor', { name, tagline, description, isReal });
  },

  async updateSponsor(id, name, tagline, description, isReal) {
    return tauriInvoke('update_sponsor', { id, name, tagline, description, isReal });
  },

  async deleteSponsor(id) {
    return tauriInvoke('delete_sponsor', { id });
  },

  async addSponsorMention(sponsorId, episodeId, startTime, endTime, segmentIdx) {
    return tauriInvoke('add_sponsor_mention', { sponsorId, episodeId, startTime, endTime, segmentIdx });
  },

  // Character Appearances
  async getCharacterAppearancesForEpisode(episodeId) {
    return tauriInvoke('get_character_appearances_for_episode', { episodeId });
  },

  async deleteCharacterAppearance(id) {
    return tauriInvoke('delete_character_appearance', { id });
  },

  // Audio Drops
  async getAudioDrops() {
    return tauriInvoke('get_audio_drops');
  },

  async createAudioDrop(name, transcriptText = null, description = null, category = null) {
    return tauriInvoke('create_audio_drop', { name, transcriptText, description, category });
  },

  async deleteAudioDrop(id) {
    return tauriInvoke('delete_audio_drop', { id });
  },

  async addAudioDropInstance(audioDropId, episodeId, segmentIdx = null, startTime = null, endTime = null, notes = null) {
    return tauriInvoke('add_audio_drop_instance', { audioDropId, episodeId, segmentIdx, startTime, endTime, notes });
  },

  async getAudioDropInstances(episodeId) {
    return tauriInvoke('get_audio_drop_instances', { episodeId });
  },

  async deleteAudioDropInstance(id) {
    return tauriInvoke('delete_audio_drop_instance', { id });
  },

  // Flagged Segments (Review Workflow)
  async createFlaggedSegment(episodeId, segmentIdx, flagType, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null) {
    return tauriInvoke('create_flagged_segment', {
      episodeId, segmentIdx, flagType, correctedSpeaker, characterId, notes, speakerIds
    });
  },

  async getFlaggedSegments(episodeId) {
    return tauriInvoke('get_flagged_segments', { episodeId });
  },

  async updateFlaggedSegment(id, flagType = null, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null, resolved = null) {
    return tauriInvoke('update_flagged_segment', {
      id, flagType, correctedSpeaker, characterId, notes, speakerIds, resolved
    });
  },

  async deleteFlaggedSegment(id) {
    return tauriInvoke('delete_flagged_segment', { id });
  },

  async getUnresolvedFlagCount(episodeId) {
    return tauriInvoke('get_unresolved_flag_count', { episodeId });
  },
};

// ============================================================================
// SEARCH API - Full-text search across transcripts
// ============================================================================

export const searchAPI = {
  async searchTranscripts(query, limit = 50, offset = 0) {
    console.log('Tauri searchTranscripts called:', query);
    const result = await tauriInvoke('search_transcripts', { query, limit, offset });
    console.log('Tauri searchTranscripts result:', result);
    return result;
  },

  async getSearchStats() {
    return tauriInvoke('get_search_stats');
  },

  async indexEpisodeTranscript(episodeId, segments) {
    console.log('Tauri indexEpisodeTranscript called for:', episodeId);
    return tauriInvoke('index_episode_transcript', { episodeId, segments });
  },

  async indexAllTranscripts() {
    console.log('Tauri indexAllTranscripts called');
    return tauriInvoke('index_all_transcripts');
  },

  async getDetectedContent(episodeId) {
    return tauriInvoke('get_detected_content', { episodeId });
  },

  async getDetectedContentByType(contentType) {
    return tauriInvoke('get_detected_content_by_type', { contentType });
  },

  async addDetectedContent(episodeId, contentType, name, description, startTime, endTime, segmentIdx, confidence, rawText) {
    return tauriInvoke('add_detected_content', {
      episodeId, contentType, name, description, startTime, endTime, segmentIdx, confidence, rawText
    });
  },
};

// ============================================================================
// EXTRACTION API - LLM-based content extraction
// ============================================================================

export const extractionAPI = {
  async getOllamaStatus() {
    return tauriInvoke('get_ollama_status');
  },

  async getPrompts() {
    return tauriInvoke('get_extraction_prompts');
  },

  async getPrompt(promptId) {
    return tauriInvoke('get_extraction_prompt', { promptId });
  },

  async createPrompt(name, description, contentType, promptText, systemPrompt, outputSchema) {
    return tauriInvoke('create_extraction_prompt', {
      name, description, contentType, promptText, systemPrompt, outputSchema
    });
  },

  async updatePrompt(promptId, name, description, contentType, promptText, systemPrompt, outputSchema, isActive) {
    return tauriInvoke('update_extraction_prompt', {
      promptId, name, description, contentType, promptText, systemPrompt, outputSchema, isActive
    });
  },

  async deletePrompt(promptId) {
    return tauriInvoke('delete_extraction_prompt', { promptId });
  },

  async runExtraction(promptId, episodeId) {
    return tauriInvoke('run_extraction', { promptId, episodeId });
  },

  async testPrompt(promptText, systemPrompt, sampleText) {
    return tauriInvoke('test_extraction_prompt', { promptText, systemPrompt, sampleText });
  },

  async getExtractionRuns(episodeId, limit) {
    return tauriInvoke('get_extraction_runs', { episodeId, limit });
  },
};

export default {
  isTauri,
  episodes: episodesAPI,
  queue: queueAPI,
  stats: statsAPI,
  worker: workerAPI,
  diagnostics: diagnosticsAPI,
  settings: settingsAPI,
  speakers: speakersAPI,
  content: contentAPI,
  search: searchAPI,
  extraction: extractionAPI,
  setupEventListeners,
};
