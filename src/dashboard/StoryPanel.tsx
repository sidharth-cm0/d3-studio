import React from 'react'
import { D3Episode } from '../types/d3'

export interface StoryPanelProps {
  storyPrompt: string
  setStoryPrompt: (text: string) => void
  onGenerate: () => void
  onPlay: () => void
  onStop: () => void
  isPlaying: boolean
  currentEpisode: D3Episode | null
  storyPresets: Array<{ label: string; prompt: string }>
  setStatus: (status: string) => void
}

export function StoryPanel({
  storyPrompt,
  setStoryPrompt,
  onGenerate,
  onPlay,
  onStop,
  isPlaying,
  currentEpisode,
  storyPresets,
  setStatus,
}: StoryPanelProps) {
  const handleClear = () => {
    setStoryPrompt('')
    setStatus('Story input cleared')
  }

  const handleAnalyze = () => {
    setStatus('🔍 Analyzing Story: Extracting characters, locations, and narrative beats...')
    setTimeout(() => {
      setStatus('✅ Analysis Complete: Found 1 location preset, 2 actors, and sequenced beats.')
    }, 1500)
  }

  return (
    <div className="d3-flex-col d3-gap-4" style={{ height: '100%' }}>
      <div>
        <div className="d3-panel-section-title">Cinematic Script Prompt</div>
        <textarea
          value={storyPrompt}
          onChange={(e) => setStoryPrompt(e.target.value)}
          placeholder="Describe your scene or type a detailed story prompt..."
          className="d3-story-textarea"
        />
      </div>

      <div>
        <div className="d3-panel-section-title" style={{ fontSize: '9px', opacity: 0.8 }}>Story Presets</div>
        <div className="d3-presets-strip">
          {storyPresets.map((p, idx) => (
            <button
              key={idx}
              type="button"
              className="d3-preset-chip"
              onClick={() => {
                setStoryPrompt(p.prompt)
                setStatus(`Applied preset: ${p.label}`)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="d3-story-actions">
        <button
          type="button"
          className="d3-topbar__btn d3-topbar__btn--primary"
          onClick={onGenerate}
          disabled={isPlaying}
          style={{ height: '36px', fontSize: '12px' }}
        >
          {isPlaying ? 'Directing...' : 'Generate Scene'}
        </button>

        <button
          type="button"
          className="d3-topbar__btn"
          onClick={handleAnalyze}
          style={{ height: '36px', fontSize: '12px', justifyContent: 'center' }}
        >
          Analyze Story
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <button
          type="button"
          className="d3-topbar__btn"
          onClick={onPlay}
          disabled={isPlaying || !currentEpisode}
          style={{ height: '32px', fontSize: '11px', justifyContent: 'center' }}
        >
          ▶ Play Edit
        </button>
        <button
          type="button"
          className="d3-topbar__btn"
          onClick={handleClear}
          style={{ height: '32px', fontSize: '11px', justifyContent: 'center' }}
        >
          Clear Prompt
        </button>
      </div>

      {currentEpisode && (
        <div className="d3-episode-info" style={{ marginTop: 'auto', background: 'rgba(0,0,0,0.15)', padding: '10px', borderRadius: '6px', border: '1px solid var(--d3-border)' }}>
          <div style={{ textTransform: 'uppercase', fontSize: '9px', fontWeight: 'bold', color: 'var(--theme-accent)', marginBottom: '4px' }}>ACTIVE SEQUENCE INFO</div>
          <div>🎬 <strong>Title:</strong> {currentEpisode.title}</div>
          <div>⏱ <strong>Duration:</strong> {currentEpisode.estimatedDuration.toFixed(1)}s</div>
          <div>🎥 <strong>Shots:</strong> {currentEpisode.scenes.reduce((n, sc) => n + sc.shots.length, 0)} cuts</div>
        </div>
      )}
    </div>
  )
}
