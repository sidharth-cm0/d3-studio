import type { D3IntroMode } from './CinematicTimeline'

interface CinematicModeSelectorProps {
  visible: boolean
  ready: boolean
  activatingMode: D3IntroMode | null
  onSelectMode: (mode: D3IntroMode) => void
  onHoverMode: (mode: D3IntroMode | null) => void
}

function ModeIcon({ mode }: { mode: D3IntroMode }) {
  if (mode === 'ai') {
    return (
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <path className="d3-cinematic-mode__glyph-core" d="M60 12 C42 28 78 42 60 58 C42 74 78 88 60 108" />
        {[22, 38, 56, 74, 92].map((y, index) => (
          <g key={y}>
            <circle cx="60" cy={y} r="5" />
            <path d={`M60 ${y} C ${index % 2 ? 82 : 38} ${y + 3}, ${index % 2 ? 92 : 28} ${y + 14}, ${index % 2 ? 103 : 17} ${y + 12}`} />
            <circle cx={index % 2 ? 103 : 17} cy={y + 12} r="3.5" />
          </g>
        ))}
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle className="d3-cinematic-mode__lens" cx="60" cy="60" r="38" />
      {[0, 60, 120, 180, 240, 300].map((rotation) => (
        <path
          key={rotation}
          className="d3-cinematic-mode__blade"
          d="M60 22 L76 58 L60 63 Z"
          transform={`rotate(${rotation} 60 60)`}
        />
      ))}
      <path className="d3-cinematic-mode__glyph-core" d="M20 60 H38 M82 60 H100 M60 20 V38 M60 82 V100" />
      <rect x="30" y="30" width="60" height="60" rx="7" />
    </svg>
  )
}

function BurningPaperMode({
  mode,
  ready,
  activating,
  onSelectMode,
  onHoverMode,
}: {
  mode: D3IntroMode
  ready: boolean
  activating: boolean
  onSelectMode: (mode: D3IntroMode) => void
  onHoverMode: (mode: D3IntroMode | null) => void
}) {
  const isAi = mode === 'ai'
  const label = isAi ? 'AI MODE' : 'DIRECTOR MODE'
  const kicker = isAi ? 'GENERATIVE PIPELINE' : 'MANUAL CONTROL'
  const route = isAi ? 'PROMPT → SCENE → MOTION' : 'SCENE → CAMERA → PERFORMANCE'

  return (
    <button
      type="button"
      className={`d3-cinematic-mode d3-cinematic-mode--${mode} ${ready ? 'd3-cinematic-mode--ready' : ''} ${activating ? 'd3-cinematic-mode--activating' : ''}`}
      disabled={!ready || activating}
      aria-label={`Enter ${label}`}
      onClick={() => ready && onSelectMode(mode)}
      onMouseEnter={() => ready && onHoverMode(mode)}
      onMouseLeave={() => onHoverMode(null)}
      onFocus={() => ready && onHoverMode(mode)}
      onBlur={() => onHoverMode(null)}
    >
      <span className="d3-cinematic-mode__burn" aria-hidden="true" />
      <span className="d3-cinematic-mode__ash" aria-hidden="true" />
      <span className="d3-cinematic-mode__edge" aria-hidden="true" />
      <span className="d3-cinematic-mode__glowline" aria-hidden="true" />
      <span className="d3-cinematic-mode__icon">
        <ModeIcon mode={mode} />
      </span>
      <span className="d3-cinematic-mode__copy">
        <span>{kicker}</span>
        <strong>{label}</strong>
        <em>{route}</em>
      </span>
    </button>
  )
}

export function CinematicModeSelector({
  visible,
  ready,
  activatingMode,
  onSelectMode,
  onHoverMode,
}: CinematicModeSelectorProps) {
  return (
    <div
      className={`d3-cinematic-mode-selector ${visible ? 'd3-cinematic-mode-selector--visible' : ''} ${ready ? 'd3-cinematic-mode-selector--ready' : ''}`}
      aria-hidden={!visible}
    >
      <BurningPaperMode
        mode="ai"
        ready={ready}
        activating={activatingMode === 'ai'}
        onSelectMode={onSelectMode}
        onHoverMode={onHoverMode}
      />
      <BurningPaperMode
        mode="director"
        ready={ready}
        activating={activatingMode === 'director'}
        onSelectMode={onSelectMode}
        onHoverMode={onHoverMode}
      />
    </div>
  )
}