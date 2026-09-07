import React from 'react'

export interface ViewportFrameProps {
  mountRef: React.RefObject<any>
  currentSceneTitle: string
  currentSceneNumber: number
  selectedShot: string
  onApplyCameraShot: (shotKey: string) => void
  motionCadence: 'auto' | 12 | 24
  visualStyle: string
  isPlaying: boolean
  onPlay: () => void
  onStop: () => void
  children?: React.ReactNode
}

// Keep a decoupled local list of camera shot names for UI dropdown
const CINEMATIC_SHOT_PRESETS = [
  { key: 'two_shot_wide', label: 'Stage Two-Shot (Wide)' },
  { key: 'close_up', label: 'Lead Close Up' },
  { key: 'actor2_close', label: 'Supporting Close Up' },
  { key: 'low_angle', label: 'Hero Low Angle' },
  { key: 'dutch_angle', label: 'Dutch Angle' },
  { key: 'over_shoulder', label: 'Over Shoulder (OTS)' },
]

export function ViewportFrame({
  mountRef,
  currentSceneTitle = 'D3 Digital Set',
  currentSceneNumber = 1,
  selectedShot,
  onApplyCameraShot,
  motionCadence,
  visualStyle,
  isPlaying,
  onPlay,
  onStop,
  children,
}: ViewportFrameProps) {
  const displayFps = motionCadence === 'auto' ? 'Native (60)' : `${motionCadence} fps`

  return (
    <div className="d3-viewport-frame">
      {/* Three.js Canvas container mount */}
      <div ref={mountRef} className="d3-viewport-canvas-mount" />

      {/* Top Left Overlay */}
      <div className="d3-viewport-overlay-tl">
        <span className="d3-viewport-scene-tag">SCENE {String(currentSceneNumber).padStart(2, '0')}</span>
        <span className="d3-viewport-scene-name">{currentSceneTitle.toUpperCase()}</span>
      </div>

      {/* Top Right Overlay */}
      <div className="d3-viewport-overlay-tr">
        {/* Camera Preset Quick Selector */}
        <select
          className="d3-select d3-viewport-metric"
          value={selectedShot}
          onChange={(e) => onApplyCameraShot(e.target.value)}
          style={{ background: 'rgba(10, 15, 19, 0.8)', border: '1px solid var(--d3-border)', height: '20px', padding: '0 4px', fontSize: '9px', textTransform: 'uppercase' }}
        >
          {CINEMATIC_SHOT_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              🎥 {p.label}
            </option>
          ))}
        </select>

        <span className="d3-viewport-metric">STYLE: {visualStyle.toUpperCase()}</span>
        <span className="d3-viewport-metric">CADENCE: {displayFps}</span>
        <span className="d3-viewport-metric" style={{ color: 'var(--d3-success)' }}>● LIVE RENDER</span>
      </div>

      {/* Floating Toolbar and any children */}
      {children}
    </div>
  )
}
export default ViewportFrame
