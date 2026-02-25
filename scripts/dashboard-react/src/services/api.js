/**
 * API Service - Handles all backend communication
 * Auto-detects Tauri and uses IPC, falls back to HTTP
 */

import * as tauriAPI from './tauri.js';

// Check if running in Tauri
export const isTauri = tauriAPI.isTauri;

const API_BASE = '/api/v2';

class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }
}

async function fetchJSON(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new APIError(
        data.error || 'API request failed',
        response.status,
        data
      );
    }

    return data;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError(error.message, 0, null);
  }
}

// ============================================================================
// EPISODES API - Auto-detects Tauri vs HTTP
// ============================================================================

export const episodesAPI = {
  async getEpisodes(params = {}) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getEpisodes(params);
      } catch (e) {
        console.error('Tauri getEpisodes failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    const queryString = new URLSearchParams(params).toString();
    return fetchJSON(`${API_BASE}/episodes?${queryString}`);
  },

  async getEpisode(id) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getEpisode(id);
      } catch (e) {
        console.error('Tauri getEpisode failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/episodes/${id}`);
  },

  async refreshFeed(source = 'patreon', force = false) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.refreshFeed(source, force);
      } catch (e) {
        console.error('Tauri refreshFeed failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/episodes/refresh-feed`, {
      method: 'POST',
      body: JSON.stringify({ source, force }),
    });
  },

  async getRefreshStatus(source) {
    if (isTauri) {
      return { status: 'idle' };
    }
    return fetchJSON(`${API_BASE}/episodes/refresh-status/${source}`);
  },

  async getFeedSources() {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getFeedSources();
      } catch (e) {
        console.error('Tauri getFeedSources failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/feeds/sources`);
  },

  async getTranscript(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getTranscript(episodeId);
      } catch (e) {
        console.error('Tauri getTranscript failed:', e);
        throw e;
      }
    }
    return fetchJSON(`${API_BASE}/episodes/${episodeId}/transcript`);
  },

  async updateSpeakerNames(episodeId, speakerNames, markedSamples = null) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.updateSpeakerNames(episodeId, speakerNames, markedSamples);
      } catch (e) {
        console.error('Tauri updateSpeakerNames failed:', e);
        throw e;
      }
    }
    // No HTTP fallback for now
    throw new Error('Speaker name updates require Tauri');
  },

  async saveTranscriptEdits(episodeId, edits) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.saveTranscriptEdits(episodeId, edits);
      } catch (e) {
        console.error('Tauri saveTranscriptEdits failed:', e);
        throw e;
      }
    }
    throw new Error('Transcript edits require Tauri');
  },

  async retryDiarization(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.retryDiarization(episodeId);
      } catch (e) {
        console.error('Tauri retryDiarization failed:', e);
        throw e;
      }
    }
    throw new Error('Diarization requires Tauri');
  },

  async saveVoiceSamples(episodeId, samples) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.saveVoiceSamples(episodeId, samples);
      } catch (e) {
        console.error('Tauri saveVoiceSamples failed:', e);
        throw e;
      }
    }
    throw new Error('Voice samples require Tauri');
  },

  async getAudioPath(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getAudioPath(episodeId);
      } catch (e) {
        console.error('Tauri getAudioPath failed:', e);
        throw e;
      }
    }
    throw new Error('Audio path requires Tauri');
  },

  async downloadEpisode(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.downloadEpisode(episodeId);
      } catch (e) {
        console.error('Tauri downloadEpisode failed:', e);
        throw e;
      }
    }
    return fetchJSON(`${API_BASE}/episodes/${episodeId}/download`, {
      method: 'POST',
    });
  },

  async analyzeEpisodeContent(episodeId, useLlm = true) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.analyzeEpisodeContent(episodeId, useLlm);
      } catch (e) {
        console.error('Tauri analyzeEpisodeContent failed:', e);
        throw e;
      }
    }
    throw new Error('Content analysis requires Tauri');
  },

  async reprocessDiarization(episodeId, options = {}) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.reprocessDiarization(episodeId, options);
      } catch (e) {
        console.error('Tauri reprocessDiarization failed:', e);
        throw e;
      }
    }
    throw new Error('Reprocess diarization requires Tauri');
  },

  async getCategoryRules() {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getCategoryRules();
      } catch (e) {
        console.error('Tauri getCategoryRules failed:', e);
        return [];
      }
    }
    return [];
  },

  async recategorizeAllEpisodes() {
    if (isTauri) {
      return await tauriAPI.episodesAPI.recategorizeAllEpisodes();
    }
    throw new Error('Recategorize requires Tauri');
  },

  async linkCrossFeedEpisodes() {
    if (isTauri) {
      return await tauriAPI.episodesAPI.linkCrossFeedEpisodes();
    }
    throw new Error('Link cross-feed requires Tauri');
  },

  async getEpisodeVariants(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.episodesAPI.getEpisodeVariants(episodeId);
      } catch (e) {
        console.error('Tauri getEpisodeVariants failed:', e);
        return [];
      }
    }
    return [];
  },

  async addCategoryRule(rule) {
    if (isTauri) {
      return await tauriAPI.episodesAPI.addCategoryRule(rule);
    }
    throw new Error('Category rules require Tauri');
  },

  async updateCategoryRule(rule) {
    if (isTauri) {
      return await tauriAPI.episodesAPI.updateCategoryRule(rule);
    }
    throw new Error('Category rules require Tauri');
  },

  async deleteCategoryRule(id) {
    if (isTauri) {
      return await tauriAPI.episodesAPI.deleteCategoryRule(id);
    }
    throw new Error('Category rules require Tauri');
  },

  async testCategoryRule(pattern, keywords = null) {
    if (isTauri) {
      return await tauriAPI.episodesAPI.testCategoryRule(pattern, keywords);
    }
    throw new Error('Category rules require Tauri');
  },
};

// ============================================================================
// QUEUE API - Auto-detects Tauri vs HTTP
// ============================================================================

export const queueAPI = {
  async getQueue() {
    if (isTauri) {
      try {
        return await tauriAPI.queueAPI.getQueue();
      } catch (e) {
        console.error('Tauri getQueue failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/queue`);
  },

  async addToQueue(episodeId, priority = 0) {
    if (isTauri) {
      try {
        await tauriAPI.queueAPI.addToQueue(episodeId, priority);
        return { success: true };
      } catch (e) {
        console.error('Tauri addToQueue failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/queue/add`, {
      method: 'POST',
      body: JSON.stringify({
        episode_id: episodeId,
        priority,
      }),
    });
  },

  async removeFromQueue(episodeId) {
    if (isTauri) {
      try {
        await tauriAPI.queueAPI.removeFromQueue(episodeId);
        return { success: true };
      } catch (e) {
        console.error('Tauri removeFromQueue failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/queue/remove/${episodeId}`, {
      method: 'DELETE',
    });
  },

  async stopCurrent() {
    if (isTauri) {
      try {
        await tauriAPI.queueAPI.stopCurrent();
        return { success: true };
      } catch (e) {
        console.error('Tauri stopCurrent failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/queue/stop-current`, {
      method: 'POST',
    });
  },

  async retryTranscription(episodeId) {
    if (isTauri) {
      try {
        await tauriAPI.queueAPI.retryTranscription(episodeId);
        return { success: true };
      } catch (e) {
        console.error('Tauri retryTranscription failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/queue/retry/${episodeId}`, {
      method: 'POST',
    });
  },

  async getStatus() {
    if (isTauri) {
      try {
        return await tauriAPI.queueAPI.getStatus();
      } catch (e) {
        console.error('Tauri getStatus failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/queue/status`);
  },
};

// ============================================================================
// STATS API
// ============================================================================

export const statsAPI = {
  async getStats() {
    if (isTauri) {
      try {
        return await tauriAPI.statsAPI.getStats();
      } catch (e) {
        console.error('Tauri getStats failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/stats`);
  },

  async getPipelineStats(limit = 20) {
    if (isTauri) {
      try {
        return await tauriAPI.statsAPI.getPipelineStats(limit);
      } catch (e) {
        console.error('Tauri getPipelineStats failed:', e);
        return { timing: null, recent: [] };
      }
    }
    return { timing: null, recent: [] };
  },

  async getPipelineHealth() {
    if (isTauri) {
      try {
        return await tauriAPI.statsAPI.getPipelineHealth();
      } catch (e) {
        console.error('Tauri getPipelineHealth failed:', e);
        return null;
      }
    }
    return null;
  },

  async getRecentErrors(limit = 20) {
    if (isTauri) {
      try {
        return await tauriAPI.statsAPI.getRecentErrors(limit);
      } catch (e) {
        console.error('Tauri getRecentErrors failed:', e);
        return [];
      }
    }
    return [];
  },

  async getQueueEpisodeLists() {
    if (isTauri) {
      try {
        return await tauriAPI.statsAPI.getQueueEpisodeLists();
      } catch (e) {
        console.error('Tauri getQueueEpisodeLists failed:', e);
        return { transcribe: [], diarize: [] };
      }
    }
    return { transcribe: [], diarize: [] };
  },
};

// ============================================================================
// WORKER API
// ============================================================================

export const workerAPI = {
  async getStatus() {
    if (isTauri) {
      try {
        return await tauriAPI.workerAPI.getStatus();
      } catch (e) {
        console.error('Tauri workerStatus failed:', e);
        throw e; // Don't fall through to HTTP in Tauri mode
      }
    }
    return fetchJSON(`${API_BASE}/worker/status`);
  },
  async setPreventSleep(enabled) {
    if (isTauri) {
      return await tauriAPI.workerAPI.setPreventSleep(enabled);
    }
    throw new Error('Prevent sleep is only available in the Tauri app');
  },
  async getPreventSleep() {
    if (isTauri) {
      return await tauriAPI.workerAPI.getPreventSleep();
    }
    return false;
  },
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

export const healthAPI = {
  async check() {
    if (isTauri) {
      return { status: 'ok', backend: 'tauri' };
    }
    return fetchJSON(`${API_BASE}/health`);
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
    if (isTauri) {
      try {
        return await tauriAPI.diagnosticsAPI.getDiagnostics();
      } catch (e) {
        console.error('Tauri getDiagnostics failed:', e);
        return { error: e.toString() };
      }
    }
    return { error: 'Diagnostics only available in Tauri mode' };
  },
};

// ============================================================================
// SETTINGS API - App configuration
// ============================================================================

export const settingsAPI = {
  async getSetting(key) {
    if (isTauri) {
      try {
        return await tauriAPI.settingsAPI.getSetting(key);
      } catch (e) {
        console.error('Tauri getSetting failed:', e);
        return null;
      }
    }
    return null;
  },

  async setSetting(key, value) {
    if (isTauri) {
      try {
        return await tauriAPI.settingsAPI.setSetting(key, value);
      } catch (e) {
        console.error('Tauri setSetting failed:', e);
        throw e;
      }
    }
    throw new Error('Settings only available in Tauri mode');
  },

  async getAllSettings() {
    if (isTauri) {
      try {
        return await tauriAPI.settingsAPI.getAllSettings();
      } catch (e) {
        console.error('Tauri getAllSettings failed:', e);
        return {};
      }
    }
    return {};
  },
};

// ============================================================================
// SPEAKERS API - Speaker management
// ============================================================================

export const speakersAPI = {
  async getSpeakers() {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getSpeakers();
      } catch (e) {
        console.error('Tauri getSpeakers failed:', e);
        return [];
      }
    }
    return [];
  },

  async createSpeaker(name, shortName = null, isHost = false, isGuest = false, isScoop = false) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.createSpeaker(name, shortName, isHost, isGuest, isScoop);
    }
    throw new Error('Speakers only available in Tauri mode');
  },

  async updateSpeaker(id, name, shortName = null, isHost = false, isGuest = false, isScoop = false) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.updateSpeaker(id, name, shortName, isHost, isGuest, isScoop);
    }
    throw new Error('Speakers only available in Tauri mode');
  },

  async deleteSpeaker(id) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.deleteSpeaker(id);
    }
    throw new Error('Speakers only available in Tauri mode');
  },

  async getSpeakerStats() {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getSpeakerStats();
      } catch (e) {
        console.error('Tauri getSpeakerStats failed:', e);
        return [];
      }
    }
    return [];
  },

  async linkEpisodeSpeaker(episodeId, diarizationLabel, speakerId) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.linkEpisodeSpeaker(episodeId, diarizationLabel, speakerId);
    }
    throw new Error('Speakers only available in Tauri mode');
  },

  async linkEpisodeAudioDrop(episodeId, diarizationLabel, audioDropId) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.linkEpisodeAudioDrop(episodeId, diarizationLabel, audioDropId);
    }
    throw new Error('Speakers only available in Tauri mode');
  },

  async unlinkEpisodeSpeaker(episodeId, diarizationLabel) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.unlinkEpisodeSpeaker(episodeId, diarizationLabel);
    }
    throw new Error('Speakers only available in Tauri mode');
  },

  async getEpisodeSpeakerAssignments(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getEpisodeSpeakerAssignments(episodeId);
      } catch (e) {
        console.error('Tauri getEpisodeSpeakerAssignments failed:', e);
        return [];
      }
    }
    return [];
  },

  async getVoiceLibrary() {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getVoiceLibrary();
      } catch (e) {
        console.error('Tauri getVoiceLibrary failed:', e);
        return [];
      }
    }
    return [];
  },

  async getEmbeddingModel() {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getEmbeddingModel();
      } catch (e) {
        console.error('Tauri getEmbeddingModel failed:', e);
        return 'pyannote';
      }
    }
    return 'pyannote';
  },

  async setEmbeddingModel(backend) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.setEmbeddingModel(backend);
    }
    throw new Error('Embedding model selection only available in Tauri mode');
  },

  async compareEmbeddingBackends(episodeId) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.compareEmbeddingBackends(episodeId);
    }
    throw new Error('Backend comparison only available in Tauri mode');
  },

  async getVoiceSamplePath(speakerName) {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getVoiceSamplePath(speakerName);
      } catch (e) {
        console.error('Tauri getVoiceSamplePath failed:', e);
        return null;
      }
    }
    return null;
  },

  async getVoiceSamples(speakerName) {
    if (isTauri) {
      try {
        return await tauriAPI.speakersAPI.getVoiceSamples(speakerName);
      } catch (e) {
        console.error('Tauri getVoiceSamples failed:', e);
        return [];
      }
    }
    return [];
  },

  async deleteVoiceSample(speakerName, filePath, sampleId) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.deleteVoiceSample(speakerName, filePath, sampleId);
    }
    throw new Error('Voice samples only available in Tauri mode');
  },

  async updateVoiceSampleRating(id, rating) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.updateVoiceSampleRating(id, rating);
    }
    throw new Error('Voice sample ratings only available in Tauri mode');
  },

  async deleteVoicePrint(speakerName) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.deleteVoicePrint(speakerName);
    }
    throw new Error('Voice print deletion only available in Tauri mode');
  },

  async purgeVoiceLibraryEntry(speakerName) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.purgeVoiceLibraryEntry(speakerName);
    }
    throw new Error('Voice library purge only available in Tauri mode');
  },

  async rebuildVoicePrintForSpeaker(speakerName) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.rebuildVoicePrintForSpeaker(speakerName);
    }
    throw new Error('Voice print rebuild only available in Tauri mode');
  },

  async rebuildVoiceLibrary(backend = null) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.rebuildVoiceLibrary(backend);
    }
    throw new Error('Voice library rebuild only available in Tauri mode');
  },

  async runVoiceHarvest(minSecs = 4.0, maxPerSpeaker = 5) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.runVoiceHarvest(minSecs, maxPerSpeaker);
    }
    throw new Error('Voice harvest only available in Tauri mode');
  },

  async extractVoiceSampleFromSegment(episodeId, segmentIdx, speakerName) {
    if (isTauri) {
      return await tauriAPI.speakersAPI.extractVoiceSampleFromSegment(episodeId, segmentIdx, speakerName);
    }
    // Silently no-op in browser mode
  },
};

// ============================================================================
// CONTENT API - Chapters, Characters, Sponsors
// ============================================================================

export const contentAPI = {
  // Chapter Types
  async getChapterTypes() {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getChapterTypes();
      } catch (e) {
        console.error('Tauri getChapterTypes failed:', e);
        return [];
      }
    }
    return [];
  },

  async createChapterType(name, description, color, icon) {
    if (isTauri) {
      return await tauriAPI.contentAPI.createChapterType(name, description, color, icon);
    }
    throw new Error('Content only available in Tauri mode');
  },

  // Episode Chapters
  async getEpisodeChapters(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getEpisodeChapters(episodeId);
      } catch (e) {
        console.error('Tauri getEpisodeChapters failed:', e);
        return [];
      }
    }
    return [];
  },

  async createEpisodeChapter(episodeId, chapterTypeId, title, startTime, endTime, startSegmentIdx, endSegmentIdx) {
    if (isTauri) {
      return await tauriAPI.contentAPI.createEpisodeChapter(
        episodeId, chapterTypeId, title, startTime, endTime, startSegmentIdx, endSegmentIdx
      );
    }
    throw new Error('Content only available in Tauri mode');
  },

  async deleteEpisodeChapter(chapterId) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteEpisodeChapter(chapterId);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async runAiChapterDetection(episodeId) {
    if (isTauri) {
      return await tauriAPI.contentAPI.runAiChapterDetection(episodeId);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async exportSponsorClip(episodeId, startTime, endTime, sponsorName) {
    if (isTauri) {
      return await tauriAPI.contentAPI.exportSponsorClip(episodeId, startTime, endTime, sponsorName);
    }
    throw new Error('Content only available in Tauri mode');
  },

  // Characters
  async getCharacters() {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getCharacters();
      } catch (e) {
        console.error('Tauri getCharacters failed:', e);
        return [];
      }
    }
    return [];
  },

  async createCharacter(name, shortName, description, catchphrase, speakerId = null) {
    if (isTauri) {
      return await tauriAPI.contentAPI.createCharacter(name, shortName, description, catchphrase, speakerId);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async updateCharacter(id, name, shortName, description, catchphrase, speakerId = null) {
    if (isTauri) {
      return await tauriAPI.contentAPI.updateCharacter(id, name, shortName, description, catchphrase, speakerId);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async deleteCharacter(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteCharacter(id);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async addCharacterAppearance(characterId, episodeId, startTime, endTime, segmentIdx) {
    if (isTauri) {
      return await tauriAPI.contentAPI.addCharacterAppearance(characterId, episodeId, startTime, endTime, segmentIdx);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async getCharacterAppearancesForEpisode(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getCharacterAppearancesForEpisode(episodeId);
      } catch (e) {
        console.error('Tauri getCharacterAppearancesForEpisode failed:', e);
        return [];
      }
    }
    return [];
  },

  async getCharacterAppearancesForCharacter(characterId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getCharacterAppearancesForCharacter(characterId);
      } catch (e) {
        console.error('Tauri getCharacterAppearancesForCharacter failed:', e);
        return [];
      }
    }
    return [];
  },

  async deleteCharacterAppearance(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteCharacterAppearance(id);
    }
    throw new Error('Content only available in Tauri mode');
  },

  // Audio Drops
  async getAudioDrops() {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getAudioDrops();
      } catch (e) {
        console.error('Tauri getAudioDrops failed:', e);
        return [];
      }
    }
    return [];
  },

  async createAudioDrop(name, transcriptText = null, description = null, category = null) {
    if (isTauri) {
      return await tauriAPI.contentAPI.createAudioDrop(name, transcriptText, description, category);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async deleteAudioDrop(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteAudioDrop(id);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async addAudioDropInstance(audioDropId, episodeId, segmentIdx = null, startTime = null, endTime = null, notes = null) {
    if (isTauri) {
      return await tauriAPI.contentAPI.addAudioDropInstance(audioDropId, episodeId, segmentIdx, startTime, endTime, notes);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async getAudioDropInstances(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getAudioDropInstances(episodeId);
      } catch (e) {
        console.error('Tauri getAudioDropInstances failed:', e);
        return [];
      }
    }
    return [];
  },

  async deleteAudioDropInstance(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteAudioDropInstance(id);
    }
    throw new Error('Content only available in Tauri mode');
  },

  // Chapter Label Rules
  async getChapterLabelRules() {
    if (isTauri) return await tauriAPI.contentAPI.getChapterLabelRules();
    throw new Error('Content only available in Tauri mode');
  },
  async saveChapterLabelRule(id, chapterTypeId, pattern, matchType, priority, enabled) {
    if (isTauri) return await tauriAPI.contentAPI.saveChapterLabelRule(id, chapterTypeId, pattern, matchType, priority, enabled);
    throw new Error('Content only available in Tauri mode');
  },
  async deleteChapterLabelRule(id) {
    if (isTauri) return await tauriAPI.contentAPI.deleteChapterLabelRule(id);
    throw new Error('Content only available in Tauri mode');
  },
  async autoLabelChapters(episodeId, overwrite = false) {
    if (isTauri) return await tauriAPI.contentAPI.autoLabelChapters(episodeId, overwrite);
    throw new Error('Content only available in Tauri mode');
  },

  // Flagged Segments (Review Workflow)
  async createFlaggedSegment(episodeId, segmentIdx, flagType, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null) {
    if (isTauri) {
      return await tauriAPI.contentAPI.createFlaggedSegment(episodeId, segmentIdx, flagType, correctedSpeaker, characterId, notes, speakerIds);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async getFlaggedSegments(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getFlaggedSegments(episodeId);
      } catch (e) {
        console.error('Tauri getFlaggedSegments failed:', e);
        return [];
      }
    }
    return [];
  },

  async updateFlaggedSegment(id, flagType = null, correctedSpeaker = null, characterId = null, notes = null, speakerIds = null, resolved = null) {
    if (isTauri) {
      return await tauriAPI.contentAPI.updateFlaggedSegment(id, flagType, correctedSpeaker, characterId, notes, speakerIds, resolved);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async deleteFlaggedSegment(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteFlaggedSegment(id);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async getUnresolvedFlagCount(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getUnresolvedFlagCount(episodeId);
      } catch (e) {
        console.error('Tauri getUnresolvedFlagCount failed:', e);
        return 0;
      }
    }
    return 0;
  },

  // Sponsors
  async getSponsors() {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getSponsors();
      } catch (e) {
        console.error('Tauri getSponsors failed:', e);
        return [];
      }
    }
    return [];
  },

  async createSponsor(name, tagline, description, isReal) {
    if (isTauri) {
      return await tauriAPI.contentAPI.createSponsor(name, tagline, description, isReal);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async updateSponsor(id, name, tagline, description, isReal) {
    if (isTauri) {
      return await tauriAPI.contentAPI.updateSponsor(id, name, tagline, description, isReal);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async deleteSponsor(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.deleteSponsor(id);
    }
    throw new Error('Content only available in Tauri mode');
  },

  async addSponsorMention(sponsorId, episodeId, startTime, endTime, segmentIdx) {
    if (isTauri) {
      return await tauriAPI.contentAPI.addSponsorMention(sponsorId, episodeId, startTime, endTime, segmentIdx);
    }
    throw new Error('Content only available in Tauri mode');
  },

  // Qwen Segment Classification
  async runQwenClassification(episodeId, segmentIndices) {
    if (isTauri) {
      return await tauriAPI.contentAPI.runQwenClassification(episodeId, segmentIndices);
    }
    throw new Error('Qwen classification only available in Tauri mode');
  },

  async getSegmentClassifications(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getSegmentClassifications(episodeId);
      } catch (e) {
        console.error('Tauri getSegmentClassifications failed:', e);
        return [];
      }
    }
    return [];
  },

  async approveSegmentClassification(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.approveSegmentClassification(id);
    }
    throw new Error('Qwen classification only available in Tauri mode');
  },

  async rejectSegmentClassification(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.rejectSegmentClassification(id);
    }
    throw new Error('Qwen classification only available in Tauri mode');
  },

  // Scoop Polish
  async runQwenPolish(episodeId, segmentIndices) {
    if (isTauri) {
      return await tauriAPI.contentAPI.runQwenPolish(episodeId, segmentIndices);
    }
    throw new Error('Scoop Polish only available in Tauri mode');
  },

  async getTranscriptCorrections(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.contentAPI.getTranscriptCorrections(episodeId);
      } catch (e) {
        console.error('Tauri getTranscriptCorrections failed:', e);
        return [];
      }
    }
    return [];
  },

  async approveTranscriptCorrection(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.approveTranscriptCorrection(id);
    }
    throw new Error('Scoop Polish only available in Tauri mode');
  },

  async rejectTranscriptCorrection(id) {
    if (isTauri) {
      return await tauriAPI.contentAPI.rejectTranscriptCorrection(id);
    }
    throw new Error('Scoop Polish only available in Tauri mode');
  },
};

// ============================================================================
// SEARCH API - Full-text search across transcripts
// ============================================================================

export const searchAPI = {
  async searchTranscripts(query, limit = 50, offset = 0) {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.searchTranscripts(query, limit, offset);
      } catch (e) {
        console.error('Tauri searchTranscripts failed:', e);
        throw e;
      }
    }
    throw new Error('Search only available in Tauri mode');
  },

  async getSearchStats() {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.getSearchStats();
      } catch (e) {
        console.error('Tauri getSearchStats failed:', e);
        return { indexed_segments: 0, unindexed_episode_count: 0 };
      }
    }
    return { indexed_segments: 0, unindexed_episode_count: 0 };
  },

  async indexEpisodeTranscript(episodeId, segments) {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.indexEpisodeTranscript(episodeId, segments);
      } catch (e) {
        console.error('Tauri indexEpisodeTranscript failed:', e);
        throw e;
      }
    }
    throw new Error('Search indexing only available in Tauri mode');
  },

  async indexAllTranscripts() {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.indexAllTranscripts();
      } catch (e) {
        console.error('Tauri indexAllTranscripts failed:', e);
        throw e;
      }
    }
    throw new Error('Search indexing only available in Tauri mode');
  },

  async reindexAllWithSpeakers() {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.reindexAllWithSpeakers();
      } catch (e) {
        console.error('Tauri reindexAllWithSpeakers failed:', e);
        throw e;
      }
    }
    throw new Error('Reindex only available in Tauri mode');
  },

  async getDetectedContent(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.getDetectedContent(episodeId);
      } catch (e) {
        console.error('Tauri getDetectedContent failed:', e);
        return [];
      }
    }
    return [];
  },

  async getDetectedContentByType(contentType) {
    if (isTauri) {
      try {
        return await tauriAPI.searchAPI.getDetectedContentByType(contentType);
      } catch (e) {
        console.error('Tauri getDetectedContentByType failed:', e);
        return [];
      }
    }
    return [];
  },

  async addDetectedContent(episodeId, contentType, name, description, startTime, endTime, segmentIdx, confidence, rawText) {
    if (isTauri) {
      return await tauriAPI.searchAPI.addDetectedContent(
        episodeId, contentType, name, description, startTime, endTime, segmentIdx, confidence, rawText
      );
    }
    throw new Error('Search only available in Tauri mode');
  },
};

// EXTRACTION API - LLM-based content extraction
// ============================================================================

export const extractionAPI = {
  async getOllamaStatus() {
    if (isTauri) {
      return await tauriAPI.extractionAPI.getOllamaStatus();
    }
    return { running: false, model: '', model_available: false, available_models: [], error: 'Not in Tauri mode' };
  },

  async getPrompts() {
    if (isTauri) {
      return await tauriAPI.extractionAPI.getPrompts();
    }
    return [];
  },

  async getPrompt(promptId) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.getPrompt(promptId);
    }
    return null;
  },

  async createPrompt(name, description, contentType, promptText, systemPrompt, outputSchema) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.createPrompt(name, description, contentType, promptText, systemPrompt, outputSchema);
    }
    throw new Error('Extraction only available in Tauri mode');
  },

  async updatePrompt(promptId, name, description, contentType, promptText, systemPrompt, outputSchema, isActive) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.updatePrompt(promptId, name, description, contentType, promptText, systemPrompt, outputSchema, isActive);
    }
    throw new Error('Extraction only available in Tauri mode');
  },

  async deletePrompt(promptId) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.deletePrompt(promptId);
    }
    throw new Error('Extraction only available in Tauri mode');
  },

  async runExtraction(promptId, episodeId) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.runExtraction(promptId, episodeId);
    }
    throw new Error('Extraction only available in Tauri mode');
  },

  async testPrompt(promptText, systemPrompt, sampleText) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.testPrompt(promptText, systemPrompt, sampleText);
    }
    throw new Error('Extraction only available in Tauri mode');
  },

  async getExtractionRuns(episodeId, limit) {
    if (isTauri) {
      return await tauriAPI.extractionAPI.getExtractionRuns(episodeId, limit);
    }
    return [];
  },
};

// ============================================================================
// WIKI API - Fandom wiki integration
// ============================================================================

export const wikiAPI = {
  async syncWikiEpisode(episodeNumber) {
    if (isTauri) {
      return await tauriAPI.wikiAPI.syncWikiEpisode(episodeNumber);
    }
    throw new Error('Wiki sync only available in Tauri mode');
  },

  async getWikiEpisodeMeta(episodeId) {
    if (isTauri) {
      try {
        return await tauriAPI.wikiAPI.getWikiEpisodeMeta(episodeId);
      } catch (e) {
        console.error('Tauri getWikiEpisodeMeta failed:', e);
        return null;
      }
    }
    return null;
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
