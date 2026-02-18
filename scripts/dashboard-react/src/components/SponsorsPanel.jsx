import { useState, useEffect } from 'react'
import { contentAPI } from '../services/api'
import { useConfirm } from '../hooks/useConfirm'

export default function SponsorsPanel({ onNotification }) {
  const confirm = useConfirm()
  const [sponsors, setSponsors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingSponsor, setEditingSponsor] = useState(null)
  const [formData, setFormData] = useState({ name: '', tagline: '', description: '', isReal: false })
  const [filter, setFilter] = useState('all') // 'all', 'fake', 'real'

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await contentAPI.getSponsors()
      setSponsors(data)
    } catch (error) {
      console.error('Error loading sponsors:', error)
      onNotification?.('Error loading sponsors', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleAddSponsor = async () => {
    if (!formData.name.trim()) {
      onNotification?.('Name is required', 'error')
      return
    }
    try {
      await contentAPI.createSponsor(
        formData.name.trim(),
        formData.tagline.trim() || null,
        formData.description.trim() || null,
        formData.isReal
      )
      onNotification?.(`Sponsor "${formData.name}" added`, 'success')
      setFormData({ name: '', tagline: '', description: '', isReal: false })
      setShowAddForm(false)
      loadData()
    } catch (error) {
      onNotification?.(`Error adding sponsor: ${error.message}`, 'error')
    }
  }

  const handleUpdateSponsor = async () => {
    if (!editingSponsor || !formData.name.trim()) return
    try {
      await contentAPI.updateSponsor(
        editingSponsor.id,
        formData.name.trim(),
        formData.tagline.trim() || null,
        formData.description.trim() || null,
        formData.isReal
      )
      onNotification?.(`Sponsor "${formData.name}" updated`, 'success')
      setEditingSponsor(null)
      setFormData({ name: '', tagline: '', description: '', isReal: false })
      loadData()
    } catch (error) {
      onNotification?.(`Error updating sponsor: ${error.message}`, 'error')
    }
  }

  const handleDeleteSponsor = async (sponsor) => {
    if (!await confirm(`Delete sponsor "${sponsor.name}"?`)) return
    try {
      await contentAPI.deleteSponsor(sponsor.id)
      onNotification?.(`Sponsor "${sponsor.name}" deleted`, 'success')
      loadData()
    } catch (error) {
      onNotification?.(`Error deleting sponsor: ${error.message}`, 'error')
    }
  }

  const startEditing = (sponsor) => {
    setEditingSponsor(sponsor)
    setFormData({
      name: sponsor.name,
      tagline: sponsor.tagline || '',
      description: sponsor.description || '',
      isReal: sponsor.is_real,
    })
    setShowAddForm(false)
  }

  const cancelEditing = () => {
    setEditingSponsor(null)
    setFormData({ name: '', tagline: '', description: '', isReal: false })
  }

  const filteredSponsors = sponsors.filter(s => {
    if (filter === 'fake') return !s.is_real
    if (filter === 'real') return s.is_real
    return true
  })

  const fakeCount = sponsors.filter(s => !s.is_real).length
  const realCount = sponsors.filter(s => s.is_real).length

  return (
    <div className="bg-white rounded-xl shadow-sm border border-cream-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Sponsors & Commercials</h2>
            <p className="text-orange-100 text-sm">Fake commercials and real sponsors</p>
          </div>
          <button
            onClick={() => {
              setShowAddForm(true)
              setEditingSponsor(null)
              setFormData({ name: '', tagline: '', description: '', isReal: false })
            }}
            className="px-3 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-medium text-sm transition-colors"
          >
            + Add Sponsor
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({sponsors.length})
          </button>
          <button
            onClick={() => setFilter('fake')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'fake'
                ? 'bg-orange-500 text-white'
                : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
            }`}
          >
            📺 Fake Commercials ({fakeCount})
          </button>
          <button
            onClick={() => setFilter('real')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'real'
                ? 'bg-green-500 text-white'
                : 'bg-green-100 text-green-700 hover:bg-green-200'
            }`}
          >
            ✓ Real Sponsors ({realCount})
          </button>
        </div>

        {/* Add/Edit Form */}
        {(showAddForm || editingSponsor) && (
          <div className="mb-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
            <h3 className="font-medium text-orange-800 mb-3">
              {editingSponsor ? 'Edit Sponsor' : 'Add New Sponsor'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Totino's Pizza Rolls"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
                <input
                  type="text"
                  value={formData.tagline}
                  onChange={(e) => setFormData({ ...formData, tagline: e.target.value })}
                  placeholder="e.g., Pizza in the morning, pizza in the evening..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., Recurring fake sponsor for pizza-related bits"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isReal}
                    onChange={(e) => setFormData({ ...formData, isReal: e.target.checked })}
                    className="w-4 h-4 text-green-500 border-gray-300 rounded focus:ring-green-400"
                  />
                  <span className="text-sm text-gray-700">This is a real sponsor (not a fake commercial)</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={editingSponsor ? handleUpdateSponsor : handleAddSponsor}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                {editingSponsor ? 'Update' : 'Add Sponsor'}
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

        {/* Sponsors List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4"></div>
            <div className="text-gray-500">Loading sponsors...</div>
          </div>
        ) : filteredSponsors.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {filter === 'all'
              ? 'No sponsors yet. Add fake commercials and real sponsors.'
              : filter === 'fake'
              ? 'No fake commercials yet.'
              : 'No real sponsors yet.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSponsors.map((sponsor) => (
              <div
                key={sponsor.id}
                className={`p-4 rounded-lg border hover:shadow-md transition-shadow ${
                  sponsor.is_real
                    ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-green-200'
                    : 'bg-gradient-to-br from-orange-50 to-red-50 border-orange-200'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg ${
                      sponsor.is_real ? 'bg-green-500' : 'bg-orange-500'
                    }`}>
                      {sponsor.is_real ? '✓' : '📺'}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800">{sponsor.name}</h3>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        sponsor.is_real
                          ? 'bg-green-200 text-green-700'
                          : 'bg-orange-200 text-orange-700'
                      }`}>
                        {sponsor.is_real ? 'Real Sponsor' : 'Fake Commercial'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEditing(sponsor)}
                      className="p-1 text-orange-600 hover:bg-orange-100 rounded transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteSponsor(sponsor)}
                      className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </button>
                  </div>
                </div>
                {sponsor.tagline && (
                  <p className={`text-sm italic mb-2 ${sponsor.is_real ? 'text-green-600' : 'text-orange-600'}`}>
                    "{sponsor.tagline}"
                  </p>
                )}
                {sponsor.description && (
                  <p className="text-sm text-gray-600 mb-2">{sponsor.description}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500 mt-2">
                  <span>{sponsor.mention_count || 0} mentions</span>
                  {sponsor.first_episode_title && (
                    <span className="truncate">First: {sponsor.first_episode_title}</span>
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
