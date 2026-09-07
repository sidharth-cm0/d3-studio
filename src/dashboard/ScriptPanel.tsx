import React, { useState } from 'react'

export interface ScriptPanelProps {
  multiActorPrompt: string
  setMultiActorPrompt: (text: string) => void
  onPlay: () => void
  onStop: () => void
  isPlaying: boolean
  setStatus: (text: string) => void
}

interface ScriptLine {
  type: 'slug' | 'char' | 'dialogue' | 'action'
  text: string
}

export function ScriptPanel({
  multiActorPrompt,
  setMultiActorPrompt,
  onPlay,
  onStop,
  isPlaying,
  setStatus,
}: ScriptPanelProps) {
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [hideDialogue, setHideDialogue] = useState<boolean>(false)

  // Parse lines for professional screenwriting styling
  const parseScript = (text: string): ScriptLine[] => {
    const rawLines = text.split('\n')
    const result: ScriptLine[] = []

    rawLines.forEach((line) => {
      const trimmed = line.trim()
      if (!trimmed) return

      if (trimmed.startsWith('INT.') || trimmed.startsWith('EXT.') || trimmed.toUpperCase().startsWith('SCENE')) {
        result.push({ type: 'slug', text: trimmed.toUpperCase() })
      } else if (trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf(':')
        const charName = trimmed.substring(0, colonIndex).trim()
        const dialogueText = trimmed.substring(colonIndex + 1).trim()
        result.push({ type: 'char', text: charName.toUpperCase() })
        result.push({ type: 'dialogue', text: dialogueText })
      } else {
        result.push({ type: 'action', text: trimmed })
      }
    })

    return result
  }

  const parsed = parseScript(multiActorPrompt)

  return (
    <div className="d3-flex-col d3-gap-3" style={{ height: '100%' }}>
      <div className="d3-panel-section-title">
        <span>Script Supervisor</span>
        <button
          type="button"
          onClick={() => setIsEditing(!isEditing)}
          className="d3-preset-chip"
          style={{ padding: '2px 8px', borderRadius: '4px' }}
        >
          {isEditing ? 'View Page' : 'Edit Script'}
        </button>
      </div>

      {isEditing ? (
        <textarea
          value={multiActorPrompt}
          onChange={(e) => setMultiActorPrompt(e.target.value)}
          placeholder="Host: dialogue...&#10;Guest: dialogue..."
          className="d3-story-textarea"
          style={{ height: '220px', fontFamily: 'Courier, monospace', fontSize: '12px' }}
        />
      ) : (
        <div className="d3-script-view" style={{ flex: 1, height: '220px' }}>
          <div className="d3-script-scene-header">SCENE 01</div>
          <div style={{ fontStyle: 'italic', marginBottom: '12px', fontSize: '11px', color: 'var(--d3-text-secondary)' }}>
            INT. D3 DIGITAL STAGE — MIDNIGHT
          </div>

          {parsed.length === 0 ? (
            <div style={{ color: 'var(--d3-text-muted)', textAlign: 'center', marginTop: '24px' }}>
              No dialogue written. Click Edit Script to compose.
            </div>
          ) : (
            parsed.map((line, idx) => {
              if (line.type === 'slug') {
                return (
                  <div key={idx} className="d3-script-scene-header" style={{ marginTop: '12px' }}>
                    {line.text}
                  </div>
                )
              }
              if (line.type === 'char') {
                return <div key={idx} className="d3-script-char">{line.text}</div>
              }
              if (line.type === 'dialogue') {
                return !hideDialogue ? (
                  <div key={idx} className="d3-script-dialogue">"{line.text}"</div>
                ) : (
                  <div key={idx} className="d3-script-dialogue" style={{ opacity: 0.25 }}>Dialogue Hidden</div>
                )
              }
              return (
                <div key={idx} style={{ color: 'var(--d3-text-secondary)', marginBottom: '8px', fontSize: '11px' }}>
                  {line.text}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Script options */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', userSelect: 'none' }}>
        <label style={{ fontSize: '10px', color: 'var(--d3-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hideDialogue}
            onChange={(e) => setHideDialogue(e.target.checked)}
          />
          Mute/Hide Dialogue
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: 'auto' }}>
        <button
          type="button"
          className="d3-topbar__btn d3-topbar__btn--primary"
          onClick={onPlay}
          disabled={isPlaying}
          style={{ height: '32px', fontSize: '11px', justifyContent: 'center' }}
        >
          {isPlaying ? 'Directing...' : '▶ Play Script'}
        </button>
        <button
          type="button"
          className="d3-topbar__btn"
          onClick={onStop}
          style={{ height: '32px', fontSize: '11px', justifyContent: 'center' }}
        >
          ⏹ Stop
        </button>
      </div>
    </div>
  )
}
