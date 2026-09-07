import React from 'react'

export interface CharacterStripProps {
  leadName?: string
  supportingName?: string
  onSelectCharacter: (target: 'lead' | 'supporting') => void
  activeTarget?: 'lead' | 'supporting' | null
}

export function CharacterStrip({
  leadName = 'Lead Actor',
  supportingName = 'Supporting Actor',
  onSelectCharacter,
  activeTarget,
}: CharacterStripProps) {
  return (
    <div className="d3-character-strip">
      <div className="d3-panel-section-title">Stage Actors</div>

      {/* Lead Actor Button */}
      <button
        type="button"
        className={`d3-character-strip-item ${activeTarget === 'lead' ? 'd3-character-strip-item--selected' : ''}`}
        onClick={() => onSelectCharacter('lead')}
        style={{
          borderColor: activeTarget === 'lead' ? 'var(--theme-accent)' : 'var(--d3-border)',
          background: activeTarget === 'lead' ? 'var(--theme-accent-bg)' : 'var(--d3-surface-1)',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--d3-text)' }}>👤 {leadName}</span>
        <div className="d3-character-strip-status">
          <span className="d3-character-strip-status-dot" style={{ backgroundColor: 'var(--d3-success)' }} />
          <span style={{ color: 'var(--d3-text-secondary)' }}>Ready</span>
        </div>
      </button>

      {/* Supporting Actor Button */}
      <button
        type="button"
        className={`d3-character-strip-item ${activeTarget === 'supporting' ? 'd3-character-strip-item--selected' : ''}`}
        onClick={() => onSelectCharacter('supporting')}
        style={{
          borderColor: activeTarget === 'supporting' ? 'var(--theme-accent)' : 'var(--d3-border)',
          background: activeTarget === 'supporting' ? 'var(--theme-accent-bg)' : 'var(--d3-surface-1)',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--d3-text)' }}>👥 {supportingName}</span>
        <div className="d3-character-strip-status">
          <span className="d3-character-strip-status-dot" style={{ backgroundColor: 'var(--d3-success)' }} />
          <span style={{ color: 'var(--d3-text-secondary)' }}>Ready</span>
        </div>
      </button>
    </div>
  )
}
export default CharacterStrip
