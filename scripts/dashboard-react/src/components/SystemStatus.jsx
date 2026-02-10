import { useState, useEffect } from 'react'
import './SystemStatus.css'

function SystemStatus() {
  const [processes, setProcesses] = useState([])
  const [systemMetrics, setSystemMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSystemStatus()
    const interval = setInterval(loadSystemStatus, 2000) // Update every 2 seconds
    return () => clearInterval(interval)
  }, [])

  const loadSystemStatus = async () => {
    try {
      const response = await fetch('/api/v2/system/status')
      const data = await response.json()
      setProcesses(data.processes || [])
      setSystemMetrics(data.system || {})
      setLoading(false)
    } catch (error) {
      console.error('Error loading system status:', error)
      setLoading(false)
    }
  }

  const formatUptime = (seconds) => {
    if (!seconds) return 'N/A'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    return `${hours}h ${mins}m ${secs}s`
  }

  const formatBytes = (bytes) => {
    if (!bytes) return '0 MB'
    const mb = (bytes / (1024 * 1024)).toFixed(1)
    return `${mb} MB`
  }

  const getStatusBadge = (status) => {
    const badges = {
      running: { class: 'status-badge-success', text: '● Running' },
      idle: { class: 'status-badge-warning', text: '○ Idle' },
      completed: { class: 'status-badge-info', text: '✓ Completed' },
      failed: { class: 'status-badge-error', text: '✗ Failed' }
    }
    const badge = badges[status] || { class: 'status-badge-default', text: status }
    return <span className={`status-badge ${badge.class}`}>{badge.text}</span>
  }

  if (loading) {
    return <div className="system-status-loading">Loading system status...</div>
  }

  return (
    <div className="system-status">
      <h2>System Status</h2>

      {/* System Metrics Card */}
      {systemMetrics && (
        <div className="status-card system-metrics">
          <h3>System Metrics</h3>
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-label">CPU Usage</span>
              <span className="metric-value">{systemMetrics.cpu_percent || 0}%</span>
            </div>
            <div className="metric">
              <span className="metric-label">Memory Usage</span>
              <span className="metric-value">{systemMetrics.memory_percent || 0}%</span>
            </div>
            <div className="metric">
              <span className="metric-label">Memory Used</span>
              <span className="metric-value">{formatBytes(systemMetrics.memory_used)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Total Memory</span>
              <span className="metric-value">{formatBytes(systemMetrics.memory_total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Processes Card */}
      <div className="status-card processes">
        <h3>Active Processes</h3>
        {processes.length === 0 ? (
          <p className="no-processes">No active processes</p>
        ) : (
          <div className="processes-list">
            {processes.map((proc, index) => (
              <div key={index} className="process-item">
                <div className="process-header">
                  <div className="process-title">
                    <strong>{proc.name}</strong>
                    {getStatusBadge(proc.status)}
                  </div>
                  <div className="process-pid">PID: {proc.pid}</div>
                </div>

                <div className="process-details">
                  <div className="detail-row">
                    <span className="detail-label">CPU:</span>
                    <span className="detail-value">{proc.cpu_percent}%</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Memory:</span>
                    <span className="detail-value">{formatBytes(proc.memory_mb * 1024 * 1024)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Uptime:</span>
                    <span className="detail-value">{formatUptime(proc.uptime_seconds)}</span>
                  </div>
                </div>

                {/* Progress bar for active tasks */}
                {proc.progress !== undefined && proc.progress !== null && (
                  <div className="process-progress">
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${proc.progress}%` }}
                      />
                    </div>
                    <span className="progress-text">{proc.progress}%</span>
                  </div>
                )}

                {/* Task description */}
                {proc.current_task && (
                  <div className="process-task">
                    <span className="task-label">Current:</span>
                    <span className="task-description">{proc.current_task}</span>
                  </div>
                )}

                {/* Estimated time remaining */}
                {proc.eta_seconds && (
                  <div className="process-eta">
                    <span className="eta-label">ETA:</span>
                    <span className="eta-value">{formatUptime(proc.eta_seconds)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Last Update Timestamp */}
      <div className="status-footer">
        <small>Last updated: {new Date().toLocaleTimeString()}</small>
      </div>
    </div>
  )
}

export default SystemStatus
