import React from 'react'
import CameraInspector from './CameraInspector'
import CharacterStrip from './CharacterStrip'

export interface RightInspectorProps {
  currentStage: string
  setCurrentStage: (stage: string) => void
  onBuildStageEnvironment: (stage: string) => void
  selectedShot: string
  onApplyCameraShot: (shot: string) => void
  onExportCameraAnimation: () => void

  // Contextual Selection Target
  activeTarget: 'scene' | 'lead' | 'supporting' | 'object'
  setActiveTarget: (target: 'scene' | 'lead' | 'supporting' | 'object') => void

  // Character Customizer Props
  skinColor: string
  setSkinColor: (color: string) => void
  hairColor: string
  setHairColor: (color: string) => void
  shirtColor: string
  setShirtColor: (color: string) => void
  hairStyle: 'short' | 'long'
  setHairStyle: (style: 'short' | 'long') => void
  jawScale: number
  setJawScale: (val: number) => void
  shoulderWidth: number
  setShoulderWidth: (val: number) => void

  // VRM Upload Actions
  leadName: string
  supportingName: string
  onUploadLead: () => void
  onUploadSupporting: () => void
  isInspectorCollapsed: boolean
  setInspectorCollapsed: (collapsed: boolean) => void
}

export function RightInspector({
  currentStage,
  setCurrentStage,
  onBuildStageEnvironment,
  selectedShot,
  onApplyCameraShot,
  onExportCameraAnimation,
  activeTarget,
  setActiveTarget,
  skinColor,
  setSkinColor,
  hairColor,
  setHairColor,
  shirtColor,
  setShirtColor,
  hairStyle,
  setHairStyle,
  jawScale,
  setJawScale,
  shoulderWidth,
  setShoulderWidth,
  leadName,
  supportingName,
  onUploadLead,
  onUploadSupporting,
  isInspectorCollapsed,
  setInspectorCollapsed,
}: RightInspectorProps) {
  const stageOptions = [
    { key: 'cyberpunk', name: 'Cyberpunk' },
    { key: 'broadcast', name: 'Newsroom' },
    { key: 'minimal', name: 'Minimal' },
  ]

  const selectStage = (key: string) => {
    setCurrentStage(key)
    onBuildStageEnvironment(key)
  }

  const handleSelectCharacter = (target: 'lead' | 'supporting') => {
    setActiveTarget(target)
  }

  return (
    <div className={`d3-inspector ${isInspectorCollapsed ? 'd3-inspector--collapsed' : ''}`}>
      {/* Context Tabs Selector */}
      <div className="d3-panel-header" style={{ marginBottom: '8px' }}>
        <div
          className="d3-segmented"
          style={{ width: '100%', padding: '2px' }}
        >
          <button
            type="button"
            className={`d3-segmented-option ${activeTarget === 'scene' ? 'd3-segmented-option--active' : ''}`}
            onClick={() => setActiveTarget('scene')}
            style={{ fontSize: '9px', padding: '4px 6px' }}
          >
            Scene
          </button>
          <button
            type="button"
            className={`d3-segmented-option ${activeTarget === 'lead' || activeTarget === 'supporting' ? 'd3-segmented-option--active' : ''}`}
            onClick={() => setActiveTarget('lead')}
            style={{ fontSize: '9px', padding: '4px 6px' }}
          >
            Actor
          </button>
          <button
            type="button"
            className={`d3-segmented-option ${activeTarget === 'object' ? 'd3-segmented-option--active' : ''}`}
            onClick={() => setActiveTarget('object')}
            style={{ fontSize: '9px', padding: '4px 6px' }}
          >
            Object
          </button>
        </div>
      </div>

      {/* SECTION 1: SCENE CONTEXT */}
      {activeTarget === 'scene' && (
        <div className="d3-flex-col d3-gap-4">
          {/* Stage Presets */}
          <div className="d3-inspector-section">
            <div className="d3-panel-section-title">Physical Stage</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {stageOptions.map((opt) => {
                const isSelected = currentStage === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    className={`d3-character-strip-item ${isSelected ? 'd3-character-strip-item--selected' : ''}`}
                    onClick={() => selectStage(opt.key)}
                    style={{
                      borderColor: isSelected ? 'var(--theme-accent)' : 'var(--d3-border)',
                      background: isSelected ? 'var(--theme-accent-bg)' : 'var(--d3-surface-1)',
                      justifyContent: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {opt.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Camera Controls */}
          <CameraInspector
            selectedShot={selectedShot}
            onApplyCameraShot={onApplyCameraShot}
            onExportCameraAnimation={onExportCameraAnimation}
          />

          {/* Actor list strip shortcut */}
          <CharacterStrip
            leadName={leadName}
            supportingName={supportingName}
            onSelectCharacter={handleSelectCharacter}
            activeTarget={null}
          />
        </div>
      )}

      {/* SECTION 2: CHARACTER CONTEXT (CUSTOMIZER & VRM UPLOADS) */}
      {(activeTarget === 'lead' || activeTarget === 'supporting') && (
        <div className="d3-flex-col d3-gap-4">
          <div className="d3-inspector-section">
            <div className="d3-panel-section-title">Actor Customization</div>
            <div
              className="d3-segmented"
              style={{ width: '100%', marginBottom: 'var(--d3-space-2)' }}
            >
              <button
                type="button"
                className={`d3-segmented-option ${activeTarget === 'lead' ? 'd3-segmented-option--active' : ''}`}
                onClick={() => setActiveTarget('lead')}
                style={{ fontSize: '9px', padding: '3px' }}
              >
                {leadName}
              </button>
              <button
                type="button"
                className={`d3-segmented-option ${activeTarget === 'supporting' ? 'd3-segmented-option--active' : ''}`}
                onClick={() => setActiveTarget('supporting')}
                style={{ fontSize: '9px', padding: '3px' }}
              >
                {supportingName}
              </button>
            </div>

            {/* Customizer controls (only active for Lead slot currently, supporting is functional underneath) */}
            <div className="d3-flex-col d3-gap-3">
              {/* Skin Tone */}
              <div className="d3-customize-section">
                <div className="d3-customize-section__label" style={{ fontSize: '10px' }}>Skin Complexion</div>
                <div className="d3-customize-swatches">
                  {[
                    { name: 'Deep', hex: '#523425' },
                    { name: 'Rich Brown', hex: '#6e473b' },
                    { name: 'Warm Tan', hex: '#96634e' },
                    { name: 'Golden Olive', hex: '#ba8565' },
                    { name: 'Fair', hex: '#ffd5c0' },
                  ].map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setSkinColor(c.hex)}
                      className="d3-swatch d3-swatch--circle"
                      style={{
                        background: c.hex,
                        border: skinColor === c.hex ? '2px solid var(--theme-accent)' : '1px solid var(--d3-border)',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Hair Style & Color */}
              <div className="d3-customize-section">
                <div className="d3-customize-section__label" style={{ fontSize: '10px' }}>Hair Style</div>
                <div className="d3-customize-hair-style" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <button
                    type="button"
                    className={`d3-topbar__btn ${hairStyle === 'short' ? 'd3-topbar__btn--primary' : ''}`}
                    onClick={() => setHairStyle('short')}
                    style={{ height: '24px', fontSize: '9px', justifyContent: 'center' }}
                  >
                    Short
                  </button>
                  <button
                    type="button"
                    className={`d3-topbar__btn ${hairStyle === 'long' ? 'd3-topbar__btn--primary' : ''}`}
                    onClick={() => setHairStyle('long')}
                    style={{ height: '24px', fontSize: '9px', justifyContent: 'center' }}
                  >
                    Long
                  </button>
                </div>
                <div className="d3-customize-swatches" style={{ marginTop: '4px' }}>
                  {['#140f0c', '#2c1810', '#4a2e1b', '#855430', '#c29d62'].map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setHairColor(hex)}
                      className="d3-swatch d3-swatch--circle"
                      style={{
                        background: hex,
                        border: hairColor === hex ? '2px solid var(--theme-accent)' : '1px solid var(--d3-border)',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Outfit color */}
              <div className="d3-customize-section">
                <div className="d3-customize-section__label" style={{ fontSize: '10px' }}>Wardrobe Color</div>
                <div className="d3-customize-swatches">
                  {['#2563eb', '#0f172a', '#15803d', '#dc2626', '#f8fafc'].map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setShirtColor(hex)}
                      className="d3-swatch"
                      style={{
                        background: hex,
                        border: shirtColor === hex ? '2px solid var(--theme-accent)' : '1px solid var(--d3-border)',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Jaw Scale */}
              <div className="d3-customize-section">
                <div className="d3-customize-range">
                  <label style={{ fontSize: '10px' }}>Jaw Scale: {jawScale.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.8"
                    max="1.3"
                    step="0.01"
                    value={jawScale}
                    onChange={(e) => setJawScale(parseFloat(e.target.value))}
                    className="d3-range"
                  />
                </div>
              </div>

              {/* Shoulder width */}
              <div className="d3-customize-section">
                <div className="d3-customize-range">
                  <label style={{ fontSize: '10px' }}>Shoulder Width: {shoulderWidth.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0.8"
                    max="1.4"
                    step="0.01"
                    value={shoulderWidth}
                    onChange={(e) => setShoulderWidth(parseFloat(e.target.value))}
                    className="d3-range"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Actor Import slot triggers */}
          <div className="d3-inspector-section">
            <div className="d3-panel-section-title">Upload VRM Avatar</div>
            <button
              type="button"
              className="d3-topbar__btn"
              onClick={activeTarget === 'lead' ? onUploadLead : onUploadSupporting}
              style={{ width: '100%', height: '32px', fontSize: '11px', justifyContent: 'center' }}
            >
              📁 Import VRM Avatar File
            </button>
            <span style={{ fontSize: '9px', color: 'var(--d3-text-muted)', textAlign: 'center', marginTop: '4px' }}>
              Compatible with VRM v1.0 standard specs.
            </span>
          </div>
        </div>
      )}

      {/* SECTION 3: OBJECT CONTEXT (PROCEDURAL PROPS READOUT) */}
      {activeTarget === 'object' && (
        <div className="d3-flex-col d3-gap-4">
          <div className="d3-inspector-section">
            <div className="d3-panel-section-title">Live Stage Props</div>
            <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--d3-border)', borderRadius: '6px', padding: '12px', fontSize: '11px', lineHeight: '1.6' }}>
              <div style={{ color: 'var(--theme-accent)', fontWeight: 700, marginBottom: '6px' }}>ENVIRONMENT INSTANCES</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--d3-text-secondary)' }}>Layout Kit:</span>
                <span style={{ fontWeight: 600 }}>{currentStage.toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--d3-text-secondary)' }}>Status:</span>
                <span style={{ color: 'var(--d3-success)', fontWeight: 600 }}>ACTIVE</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--d3-text-secondary)' }}>Instanced:</span>
                <span>Seed layout (proc)</span>
              </div>
            </div>
            <span style={{ fontSize: '10px', color: 'var(--d3-text-secondary)', marginTop: '8px', lineHeight: '1.4' }}>
              ℹ️ Props are auto-populated dynamically based on your Story prompt context keywords. Use <strong>Story Mode</strong> to generate specific environments.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
export default RightInspector
