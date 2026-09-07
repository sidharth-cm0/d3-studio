import React from 'react'

export interface CameraInspectorProps {
  selectedShot: string
  onApplyCameraShot: (shotKey: string) => void
  onExportCameraAnimation?: () => void
}

export function CameraInspector({
  selectedShot,
  onApplyCameraShot,
  onExportCameraAnimation,
}: CameraInspectorProps) {
  const presets = [
    { key: 'two_shot_wide', label: 'Wide', icon: '📺', desc: 'Stage Two-Shot' },
    { key: 'close_up', label: 'Close Up', icon: '👤', desc: 'Lead Framing' },
    { key: 'actor2_close', label: 'Supporting', icon: '👥', desc: 'Guest Framing' },
    { key: 'low_angle', label: 'Low Angle', icon: '📐', desc: 'Dramatic Low' },
    { key: 'dutch_angle', label: 'Dutch', icon: '⧎', desc: 'Tilted Angle' },
    { key: 'over_shoulder', label: 'OTS', icon: '🎥', desc: 'Over Shoulder' },
  ]

  return (
    <div className="d3-inspector-section">
      <div className="d3-panel-section-title">Camera Lenses</div>
      <div className="d3-camera-cards-grid">
        {presets.map((p) => {
          const isSelected = selectedShot === p.key
          return (
            <button
              key={p.key}
              type="button"
              className={`d3-camera-card ${isSelected ? 'd3-camera-card--selected' : ''}`}
              onClick={() => onApplyCameraShot(p.key)}
              title={p.desc}
            >
              <span className="d3-camera-card-icon">{p.icon}</span>
              <span className="d3-camera-card-label">{p.label}</span>
            </button>
          )
        })}
      </div>

      {onExportCameraAnimation && (
        <button
          type="button"
          className="d3-topbar__btn"
          onClick={onExportCameraAnimation}
          style={{ width: '100%', height: '28px', marginTop: '4px', fontSize: '10px', justifyContent: 'center' }}
        >
          Export Camera Path
        </button>
      )}
    </div>
  )
}
export default CameraInspector
