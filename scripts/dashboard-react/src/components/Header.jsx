const MAIN_TABS = [
  { id: 'episodes', label: 'Episodes', icon: '📻' },
  { id: 'search', label: 'Search', icon: '🔍' },
  { id: 'extraction', label: 'Extraction', icon: '🤖' },
  { id: 'speakers', label: 'Audio ID', icon: '🎙️' },
  { id: 'characters', label: 'Characters', icon: '🎭' },
  { id: 'sponsors', label: 'Sponsors', icon: '📺' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

export default function Header({ connected, activeMainTab, onSelectMainTab }) {
  return (
    <header className="bg-white border-b-2 border-cream-300 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-2.5">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">
            🍦 Ice Cream Social Transcription
          </h1>

          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                connected
                  ? 'bg-sage-100 text-sage-700 border border-sage-200'
                  : 'bg-gray-100 text-gray-600 border border-gray-200'
              }`}
            >
              {connected ? (
                <>
                  <span className="inline-block w-2 h-2 bg-sage-500 rounded-full mr-2 animate-pulse"></span>
                  Worker Active
                </>
              ) : (
                <>
                  <span className="inline-block w-2 h-2 bg-gray-400 rounded-full mr-2"></span>
                  Connecting...
                </>
              )}
            </span>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto pb-1.5">
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onSelectMainTab?.(tab.id)}
              className={`px-3 py-2 font-medium text-sm transition-colors border-b-2 whitespace-nowrap ${
                activeMainTab === tab.id
                  ? 'border-coral-500 text-coral-600 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-cream-50'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
