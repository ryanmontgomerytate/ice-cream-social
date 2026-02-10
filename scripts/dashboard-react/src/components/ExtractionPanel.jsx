import { useState, useEffect, useCallback } from 'react'
import { extractionAPI, episodesAPI } from '../services/api'

export default function ExtractionPanel({ onNotification }) {
  const [ollamaStatus, setOllamaStatus] = useState(null)
  const [prompts, setPrompts] = useState([])
  const [selectedPrompt, setSelectedPrompt] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [episodes, setEpisodes] = useState([])
  const [selectedEpisode, setSelectedEpisode] = useState(null)
  const [extractionResult, setExtractionResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const [sampleText, setSampleText] = useState('')

  // Form state for editing prompts
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content_type: 'custom',
    prompt_text: '',
    system_prompt: '',
    output_schema: '',
    is_active: true,
  })

  useEffect(() => {
    loadOllamaStatus()
    loadPrompts()
    loadEpisodes()
  }, [])

  const loadOllamaStatus = async () => {
    try {
      const status = await extractionAPI.getOllamaStatus()
      setOllamaStatus(status)
    } catch (error) {
      console.error('Failed to get Ollama status:', error)
    }
  }

  const loadPrompts = async () => {
    try {
      const data = await extractionAPI.getPrompts()
      setPrompts(data)
    } catch (error) {
      console.error('Failed to load prompts:', error)
    }
  }

  const loadEpisodes = async () => {
    try {
      const response = await episodesAPI.getEpisodes({
        feed_source: 'patreon',
        transcribed_only: true,
        limit: 100,
        sort_by: 'published_date',
        sort_desc: true,
      })
      setEpisodes(response.episodes || [])
    } catch (error) {
      console.error('Failed to load episodes:', error)
    }
  }

  const handleSelectPrompt = (prompt) => {
    setSelectedPrompt(prompt)
    setFormData({
      name: prompt.name,
      description: prompt.description || '',
      content_type: prompt.content_type,
      prompt_text: prompt.prompt_text,
      system_prompt: prompt.system_prompt || '',
      output_schema: prompt.output_schema || '',
      is_active: prompt.is_active,
    })
    setIsEditing(false)
    setExtractionResult(null)
  }

  const handleNewPrompt = () => {
    setSelectedPrompt(null)
    setFormData({
      name: '',
      description: '',
      content_type: 'custom',
      prompt_text: '',
      system_prompt: 'You are a content extraction assistant. Analyze podcast transcripts and extract structured information. Always respond with valid JSON.',
      output_schema: '',
      is_active: true,
    })
    setIsEditing(true)
    setExtractionResult(null)
  }

  const handleSavePrompt = async () => {
    setLoading(true)
    try {
      if (selectedPrompt) {
        await extractionAPI.updatePrompt(
          selectedPrompt.id,
          formData.name,
          formData.description || null,
          formData.content_type,
          formData.prompt_text,
          formData.system_prompt || null,
          formData.output_schema || null,
          formData.is_active
        )
        onNotification?.('Prompt updated', 'success')
      } else {
        await extractionAPI.createPrompt(
          formData.name,
          formData.description || null,
          formData.content_type,
          formData.prompt_text,
          formData.system_prompt || null,
          formData.output_schema || null
        )
        onNotification?.('Prompt created', 'success')
      }
      await loadPrompts()
      setIsEditing(false)
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Unknown error'
      onNotification?.(`Failed to save prompt: ${msg}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePrompt = async () => {
    if (!selectedPrompt) return
    if (!confirm(`Delete prompt "${selectedPrompt.name}"?`)) return

    setLoading(true)
    try {
      await extractionAPI.deletePrompt(selectedPrompt.id)
      onNotification?.('Prompt deleted', 'success')
      setSelectedPrompt(null)
      await loadPrompts()
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Unknown error'
      onNotification?.(`Failed to delete prompt: ${msg}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRunExtraction = async () => {
    if (!selectedPrompt || !selectedEpisode) {
      onNotification?.('Select a prompt and episode first', 'warning')
      return
    }

    setLoading(true)
    setExtractionResult(null)
    try {
      const result = await extractionAPI.runExtraction(selectedPrompt.id, selectedEpisode.id)
      setExtractionResult(result)
      if (result.status === 'completed') {
        onNotification?.(`Extracted ${result.items_extracted} items in ${(result.duration_ms / 1000).toFixed(1)}s`, 'success')
      } else {
        onNotification?.(`Extraction failed: ${result.error}`, 'error')
      }
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Unknown error'
      onNotification?.(`Extraction failed: ${msg}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleTestPrompt = async () => {
    if (!formData.prompt_text || !sampleText) {
      onNotification?.('Enter prompt text and sample text', 'warning')
      return
    }

    setLoading(true)
    setExtractionResult(null)
    try {
      const result = await extractionAPI.testPrompt(
        formData.prompt_text,
        formData.system_prompt || null,
        sampleText
      )
      setExtractionResult(result)
      if (result.status === 'completed') {
        onNotification?.(`Test completed in ${(result.duration_ms / 1000).toFixed(1)}s`, 'success')
      } else {
        onNotification?.(`Test failed: ${result.error}`, 'error')
      }
    } catch (error) {
      const msg = typeof error === 'string' ? error : error?.message || 'Unknown error'
      onNotification?.(`Test failed: ${msg}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const contentTypes = [
    { value: 'character', label: 'Character Detection' },
    { value: 'trivia', label: 'Trivia Scores' },
    { value: 'guest', label: 'Guest Detection' },
    { value: 'segment', label: 'Segment Detection' },
    { value: 'custom', label: 'Custom' },
  ]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header with Ollama Status */}
      <div className="bg-gradient-to-r from-purple-500 to-indigo-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">LLM Content Extraction</h2>
            <p className="text-purple-100 text-sm">
              Create and run extraction prompts with local Ollama
            </p>
          </div>
          <div className="text-right">
            {ollamaStatus ? (
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                ollamaStatus.running && ollamaStatus.model_available
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
              }`}>
                {ollamaStatus.running && ollamaStatus.model_available
                  ? `Ollama: ${ollamaStatus.model}`
                  : ollamaStatus.error || 'Ollama not running'}
              </div>
            ) : (
              <div className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-600">
                Checking Ollama...
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-3 gap-6">
          {/* Left: Prompt List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Extraction Prompts</h3>
              <button
                onClick={handleNewPrompt}
                className="px-3 py-1 bg-purple-500 hover:bg-purple-600 text-white rounded text-sm"
              >
                + New
              </button>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {prompts.map((prompt) => (
                <div
                  key={prompt.id}
                  onClick={() => handleSelectPrompt(prompt)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedPrompt?.id === prompt.id
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{prompt.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      prompt.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {prompt.content_type}
                    </span>
                  </div>
                  {prompt.description && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">{prompt.description}</p>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {prompt.run_count} runs
                  </div>
                </div>
              ))}
              {prompts.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No prompts yet</p>
              )}
            </div>
          </div>

          {/* Middle: Prompt Editor */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {isEditing ? (selectedPrompt ? 'Edit Prompt' : 'New Prompt') : 'Prompt Details'}
              </h3>
              {selectedPrompt && !isEditing && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={handleDeletePrompt}
                    className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {(selectedPrompt || isEditing) ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    disabled={!isEditing}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                    placeholder="Character Detection"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={formData.content_type}
                    onChange={(e) => setFormData({ ...formData, content_type: e.target.value })}
                    disabled={!isEditing}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                  >
                    {contentTypes.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    disabled={!isEditing}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                    placeholder="What this prompt extracts..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Extraction Prompt
                  </label>
                  <textarea
                    value={formData.prompt_text}
                    onChange={(e) => setFormData({ ...formData, prompt_text: e.target.value })}
                    disabled={!isEditing}
                    rows={6}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm disabled:bg-gray-50"
                    placeholder="Analyze this transcript and find..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    System Prompt (optional)
                  </label>
                  <textarea
                    value={formData.system_prompt}
                    onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                    disabled={!isEditing}
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm disabled:bg-gray-50"
                    placeholder="You are a content extraction assistant..."
                  />
                </div>

                {isEditing && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleSavePrompt}
                      disabled={loading || !formData.name || !formData.prompt_text}
                      className="flex-1 px-4 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 text-white rounded-lg font-medium"
                    >
                      {loading ? 'Saving...' : 'Save Prompt'}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false)
                        if (!selectedPrompt) setFormData({ name: '', description: '', content_type: 'custom', prompt_text: '', system_prompt: '', output_schema: '', is_active: true })
                      }}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-400 text-center py-8">
                Select a prompt or create a new one
              </div>
            )}
          </div>

          {/* Right: Run Extraction */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Run Extraction</h3>

            {/* Mode Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setTestMode(false)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${
                  !testMode ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                Run on Episode
              </button>
              <button
                onClick={() => setTestMode(true)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium ${
                  testMode ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                Test Mode
              </button>
            </div>

            {!testMode ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Episode
                  </label>
                  <select
                    value={selectedEpisode?.id || ''}
                    onChange={(e) => {
                      const ep = episodes.find(ep => ep.id === parseInt(e.target.value))
                      setSelectedEpisode(ep)
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Choose an episode...</option>
                    {episodes.map((ep) => (
                      <option key={ep.id} value={ep.id}>
                        {ep.episode_number ? `#${ep.episode_number}: ` : ''}{ep.title}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleRunExtraction}
                  disabled={loading || !selectedPrompt || !selectedEpisode || !ollamaStatus?.running}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-lg font-medium"
                >
                  {loading ? 'Running...' : 'Run Extraction'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sample Text
                  </label>
                  <textarea
                    value={sampleText}
                    onChange={(e) => setSampleText(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
                    placeholder="Paste sample transcript text here to test your prompt..."
                  />
                </div>

                <button
                  onClick={handleTestPrompt}
                  disabled={loading || !formData.prompt_text || !sampleText || !ollamaStatus?.running}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-lg font-medium"
                >
                  {loading ? 'Testing...' : 'Test Prompt'}
                </button>
              </>
            )}

            {/* Results */}
            {extractionResult && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium ${
                    extractionResult.status === 'completed' ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {extractionResult.status === 'completed' ? 'Success' : 'Failed'}
                  </span>
                  <span className="text-sm text-gray-500">
                    {(extractionResult.duration_ms / 1000).toFixed(1)}s
                  </span>
                </div>

                {extractionResult.error && (
                  <div className="text-red-600 text-sm mb-2">{extractionResult.error}</div>
                )}

                {extractionResult.parsed_json && (
                  <div className="bg-white p-3 rounded border overflow-auto max-h-64">
                    <pre className="text-xs text-gray-700">
                      {JSON.stringify(extractionResult.parsed_json, null, 2)}
                    </pre>
                  </div>
                )}

                {!extractionResult.parsed_json && extractionResult.raw_response && (
                  <div className="bg-white p-3 rounded border overflow-auto max-h-64">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                      {extractionResult.raw_response}
                    </pre>
                  </div>
                )}

                {extractionResult.items_extracted > 0 && (
                  <div className="text-sm text-gray-600 mt-2">
                    Extracted {extractionResult.items_extracted} item(s)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
