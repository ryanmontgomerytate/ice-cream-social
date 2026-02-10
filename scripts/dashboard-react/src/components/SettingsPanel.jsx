import { useState, useEffect } from 'react'
import { settingsAPI } from '../services/api'

export default function SettingsPanel({ onNotification }) {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const data = await settingsAPI.getAllSettings()
      setSettings(data || {})
    } catch (error) {
      console.error('Error loading settings:', error)
      onNotification?.('Error loading settings', 'error')
    } finally {
      setLoading(false)
    }
  }

  const updateSetting = async (key, value) => {
    setSaving(true)
    try {
      await settingsAPI.setSetting(key, value)
      setSettings(prev => ({ ...prev, [key]: value }))
      onNotification?.(`Setting "${key}" updated`, 'success')
    } catch (error) {
      console.error('Error updating setting:', error)
      onNotification?.(`Error updating setting: ${error.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleAutoTranscribe = () => {
    const currentValue = settings.auto_transcribe === 'true'
    updateSetting('auto_transcribe', (!currentValue).toString())
  }

  const toggleDiarization = () => {
    const currentValue = settings.enable_diarization === 'true'
    updateSetting('enable_diarization', (!currentValue).toString())
  }

  const isAutoTranscribeEnabled = settings.auto_transcribe === 'true'
  const isDiarizationEnabled = settings.enable_diarization === 'true'

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-600 to-gray-700 px-6 py-4">
        <h2 className="text-xl font-bold text-white">Settings</h2>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-500 rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-gray-500">Loading settings...</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Auto-Transcribe Toggle */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-blue-800">Auto-Transcribe</h3>
                  <p className="text-sm text-blue-600 mt-1">
                    Automatically transcribe downloaded episodes when the queue is empty.
                    Episodes are processed in order of publish date (newest first).
                  </p>
                </div>
                <button
                  onClick={toggleAutoTranscribe}
                  disabled={saving}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isAutoTranscribeEnabled ? 'bg-blue-500' : 'bg-gray-300'
                  } ${saving ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      isAutoTranscribeEnabled ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  isAutoTranscribeEnabled
                    ? 'bg-blue-200 text-blue-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {isAutoTranscribeEnabled ? 'ON' : 'OFF'}
                </span>
                {isAutoTranscribeEnabled && (
                  <span className="text-xs text-blue-600">
                    Worker will automatically pick up next episode when idle
                  </span>
                )}
              </div>
            </div>

            {/* Diarization Toggle */}
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-purple-800">Speaker Diarization</h3>
                  <p className="text-sm text-purple-600 mt-1">
                    Identify who is speaking in each segment. Requires HuggingFace token
                    and adds processing time.
                  </p>
                </div>
                <button
                  onClick={toggleDiarization}
                  disabled={saving}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isDiarizationEnabled ? 'bg-purple-500' : 'bg-gray-300'
                  } ${saving ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      isDiarizationEnabled ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  isDiarizationEnabled
                    ? 'bg-purple-200 text-purple-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {isDiarizationEnabled ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>

            {/* Model Selection */}
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-800 mb-2">Transcription Model</h3>
              <select
                value={settings.transcription_model || 'medium'}
                onChange={(e) => updateSetting('transcription_model', e.target.value)}
                disabled={saving}
                className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="tiny">Tiny (fastest, lowest quality)</option>
                <option value="base">Base (fast, basic quality)</option>
                <option value="small">Small (balanced)</option>
                <option value="medium">Medium (recommended)</option>
                <option value="large-v3">Large v3 (best quality, slowest)</option>
              </select>
              <p className="text-sm text-gray-500 mt-2">
                Larger models are more accurate but take longer to process.
              </p>
            </div>

            {/* Current Settings Debug */}
            <div className="p-4 bg-gray-100 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-700 mb-2 text-sm">Current Settings</h3>
              <pre className="text-xs text-gray-600 overflow-auto">
                {JSON.stringify(settings, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
