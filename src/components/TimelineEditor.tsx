/**
 * Module 6 — Interactive Timeline Editor
 *
 * Displays shots from the current D3Episode, lets the user edit:
 *   - camera shot key
 *   - dialogue text
 *   - duration
 *   - gesture
 * Changes mutate structured episode data. Parent recompiles the canonical timeline.
 */

import type { CSSProperties } from 'react'
import { D3Episode, D3Shot, D3CameraShotKey, D3Gesture } from '../types/d3'

const CAMERA_OPTIONS: { key: D3CameraShotKey; label: string }[] = [
  { key: 'two_shot_wide', label: 'Two-Shot Wide' },
  { key: 'close_up', label: 'Lead Close Up' },
  { key: 'actor2_close', label: 'Supporting Close Up' },
  { key: 'low_angle', label: 'Low Angle' },
  { key: 'dutch_angle', label: 'Dutch Angle' },
  { key: 'over_shoulder', label: 'Over Shoulder' },
]

const GESTURE_OPTIONS: D3Gesture[] = [
  'none',
  'wave',
  'bow',
  'look_around',
  'turn_head',
  'thumbs',
  'point',
  'shrug',
  'nod',
]

export interface TimelineEditorProps {
  episode: D3Episode
  selectedShotIndex: number
  onSelectShot: (index: number) => void
  onUpdateShot: (index: number, patch: Partial<D3Shot>) => void
  onDeleteShot: (index: number) => void
  onDuplicateShot: (index: number) => void
  onPlayFromShot?: (index: number) => void
  disabled?: boolean
}

export function TimelineEditor({
  episode,
  selectedShotIndex,
  onSelectShot,
  onUpdateShot,
  onDeleteShot,
  onDuplicateShot,
  onPlayFromShot,
  disabled,
}: TimelineEditorProps) {
  // Flatten shots across all scenes for a continuous timeline view
  type FlatShot = { shot: D3Shot; sceneIndex: number; localIndex: number; globalIndex: number }
  const flat: FlatShot[] = []
  episode.scenes.forEach((sc, sceneIndex) => {
    sc.shots.forEach((shot, localIndex) => {
      flat.push({ shot, sceneIndex, localIndex, globalIndex: flat.length })
    })
  })
  const shots = flat.map((f) => f.shot)
  const total = episode.estimatedDuration || shots.reduce((s, sh) => s + sh.duration, 0)
  const selectedFlat = flat[selectedShotIndex]
  const selected = selectedFlat?.shot
  const selectedSceneTitle = selectedFlat
    ? episode.scenes[selectedFlat.sceneIndex]?.title || `Scene ${selectedFlat.sceneIndex + 1}`
    : ''


  // Cumulative start times for visual layout
  let cursor = 0
  const blocks = shots.map((shot, i) => {
    const start = cursor
    cursor += shot.duration
    return { shot, index: i, start, end: cursor }
  })

  const primaryPerf = selected
    ? Object.values(selected.performances || {})[0]
    : undefined
  const primaryPerfKey = selected
    ? Object.keys(selected.performances || {})[0]
    : undefined

  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        right: 260,
        bottom: 70,
        maxHeight: 200,
        background: 'rgba(15, 23, 42, 0.94)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 12,
        padding: 10,
        zIndex: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: disabled ? 'none' : 'auto',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
          ⏱ Timeline Editor — {shots.length} shots · {total.toFixed(1)}s
        </div>
        <div style={{ fontSize: 10, color: '#64748b' }}>
          Edit structured episode data · recompiles on change
        </div>
      </div>

      {/* Shot blocks */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          overflowX: 'auto',
          paddingBottom: 4,
          minHeight: 44,
        }}
      >
        {blocks.map(({ shot, index, start }) => {
          const active = index === selectedShotIndex
          const label = shot.dialogue?.text?.slice(0, 28) || shot.narrativeBeat?.slice(0, 28) || `Shot ${shot.shotNumber}`
          const width = Math.max(72, Math.min(180, shot.duration * 28))
          return (
            <button
              key={shot.id}
              type="button"
              onClick={() => onSelectShot(index)}
              style={{
                flex: `0 0 ${width}px`,
                width,
                textAlign: 'left',
                background: active ? '#4f46e5' : '#1e293b',
                border: active ? '1px solid #a5b4fc' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: '6px 8px',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: 10,
              }}
              title={`${start.toFixed(1)}s · ${shot.camera.shotKey}`}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                Sc{flat[index]?.sceneIndex + 1 || 1}.{shot.shotNumber} · {shot.camera.shotKey}
              </div>
              <div style={{ opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label}
              </div>
              <div style={{ opacity: 0.6, marginTop: 2 }}>{shot.duration.toFixed(1)}s</div>
            </button>
          )
        })}
        {shots.length === 0 && (
          <div style={{ fontSize: 11, color: '#64748b', padding: 8 }}>
            Generate a scene first to edit the timeline.
          </div>
        )}
      </div>

      {/* Inspector */}
      {selected && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr auto',
            gap: 8,
            alignItems: 'end',
            borderTop: '1px solid #334155',
            paddingTop: 8,
          }}
        >
          <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
            {selectedSceneTitle} · Shot {selected.shotNumber}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: '#94a3b8' }}>
            Camera
            <select
              value={String(selected.camera.shotKey)}
              onChange={(e) => {
                const shotKey = e.target.value as D3CameraShotKey
                const anchor =
                  shotKey === 'actor2_close'
                    ? 'actor2_head'
                    : shotKey === 'two_shot_wide'
                      ? 'stage_center'
                      : shotKey === 'low_angle' || shotKey === 'over_shoulder'
                        ? 'actor1_chest'
                        : 'actor1_head'
                onUpdateShot(selectedShotIndex, {
                  camera: {
                    ...selected.camera,
                    shotKey,
                    anchor,
                    rollZ: shotKey === 'dutch_angle' ? 0.18 : undefined,
                  },
                })
              }}
              style={selectStyle}
            >
              {CAMERA_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: '#94a3b8' }}>
            Duration (s)
            <input
              type="number"
              min={0.8}
              max={30}
              step={0.1}
              value={Number(selected.duration.toFixed(1))}
              onChange={(e) => {
                const duration = Math.max(0.8, parseFloat(e.target.value) || 1)
                onUpdateShot(selectedShotIndex, { duration })
              }}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, color: '#94a3b8' }}>
            Gesture
            <select
              value={primaryPerf?.gesture || 'none'}
              onChange={(e) => {
                const gesture = e.target.value as D3Gesture
                if (!primaryPerfKey) return
                const performances = {
                  ...selected.performances,
                  [primaryPerfKey]: {
                    ...selected.performances[primaryPerfKey],
                    source: selected.performances[primaryPerfKey]?.source || ('AI' as const),
                    emotion: selected.performances[primaryPerfKey]?.emotion || ('neutral' as const),
                    gesture: gesture === 'none' ? undefined : gesture,
                  },
                }
                onUpdateShot(selectedShotIndex, { performances })
              }}
              style={selectStyle}
            >
              {GESTURE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: 4 }}>
            {onPlayFromShot && (
              <button type="button" onClick={() => onPlayFromShot(selectedShotIndex)} style={btnStyle('#10b981')}>
                ▶
              </button>
            )}
            <button type="button" onClick={() => onDuplicateShot(selectedShotIndex)} style={btnStyle('#334155')} title="Duplicate shot">
              ⧉
            </button>
            <button
              type="button"
              onClick={() => onDeleteShot(selectedShotIndex)}
              disabled={shots.length <= 1}
              style={btnStyle(shots.length <= 1 ? '#1e293b' : '#7f1d1d')}
              title="Delete shot"
            >
              ✕
            </button>
          </div>

          <label
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 10,
              color: '#94a3b8',
            }}
          >
            Dialogue
            <textarea
              value={selected.dialogue?.text || ''}
              onChange={(e) => {
                const text = e.target.value
                const speakerId = selected.dialogue?.speakerId || primaryPerfKey || 'char_host'
                onUpdateShot(selectedShotIndex, {
                  dialogue: text
                    ? {
                        speakerId,
                        text,
                        estimatedDuration: Math.max(1.2, text.trim().split(/\s+/).length / 2.4 + 0.3),
                      }
                    : undefined,
                })
              }}
              rows={2}
              style={{
                ...inputStyle,
                resize: 'vertical',
                minHeight: 40,
                fontFamily: 'sans-serif',
              }}
              placeholder="Dialogue line for this shot…"
            />
          </label>
        </div>
      )}
    </div>
  )
}

const selectStyle: CSSProperties = {
  background: '#1e293b',
  color: '#fff',
  border: '1px solid #475569',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
}

const inputStyle: CSSProperties = {
  background: '#1e293b',
  color: '#fff',
  border: '1px solid #475569',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 11,
}

function btnStyle(bg: string): CSSProperties {
  return {
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
  }
}

export default TimelineEditor
