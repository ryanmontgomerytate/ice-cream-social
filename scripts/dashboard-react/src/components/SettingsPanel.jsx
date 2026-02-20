import { useState, useEffect, useCallback } from 'react'
import { settingsAPI, episodesAPI, workerAPI, contentAPI } from '../services/api'

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

// ============================================================================
// Chapter Label Rules Section
// ============================================================================

const MATCH_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'regex', label: 'Regex' },
]

function ChapterLabelRuleRow({ rule, chapterTypes, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ ...rule })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const ct = chapterTypes.find(t => t.id === rule.chapter_type_id)
    return (
      <div className={`flex items-center gap-3 px-3 py-2 rounded border ${rule.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
        <span className="text-base">{ct?.icon || '📑'}</span>
        <span className="text-xs font-medium text-gray-700 w-24 flex-shrink-0" style={{ color: ct?.color }}>{ct?.name || '—'}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">{MATCH_TYPES.find(m => m.value === rule.match_type)?.label || rule.match_type}</span>
        <span className="text-xs font-mono text-gray-600 flex-1 truncate">{rule.pattern}</span>
        <span className="text-xs text-gray-400 flex-shrink-0">p{rule.priority}</span>
        <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:text-blue-700 flex-shrink-0">Edit</button>
        <button onClick={() => onDelete(rule.id)} className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
      </div>
    )
  }

  return (
    <div className="p-3 rounded border border-blue-200 bg-blue-50 space-y-2">
      <div className="flex gap-2">
        <select
          value={draft.chapter_type_id}
          onChange={e => setDraft(d => ({ ...d, chapter_type_id: parseInt(e.target.value) }))}
          className="text-xs border border-gray-300 rounded px-2 py-1 flex-shrink-0"
        >
          {chapterTypes.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
        </select>
        <select
          value={draft.match_type}
          onChange={e => setDraft(d => ({ ...d, match_type: e.target.value }))}
          className="text-xs border border-gray-300 rounded px-2 py-1 flex-shrink-0"
        >
          {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input
          value={draft.pattern}
          onChange={e => setDraft(d => ({ ...d, pattern: e.target.value }))}
          placeholder="Pattern to match..."
          className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 font-mono"
        />
        <input
          type="number"
          value={draft.priority}
          onChange={e => setDraft(d => ({ ...d, priority: parseInt(e.target.value) || 0 }))}
          className="text-xs border border-gray-300 rounded px-2 py-1 w-16"
          title="Priority (higher runs first)"
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />
          Enabled
        </label>
        <div className="flex-1" />
        <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
        <button onClick={handleSave} disabled={saving || !draft.pattern} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function ChapterLabelRulesSection({ onNotification }) {
  const [rules, setRules] = useState([])
  const [chapterTypes, setChapterTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newRule, setNewRule] = useState({ chapter_type_id: null, pattern: '', match_type: 'contains', priority: 0, enabled: true })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [r, t] = await Promise.all([contentAPI.getChapterLabelRules(), contentAPI.getChapterTypes()])
      setRules(r)
      setChapterTypes(t)
      if (t.length > 0 && !newRule.chapter_type_id) setNewRule(d => ({ ...d, chapter_type_id: t[0].id }))
    } catch (e) {
      onNotification?.(`Error loading chapter rules: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (rule) => {
    try {
      await contentAPI.saveChapterLabelRule(rule.id || null, rule.chapter_type_id, rule.pattern, rule.match_type, rule.priority, rule.enabled)
      await load()
      onNotification?.('Rule saved', 'success')
    } catch (e) {
      onNotification?.(`Save failed: ${e.message}`, 'error')
      throw e
    }
  }

  const handleDelete = async (id) => {
    try {
      await contentAPI.deleteChapterLabelRule(id)
      setRules(r => r.filter(x => x.id !== id))
      onNotification?.('Rule deleted', 'success')
    } catch (e) {
      onNotification?.(`Delete failed: ${e.message}`, 'error')
    }
  }

  const handleAdd = async () => {
    if (!newRule.pattern || !newRule.chapter_type_id) return
    setSaving(true)
    try {
      await contentAPI.saveChapterLabelRule(null, newRule.chapter_type_id, newRule.pattern, newRule.match_type, newRule.priority, newRule.enabled)
      await load()
      setNewRule(d => ({ ...d, pattern: '', priority: 0, enabled: true }))
      setAdding(false)
      onNotification?.('Rule added', 'success')
    } catch (e) {
      onNotification?.(`Add failed: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-gray-800 text-sm">Chapter Label Rules</h3>
          <p className="text-xs text-gray-500 mt-0.5">Match transcript text to chapter types. Used by "Auto-Label Chapters" in the transcript editor.</p>
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="text-xs bg-indigo-500 text-white px-3 py-1.5 rounded hover:bg-indigo-600"
        >+ Add Rule</button>
      </div>

      {adding && (
        <div className="p-3 rounded border border-indigo-200 bg-indigo-50 space-y-2 mb-3">
          <div className="flex gap-2">
            <select
              value={newRule.chapter_type_id || ''}
              onChange={e => setNewRule(d => ({ ...d, chapter_type_id: parseInt(e.target.value) }))}
              className="text-xs border border-gray-300 rounded px-2 py-1 flex-shrink-0"
            >
              {chapterTypes.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
            </select>
            <select
              value={newRule.match_type}
              onChange={e => setNewRule(d => ({ ...d, match_type: e.target.value }))}
              className="text-xs border border-gray-300 rounded px-2 py-1 flex-shrink-0"
            >
              {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input
              value={newRule.pattern}
              onChange={e => setNewRule(d => ({ ...d, pattern: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Pattern to match in transcript text..."
              className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 font-mono"
            />
            <input
              type="number"
              value={newRule.priority}
              onChange={e => setNewRule(d => ({ ...d, priority: parseInt(e.target.value) || 0 }))}
              className="text-xs border border-gray-300 rounded px-2 py-1 w-16"
              title="Priority"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={newRule.enabled} onChange={e => setNewRule(d => ({ ...d, enabled: e.target.checked }))} />
              Enabled
            </label>
            <div className="flex-1" />
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={handleAdd} disabled={saving || !newRule.pattern} className="text-xs bg-indigo-500 text-white px-3 py-1 rounded hover:bg-indigo-600 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add Rule'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No rules yet. Add a rule to enable auto-labeling.</p>
      ) : (
        <div className="space-y-1.5">
          {rules.map(rule => (
            <ChapterLabelRuleRow
              key={rule.id}
              rule={rule}
              chapterTypes={chapterTypes}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SettingsPanel({ onNotification }) {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(null)
  const [preventSleep, setPreventSleep] = useState(false)
  const [preventSleepLoading, setPreventSleepLoading] = useState(false)

  useEffect(() => {
    loadSettings()
    loadPreventSleep()
  }, [])

  const loadPreventSleep = async () => {
    try {
      const active = await workerAPI.getPreventSleep()
      setPreventSleep(active)
    } catch (e) {
      console.error('Error checking prevent sleep:', e)
    }
  }

  const togglePreventSleep = async () => {
    setPreventSleepLoading(true)
    try {
      const newValue = !preventSleep
      const result = await workerAPI.setPreventSleep(newValue)
      setPreventSleep(result)
      onNotification?.(result ? 'Prevent sleep enabled' : 'Prevent sleep disabled', 'success')
    } catch (e) {
      console.error('Error toggling prevent sleep:', e)
      onNotification?.(`Error: ${e.message || e}`, 'error')
    } finally {
      setPreventSleepLoading(false)
    }
  }

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
    setSavingKey(key)
    try {
      await settingsAPI.setSetting(key, value)
      setSettings(prev => ({ ...prev, [key]: value }))
      onNotification?.(`Setting "${key}" updated`, 'success')
    } catch (error) {
      console.error('Error updating setting:', error)
      onNotification?.(`Error updating setting: ${error.message}`, 'error')
    } finally {
      setSavingKey(null)
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

      <div className="p-6 overflow-y-auto max-h-[calc(100vh-200px)]">
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
                  disabled={savingKey === 'auto_transcribe'}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isAutoTranscribeEnabled ? 'bg-blue-500' : 'bg-gray-300'
                  } ${savingKey === 'auto_transcribe' ? 'opacity-50' : ''}`}
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
                  disabled={savingKey === 'enable_diarization'}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isDiarizationEnabled ? 'bg-purple-500' : 'bg-gray-300'
                  } ${savingKey === 'enable_diarization' ? 'opacity-50' : ''}`}
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

            {/* Prevent Sleep Toggle */}
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-amber-800">Prevent Sleep</h3>
                  <p className="text-sm text-amber-600 mt-1">
                    Keep your Mac awake while processing the queue. Uses macOS <code className="text-xs bg-amber-100 px-1 py-0.5 rounded">caffeinate</code> to
                    prevent sleep on AC power. Enable this for overnight batch runs.
                  </p>
                </div>
                <button
                  onClick={togglePreventSleep}
                  disabled={preventSleepLoading}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    preventSleep ? 'bg-amber-500' : 'bg-gray-300'
                  } ${preventSleepLoading ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      preventSleep ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  preventSleep
                    ? 'bg-amber-200 text-amber-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {preventSleep ? 'AWAKE' : 'OFF'}
                </span>
                {preventSleep && (
                  <span className="text-xs text-amber-600">
                    Mac will stay awake until this is turned off or the app closes
                  </span>
                )}
              </div>
              <p className="text-xs text-amber-500 mt-2">
                Without this, macOS will sleep after a period of inactivity, pausing all pipeline processing.
                Only works while plugged into AC power.
              </p>
            </div>

            {/* Model Selection */}
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-800 mb-2">Transcription Model</h3>
              <select
                value={settings.transcription_model || 'medium'}
                onChange={(e) => updateSetting('transcription_model', e.target.value)}
                disabled={savingKey === 'transcription_model'}
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

            {/* Chapter Label Rules Section */}
            <ChapterLabelRulesSection onNotification={onNotification} />

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
