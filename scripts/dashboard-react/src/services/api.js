/**
 * API Service - Handles all backend communication via Tauri IPC
 */

import * as tauriAPI from './tauri.js';

export const isTauri = tauriAPI.isTauri;

// ============================================================================
// STATIC CACHE - For rarely-changing global data (chapter types, characters, audio drops)
// ============================================================================
const _staticCache = new Map();

function _cachedFetch(key, fetchFn) {
  if (_staticCache.has(key)) return Promise.resolve(_staticCache.get(key));
  return fetchFn().then(result => { _staticCache.set(key, result); return result });
}

export function invalidateStaticCache(key) {
  if (key) _staticCache.delete(key); else _staticCache.clear();
}

// ============================================================================
// EPISODES API
// ============================================================================

export const episodesAPI = {
  async getEpisodes(params = {}) {
    return tauriAPI.episodesAPI.getEpisodes(params);
  },

  async getEpisode(id) {
    return tauriAPI.episodesAPI.getEpisode(id);
  },

  async refreshFeed(source = 'patreon', force = false) {
    return tauriAPI.episodesAPI.refreshFeed(source, force);
  },

  async getRefreshStatus(source) {
    return { status: 'idle' };
  },

  async getFeedSources() {
    return tauriAPI.episodesAPI.getFeedSources();
  },

  async getTranscript(episodeId) {
    return tauriAPI.episodesAPI.getTranscript(episodeId);
  },

  async updateSpeakerNames(episodeId, speakerNames, markedSamples = null) {
    return tauriAPI.episodesAPI.updateSpeakerNames(episodeId, speakerNames, markedSamples);
  },

  async saveTranscriptEdits(episodeId, edits) {
    return tauriAPI.episodesAPI.saveTranscriptEdits(episodeId, edits);
  },

  async retryDiarization(episodeId) {
    return tauriAPI.episodesAPI.retryDiarization(episodeId);
  },

  async saveVoiceSamples(episodeId, samples) {
    return tauriAPI.episodesAPI.saveVoiceSamples(episodeId, samples);
  },

  async getAudioPath(episodeId) {
    return tauriAPI.episodesAPI.getAudioPath(episodeId);
  },

  async downloadEpisode(episodeId) {
    return tauriAPI.episodesAPI.downloadEpisode(episodeId);
  },

  async analyzeEpisodeContent(episodeId, useLlm = true) {
    return tauriAPI.episodesAPI.analyzeEpisodeContent(episodeId, useLlm);
  },

  async reprocessDiarization(episodeId) {
    return tauriAPI.episodesAPI.reprocessDiarization(episodeId);
  },

  async confirmReprocessWithQwenHints(episodeId, options = {}) {
    return tauriAPI.episodesAPI.confirmReprocessWithQwenHints(episodeId, options);
  },

  async getCategoryRules() {
    return tauriAPI.episodesAPI.getCategoryRules();
  },

  async recategorizeAllEpisodes() {
    return tauriAPI.episodesAPI.recategorizeAllEpisodes();
  },

  async linkCrossFeedEpisodes() {
    return tauriAPI.episodesAPI.linkCrossFeedEpisodes();
  },

  async getEpisodeVariants(episodeId) {
    return tauriAPI.episodesAPI.getEpisodeVariants(episodeId);
  },

  async addCategoryRule(rule) {
    return tauriAPI.episodesAPI.addCategoryRule(rule);
  },

  async updateCategoryRule(rule) {
    return tauriAPI.episodesAPI.updateCategoryRule(rule);
  },

  async deleteCategoryRule(id) {
    return tauriAPI.episodesAPI.deleteCategoryRule(id);
  },

  async testCategoryRule(pattern, keywords = null) {
    return tauriAPI.episodesAPI.testCategoryRule(pattern, keywords);
  },
};

// ============================================================================
// QUEUE API
// ============================================================================

export const queueAPI = {
  async getQueue() {
    return tauriAPI.queueAPI.getQueue();
  },

  async addToQueue(episodeId, priority = 0) {
    await tauriAPI.queueAPI.addToQueue(episodeId, priority);
    return { success: true };
  },

  async removeFromQueue(episodeId) {
    await tauriAPI.queueAPI.removeFromQueue(episodeId);
    return { success: true };
  },

  async stopCurrent() {
    await tauriAPI.queueAPI.stopCurrent();
    return { success: true };
  },

  async retryTranscription(episodeId) {
    await tauriAPI.queueAPI.retryTranscription(episodeId);
    return { success: true };
  },

  async getStatus() {
    return tauriAPI.queueAPI.getStatus();
  },
};

// ============================================================================
// STATS API
// ============================================================================

export const statsAPI = {
  async getStats() {
    return tauriAPI.statsAPI.getStats();
  },

  async getPipelineStats(limit = 20) {
    return tauriAPI.statsAPI.getPipelineStats(limit);
  },

  async getPipelineHealth() {
    return tauriAPI.statsAPI.getPipelineHealth();
  },

  async getRecentErrors(limit = 20) {
    return tauriAPI.statsAPI.getRecentErrors(limit);
  },

  async getQueueEpisodeLists() {
    return tauriAPI.statsAPI.getQueueEpisodeLists();
  },
};

// ============================================================================
// WORKER API
// ============================================================================

export const workerAPI = {
  async getStatus() {
    return tauriAPI.workerAPI.getStatus();
  },

  async setPreventSleep(enabled) {
    return tauriAPI.workerAPI.setPreventSleep(enabled);
  },

  async getPreventSleep() {
    return tauriAPI.workerAPI.getPreventSleep();
  },
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

export const healthAPI = {
  async check() {
    return { status: 'ok', backend: 'tauri' };
  },
};

// ============================================================================
// EVENT SETUP - For real-time updates
// ============================================================================

export const setupEventListeners = tauriAPI.setupEventListeners;

// ============================================================================
// DIAGNOSTICS API - For error review and system status
// ============================================================================

export const diagnosticsAPI = {
  async getDiagnostics() {
    return tauriAPI.diagnosticsAPI.getDiagnostics();
  },
};

// ============================================================================
// SETTINGS API - App configuration
// ============================================================================

export const settingsAPI = {
  async getSetting(key) {
    return tauriAPI.settingsAPI.getSetting(key);
  },

  async setSetting(key, value) {
    return tauriAPI.settingsAPI.setSetting(key, value);
  },

  async getAllSettings() {
    return tauriAPI.settingsAPI.getAllSettings();
  },
};

// ============================================================================
// SPEAKERS API - Speaker management
// ============================================================================

export const speakersAPI = {
  async getSpeakers() {
    return tauriAPI.speakersAPI.getSpeakers();
  },

  async createSpeaker(name, shortName = null, isHost = false, isGuest = false, isScoop = false) {
    return tauriAPI.speakersAPI.createSpeaker(name, shortName, isHost, isGuest, isScoop);
  },

  async updateSpeaker(id, name, shortName = null, isHost = false, isGuest = false, isScoop = false) {
    return tauriAPI.speakersAPI.updateSpeaker(id, name, shortName, isHost, isGuest, isScoop);
  },

  async deleteSpeaker(id) {
    return tauriAPI.speakersAPI.deleteSpeaker(id);
  },

  async getSpeakerStats() {
    return tauriAPI.speakersAPI.getSpeakerStats();
  },

  async linkEpisodeSpeaker(episodeId, diarizationLabel, speakerId) {
    return tauriAPI.speakersAPI.linkEpisodeSpeaker(episodeId, diarizationLabel, speakerId);
  },

  async linkEpisodeAudioDrop(episodeId, diarizationLabel, audioDropId) {
    return tauriAPI.speakersAPI.linkEpisodeAudioDrop(episodeId, diarizationLabel, audioDropId);
  },

  async unlinkEpisodeSpeaker(episodeId, diarizationLabel) {
    return tauriAPI.speakersAPI.unlinkEpisodeSpeaker(episodeId, diarizationLabel);
  },

  async getEpisodeSpeakerAssignments(episodeId) {
    return tauriAPI.speakersAPI.getEpisodeSpeakerAssignments(episodeId);
  },

  async getVoiceLibrary() {
    return tauriAPI.speakersAPI.getVoiceLibrary();
  },

  async getEmbeddingModel() {
    return tauriAPI.speakersAPI.getEmbeddingModel();
  },

  async setEmbeddingModel(backend) {
    return tauriAPI.speakersAPI.setEmbeddingModel(backend);
  },

  async compareEmbeddingBackends(episodeId) {
    return tauriAPI.speakersAPI.compareEmbeddingBackends(episodeId);
  },

  async getVoiceSamplePath(speakerName) {
    return tauriAPI.speakersAPI.getVoiceSamplePath(speakerName);
  },

  async getVoiceSamples(speakerName) {
    return tauriAPI.speakersAPI.getVoiceSamples(speakerName);
  },

  async deleteVoiceSample(speakerName, filePath, sampleId) {
    return tauriAPI.speakersAPI.deleteVoiceSample(speakerName, filePath, sampleId);
  },

  async updateVoiceSampleRating(id, rating) {
    return tauriAPI.speakersAPI.updateVoiceSampleRating(id, rating);
  },

  async deleteVoicePrint(speakerName) {
    return tauriAPI.speakersAPI.deleteVoicePrint(speakerName);
  },

  async purgeVoiceLibraryEntry(speakerName) {
    return tauriAPI.speakersAPI.purgeVoiceLibraryEntry(speakerName);
  },

  async rebuildVoicePrintForSpeaker(speakerName) {
    return tauriAPI.speakersAPI.rebuildVoicePrintForSpeaker(speakerName);
  },

  async rebuildVoiceLibrary(backend = null) {
    return tauriAPI.speakersAPI.rebuildVoiceLibrary(backend);
  },

  async runVoiceHarvest(minSecs = 4.0, maxPerSpeaker = 5) {
    return tauriAPI.speakersAPI.runVoiceHarvest(minSecs, maxPerSpeaker);
  },

  async extractVoiceSampleFromSegment(episodeId, segmentIdx, speakerName) {
    return tauriAPI.speakersAPI.extractVoiceSampleFromSegment(episodeId, segmentIdx, speakerName);
  },
};

// ============================================================================
// CONTENT API - Chapters, Characters, Sponsors
// ============================================================================

export const contentAPI = {
  // Chapter Types
  async getChapterTypes() {
    return _cachedFetch('chapterTypes', () => tauriAPI.contentAPI.getChapterTypes());
  },

  async createChapterType(name, description, color, icon) {
    const result = await tauriAPI.contentAPI.createChapterType(name, description, color, icon);
    invalidateStaticCache('chapterTypes');
    return result;
  },

  async updateChapterType(id, name, description, color, icon, sortOrder) {
    const result = await tauriAPI.contentAPI.updateChapterType(id, name, description, color, icon, sortOrder);
    invalidateStaticCache('chapterTypes');
    return result;
  },

  async deleteChapterType(id) {
    const result = await tauriAPI.contentAPI.deleteChapterType(id);
    invalidateStaticCache('chapterTypes');
    return result;
  },

  // Episode Chapters
  async getEpisodeChapters(episodeId) {
    return tauriAPI.contentAPI.getEpisodeChapters(episodeId);
  },

  async createEpisodeChapter(episodeId, chapterTypeId, title, startTime, endTime, startSegmentIdx, endSegmentIdx) {
    return tauriAPI.contentAPI.createEpisodeChapter(
      episodeId, chapterTypeId, title, startTime, endTime, startSegmentIdx, endSegmentIdx
    );
  },

  async deleteEpisodeChapter(chapterId) {
    return tauriAPI.contentAPI.deleteEpisodeChapter(chapterId);
  },

  async runAiChapterDetection(episodeId) {
    return tauriAPI.contentAPI.runAiChapterDetection(episodeId);
  },

  async exportSponsorClip(episodeId, startTime, endTime, sponsorName) {
    return tauriAPI.contentAPI.exportSponsorClip(episodeId, startTime, endTime, sponsorName);
  },

  // Characters
  async getCharacters() {
    return _cachedFetch('characters', () => tauriAPI.contentAPI.getCharacters());
  },

  async createCharacter(name, shortName, description, catchphrase, speakerId = null) {
    const result = await tauriAPI.contentAPI.createCharacter(name, shortName, description, catchphrase, speakerId);
    invalidateStaticCache('characters');
    return result;
  },

  async updateCharacter(id, name, shortName, description, catchphrase, speakerId = null) {
    const result = await tauriAPI.contentAPI.updateCharacter(id, name, shortName, description, catchphrase, speakerId);
    invalidateStaticCache('characters');
    return result;
  },

  async deleteCharacter(id) {
    const result = await tauriAPI.contentAPI.deleteCharacter(id);
    invalidateStaticCache('characters');
    return result;
  },

  async addCharacterAppearance(characterId, episodeId, startTime, endTime, segmentIdx, performedBySpeakerId = null) {
    return tauriAPI.contentAPI.addCharacterAppearance(characterId, episodeId, startTime, endTime, segmentIdx, performedBySpeakerId);
  },

  async getCharacterAppearancesForEpisode(episodeId) {
    return tauriAPI.contentAPI.getCharacterAppearancesForEpisode(episodeId);
  },

  async getCharacterAppearancesForCharacter(characterId) {
    return tauriAPI.contentAPI.getCharacterAppearancesForCharacter(characterId);
  },

  async deleteCharacterAppearance(id) {
    return tauriAPI.contentAPI.deleteCharacterAppearance(id);
  },

  // Audio Drops
  async getAudioDrops() {
    return _cachedFetch('audioDrops', () => tauriAPI.contentAPI.getAudioDrops());
  },

  async createAudioDrop(name, transcriptText = null, description = null, category = null) {
    const result = await tauriAPI.contentAPI.createAudioDrop(name, transcriptText, description, category);
    invalidateStaticCache('audioDrops');
    return result;
  },

  async updateAudioDropTranscript(dropId, text) {
    const result = await tauriAPI.contentAPI.updateAudioDropTranscript(dropId, text);
    invalidateStaticCache('audioDrops');
    return result;
  },

  async updateAudioDropWindow(dropId, minWindow, maxWindow) {
    const result = await tauriAPI.contentAPI.updateAudioDropWindow(dropId, minWindow, maxWindow);
    invalidateStaticCache('audioDrops');
    return result;
  },

  async deleteAudioDrop(id) {
    const result = await tauriAPI.contentAPI.deleteAudioDrop(id);
    invalidateStaticCache('audioDrops');
    return result;
  },

  async getAudioDropInstances(episodeId) {
    return tauriAPI.contentAPI.getAudioDropInstances(episodeId);
  },

  // Chapter Label Rules
  async getChapterLabelRules() {
    return tauriAPI.contentAPI.getChapterLabelRules();
  },

  async saveChapterLabelRule(id, chapterTypeId, pattern, matchType, priority, enabled) {
    return tauriAPI.contentAPI.saveChapterLabelRule(id, chapterTypeId, pattern, matchType, priority, enabled);
  },

  async deleteChapterLabelRule(id) {
    return tauriAPI.contentAPI.deleteChapterLabelRule(id);
  },

  async autoLabelChapters(episodeId, overwrite = false) {
    return tauriAPI.contentAPI.autoLabelChapters(episodeId, overwrite);
  },

  // Flagged Segments (Review Workflow)
  async createFlaggedSegment(episodeId, segmentIdx, flagType, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null) {
    return tauriAPI.contentAPI.createFlaggedSegment(episodeId, segmentIdx, flagType, correctedSpeaker, characterId, notes, speakerIds);
  },

  async getFlaggedSegments(episodeId) {
    return tauriAPI.contentAPI.getFlaggedSegments(episodeId);
  },

  async updateFlaggedSegment(id, flagType = null, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null, resolved = null) {
    return tauriAPI.contentAPI.updateFlaggedSegment(id, flagType, correctedSpeaker, characterId, notes, speakerIds, resolved);
  },

  async deleteFlaggedSegment(id) {
    return tauriAPI.contentAPI.deleteFlaggedSegment(id);
  },

  async getUnresolvedFlagCount(episodeId) {
    return tauriAPI.contentAPI.getUnresolvedFlagCount(episodeId);
  },

  // Sponsors
  async getSponsors() {
    return tauriAPI.contentAPI.getSponsors();
  },

  async createSponsor(name, tagline, description, isReal) {
    return tauriAPI.contentAPI.createSponsor(name, tagline, description, isReal);
  },

  async updateSponsor(id, name, tagline, description, isReal) {
    return tauriAPI.contentAPI.updateSponsor(id, name, tagline, description, isReal);
  },

  async deleteSponsor(id) {
    return tauriAPI.contentAPI.deleteSponsor(id);
  },

  async addSponsorMention(sponsorId, episodeId, startTime, endTime, segmentIdx) {
    return tauriAPI.contentAPI.addSponsorMention(sponsorId, episodeId, startTime, endTime, segmentIdx);
  },

  // Qwen Segment Classification
  async runQwenClassification(episodeId, segmentIndices) {
    return tauriAPI.contentAPI.runQwenClassification(episodeId, segmentIndices);
  },

  async getSegmentClassifications(episodeId) {
    return tauriAPI.contentAPI.getSegmentClassifications(episodeId);
  },

  async approveSegmentClassification(id) {
    return tauriAPI.contentAPI.approveSegmentClassification(id);
  },

  async rejectSegmentClassification(id) {
    return tauriAPI.contentAPI.rejectSegmentClassification(id);
  },

  // Scoop Polish
  async runQwenPolish(episodeId, segmentIndices) {
    return tauriAPI.contentAPI.runQwenPolish(episodeId, segmentIndices);
  },

  async getTranscriptCorrections(episodeId) {
    return tauriAPI.contentAPI.getTranscriptCorrections(episodeId);
  },

  async approveTranscriptCorrection(id) {
    return tauriAPI.contentAPI.approveTranscriptCorrection(id);
  },

  async rejectTranscriptCorrection(id) {
    return tauriAPI.contentAPI.rejectTranscriptCorrection(id);
  },

  async getAllPendingCorrections() {
    return tauriAPI.contentAPI.getAllPendingCorrections();
  },

  async approveAllCorrectionsForEpisode(episodeId) {
    return tauriAPI.contentAPI.approveAllCorrectionsForEpisode(episodeId);
  },

  async rejectAllCorrectionsForEpisode(episodeId) {
    return tauriAPI.contentAPI.rejectAllCorrectionsForEpisode(episodeId);
  },

  // Episode Interaction Analytics
  logEpisodeInteraction(episodeId, action, segmentIdx = null, metadata = null) {
    tauriAPI.contentAPI.logEpisodeInteraction(episodeId, action, segmentIdx, metadata)
      .catch(() => {}); // fire-and-forget
  },

  async getEpisodeInteractionSummary(episodeId) {
    return tauriAPI.contentAPI.getEpisodeInteractionSummary(episodeId);
  },
};

// ============================================================================
// SEARCH API - Full-text search across transcripts
// ============================================================================

export const searchAPI = {
  async searchTranscripts(query, limit = 50, offset = 0) {
    return tauriAPI.searchAPI.searchTranscripts(query, limit, offset);
  },

  async getSearchStats() {
    return tauriAPI.searchAPI.getSearchStats();
  },

  async indexEpisodeTranscript(episodeId, segments) {
    return tauriAPI.searchAPI.indexEpisodeTranscript(episodeId, segments);
  },

  async indexAllTranscripts() {
    return tauriAPI.searchAPI.indexAllTranscripts();
  },

  async reindexAllWithSpeakers() {
    return tauriAPI.searchAPI.reindexAllWithSpeakers();
  },

  async getDetectedContent(episodeId) {
    return tauriAPI.searchAPI.getDetectedContent(episodeId);
  },

  async getDetectedContentByType(contentType) {
    return tauriAPI.searchAPI.getDetectedContentByType(contentType);
  },

  async addDetectedContent(episodeId, contentType, name, description, startTime, endTime, segmentIdx, confidence, rawText) {
    return tauriAPI.searchAPI.addDetectedContent(
      episodeId, contentType, name, description, startTime, endTime, segmentIdx, confidence, rawText
    );
  },
};

// ============================================================================
// EXTRACTION API - LLM-based content extraction
// ============================================================================

export const extractionAPI = {
  async getOllamaStatus() {
    return tauriAPI.extractionAPI.getOllamaStatus();
  },

  async getPrompts() {
    return tauriAPI.extractionAPI.getPrompts();
  },

  async getPrompt(promptId) {
    return tauriAPI.extractionAPI.getPrompt(promptId);
  },

  async createPrompt(name, description, contentType, promptText, systemPrompt, outputSchema) {
    return tauriAPI.extractionAPI.createPrompt(name, description, contentType, promptText, systemPrompt, outputSchema);
  },

  async updatePrompt(promptId, name, description, contentType, promptText, systemPrompt, outputSchema, isActive) {
    return tauriAPI.extractionAPI.updatePrompt(promptId, name, description, contentType, promptText, systemPrompt, outputSchema, isActive);
  },

  async deletePrompt(promptId) {
    return tauriAPI.extractionAPI.deletePrompt(promptId);
  },

  async runExtraction(promptId, episodeId) {
    return tauriAPI.extractionAPI.runExtraction(promptId, episodeId);
  },

  async testPrompt(promptText, systemPrompt, sampleText) {
    return tauriAPI.extractionAPI.testPrompt(promptText, systemPrompt, sampleText);
  },

  async getExtractionRuns(episodeId, limit) {
    return tauriAPI.extractionAPI.getExtractionRuns(episodeId, limit);
  },
};

// ============================================================================
// WIKI API - Fandom wiki integration
// ============================================================================

export const wikiAPI = {
  async syncWikiEpisode(episodeNumber) {
    return tauriAPI.wikiAPI.syncWikiEpisode(episodeNumber);
  },

  async getWikiEpisodeMeta(episodeId) {
    return tauriAPI.wikiAPI.getWikiEpisodeMeta(episodeId);
  },
};

// Export everything
export default {
  isTauri,
  episodes: episodesAPI,
  queue: queueAPI,
  stats: statsAPI,
  worker: workerAPI,
  health: healthAPI,
  diagnostics: diagnosticsAPI,
  settings: settingsAPI,
  speakers: speakersAPI,
  content: contentAPI,
  search: searchAPI,
  extraction: extractionAPI,
  wiki: wikiAPI,
  setupEventListeners,
};
