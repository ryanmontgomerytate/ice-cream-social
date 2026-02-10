export default function Queue({ queue }) {
  const pending = queue.pending || []
  const completed = queue.completed || []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Pending Queue */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">📋</span>
          <h2 className="text-xl font-bold text-gray-800">Queue</h2>
        </div>

        <div className="space-y-2">
          {pending.length === 0 ? (
            <div className="text-center py-8 text-gray-400">Queue is empty</div>
          ) : (
            pending.slice(0, 5).map((file, index) => {
              const filename = file.split('/').pop()
              return (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200"
                >
                  <span className="text-sm text-gray-700 truncate">{filename}</span>
                  <span className="badge badge-pending">Pending</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Recent Completions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">✅</span>
          <h2 className="text-xl font-bold text-gray-800">Recent Completions</h2>
        </div>

        <div className="space-y-2">
          {completed.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              No completed transcriptions yet
            </div>
          ) : (
            completed
              .slice(-5)
              .reverse()
              .map((file, index) => {
                const filename = file.split('/').pop()
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-sage-50 rounded-lg border border-sage-200"
                  >
                    <span className="text-sm text-gray-700 truncate">{filename}</span>
                    <span className="badge badge-success">✓</span>
                  </div>
                )
              })
          )}
        </div>
      </div>
    </div>
  )
}
