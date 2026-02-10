import { useState, useEffect } from 'react'
import { contentAPI, episodesAPI } from '../services/api'

export default function CharactersPanel({ onNotification }) {
  const [characters, setCharacters] = useState([])
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingCharacter, setEditingCharacter] = useState(null)
  const [formData, setFormData] = useState({ name: '', shortName: '', description: '', catchphrase: '' })

  // Quick Add state
  const [quickAdd, setQuickAdd] = useState({ characterName: '', episodeId: '', timestamp: '' })
  const [addingAppearance, setAddingAppearance] = useState(false)

  useEffect(() => {
    loadData()
    loadEpisodes()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await contentAPI.getCharacters()
      setCharacters(data)
    } catch (error) {
      console.error('Error loading characters:', error)
      onNotification?.('Error loading characters', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadEpisodes = async () => {
    try {
      const response = await episodesAPI.getEpisodes({
        feed_source: 'patreon',
        limit: 500,
        sort_by: 'episode_number',
        sort_desc: true,
      })
      setEpisodes(response.episodes || [])
    } catch (error) {
      console.error('Error loading episodes:', error)
    }
  }

  // Quick Add: Add character appearance (creates character if new)
  const handleQuickAdd = async () => {
    if (!quickAdd.characterName.trim()) {
      onNotification?.('Enter a character name', 'warning')
      return
    }
    if (!quickAdd.episodeId) {
      onNotification?.('Select an episode', 'warning')
      return
    }

    setAddingAppearance(true)
    try {
      // Check if character exists
      let character = characters.find(
        c => c.name.toLowerCase() === quickAdd.characterName.trim().toLowerCase()
      )

      // Create character if it doesn't exist
      if (!character) {
        const newId = await contentAPI.createCharacter(
          quickAdd.characterName.trim(),
          null, null, null
        )
        // Reload to get the new character
        const updatedChars = await contentAPI.getCharacters()
        setCharacters(updatedChars)
        character = updatedChars.find(c => c.id === newId)
        onNotification?.(`Created new character: ${quickAdd.characterName}`, 'info')
      }

      // Parse timestamp if provided (format: MM:SS or HH:MM:SS)
      let startTime = null
      if (quickAdd.timestamp.trim()) {
        const parts = quickAdd.timestamp.split(':').map(Number)
        if (parts.length === 2) {
          startTime = parts[0] * 60 + parts[1]
        } else if (parts.length === 3) {
          startTime = parts[0] * 3600 + parts[1] * 60 + parts[2]
        }
      }

      // Add appearance
      await contentAPI.addCharacterAppearance(
        character.id,
        parseInt(quickAdd.episodeId),
        startTime,
        null,
        null
      )

      const episode = episodes.find(e => e.id === parseInt(quickAdd.episodeId))
      onNotification?.(`Added ${character.name} to episode ${episode?.episode_number || quickAdd.episodeId}`, 'success')

      // Reset form and reload
      setQuickAdd({ characterName: '', episodeId: '', timestamp: '' })
      loadData()
    } catch (error) {
      onNotification?.(`Error: ${error.message}`, 'error')
    } finally {
      setAddingAppearance(false)
    }
  }

  const handleAddCharacter = async () => {
    if (!formData.name.trim()) {
      onNotification?.('Name is required', 'error')
      return
    }
    try {
      await contentAPI.createCharacter(
        formData.name.trim(),
        formData.shortName.trim() || null,
        formData.description.trim() || null,
        formData.catchphrase.trim() || null
      )
      onNotification?.(`Character "${formData.name}" added`, 'success')
      setFormData({ name: '', shortName: '', description: '', catchphrase: '' })
      setShowAddForm(false)
      loadData()
    } catch (error) {
      onNotification?.(`Error adding character: ${error.message}`, 'error')
    }
  }

  const handleUpdateCharacter = async () => {
    if (!editingCharacter || !formData.name.trim()) return
    try {
      await contentAPI.updateCharacter(
        editingCharacter.id,
        formData.name.trim(),
        formData.shortName.trim() || null,
        formData.description.trim() || null,
        formData.catchphrase.trim() || null
      )
      onNotification?.(`Character "${formData.name}" updated`, 'success')
      setEditingCharacter(null)
      setFormData({ name: '', shortName: '', description: '', catchphrase: '' })
      loadData()
    } catch (error) {
      onNotification?.(`Error updating character: ${error.message}`, 'error')
    }
  }

  const handleDeleteCharacter = async (character) => {
    if (!confirm(`Delete character "${character.name}"?`)) return
    try {
      await contentAPI.deleteCharacter(character.id)
      onNotification?.(`Character "${character.name}" deleted`, 'success')
      loadData()
    } catch (error) {
      onNotification?.(`Error deleting character: ${error.message}`, 'error')
    }
  }

  const startEditing = (character) => {
    setEditingCharacter(character)
    setFormData({
      name: character.name,
      shortName: character.short_name || '',
      description: character.description || '',
      catchphrase: character.catchphrase || '',
    })
    setShowAddForm(false)
  }

  const cancelEditing = () => {
    setEditingCharacter(null)
    setFormData({ name: '', shortName: '', description: '', catchphrase: '' })
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-pink-500 to-pink-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">ICS Characters</h2>
            <p className="text-pink-100 text-sm">Recurring characters from bits & commercials</p>
          </div>
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingCharacter(null)
              setFormData({ name: '', shortName: '', description: '', catchphrase: '' })
            }}
            className="px-3 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium text-sm transition-colors"
          >
            + Add Character
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Quick Add Appearance - The simple way! */}
        <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
          <h3 className="font-medium text-green-800 mb-3 flex items-center gap-2">
            <span className="text-lg">⚡</span> Quick Add Character Appearance
          </h3>
          <p className="text-sm text-green-700 mb-3">
            Know a character appears in an episode? Add it here. Creates the character if it's new.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Character Name</label>
              <input
                type="text"
                value={quickAdd.characterName}
                onChange={(e) => setQuickAdd({ ...quickAdd, characterName: e.target.value })}
                placeholder="e.g., Count Absorbo"
                list="character-suggestions"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <datalist id="character-suggestions">
                {characters.map(c => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Episode</label>
              <select
                value={quickAdd.episodeId}
                onChange={(e) => setQuickAdd({ ...quickAdd, episodeId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select episode...</option>
                {episodes.map(ep => (
                  <option key={ep.id} value={ep.id}>
                    {ep.episode_number ? `#${ep.episode_number}` : ''} {ep.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">Timestamp</label>
              <input
                type="text"
                value={quickAdd.timestamp}
                onChange={(e) => setQuickAdd({ ...quickAdd, timestamp: e.target.value })}
                placeholder="MM:SS"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <button
              onClick={handleQuickAdd}
              disabled={addingAppearance}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white rounded-lg font-medium transition-colors"
            >
              {addingAppearance ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>

        {/* Add/Edit Form (detailed) */}
        {(showAddForm || editingCharacter) && (
          <div className="mb-6 p-4 bg-pink-50 rounded-lg border border-pink-200">
            <h3 className="font-medium text-pink-800 mb-3">
              {editingCharacter ? 'Edit Character' : 'Add New Character (with details)'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Sweet Bean"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Short Name</label>
                <input
                  type="text"
                  value={formData.shortName}
                  onChange={(e) => setFormData({ ...formData, shortName: e.target.value })}
                  placeholder="e.g., Bean"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catchphrase</label>
                <input
                  type="text"
                  value={formData.catchphrase}
                  onChange={(e) => setFormData({ ...formData, catchphrase: e.target.value })}
                  placeholder="e.g., It's me, Sweet Bean!"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., Matt's lovable character"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={editingCharacter ? handleUpdateCharacter : handleAddCharacter}
                className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                {editingCharacter ? 'Update' : 'Add Character'}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false)
                  cancelEditing()
                }}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Characters List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-pink-200 border-t-pink-500 rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-gray-500">Loading characters...</div>
          </div>
        ) : characters.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No characters yet. Use Quick Add above to add characters!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {characters.map((character) => (
              <div
                key={character.id}
                className="p-4 rounded-lg border bg-gradient-to-br from-pink-50 to-purple-50 border-pink-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-pink-500 text-white flex items-center justify-center font-bold text-lg">
                      {(character.short_name || character.name).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800">{character.name}</h3>
                      {character.short_name && (
                        <span className="text-xs text-gray-500">({character.short_name})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEditing(character)}
                      className="p-1 text-pink-600 hover:bg-pink-100 rounded transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteCharacter(character)}
                      className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </button>
                  </div>
                </div>
                {character.catchphrase && (
                  <p className="text-sm text-pink-600 italic mb-2">"{character.catchphrase}"</p>
                )}
                {character.description && (
                  <p className="text-sm text-gray-600 mb-2">{character.description}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                  <span className="font-medium text-pink-600">{character.appearance_count || 0} appearances</span>
                  {character.first_episode_title && (
                    <span className="truncate">First: {character.first_episode_title}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
