import React from 'react'
import { D3Episode, D3Shot } from '../types/d3'
import { TimelineEditor } from '../components/TimelineEditor'

export interface TimelinePanelProps {
  episode: D3Episode
  activeSceneIndex: number
  selectedShotIndex: number
  onSelectShot: (index: number) => void
  onUpdateShot: (index: number, patch: Partial<D3Shot>) => void
  onDeleteShot: (index: number) => void
  onDuplicateShot: (index: number) => void
  onPlayFromShot?: (index: number) => void
  disabled?: boolean
  timelineCollapsed: boolean
  setTimelineCollapsed: (collapsed: boolean) => void
}

export function TimelinePanel({
  episode,
  activeSceneIndex,
  selectedShotIndex,
  onSelectShot,
  onUpdateShot,
  onDeleteShot,
  onDuplicateShot,
  onPlayFromShot,
  disabled,
  timelineCollapsed,
  setTimelineCollapsed,
}: TimelinePanelProps) {
  const activeScene = episode.scenes[activeSceneIndex]
  const shots = activeScene ? activeScene.shots : []
  const totalDuration = shots.reduce((s, sh) => s + sh.duration, 0)

  return (
    <div className={`d3-timeline-panel ${timelineCollapsed ? 'd3-timeline-panel--collapsed' : ''}`}>
      {/* Timeline Header */}
      <div className="d3-timeline-header">
        <div className="d3-timeline-header__title">
          🎬 Sequence Timeline · {shots.length} Shots · {totalDuration.toFixed(1)}s
        </div>
        <button
          type="button"
          onClick={() => setTimelineCollapsed(!timelineCollapsed)}
          className="d3-preset-chip"
          style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }}
        >
          {timelineCollapsed ? '▲ EXPAND TIMELINE' : '▼ COLLAPSE'}
        </button>
      </div>

      {/* Main Timeline Workspace (Only visible when expanded) */}
      {!timelineCollapsed && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Scrollable Tracks Area */}
          <div className="d3-timeline-tracks-container">
            {/* Left Track Labels */}
            <div className="d3-timeline-labels">
              <div className="d3-timeline-label-item" style={{ height: '18px', background: 'var(--d3-surface-1)' }}>RULER</div>
              <div className="d3-timeline-label-item">CAMERA</div>
              <div className="d3-timeline-label-item">CHAR_1</div>
              <div className="d3-timeline-label-item">CHAR_2</div>
              <div className="d3-timeline-label-item">DIALOGUE</div>
              <div className="d3-timeline-label-item">STAGE</div>
              <div className="d3-timeline-label-item">AUDIO</div>
            </div>

            {/* Right Horizontal Timeline Tracks */}
            <div className="d3-timeline-tracks d3-scrollable">
              {/* 1. Time Ruler */}
              <div className="d3-timeline-ruler">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  return (
                    <div
                      key={`ruler-${sh.id}`}
                      style={{
                        position: 'absolute',
                        left: `${idx * width}px`,
                        width: `${width}px`,
                        fontSize: '8px',
                        color: 'var(--d3-text-muted)',
                        paddingLeft: '4px',
                        borderLeft: '1px solid var(--d3-border)',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      +{sh.duration.toFixed(1)}s
                    </div>
                  )
                })}
              </div>

              {/* 2. Camera Track */}
              <div className="d3-timeline-track-row">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  const isSelected = idx === selectedShotIndex
                  return (
                    <div
                      key={`cam-${sh.id}`}
                      onClick={() => onSelectShot(idx)}
                      style={{
                        width: `${width}px`,
                        background: isSelected ? 'var(--theme-accent-bg)' : 'rgba(11, 110, 134, 0.15)',
                        border: isSelected ? '1px solid var(--theme-accent)' : '1px solid rgba(11, 110, 134, 0.3)',
                        borderRadius: '3px',
                        margin: '2px',
                        fontSize: '8px',
                        fontWeight: 700,
                        color: isSelected ? 'var(--theme-accent)' : 'var(--d3-text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={`${sh.camera.shotKey}`}
                    >
                      {sh.camera.shotKey.replace('_', ' ').toUpperCase()}
                    </div>
                  )
                })}
              </div>

              {/* 3. Character 1 Track */}
              <div className="d3-timeline-track-row">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  const keys = Object.keys(sh.performances || {})
                  const p1 = sh.performances[keys[0]]
                  const isSelected = idx === selectedShotIndex
                  return (
                    <div
                      key={`c1-${sh.id}`}
                      style={{
                        width: `${width}px`,
                        background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
                        borderRight: '1px solid var(--d3-border)',
                        fontSize: '8px',
                        color: 'var(--d3-text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                        overflow: 'hidden',
                      }}
                    >
                      🎭 {p1 ? `${p1.emotion} ${p1.gesture ? `[${p1.gesture}]` : ''}` : 'idle'}
                    </div>
                  )
                })}
              </div>

              {/* 4. Character 2 Track */}
              <div className="d3-timeline-track-row">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  const keys = Object.keys(sh.performances || {})
                  const p2 = sh.performances[keys[1]]
                  const isSelected = idx === selectedShotIndex
                  return (
                    <div
                      key={`c2-${sh.id}`}
                      style={{
                        width: `${width}px`,
                        background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
                        borderRight: '1px solid var(--d3-border)',
                        fontSize: '8px',
                        color: 'var(--d3-text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                        overflow: 'hidden',
                      }}
                    >
                      🎭 {p2 ? `${p2.emotion}` : 'idle'}
                    </div>
                  )
                })}
              </div>

              {/* 5. Dialogue Track */}
              <div className="d3-timeline-track-row">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  const isSelected = idx === selectedShotIndex
                  return (
                    <div
                      key={`dia-${sh.id}`}
                      style={{
                        width: `${width}px`,
                        background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
                        borderRight: '1px solid var(--d3-border)',
                        fontSize: '8px',
                        fontStyle: 'italic',
                        color: 'var(--d3-text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      🗣️ {sh.dialogue?.text ? `"${sh.dialogue.text}"` : '—'}
                    </div>
                  )
                })}
              </div>

              {/* 6. Environment Track */}
              <div className="d3-timeline-track-row">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  return (
                    <div
                      key={`env-${sh.id}`}
                      style={{
                        width: `${width}px`,
                        borderRight: '1px solid var(--d3-border)',
                        fontSize: '8px',
                        color: 'var(--d3-text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                      }}
                    >
                      🌍 kit_proc
                    </div>
                  )
                })}
              </div>

              {/* 7. Audio Track */}
              <div className="d3-timeline-track-row">
                {shots.map((sh, idx) => {
                  const width = Math.max(72, Math.min(180, sh.duration * 24))
                  return (
                    <div
                      key={`aud-${sh.id}`}
                      style={{
                        width: `${width}px`,
                        borderRight: '1px solid var(--d3-border)',
                        fontSize: '8px',
                        color: 'var(--d3-text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                      }}
                    >
                      🎵 TTS_Track_24k
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Embedded Canonical Editor for Mutating State */}
          <div style={{ padding: '8px var(--d3-space-4)', background: 'var(--d3-surface-2)', borderTop: '1px solid var(--d3-border)', maxHeight: '110px', overflowY: 'auto' }}>
            <TimelineEditor
              episode={episode}
              activeSceneIndex={activeSceneIndex}
              selectedShotIndex={selectedShotIndex}
              onSelectShot={onSelectShot}
              onUpdateShot={onUpdateShot}
              onDeleteShot={onDeleteShot}
              onDuplicateShot={onDuplicateShot}
              onPlayFromShot={onPlayFromShot}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  )
}
export default TimelinePanel
