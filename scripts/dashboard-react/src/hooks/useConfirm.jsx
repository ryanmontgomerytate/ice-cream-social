import { createContext, useContext, useState, useCallback } from 'react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { message, resolve }

  const confirm = useCallback((message) => {
    return new Promise((resolve) => {
      setState({ message, resolve })
    })
  }, [])

  const handleYes = () => {
    state?.resolve(true)
    setState(null)
  }

  const handleNo = () => {
    state?.resolve(false)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={handleNo} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-gray-200 p-6 max-w-sm w-full mx-4">
            <p className="text-sm text-gray-800 mb-5 leading-relaxed">{state.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleNo}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                autoFocus
              >
                Cancel
              </button>
              <button
                onClick={handleYes}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    // ConfirmProvider not found — return a no-op that cancels the action
    // rather than crashing the app.
    return () => Promise.resolve(false)
  }
  return confirm
}
