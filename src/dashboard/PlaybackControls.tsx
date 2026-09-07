import React from 'react'

export interface PlaybackControlsProps {
  isPlaying: boolean
  onPlay: () => void
  onStop: () => void
  onPreviousShot: () => void
  onNextShot: () => void
  currentShotNumber: number
  totalShots: number
  totalDuration: number
  motionCadence: 'auto' | 12 | 24
  setMotionCadence: (cad: 'auto' | 12 | 24) => void
}

export function PlaybackControls({
  isPlaying,
  onPlay,
  onStop,
  onPreviousShot,
  onNextShot,
  currentShotNumber,
  totalShots,
  totalDuration,
  motionCadence,
  setMotionCadence,
}: PlaybackControlsProps) {
  return (
    <div className="d3-playback-bar">
      {/* Left side: current shot details */}
      <div className="d3-playback-time">
        🎬 CUT: <span style={{ color: 'var(--theme-accent)', fontWeight: 800 }}>{currentShotNumber}/{totalShots}</span> · {totalDuration.toFixed(1)}s TOTAL
      </div>

      {/* Center: ⏮ ▶ ■ ⏭ */}
      <div className="d3-playback-controls">
        <button
          type="button"
          className="d3-playback-btn"
          onClick={onPreviousShot}
          title="Previous Shot (⏮)"
        >
          ⏮
        </button>

        <button
          type="button"
          className="d3-playback-btn"
          onClick={onPlay}
          style={{ fontSize: '18px', color: isPlaying ? 'var(--theme-accent)' : 'var(--d3-text)' }}
          title={isPlaying ? 'Directing Scene...' : 'Play Scene (▶)'}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>

        <button
          type="button"
          className="d3-playback-btn"
          onClick={onStop}
          title="Stop Playback (■)"
        >
          ■
        </button>

        <button
          type="button"
          className="d3-playback-btn"
          onClick={onNextShot}
          title="Next Shot (⏭)"
        >
          ⏭
        </button>
      </div>

      {/* Right side: visual rate display / selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--d3-text-muted)' }}>CADENCE:</span>
        <div className="d3-segmented">
          {(['auto', 24, 12] as const).map((cad) => (
            <button
              key={String(cad)}
              type="button"
              className={`d3-segmented-option ${motionCadence === cad ? 'd3-segmented-option--active' : ''}`}
              onClick={() => setMotionCadence(cad)}
              style={{ padding: '2px 8px', fontSize: '9px' }}
            >
              {cad === 'auto' ? 'Auto' : `${cad}fps`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
export default PlaybackControls
