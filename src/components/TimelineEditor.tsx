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

import { D3Episode, D3Shot, D3CameraShotKey, D3Gesture } from '../types/d3'
import './TimelineEditor.css'

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
  /** When provided, the editor shows ONLY this scene's shots (Episode Engine). */
  activeSceneIndex?: number
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
  activeSceneIndex,
  selectedShotIndex,
  onSelectShot,
  onUpdateShot,
  onDeleteShot,
  onDuplicateShot,
  onPlayFromShot,
  disabled,
}: TimelineEditorProps) {
  // Episode Engine: when activeSceneIndex is provided, show ONLY the active
  // scene's shots so the timeline visibly switches with scene selection.
  // Indices passed back to callbacks are LOCAL to that scene — matching the
  // App handlers (update/delete/duplicate/Record/AI⇄USER all use the same
  // local-index convention for the currently selected scene).
  type FlatShot = { shot: D3Shot; sceneIndex: number; localIndex: number; globalIndex: number }
  const activeScene = activeSceneIndex != null ? episode.scenes[activeSceneIndex] : undefined
  const flat: FlatShot[] = []
  if (activeScene) {
    activeScene.shots.forEach((shot, localIndex) => {
      flat.push({
        shot,
        sceneIndex: activeSceneIndex as number,
        localIndex,
        globalIndex: localIndex,
      })
    })
  } else {
    // Legacy fallback: flatten across all scenes.
    episode.scenes.forEach((sc, sceneIndex) => {
      sc.shots.forEach((shot, localIndex) => {
        flat.push({ shot, sceneIndex, localIndex, globalIndex: flat.length })
      })
    })
  }
  const shots = flat.map((f) => f.shot)
  const total = activeScene
    ? activeScene.shots.reduce((s, sh) => s + sh.duration, 0)
    : episode.estimatedDuration || shots.reduce((s, sh) => s + sh.duration, 0)
  const selectedFlat = flat[selectedShotIndex]
  const selected = selectedFlat?.shot
  const selectedSceneTitle = activeScene
    ? activeScene.title || `Scene ${(activeSceneIndex as number) + 1}`
    : selectedFlat
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
    <div className="d3-timeline-editor" style={{ opacity: disabled ? 0.55 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div className="d3-timeline-editor__header">
        <div className="d3-timeline-editor__title">
          Timeline Editor — {selectedSceneTitle || 'Timeline'} · {shots.length} shots · {total.toFixed(1)}s
        </div>
        <div className="d3-timeline-editor__subtitle">
          Edit structured episode data · recompiles on change
        </div>
      </div>

      {/* Shot blocks */}
      <div className="d3-timeline-editor__track">
        {blocks.map(({ shot, index, start }) => {
          const active = index === selectedShotIndex
          const label = shot.dialogue?.text?.slice(0, 28) || shot.narrativeBeat?.slice(0, 28) || `Shot ${shot.shotNumber}`
          const width = Math.max(72, Math.min(180, shot.duration * 28))
          return (
            <button
              key={shot.id}
              type="button"
              onClick={() => onSelectShot(index)}
              className={`d3-timeline-editor__shot ${active ? 'd3-timeline-editor__shot--active' : ''}`}
              style={{ flex: `0 0 ${width}px`, width }}
              title={`${start.toFixed(1)}s · ${shot.camera.shotKey}`}
            >
              <div className="d3-timeline-editor__shot-label">
                Sc{flat[index]?.sceneIndex + 1 || 1}.{shot.shotNumber} · {shot.camera.shotKey}
              </div>
              <div className="d3-timeline-editor__shot-text">{label}</div>
              <div className="d3-timeline-editor__shot-duration">{shot.duration.toFixed(1)}s</div>
            </button>
          )
        })}
        {shots.length === 0 && (
          <div className="d3-timeline-editor__empty">
            Generate a scene first to edit the timeline.
          </div>
        )}
      </div>

      {/* Inspector */}
      {selected && (
        <div className="d3-timeline-editor__inspector">
          <div className="d3-timeline-editor__inspector-title">
            {selectedSceneTitle} · Shot {selected.shotNumber}
          </div>

          <label className="d3-timeline-editor__field">
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
              className="d3-select d3-select--sm"
            >
              {CAMERA_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="d3-timeline-editor__field">
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
              className="d3-input d3-input--sm"
            />
          </label>

          <label className="d3-timeline-editor__field">
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
              className="d3-select d3-select--sm"
            >
              {GESTURE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>

          <div className="d3-timeline-editor__actions">
            {onPlayFromShot && (
              <button type="button" onClick={() => onPlayFromShot(selectedShotIndex)} className="d3-btn d3-btn--secondary d3-btn--sm">
                ▶
              </button>
            )}
            <button type="button" onClick={() => onDuplicateShot(selectedShotIndex)} className="d3-btn d3-btn--tertiary d3-btn--sm" title="Duplicate shot">
              ⧉
            </button>
            <button
              type="button"
              onClick={() => onDeleteShot(selectedShotIndex)}
              disabled={shots.length <= 1}
              className="d3-btn d3-btn--danger d3-btn--sm"
              title="Delete shot"
            >
              ✕
            </button>
          </div>

          <label className="d3-timeline-editor__field d3-timeline-editor__field--full">
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
              className="d3-textarea d3-textarea--sm"
              placeholder="Dialogue line for this shot…"
            />
          </label>
        </div>
      )}
    </div>
  )
}

export default TimelineEditor
