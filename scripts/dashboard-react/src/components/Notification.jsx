import { useEffect } from 'react'

export default function Notification({ message, type = 'success', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000)
    return () => clearTimeout(timer)
  }, [onClose])

  const styles = {
    success: 'bg-sage-50 border-sage-500 text-sage-800',
    error: 'bg-red-50 border-red-500 text-red-800'
  }

  return (
    <div className="fixed top-20 right-4 z-50 animate-slide-in">
      <div className={`${styles[type]} border-l-4 rounded-lg shadow-lg p-4 max-w-md`}>
        <div className="flex items-center justify-between">
          <p className="font-medium">{message}</p>
          <button
            className="ml-4 text-gray-400 hover:text-gray-600"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
