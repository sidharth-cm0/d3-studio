import React from 'react'
import { D3Episode } from '../types/d3'

export interface SceneNavigatorProps {
  currentEpisode: D3Episode | null
  currentSceneIndex: number
  onSelectScene: (idx: number) => void
  onPrevious: () => void
  onNext: () => void
  setStatus: (status: string) => void
}

export function SceneNavigator({
  currentEpisode,
  currentSceneIndex,
  onSelectScene,
  onPrevious,
  onNext,
  setStatus,
}: SceneNavigatorProps) {
  if (!currentEpisode) {
    return (
      <div style={{ color: 'var(--d3-text-muted)', fontSize: '11px', textAlign: 'center', marginTop: '24px' }}>
        No scenes loaded. Describe a scene to begin.
      </div>
    )
  }

  // Get a scenic icon based on location names/presetId
  const getSceneIcon = (locationId: string): string => {
    const id = locationId.toLowerCase()
    if (id.includes('living') || id.includes('apartment') || id.includes('room')) return '🏠'
    if (id.includes('office') || id.includes('desk') || id.includes('work')) return '🏢'
    if (id.includes('street') || id.includes('city') || id.includes('road')) return '🏙'
    if (id.includes('forest') || id.includes('nature') || id.includes('wood')) return '🌲'
    if (id.includes('sci') || id.includes('lab') || id.includes('warehouse')) return '🔬'
    return '🎬'
  }

  return (
    <div className="d3-flex-col d3-gap-3" style={{ height: '100%' }}>
      <div className="d3-panel-section-title">Scene Navigator</div>

      <div className="d3-flex-col d3-gap-2 d3-scrollable" style={{ flex: 1, maxHeight: '280px', overflowY: 'auto' }}>
        {currentEpisode.scenes.map((scene, idx) => {
          const isSelected = idx === currentSceneIndex
          const duration = scene.shots.reduce((s, sh) => s + sh.duration, 0)
          const icon = getSceneIcon(scene.locationId)
          const sceneTitle = scene.title || `Scene ${scene.sceneNumber || (idx + 1)}`

          return (
            <button
              key={scene.id}
              type="button"
              className={`d3-scene-list-row ${isSelected ? 'd3-scene-list-row--selected' : ''}`}
              onClick={() => {
                onSelectScene(idx)
                setStatus(`Selected Scene ${idx + 1}: ${sceneTitle}`)
              }}
            >
              <div className="d3-scene-list-number">
                {String(idx + 1).padStart(2, '0')}
              </div>
              <div className="d3-scene-list-info">
                <div className="d3-scene-list-name">
                  <span style={{ marginRight: '6px' }}>{icon}</span>
                  {sceneTitle}
                </div>
                <div className="d3-scene-list-desc">
                  🎥 {scene.shots.length} shots · 🎭 {scene.castIds?.length || 2} cast
                </div>
              </div>
              <div className="d3-scene-list-duration">
                {duration.toFixed(1)}s
              </div>
              <div className="d3-scene-list-status d3-scene-list-status--ready" title="Ready to render" />
            </button>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: 'auto' }}>
        <button
          type="button"
          className="d3-topbar__btn"
          onClick={onPrevious}
          disabled={currentSceneIndex <= 0}
          style={{ height: '32px', fontSize: '11px', justifyContent: 'center' }}
        >
          ◀ Previous
        </button>
        <button
          type="button"
          className="d3-topbar__btn"
          onClick={onNext}
          disabled={currentSceneIndex >= currentEpisode.scenes.length - 1}
          style={{ height: '32px', fontSize: '11px', justifyContent: 'center' }}
        >
          Next ▶
        </button>
      </div>
    </div>
  )
}
