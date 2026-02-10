export default function Header({ connected }) {
  return (
    <header className="bg-white border-b-2 border-cream-300 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">
            🍦 Ice Cream Social Transcription
          </h1>

          <div className="flex items-center gap-2">
            <span
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
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
      </div>
    </header>
  )
}
