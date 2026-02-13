import { useState, useEffect, useCallback } from 'react'
import { settingsAPI, episodesAPI } from '../services/api'

// ============================================================================
// Category Rule Card - Editable card for a single rule
// ============================================================================

function CategoryRuleCard({ rule, onSave, onDelete, onTest, isNew = false }) {
  const [expanded, setExpanded] = useState(isNew)
  const [editing, setEditing] = useState(isNew)
  const [draft, setDraft] = useState({ ...rule })
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')

  const isBonusCatchAll = rule.category === 'bonus' && rule.priority === 99

  const keywords = (draft.keywords || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0)

  const setKeywords = (kws) => {
    setDraft(prev => ({ ...prev, keywords: kws.join(', ') }))
  }

  const addKeyword = () => {
    const kw = newKeyword.trim()
    if (kw && !keywords.includes(kw)) {
      setKeywords([...keywords, kw])
      setNewKeyword('')
    }
  }

  const removeKeyword = (idx) => {
    setKeywords(keywords.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await onTest(draft.title_pattern, draft.keywords || null)
      setTestResult(result)
    } catch (e) {
      setTestResult({ error: e.message || e.toString() })
    } finally {
      setTesting(false)
    }
  }

  const handleCancel = () => {
    setDraft({ ...rule })
    setEditing(false)
    setTestResult(null)
    if (isNew) onDelete?.(rule.id)
  }

  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: rule.color || '#e5e7eb' }}>
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={() => { if (!editing) setExpanded(!expanded) }}
      >
        <span className="text-xl">{draft.icon || '?'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{draft.display_name}</span>
            <span
              className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: draft.color || '#6b7280' }}
            >
              {draft.category}
            </span>
            <span className="text-xs text-gray-400">priority: {draft.priority}</span>
          </div>
        </div>
        {!editing && (
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true); setExpanded(true) }}
            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
          >
            Edit
          </button>
        )}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded detail / edit form */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-3 bg-gray-50">
          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
                  <input
                    type="text"
                    value={draft.display_name}
                    onChange={(e) => setDraft(prev => ({ ...prev, display_name: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category Slug</label>
                  <input
                    type="text"
                    value={draft.category}
                    onChange={(e) => setDraft(prev => ({ ...prev, category: e.target.value }))}
                    disabled={!isNew}
                    className="w-full px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-400 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Icon (emoji)</label>
                  <input
                    type="text"
                    value={draft.icon || ''}
                    onChange={(e) => setDraft(prev => ({ ...prev, icon: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    placeholder="e.g. emoji"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.color || '#6b7280'}
                      onChange={(e) => setDraft(prev => ({ ...prev, color: e.target.value }))}
                      className="w-8 h-8 rounded border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={draft.color || ''}
                      onChange={(e) => setDraft(prev => ({ ...prev, color: e.target.value }))}
                      className="flex-1 px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
                      placeholder="#hexcolor"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                  <input
                    type="number"
                    value={draft.priority}
                    onChange={(e) => setDraft(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                    className="w-full px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title Pattern (regex)</label>
                <input
                  type="text"
                  value={draft.title_pattern}
                  onChange={(e) => setDraft(prev => ({ ...prev, title_pattern: e.target.value }))}
                  className="w-full px-2 py-1.5 text-sm border rounded font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  placeholder="(?i)regex pattern"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Number Pattern (regex, optional)</label>
                <input
                  type="text"
                  value={draft.number_pattern || ''}
                  onChange={(e) => setDraft(prev => ({ ...prev, number_pattern: e.target.value || null }))}
                  className="w-full px-2 py-1.5 text-sm border rounded font-mono focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  placeholder="(?i)capture group (\d+)"
                />
              </div>

              {/* Keywords */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Keywords (matched before regex, case-insensitive)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {keywords.map((kw, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white border"
                      style={{ borderColor: draft.color || '#d1d5db', color: draft.color || '#374151' }}
                    >
                      {kw}
                      <button
                        onClick={() => removeKeyword(i)}
                        className="hover:text-red-500 font-bold"
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                    className="flex-1 px-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    placeholder="Add keyword..."
                  />
                  <button
                    onClick={addKeyword}
                    disabled={!newKeyword.trim()}
                    className="px-3 py-1.5 text-sm rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Test button */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleTest}
                  disabled={testing || !draft.title_pattern}
                  className="px-3 py-1.5 text-sm rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-700 disabled:opacity-40"
                >
                  {testing ? 'Testing...' : 'Test Pattern'}
                </button>
                {testResult && !testResult.error && (
                  <span className="text-sm text-gray-600">
                    {testResult.match_count} episode{testResult.match_count !== 1 ? 's' : ''} matched
                  </span>
                )}
                {testResult?.error && (
                  <span className="text-sm text-red-600">{testResult.error}</span>
                )}
              </div>

              {/* Test result samples */}
              {testResult?.samples?.length > 0 && (
                <div className="max-h-40 overflow-y-auto bg-white rounded border p-2">
                  {testResult.samples.map((s, i) => (
                    <div key={i} className="text-xs text-gray-600 py-0.5 flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${s.matched_by === 'keyword' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                      <span className="truncate">{s.title}</span>
                    </div>
                  ))}
                  {testResult.match_count > 20 && (
                    <div className="text-xs text-gray-400 pt-1">
                      ...and {testResult.match_count - 20} more
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-1.5 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                >
                  Cancel
                </button>
                {!isNew && !isBonusCatchAll && (
                  <button
                    onClick={() => onDelete(rule.id)}
                    className="ml-auto px-3 py-1.5 text-sm rounded bg-red-100 hover:bg-red-200 text-red-600"
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-1 text-sm text-gray-600">
              <div><span className="text-gray-400">Pattern:</span> <code className="text-xs bg-white px-1 py-0.5 rounded">{rule.title_pattern}</code></div>
              {rule.number_pattern && (
                <div><span className="text-gray-400">Number:</span> <code className="text-xs bg-white px-1 py-0.5 rounded">{rule.number_pattern}</code></div>
              )}
              {keywords.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-400">Keywords:</span>
                  {keywords.map((kw, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-white border">{kw}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Category Rules Section
// ============================================================================

function CategoryRulesSection({ onNotification }) {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [recategorizing, setRecategorizing] = useState(false)
  const [addingNew, setAddingNew] = useState(false)

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      const data = await episodesAPI.getCategoryRules()
      setRules(data || [])
    } catch (e) {
      console.error('Error loading category rules:', e)
      onNotification?.('Error loading category rules', 'error')
    } finally {
      setLoading(false)
    }
  }, [onNotification])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const handleSave = async (draft) => {
    // Determine if this is a new rule (id <= 0 or doesn't exist in current list)
    const isNew = !rules.some(r => r.id === draft.id)
    if (isNew) {
      const newId = await episodesAPI.addCategoryRule(draft)
      onNotification?.(`Rule "${draft.display_name}" added`, 'success')
      setAddingNew(false)
      await loadRules()
      return newId
    } else {
      await episodesAPI.updateCategoryRule(draft)
      onNotification?.(`Rule "${draft.display_name}" updated`, 'success')
      await loadRules()
    }
  }

  const handleDelete = async (id) => {
    // If it's the temp new rule, just remove it
    if (id === -1) {
      setAddingNew(false)
      return
    }
    try {
      await episodesAPI.deleteCategoryRule(id)
      onNotification?.('Rule deleted', 'success')
      await loadRules()
    } catch (e) {
      onNotification?.(e.message || 'Error deleting rule', 'error')
    }
  }

  const handleTest = async (pattern, keywords) => {
    return await episodesAPI.testCategoryRule(pattern, keywords)
  }

  const handleRecategorize = async () => {
    setRecategorizing(true)
    try {
      const result = await episodesAPI.recategorizeAllEpisodes()
      const counts = result.counts || {}
      const summary = Object.entries(counts)
        .map(([cat, n]) => `${cat}: ${n}`)
        .join(', ')
      onNotification?.(`Recategorized ${result.total} episodes (${summary})`, 'success')
    } catch (e) {
      onNotification?.(`Recategorize failed: ${e.message || e}`, 'error')
    } finally {
      setRecategorizing(false)
    }
  }

  const handleAddNew = () => {
    setAddingNew(true)
  }

  const maxPriority = rules.reduce((max, r) => Math.max(max, r.priority), 0)
  const newRuleTemplate = {
    id: -1,
    category: '',
    display_name: '',
    title_pattern: '',
    number_pattern: null,
    priority: maxPriority > 90 ? maxPriority - 1 : maxPriority + 1,
    icon: '',
    color: '#6b7280',
    keywords: null,
  }

  return (
    <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-amber-800">Category Rules</h3>
          <p className="text-sm text-amber-600 mt-0.5">
            Rules for auto-categorizing episodes. Checked in priority order (lowest first).
          </p>
        </div>
        <button
          onClick={handleRecategorize}
          disabled={recategorizing}
          className="px-3 py-1.5 text-sm rounded bg-amber-200 hover:bg-amber-300 text-amber-800 disabled:opacity-50"
        >
          {recategorizing ? 'Re-categorizing...' : 'Re-categorize All'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="w-8 h-8 border-3 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-2"></div>
          <div className="text-sm text-amber-600">Loading rules...</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <CategoryRuleCard
              key={rule.id}
              rule={rule}
              onSave={handleSave}
              onDelete={handleDelete}
              onTest={handleTest}
            />
          ))}

          {addingNew && (
            <CategoryRuleCard
              key="new"
              rule={newRuleTemplate}
              onSave={handleSave}
              onDelete={handleDelete}
              onTest={handleTest}
              isNew
            />
          )}

          {!addingNew && (
            <button
              onClick={handleAddNew}
              className="w-full py-2 text-sm rounded border-2 border-dashed border-amber-300 text-amber-600 hover:bg-amber-100 hover:border-amber-400"
            >
              + Add Rule
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Settings Panel
// ============================================================================

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

            {/* Category Rules Section */}
            <CategoryRulesSection onNotification={onNotification} />

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
