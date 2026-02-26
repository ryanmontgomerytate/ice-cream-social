import { useState, useEffect, useCallback } from 'react'
import { settingsAPI, episodesAPI, workerAPI, contentAPI, speakersAPI } from '../services/api'

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadRules()
  }, [])

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
// Chapter Types Section
// ============================================================================

const DEFAULT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#64748b']

// ============================================================================
// Chapter Management Section (replaces ChapterTypesSection + ChapterLabelRulesSection)
// ============================================================================

const MATCH_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'regex', label: 'Regex' },
]

function ChapterRuleInlineRow({ rule, onSave, onDelete }) {
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
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded border bg-white border-gray-100 text-xs">
        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">{MATCH_TYPES.find(m => m.value === rule.match_type)?.label || rule.match_type}</span>
        <span className="font-mono text-gray-600 flex-1 truncate">{rule.pattern}</span>
        <span className="text-gray-400 flex-shrink-0">p{rule.priority}</span>
        {!rule.enabled && <span className="text-gray-400 flex-shrink-0">(off)</span>}
        <button onClick={() => setEditing(true)} className="text-blue-500 hover:text-blue-700 flex-shrink-0">Edit</button>
        <button onClick={() => onDelete(rule.id)} className="text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
      </div>
    )
  }

  return (
    <div className="p-2 rounded border border-blue-200 bg-blue-50 space-y-1.5 text-xs">
      <div className="flex gap-2 flex-wrap">
        <select
          value={draft.match_type}
          onChange={e => setDraft(d => ({ ...d, match_type: e.target.value }))}
          className="border border-gray-300 rounded px-2 py-1 flex-shrink-0"
        >
          {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input
          value={draft.pattern}
          onChange={e => setDraft(d => ({ ...d, pattern: e.target.value }))}
          placeholder="Pattern to match..."
          className="border border-gray-300 rounded px-2 py-1 flex-1 min-w-[120px] font-mono"
        />
        <input
          type="number"
          value={draft.priority}
          onChange={e => setDraft(d => ({ ...d, priority: parseInt(e.target.value) || 0 }))}
          className="border border-gray-300 rounded px-2 py-1 w-14"
          title="Priority (higher runs first)"
        />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 text-gray-600">
          <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />
          Enabled
        </label>
        <div className="flex-1" />
        <button onClick={() => setEditing(false)} className="text-gray-500 hover:text-gray-700">Cancel</button>
        <button onClick={handleSave} disabled={saving || !draft.pattern} className="bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function ChapterTypeCard({ type, rules, onSaveType, onDeleteType, onSaveRule, onDeleteRule, onAddRule }) {
  const [expanded, setExpanded] = useState(false)
  const [editingType, setEditingType] = useState(false)
  const [draft, setDraft] = useState({ ...type })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [addingRule, setAddingRule] = useState(false)
  const [newRule, setNewRule] = useState({ pattern: '', match_type: 'contains', priority: 0, enabled: true })
  const [addingSaving, setAddingSaving] = useState(false)

  const handleSaveType = async () => {
    setSaving(true)
    try {
      await onSaveType(draft)
      setEditingType(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    onDeleteType(type.id)
  }

  const handleAddRule = async () => {
    if (!newRule.pattern.trim()) return
    setAddingSaving(true)
    try {
      await onAddRule(type.id, newRule)
      setNewRule({ pattern: '', match_type: 'contains', priority: 0, enabled: true })
      setAddingRule(false)
    } finally {
      setAddingSaving(false)
    }
  }

  const typeRules = rules.filter(r => r.chapter_type_id === type.id)

  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: type.color || '#e5e7eb' }}>
      {/* Summary row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 bg-white"
        onClick={() => { if (!editingType) setExpanded(e => !e) }}
      >
        <span className="text-base w-6 text-center flex-shrink-0">{type.icon || '📑'}</span>
        <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: type.color }} />
        <span className="text-sm font-medium text-gray-800 flex-1" style={{ color: type.color }}>{type.name}</span>
        {typeRules.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 flex-shrink-0">
            {typeRules.length} rule{typeRules.length !== 1 ? 's' : ''}
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-3 py-3 space-y-3 bg-gray-50" style={{ borderColor: type.color || '#e5e7eb' }}>
          {/* Type edit fields */}
          {editingType ? (
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap">
                <input
                  value={draft.icon || ''}
                  onChange={e => setDraft(d => ({ ...d, icon: e.target.value }))}
                  placeholder="🎬"
                  className="text-sm border border-gray-300 rounded px-2 py-1 w-14 text-center"
                  title="Emoji icon"
                />
                <input
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="Chapter name"
                  className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-[120px]"
                />
                <input
                  value={draft.color}
                  onChange={e => setDraft(d => ({ ...d, color: e.target.value }))}
                  type="color"
                  className="h-8 w-10 rounded border border-gray-300 cursor-pointer p-0.5"
                  title="Color"
                />
                <input
                  type="number"
                  value={draft.sort_order}
                  onChange={e => setDraft(d => ({ ...d, sort_order: parseInt(e.target.value) || 0 }))}
                  className="text-xs border border-gray-300 rounded px-2 py-1 w-16"
                  title="Sort order"
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {DEFAULT_COLORS.map(c => (
                  <button key={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
                    className={`w-5 h-5 rounded-full border-2 ${draft.color === c ? 'border-blue-500' : 'border-transparent'}`}
                    style={{ background: c }} />
                ))}
              </div>
              <input
                value={draft.description || ''}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                placeholder="Description (optional)"
                className="text-xs border border-gray-300 rounded px-2 py-1 w-full"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDelete}
                  className={`text-xs px-2 py-1 rounded border ${confirmDelete ? 'bg-red-600 text-white border-red-600' : 'text-red-500 border-red-200 hover:bg-red-50'}`}
                >
                  {confirmDelete ? 'Confirm delete?' : 'Delete type'}
                </button>
                <div className="flex-1" />
                <button onClick={() => { setEditingType(false); setDraft({ ...type }); setConfirmDelete(false) }} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                <button onClick={handleSaveType} disabled={saving || !draft.name} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {type.description && <span className="text-xs text-gray-500 flex-1">{type.description}</span>}
              {!type.description && <span className="text-xs text-gray-400 flex-1 italic">No description</span>}
              <button onClick={() => { setEditingType(true); setExpanded(true) }} className="text-xs text-blue-500 hover:text-blue-700">Edit type</button>
            </div>
          )}

          {/* Rules for this type */}
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Rules ({typeRules.length})</div>
            {typeRules.length === 0 && !addingRule && (
              <p className="text-xs text-gray-400 italic">No rules yet — auto-labeling won't fire for this type.</p>
            )}
            <div className="space-y-1">
              {typeRules.map(rule => (
                <ChapterRuleInlineRow
                  key={rule.id}
                  rule={rule}
                  onSave={onSaveRule}
                  onDelete={onDeleteRule}
                />
              ))}
            </div>

            {/* Add rule form */}
            {addingRule ? (
              <div className="mt-2 p-2 rounded border border-indigo-200 bg-indigo-50 space-y-1.5 text-xs">
                <div className="flex gap-2 flex-wrap">
                  <select
                    value={newRule.match_type}
                    onChange={e => setNewRule(d => ({ ...d, match_type: e.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1 flex-shrink-0"
                  >
                    {MATCH_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input
                    value={newRule.pattern}
                    onChange={e => setNewRule(d => ({ ...d, pattern: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddRule()}
                    placeholder="Pattern to match..."
                    className="border border-gray-300 rounded px-2 py-1 flex-1 min-w-[120px] font-mono"
                    autoFocus
                  />
                  <input
                    type="number"
                    value={newRule.priority}
                    onChange={e => setNewRule(d => ({ ...d, priority: parseInt(e.target.value) || 0 }))}
                    className="border border-gray-300 rounded px-2 py-1 w-14"
                    title="Priority"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-gray-600">
                    <input type="checkbox" checked={newRule.enabled} onChange={e => setNewRule(d => ({ ...d, enabled: e.target.checked }))} />
                    Enabled
                  </label>
                  <div className="flex-1" />
                  <button onClick={() => setAddingRule(false)} className="text-gray-500 hover:text-gray-700">Cancel</button>
                  <button onClick={handleAddRule} disabled={addingSaving || !newRule.pattern.trim()} className="bg-indigo-500 text-white px-2 py-1 rounded hover:bg-indigo-600 disabled:opacity-50">
                    {addingSaving ? 'Adding…' : 'Add Rule'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddingRule(true)} className="mt-1.5 text-xs text-indigo-500 hover:text-indigo-700">+ Add Rule</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChapterManagementSection({ onNotification }) {
  const [types, setTypes] = useState([])
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newType, setNewType] = useState({ name: '', description: '', color: '#3b82f6', icon: '', sort_order: 99 })
  const [addingSaving, setAddingSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, r] = await Promise.all([contentAPI.getChapterTypes(), contentAPI.getChapterLabelRules()])
      setTypes(t)
      setRules(r)
    } catch (e) {
      onNotification?.(`Error loading chapter data: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaveType = async (type) => {
    try {
      await contentAPI.updateChapterType(type.id, type.name, type.description || null, type.color, type.icon || null, type.sort_order)
      await load()
      onNotification?.('Chapter type saved', 'success')
    } catch (e) {
      onNotification?.(`Save failed: ${e.message}`, 'error')
      throw e
    }
  }

  const handleDeleteType = async (id) => {
    try {
      await contentAPI.deleteChapterType(id)
      setTypes(t => t.filter(x => x.id !== id))
      setRules(r => r.filter(x => x.chapter_type_id !== id))
      onNotification?.('Chapter type deleted', 'success')
    } catch (e) {
      onNotification?.(`Delete failed: ${e.message}`, 'error')
    }
  }

  const handleAddType = async () => {
    if (!newType.name.trim()) return
    setAddingSaving(true)
    try {
      await contentAPI.createChapterType(newType.name.trim(), newType.description || null, newType.color, newType.icon || null)
      await load()
      setNewType({ name: '', description: '', color: '#3b82f6', icon: '', sort_order: 99 })
      setAdding(false)
      onNotification?.('Chapter type created', 'success')
    } catch (e) {
      onNotification?.(`Create failed: ${e.message}`, 'error')
    } finally {
      setAddingSaving(false)
    }
  }

  const handleSaveRule = async (rule) => {
    try {
      await contentAPI.saveChapterLabelRule(rule.id, rule.chapter_type_id, rule.pattern, rule.match_type, rule.priority, rule.enabled)
      await load()
      onNotification?.('Rule saved', 'success')
    } catch (e) {
      onNotification?.(`Save failed: ${e.message}`, 'error')
      throw e
    }
  }

  const handleDeleteRule = async (id) => {
    try {
      await contentAPI.deleteChapterLabelRule(id)
      setRules(r => r.filter(x => x.id !== id))
      onNotification?.('Rule deleted', 'success')
    } catch (e) {
      onNotification?.(`Delete failed: ${e.message}`, 'error')
    }
  }

  const handleAddRule = async (chapterTypeId, rule) => {
    try {
      await contentAPI.saveChapterLabelRule(null, chapterTypeId, rule.pattern, rule.match_type, rule.priority, rule.enabled)
      await load()
      onNotification?.('Rule added', 'success')
    } catch (e) {
      onNotification?.(`Add failed: ${e.message}`, 'error')
      throw e
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-gray-800 text-sm">Chapter Management</h3>
          <p className="text-xs text-gray-500 mt-0.5">Expand a type to edit it or manage its auto-label rules.</p>
        </div>
        <button onClick={() => setAdding(a => !a)} className="text-xs bg-indigo-500 text-white px-3 py-1.5 rounded hover:bg-indigo-600">+ Add Type</button>
      </div>

      {adding && (
        <div className="p-3 rounded border border-indigo-200 bg-indigo-50 space-y-2 mb-3">
          <div className="flex gap-2 flex-wrap">
            <input value={newType.icon} onChange={e => setNewType(d => ({ ...d, icon: e.target.value }))}
              placeholder="🎬" className="text-sm border border-gray-300 rounded px-2 py-1 w-14 text-center" title="Emoji icon" />
            <input value={newType.name} onChange={e => setNewType(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAddType()}
              placeholder="Chapter type name" className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-[140px]" />
            <input value={newType.color} onChange={e => setNewType(d => ({ ...d, color: e.target.value }))}
              type="color" className="h-8 w-10 rounded border border-gray-300 cursor-pointer p-0.5" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {DEFAULT_COLORS.map(c => (
              <button key={c} onClick={() => setNewType(d => ({ ...d, color: c }))}
                className={`w-5 h-5 rounded-full border-2 ${newType.color === c ? 'border-indigo-500' : 'border-transparent'}`}
                style={{ background: c }} />
            ))}
          </div>
          <input value={newType.description} onChange={e => setNewType(d => ({ ...d, description: e.target.value }))}
            placeholder="Description (optional)" className="text-xs border border-gray-300 rounded px-2 py-1 w-full" />
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={handleAddType} disabled={addingSaving || !newType.name.trim()} className="text-xs bg-indigo-500 text-white px-3 py-1 rounded hover:bg-indigo-600 disabled:opacity-50">
              {addingSaving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading…</p>
      ) : types.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No chapter types. Add one above.</p>
      ) : (
        <div className="space-y-2">
          {types.map(t => (
            <ChapterTypeCard
              key={t.id}
              type={t}
              rules={rules}
              onSaveType={handleSaveType}
              onDeleteType={handleDeleteType}
              onSaveRule={handleSaveRule}
              onDeleteRule={handleDeleteRule}
              onAddRule={handleAddRule}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// (Legacy components below — kept as stubs so no references break, but no longer rendered)
function ChapterTypeRow({ type, onSave, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ ...type })
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!confirming) { setConfirming(true); return }
    onDelete(type.id)
    setConfirming(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded border bg-white border-gray-200">
        <span className="text-base w-6 text-center">{type.icon || '📑'}</span>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full flex-shrink-0" style={{ background: type.color }} />
          <span className="text-xs font-medium text-gray-800">{type.name}</span>
        </div>
        {type.description && <span className="text-xs text-gray-400 flex-1 truncate">{type.description}</span>}
        {!type.description && <div className="flex-1" />}
        <span className="text-xs text-gray-400 flex-shrink-0">#{type.sort_order}</span>
        <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:text-blue-700 flex-shrink-0">Edit</button>
        {confirming
          ? <button onClick={handleDelete} className="text-xs text-red-600 font-medium flex-shrink-0">Confirm?</button>
          : <button onClick={handleDelete} className="text-xs text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
        }
      </div>
    )
  }

  return (
    <div className="p-3 rounded border border-blue-200 bg-blue-50 space-y-2">
      <div className="flex gap-2 flex-wrap">
        <input
          value={draft.icon || ''}
          onChange={e => setDraft(d => ({ ...d, icon: e.target.value }))}
          placeholder="🎬"
          className="text-sm border border-gray-300 rounded px-2 py-1 w-14 text-center"
          title="Emoji icon"
        />
        <input
          value={draft.name}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          placeholder="Chapter name"
          className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-[120px]"
        />
        <input
          value={draft.color}
          onChange={e => setDraft(d => ({ ...d, color: e.target.value }))}
          type="color"
          className="h-8 w-10 rounded border border-gray-300 cursor-pointer p-0.5"
          title="Color"
        />
        <input
          type="number"
          value={draft.sort_order}
          onChange={e => setDraft(d => ({ ...d, sort_order: parseInt(e.target.value) || 0 }))}
          className="text-xs border border-gray-300 rounded px-2 py-1 w-16"
          title="Sort order (lower = first)"
        />
      </div>
      <div className="flex gap-1 flex-wrap">
        {DEFAULT_COLORS.map(c => (
          <button key={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
            className={`w-5 h-5 rounded-full border-2 ${draft.color === c ? 'border-blue-500' : 'border-transparent'}`}
            style={{ background: c }} />
        ))}
      </div>
      <input
        value={draft.description || ''}
        onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
        placeholder="Description (optional)"
        className="text-xs border border-gray-300 rounded px-2 py-1 w-full"
      />
      <div className="flex items-center gap-2 justify-end">
        <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
        <button onClick={handleSave} disabled={saving || !draft.name} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function ChapterTypesSection({ onNotification }) {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newType, setNewType] = useState({ name: '', description: '', color: '#3b82f6', icon: '', sort_order: 99 })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      setTypes(await contentAPI.getChapterTypes())
    } catch (e) {
      onNotification?.(`Error loading chapter types: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (type) => {
    try {
      await contentAPI.updateChapterType(type.id, type.name, type.description || null, type.color, type.icon || null, type.sort_order)
      await load()
      onNotification?.('Chapter type saved', 'success')
    } catch (e) {
      onNotification?.(`Save failed: ${e.message}`, 'error')
      throw e
    }
  }

  const handleDelete = async (id) => {
    try {
      await contentAPI.deleteChapterType(id)
      setTypes(t => t.filter(x => x.id !== id))
      onNotification?.('Chapter type deleted', 'success')
    } catch (e) {
      onNotification?.(`Delete failed: ${e.message}`, 'error')
    }
  }

  const handleAdd = async () => {
    if (!newType.name.trim()) return
    setSaving(true)
    try {
      await contentAPI.createChapterType(newType.name.trim(), newType.description || null, newType.color, newType.icon || null)
      await load()
      setNewType({ name: '', description: '', color: '#3b82f6', icon: '', sort_order: 99 })
      setAdding(false)
      onNotification?.('Chapter type created', 'success')
    } catch (e) {
      onNotification?.(`Create failed: ${e.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-gray-800 text-sm">Chapter Types</h3>
          <p className="text-xs text-gray-500 mt-0.5">Define the kinds of chapters used across episodes (Scoop Mail, Jock vs Nerd, etc.)</p>
        </div>
        <button onClick={() => setAdding(a => !a)} className="text-xs bg-indigo-500 text-white px-3 py-1.5 rounded hover:bg-indigo-600">+ Add Type</button>
      </div>

      {adding && (
        <div className="p-3 rounded border border-indigo-200 bg-indigo-50 space-y-2 mb-3">
          <div className="flex gap-2 flex-wrap">
            <input value={newType.icon} onChange={e => setNewType(d => ({ ...d, icon: e.target.value }))}
              placeholder="🎬" className="text-sm border border-gray-300 rounded px-2 py-1 w-14 text-center" title="Emoji icon" />
            <input value={newType.name} onChange={e => setNewType(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Chapter type name" className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-[140px]" />
            <input value={newType.color} onChange={e => setNewType(d => ({ ...d, color: e.target.value }))}
              type="color" className="h-8 w-10 rounded border border-gray-300 cursor-pointer p-0.5" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {DEFAULT_COLORS.map(c => (
              <button key={c} onClick={() => setNewType(d => ({ ...d, color: c }))}
                className={`w-5 h-5 rounded-full border-2 ${newType.color === c ? 'border-indigo-500' : 'border-transparent'}`}
                style={{ background: c }} />
            ))}
          </div>
          <input value={newType.description} onChange={e => setNewType(d => ({ ...d, description: e.target.value }))}
            placeholder="Description (optional)" className="text-xs border border-gray-300 rounded px-2 py-1 w-full" />
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            <button onClick={handleAdd} disabled={saving || !newType.name.trim()} className="text-xs bg-indigo-500 text-white px-3 py-1 rounded hover:bg-indigo-600 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 py-2">Loading…</p>
      ) : types.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No chapter types. Add one above.</p>
      ) : (
        <div className="space-y-1.5">
          {types.map(t => <ChapterTypeRow key={t.id} type={t} onSave={handleSave} onDelete={handleDelete} />)}
        </div>
      )}
    </div>
  )
}

// Chapter Label Rules Section (legacy — no longer rendered)
// ============================================================================

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

// ============================================================================
// Corrections Review Section (Scoop Polish — cross-episode bulk review)
// ============================================================================

function CorrectionRow({ correction, onApprove, onReject }) {
  const hasDiff = correction.original_text !== correction.corrected_text
  const conf = correction.confidence != null ? Math.round(correction.confidence * 100) : null

  return (
    <div className="text-xs border border-gray-100 rounded p-2 space-y-1 bg-white">
      <div className="flex items-start gap-2">
        {correction.has_multiple_speakers && (
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">multi-spkr</span>
        )}
        {conf != null && (
          <span className={`flex-shrink-0 px-1.5 py-0.5 rounded font-medium ${conf >= 90 ? 'bg-green-100 text-green-700' : conf >= 70 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
            {conf}%
          </span>
        )}
        <span className="text-gray-400 flex-shrink-0">#{correction.segment_idx}</span>
        {correction.speaker_change_note && (
          <span className="text-purple-600 italic flex-1 truncate">{correction.speaker_change_note}</span>
        )}
        <div className="flex gap-1 ml-auto flex-shrink-0">
          <button onClick={() => onApprove(correction.id)} className="px-2 py-0.5 rounded bg-green-500 text-white hover:bg-green-600 text-xs">✓</button>
          <button onClick={() => onReject(correction.id)} className="px-2 py-0.5 rounded bg-red-400 text-white hover:bg-red-500 text-xs">✗</button>
        </div>
      </div>
      {hasDiff && (
        <div className="space-y-0.5 pl-2 border-l-2 border-gray-200">
          <div className="text-red-600 line-through opacity-70 break-words">{correction.original_text}</div>
          <div className="text-green-700 break-words">{correction.corrected_text}</div>
        </div>
      )}
      {!hasDiff && correction.has_multiple_speakers && (
        <div className="pl-2 border-l-2 border-amber-200 text-gray-500 break-words">{correction.original_text}</div>
      )}
    </div>
  )
}

function EpisodeCorrectionsGroup({ episodeId, episodeTitle, episodeNumber, corrections, onApproveAll, onRejectAll, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false)
  const multiCount = corrections.filter(c => c.has_multiple_speakers).length

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer select-none" onClick={() => setExpanded(e => !e)}>
        <span className="text-gray-400 text-xs w-3">{expanded ? '▼' : '▶'}</span>
        <span className="text-xs font-medium text-gray-700 flex-1">
          Ep {episodeNumber || episodeId} — {episodeTitle || 'Untitled'}
        </span>
        <span className="text-xs text-gray-500">{corrections.length} correction{corrections.length !== 1 ? 's' : ''}</span>
        {multiCount > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{multiCount} multi-spkr</span>}
        <button onClick={e => { e.stopPropagation(); onApproveAll(episodeId) }}
          className="text-xs px-2 py-0.5 rounded bg-green-500 text-white hover:bg-green-600 ml-1">✓ All</button>
        <button onClick={e => { e.stopPropagation(); onRejectAll(episodeId) }}
          className="text-xs px-2 py-0.5 rounded bg-gray-300 text-gray-700 hover:bg-gray-400">✗ All</button>
      </div>
      {expanded && (
        <div className="p-2 space-y-1.5 bg-gray-50">
          {corrections.map(c => (
            <CorrectionRow key={c.id} correction={c} onApprove={onApprove} onReject={onReject} />
          ))}
        </div>
      )}
    </div>
  )
}

function CorrectionsReviewSection({ onNotification }) {
  const [corrections, setCorrections] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all') // all | multi_speaker | text_only

  const load = async () => {
    setLoading(true)
    try {
      setCorrections(await contentAPI.getAllPendingCorrections())
    } catch (e) {
      onNotification?.(`Error loading corrections: ${e.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Group by episode
  const byEpisode = corrections
    .filter(c => filter === 'all' || (filter === 'multi_speaker' ? c.has_multiple_speakers : !c.has_multiple_speakers))
    .reduce((acc, c) => {
      if (!acc[c.episode_id]) acc[c.episode_id] = { episodeId: c.episode_id, episodeTitle: c.episode_title, episodeNumber: c.episode_number, corrections: [] }
      acc[c.episode_id].corrections.push(c)
      return acc
    }, {})
  const groups = Object.values(byEpisode)

  const handleApprove = async (id) => {
    try {
      await contentAPI.approveTranscriptCorrection(id)
      setCorrections(cs => cs.filter(c => c.id !== id))
    } catch (e) {
      onNotification?.(`Failed: ${e.message}`, 'error')
    }
  }

  const handleReject = async (id) => {
    try {
      await contentAPI.rejectTranscriptCorrection(id)
      setCorrections(cs => cs.filter(c => c.id !== id))
    } catch (e) {
      onNotification?.(`Failed: ${e.message}`, 'error')
    }
  }

  const handleApproveAll = async (episodeId) => {
    try {
      const count = await contentAPI.approveAllCorrectionsForEpisode(episodeId)
      setCorrections(cs => cs.filter(c => c.episode_id !== episodeId))
      onNotification?.(`Approved ${count} corrections`, 'success')
    } catch (e) {
      onNotification?.(`Failed: ${e.message}`, 'error')
    }
  }

  const handleRejectAll = async (episodeId) => {
    try {
      const count = await contentAPI.rejectAllCorrectionsForEpisode(episodeId)
      setCorrections(cs => cs.filter(c => c.episode_id !== episodeId))
      onNotification?.(`Rejected ${count} corrections`, 'success')
    } catch (e) {
      onNotification?.(`Failed: ${e.message}`, 'error')
    }
  }

  const multiCount = corrections.filter(c => c.has_multiple_speakers).length

  return (
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-gray-800 text-sm">Scoop Polish Corrections</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Review AI-suggested transcript corrections across all episodes.
            {corrections.length > 0 && ` ${corrections.length} pending${multiCount > 0 ? `, ${multiCount} with multi-speaker notes` : ''}.`}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="text-xs bg-indigo-500 text-white px-3 py-1.5 rounded hover:bg-indigo-600 disabled:opacity-50">
          {loading ? 'Loading…' : corrections.length === 0 ? 'Load' : 'Refresh'}
        </button>
      </div>

      {corrections.length > 0 && (
        <div className="flex gap-2 mb-3">
          {['all', 'multi_speaker', 'text_only'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border ${filter === f ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
              {f === 'all' ? `All (${corrections.length})` : f === 'multi_speaker' ? `Multi-speaker (${multiCount})` : `Text only (${corrections.length - multiCount})`}
            </button>
          ))}
        </div>
      )}

      {!loading && corrections.length === 0 && (
        <p className="text-xs text-gray-400 py-2">Click Load to fetch pending corrections.</p>
      )}

      {groups.length > 0 && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {groups.map(g => (
            <EpisodeCorrectionsGroup key={g.episodeId}
              {...g}
              onApproveAll={handleApproveAll}
              onRejectAll={handleRejectAll}
              onApprove={handleApprove}
              onReject={handleReject}
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
  const [embeddingModel, setEmbeddingModel] = useState('pyannote')

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
      const [data, model] = await Promise.all([
        settingsAPI.getAllSettings(),
        speakersAPI.getEmbeddingModel(),
      ])
      setSettings(data || {})
      setEmbeddingModel(model || 'pyannote')
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

  const togglePauseTranscribeQueue = () => {
    const currentValue = settings.pause_transcribe_queue === 'true'
    updateSetting('pause_transcribe_queue', (!currentValue).toString())
  }

  const togglePauseDiarizeQueue = () => {
    const currentValue = settings.pause_diarize_queue === 'true'
    updateSetting('pause_diarize_queue', (!currentValue).toString())
  }

  const togglePauseTranscribeDuringPriorityReprocess = () => {
    const currentValue = settings.priority_reprocess_pause_transcribe === 'true'
    updateSetting('priority_reprocess_pause_transcribe', (!currentValue).toString())
  }

  const updateEmbeddingModel = async (nextModel) => {
    if (!nextModel || nextModel === embeddingModel) return
    setSavingKey('embedding_model')
    try {
      await speakersAPI.setEmbeddingModel(nextModel)
      setEmbeddingModel(nextModel)
      setSettings(prev => ({ ...prev, embedding_model: nextModel }))
      onNotification?.(
        'Embedding backend updated. Recalibrate All in Audio ID to rebuild voice prints for this backend.',
        'success'
      )
    } catch (error) {
      onNotification?.(`Error updating embedding backend: ${error.message}`, 'error')
    } finally {
      setSavingKey(null)
    }
  }


  const isAutoTranscribeEnabled = settings.auto_transcribe === 'true'
  const isDiarizationEnabled = settings.enable_diarization === 'true'
  const isTranscribeQueuePaused = settings.pause_transcribe_queue === 'true'
  const isDiarizeQueuePaused = settings.pause_diarize_queue === 'true'
  const isPriorityReprocessPauseEnabled = settings.priority_reprocess_pause_transcribe === 'true'
  const isHfHubOfflineEnabled = settings.hf_hub_offline === 'true'

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

            {/* Transcription Queue Pause Toggle */}
            <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-indigo-800">Pause Transcription Queue</h3>
                  <p className="text-sm text-indigo-600 mt-1">
                    Pause new transcription jobs. In-flight work continues; queued items remain pending.
                  </p>
                </div>
                <button
                  onClick={togglePauseTranscribeQueue}
                  disabled={savingKey === 'pause_transcribe_queue'}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isTranscribeQueuePaused ? 'bg-indigo-500' : 'bg-gray-300'
                  } ${savingKey === 'pause_transcribe_queue' ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      isTranscribeQueuePaused ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  isTranscribeQueuePaused
                    ? 'bg-indigo-200 text-indigo-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {isTranscribeQueuePaused ? 'PAUSED' : 'RUNNING'}
                </span>
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

            {/* Diarization Queue Pause Toggle */}
            <div className="p-4 bg-fuchsia-50 rounded-lg border border-fuchsia-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-fuchsia-800">Pause Diarization Queue</h3>
                  <p className="text-sm text-fuchsia-600 mt-1">
                    Pause new diarization jobs. Transcription can continue and wait for diarization later.
                  </p>
                </div>
                <button
                  onClick={togglePauseDiarizeQueue}
                  disabled={savingKey === 'pause_diarize_queue'}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isDiarizeQueuePaused ? 'bg-fuchsia-500' : 'bg-gray-300'
                  } ${savingKey === 'pause_diarize_queue' ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      isDiarizeQueuePaused ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  isDiarizeQueuePaused
                    ? 'bg-fuchsia-200 text-fuchsia-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {isDiarizeQueuePaused ? 'PAUSED' : 'RUNNING'}
                </span>
              </div>
            </div>

            {/* Priority Reprocess Resource Policy */}
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-amber-800">Pause Transcribe During Priority Reprocess</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    If ON, a top-priority re-diarization temporarily blocks new transcription starts.
                    If OFF, transcription and diarization continue concurrently.
                  </p>
                </div>
                <button
                  onClick={togglePauseTranscribeDuringPriorityReprocess}
                  disabled={savingKey === 'priority_reprocess_pause_transcribe'}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isPriorityReprocessPauseEnabled ? 'bg-amber-500' : 'bg-gray-300'
                  } ${savingKey === 'priority_reprocess_pause_transcribe' ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      isPriorityReprocessPauseEnabled ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  isPriorityReprocessPauseEnabled
                    ? 'bg-amber-200 text-amber-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {isPriorityReprocessPauseEnabled ? 'PAUSE ON REPROCESS' : 'CONCURRENT PIPELINE'}
                </span>
              </div>
            </div>

            {/* Voice Embedding Backend */}
            <div className="p-4 bg-violet-50 rounded-lg border border-violet-200">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="font-medium text-violet-800">Voice Embedding Backend</h3>
                  <p className="text-sm text-violet-600 mt-1">
                    Select the model used for speaker voice prints and diarization speaker-ID matching.
                  </p>
                </div>
                <select
                  value={embeddingModel}
                  onChange={(e) => updateEmbeddingModel(e.target.value)}
                  disabled={savingKey === 'embedding_model'}
                  className="px-3 py-2 border border-violet-300 rounded-lg bg-white text-sm"
                >
                  <option value="ecapa-tdnn">ECAPA-TDNN</option>
                  <option value="pyannote">pyannote/embedding</option>
                </select>
              </div>
              <p className="text-xs text-violet-500 mt-2">
                Switching backend does not retrain existing prints automatically. Use Recalibrate All in Audio ID after switching.
              </p>
            </div>

            {/* Hugging Face Offline Mode */}
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-slate-800">Hugging Face Offline Mode</h3>
                  <p className="text-sm text-slate-600 mt-1">
                    Force Compare/Rebuild voice-print jobs to use cached models only.
                    Enable this after models are downloaded to avoid network/DNS failures.
                  </p>
                </div>
                <button
                  onClick={() => updateSetting('hf_hub_offline', (!isHfHubOfflineEnabled).toString())}
                  disabled={savingKey === 'hf_hub_offline'}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                    isHfHubOfflineEnabled ? 'bg-slate-600' : 'bg-gray-300'
                  } ${savingKey === 'hf_hub_offline' ? 'opacity-50' : ''}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${
                      isHfHubOfflineEnabled ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  isHfHubOfflineEnabled
                    ? 'bg-slate-200 text-slate-800'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {isHfHubOfflineEnabled ? 'CACHE ONLY' : 'NETWORK ALLOWED'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                If cache is missing, compare/rebuild will fail fast instead of retrying Hugging Face endpoints.
              </p>
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

            {/* Chapter Management (types + rules, merged) */}
            <ChapterManagementSection onNotification={onNotification} />

            {/* Scoop Polish Corrections Bulk Review */}
            <CorrectionsReviewSection onNotification={onNotification} />

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
