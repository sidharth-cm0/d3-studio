import React from 'react'
import { VISUAL_STYLE_OPTIONS } from '../services/visualStyle'

export interface TopBarProps {
  projectName?: string
  currentSequence?: string
  aiDirectorMode: 'ai' | 'director'
  setAiDirectorMode: (mode: 'ai' | 'director') => void
  onUndo: () => void
  onExport: () => void
  isExporting: boolean
  visualStyle: string
  setVisualStyle: (style: any) => void
  motionCadence: 'auto' | 12 | 24
  setMotionCadence: (cad: 'auto' | 12 | 24) => void
}

export function TopBar({
  projectName = 'D3 STUDIO ENGINE',
  currentSequence = 'Sequence_01_Main',
  aiDirectorMode,
  setAiDirectorMode,
  onUndo,
  onExport,
  isExporting,
  visualStyle,
  setVisualStyle,
  motionCadence,
  setMotionCadence,
}: TopBarProps) {
  return (
    <div className="d3-topbar">
      {/* Left section: Logo + Sequence status */}
      <div className="d3-topbar__left">
        <div className="d3-topbar__logo">D3 STUDIO</div>
        <div className="d3-topbar__project">
          <span className="d3-topbar__project-name">{projectName}</span>
          <span className="d3-topbar__project-sequence">· {currentSequence}</span>
        </div>
      </div>

      {/* Center section: AI Mode vs Director Mode toggle */}
      <div className="d3-topbar__center">
        <div className="d3-topbar__mode-selector" title="Switch creative workbench theme">
          <button
            type="button"
            className={`d3-topbar__mode-btn ${aiDirectorMode === 'ai' ? 'd3-topbar__mode-btn--active-ai' : ''}`}
            onClick={() => setAiDirectorMode('ai')}
          >
            AI Creative
          </button>
          <button
            type="button"
            className={`d3-topbar__mode-btn ${aiDirectorMode === 'director' ? 'd3-topbar__mode-btn--active-director' : ''}`}
            onClick={() => setAiDirectorMode('director')}
          >
            Director
          </button>
        </div>
      </div>

      {/* Right section: Style selectors + Save / Undo / Export / Settings */}
      <div className="d3-topbar__right">
        {/* Style Selector */}
        <select
          className="d3-select d3-style-controls__select"
          value={visualStyle}
          onChange={(e) => setVisualStyle(e.target.value)}
          title="Cinematic look layered on the current environment"
          style={{ width: 'auto', minWidth: '95px', height: '24px', fontSize: '10px', marginRight: '4px' }}
        >
          {VISUAL_STYLE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Cadence Segmented Selector */}
        <div
          className="d3-segmented"
          title="Character motion cadence — visual sampling only"
          style={{ marginRight: '8px' }}
        >
          {((['auto', 24, 12] as const)).map((cad) => (
            <button
              key={String(cad)}
              type="button"
              className={`d3-segmented-option ${motionCadence === cad ? 'd3-segmented-option--active' : ''}`}
              onClick={() => setMotionCadence(cad)}
              style={{ padding: '2px 8px', fontSize: '9px' }}
            >
              {cad === 'auto' ? 'Auto' : `${cad}f`}
            </button>
          ))}
        </div>

        {/* Undo Action */}
        <button
          type="button"
          onClick={onUndo}
          className="d3-topbar__btn"
          title="Undo latest action"
        >
          <span>⤺</span> Undo
        </button>

        {/* Export Action */}
        <button
          type="button"
          onClick={onExport}
          disabled={isExporting}
          className="d3-topbar__btn d3-topbar__btn--primary"
          title="Export package to Blender"
        >
          <span>📥</span> {isExporting ? 'Packaging...' : 'Export'}
        </button>
      </div>
    </div>
  )
}
