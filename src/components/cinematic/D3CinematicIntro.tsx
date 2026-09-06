import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CinematicAudio } from './CinematicAudio'
import { CinematicFire } from './CinematicFire'
import { CinematicModeSelector } from './CinematicModeSelector'
import { CinematicScene } from './CinematicScene'
import { CinematicSmoke } from './CinematicSmoke'
import {
  CinematicTimeline,
  getQualityTier,
  isAtOrAfter,
  prefersReducedMotion,
  stateClassName,
  type CinematicState,
  type D3IntroMode,
  type QualityTier,
} from './CinematicTimeline'
import './cinematic.css'

export type { D3IntroMode }

interface D3CinematicIntroProps {
  onSelectMode: (mode: D3IntroMode) => void
  onSkip?: () => void
}

function CinematicClapboard({ ready, closing, onClap }: { ready: boolean; closing: boolean; onClap: () => void }) {
  return (
    <section className="d3-cinematic-clapboard-stage" aria-labelledby="d3-cinematic-title">
      <div className="d3-cinematic-brand">
        <span>D3 STUDIOS</span>
        <h1 id="d3-cinematic-title">Cinematic Systems Online</h1>
      </div>

      <button
        type="button"
        className={`d3-cinematic-clapboard ${ready ? 'd3-cinematic-clapboard--ready' : ''} ${closing ? 'd3-cinematic-clapboard--closing' : ''}`}
        aria-label="Clap the D3 Studios slate to start the cinematic intro"
        aria-disabled={!ready}
        onClick={onClap}
      >
        <span className="d3-cinematic-clapboard__shadow" aria-hidden="true" />
        <span className="d3-cinematic-clapboard__dust d3-cinematic-clapboard__dust--left" aria-hidden="true" />
        <span className="d3-cinematic-clapboard__dust d3-cinematic-clapboard__dust--right" aria-hidden="true" />
        <span className="d3-cinematic-clapboard__hinge" aria-hidden="true" />
        <span className="d3-cinematic-clapboard__top" aria-hidden="true">
          <span />
          <span />
        </span>
        <span className="d3-cinematic-clapboard__body" aria-hidden="true">
          <span className="d3-cinematic-clapboard__texture" />
          <span className="d3-cinematic-clapboard__row">
            <small>PRODUCTION</small>
            <strong>D3 STUDIOS</strong>
          </span>
          <span className="d3-cinematic-clapboard__row">
            <small>SCENE</small>
            <strong>01</strong>
          </span>
          <span className="d3-cinematic-clapboard__row">
            <small>TAKE</small>
            <strong>01</strong>
          </span>
          <span className="d3-cinematic-clapboard__row d3-cinematic-clapboard__row--wide">
            <small>DIRECTOR</small>
            <strong>YOU</strong>
          </span>
          <span className="d3-cinematic-clapboard__engraving">MATTE GRAPHITE · COLD STAGE · HOT PRACTICALS</span>
        </span>
      </button>

      <p className="d3-cinematic-hint">
        {ready ? 'Click the slate or press Enter to roll camera' : 'Studio waking…'}
      </p>
    </section>
  )
}

function CinematicParticleCanvas({
  state,
  quality,
  reducedMotion,
  paused,
  hoveredMode,
  particleTickRef,
  onImpact,
  onIgnition,
  onExhale,
}: {
  state: CinematicState
  quality: QualityTier
  reducedMotion: boolean
  paused: boolean
  hoveredMode: D3IntroMode | null
  particleTickRef: React.MutableRefObject<((dt: number, now: number, stateAge: number) => void) | null>
  onImpact: () => void
  onIgnition: () => void
  onExhale: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef(state)
  const hoveredModeRef = useRef(hoveredMode)
  const pausedRef = useRef(paused)
  const smokeRef = useRef<CinematicSmoke | null>(null)
  const fireRef = useRef<CinematicFire | null>(null)
  const eventMarkers = useRef({ impact: false, ignition: false, exhale: false, clap: false })

  useEffect(() => {
    stateRef.current = state
    if (state === 'CLAP') eventMarkers.current.clap = false
    if (state === 'EXHALE') eventMarkers.current.exhale = false
    if (state === 'CIGAR_IMPACT') eventMarkers.current.impact = false
    if (state === 'IGNITION') eventMarkers.current.ignition = false
  }, [state])

  useEffect(() => {
    hoveredModeRef.current = hoveredMode
  }, [hoveredMode])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    smokeRef.current = new CinematicSmoke(quality, reducedMotion)
    fireRef.current = new CinematicFire(quality, reducedMotion)
    return () => {
      particleTickRef.current = null
      smokeRef.current?.reset()
      fireRef.current?.reset()
    }
  }, [particleTickRef, quality, reducedMotion])

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const ratio = reducedMotion || quality === 'low' ? 1 : quality === 'medium' ? 1.25 : 1.45
      canvas.width = Math.max(1, Math.floor(rect.width * ratio))
      canvas.height = Math.max(1, Math.floor(rect.height * ratio))
      const context = canvas.getContext('2d')
      context?.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [quality, reducedMotion])

  useEffect(() => {
    particleTickRef.current = (dt, now, stateAge) => {
      if (pausedRef.current) return
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      const smoke = smokeRef.current
      const fire = fireRef.current
      if (!canvas || !context || !smoke || !fire) return
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height
      context.clearRect(0, 0, width, height)

      const liveState = stateRef.current
      if (liveState === 'CLAP' && !eventMarkers.current.clap) {
        eventMarkers.current.clap = true
        fire.burstClap(width, height)
      }
      if (liveState === 'EXHALE' && !eventMarkers.current.exhale) {
        eventMarkers.current.exhale = true
        smoke.burst(width, height)
        onExhale()
      }
      if (liveState === 'CIGAR_IMPACT' && !eventMarkers.current.impact) {
        eventMarkers.current.impact = true
        fire.burstImpact(width, height)
        onImpact()
      }
      if (liveState === 'IGNITION' && !eventMarkers.current.ignition) {
        eventMarkers.current.ignition = true
        onIgnition()
      }

      smoke.draw(context, dt, now, liveState, stateAge, width, height)
      fire.draw(context, dt, now, liveState, stateAge, width, height, hoveredModeRef.current)
    }
  }, [onExhale, onIgnition, onImpact, particleTickRef])

  return <canvas ref={canvasRef} className="d3-cinematic-particles" aria-hidden="true" />
}

export function D3CinematicIntro({ onSelectMode, onSkip }: D3CinematicIntroProps) {
  const reducedMotion = useMemo(prefersReducedMotion, [])
  const quality = useMemo(() => getQualityTier(reducedMotion), [reducedMotion])
  const [state, setState] = useState<CinematicState>('BOOT')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [paused, setPaused] = useState(false)
  const [selectedMode, setSelectedMode] = useState<D3IntroMode | null>(null)
  const [hoveredMode, setHoveredMode] = useState<D3IntroMode | null>(null)
  const [gorillaAssetStatus, setGorillaAssetStatus] = useState<'loading' | 'loaded' | 'unavailable'>('loading')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const webglHostRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<CinematicScene | null>(null)
  const audioRef = useRef<CinematicAudio | null>(null)
  const timelineRef = useRef<CinematicTimeline | null>(null)
  const particleTickRef = useRef<((dt: number, now: number, stateAge: number) => void) | null>(null)

  const canClap = state === 'CLAPBOARD_READY'
  const clapboardVisible = state === 'BOOT' || state === 'STUDIO_REVEAL' || state === 'CLAPBOARD_READY' || state === 'CLAP'
  const modesVisible = isAtOrAfter(state, 'MODES_REVEAL')
  const modesReady = state === 'MODES_READY'

  useEffect(() => {
    const audio = new CinematicAudio()
    audio.setMuted(!soundEnabled)
    audioRef.current = audio

    const timeline = new CinematicTimeline({
      reducedMotion,
      onState: (next) => {
        setState(next)
        sceneRef.current?.setState(next)
      },
    })
    timelineRef.current = timeline
    timeline.start()

    return () => {
      timeline.dispose()
      audio.dispose()
      timelineRef.current = null
      audioRef.current = null
    }
  }, [reducedMotion])

  useEffect(() => {
    audioRef.current?.setMuted(!soundEnabled)
  }, [soundEnabled])

  useEffect(() => {
    const host = webglHostRef.current
    if (!host) return
    const scene = new CinematicScene({
      quality,
      reducedMotion,
      onGorillaLoaded: (loaded) => setGorillaAssetStatus(loaded ? 'loaded' : 'unavailable'),
      onRenderParticleLayer: (dt, now, stateAge) => particleTickRef.current?.(dt, now, stateAge),
    })
    sceneRef.current = scene
    scene.mount(host)
    scene.setState(state)
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [quality, reducedMotion])

  useEffect(() => {
    sceneRef.current?.setSelectedMode(selectedMode)
  }, [selectedMode])

  useEffect(() => {
    sceneRef.current?.setHoveredMode(hoveredMode)
  }, [hoveredMode])

  useEffect(() => {
    sceneRef.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    const onVisibilityChange = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  const handleSkip = useCallback(() => {
    timelineRef.current?.skip()
    onSkip?.()
  }, [onSkip])

  const handleClap = useCallback(() => {
    if (!timelineRef.current?.clap()) return
    void audioRef.current?.playClap().catch((error) => {
      console.warn('Unable to play D3 procedural clap:', error)
    })
  }, [])

  const handleSelectMode = useCallback((mode: D3IntroMode) => {
    if (!timelineRef.current?.selectMode()) return
    setSelectedMode(mode)
    void audioRef.current?.playMode(mode).catch((error) => {
      console.warn('Unable to play D3 mode sting:', error)
    })
    window.setTimeout(() => onSelectMode(mode), reducedMotion ? 460 : 1160)
  }, [onSelectMode, reducedMotion])

  const handleImpact = useCallback(() => {
    void audioRef.current?.playImpact().catch((error) => {
      console.warn('Unable to play D3 cigar impact:', error)
    })
  }, [])

  const handleIgnition = useCallback(() => {
    void audioRef.current?.playIgnition().catch((error) => {
      console.warn('Unable to play D3 ignition:', error)
    })
  }, [])

  const handleExhale = useCallback(() => {
    // Kept as an explicit state cue hook for future file-based breath/room foley.
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current
    if (!root || reducedMotion || quality === 'low') return
    const rect = root.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    root.style.setProperty('--pointer-x', x.toFixed(4))
    root.style.setProperty('--pointer-y', y.toFixed(4))
    root.style.setProperty('--tilt-x', `${(-y * 7).toFixed(3)}deg`)
    root.style.setProperty('--tilt-y', `${(x * 9).toFixed(3)}deg`)
    sceneRef.current?.setPointer(x, y)
  }, [quality, reducedMotion])

  const resetPointer = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    root.style.setProperty('--pointer-x', '0')
    root.style.setProperty('--pointer-y', '0')
    root.style.setProperty('--tilt-x', '0deg')
    root.style.setProperty('--tilt-y', '0deg')
    sceneRef.current?.setPointer(0, 0)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleSkip()
        return
      }
      if ((event.key === 'Enter' || event.key === ' ') && canClap) {
        event.preventDefault()
        handleClap()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canClap, handleClap, handleSkip])

  return (
    <div
      ref={rootRef}
      className={[
        'd3-cinematic-intro',
        `d3-cinematic-intro--${stateClassName(state)}`,
        `d3-cinematic-intro--quality-${quality}`,
        reducedMotion ? 'd3-cinematic-intro--reduced-motion' : '',
        paused ? 'd3-cinematic-intro--paused' : '',
        selectedMode ? `d3-cinematic-intro--selected-${selectedMode}` : '',
      ].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label="D3 Studios cinematic intro"
      data-state={state}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
    >
      <div ref={webglHostRef} className="d3-cinematic-webgl-host" aria-hidden="true" />
      <CinematicParticleCanvas
        state={state}
        quality={quality}
        reducedMotion={reducedMotion}
        paused={paused}
        hoveredMode={hoveredMode}
        particleTickRef={particleTickRef}
        onImpact={handleImpact}
        onIgnition={handleIgnition}
        onExhale={handleExhale}
      />

      <div className="d3-cinematic-grade" aria-hidden="true">
        <span className="d3-cinematic-grade__haze d3-cinematic-grade__haze--blue" />
        <span className="d3-cinematic-grade__haze d3-cinematic-grade__haze--amber" />
        <span className="d3-cinematic-grade__grain" />
        <span className="d3-cinematic-grade__vignette" />
        <span className="d3-cinematic-grade__flash" />
      </div>

      <div className="d3-cinematic-controls">
        <button
          type="button"
          className="d3-cinematic-control"
          onClick={() => setSoundEnabled((enabled) => !enabled)}
          aria-pressed={soundEnabled}
        >
          Sound {soundEnabled ? 'On' : 'Off'}
        </button>
        <button type="button" className="d3-cinematic-control" onClick={handleSkip}>
          Skip Intro
        </button>
      </div>

      <div className="d3-cinematic-status" aria-live="polite">
        <span>{state.replace(/_/g, ' ')}</span>
        <strong>
          {gorillaAssetStatus === 'loaded'
            ? 'LICENSED PRIMATE ASSET LOADED'
            : gorillaAssetStatus === 'unavailable'
              ? 'PRIMATE ASSET UNAVAILABLE — NO FAKE SUBSTITUTE'
              : 'LOADING LICENSED PRIMATE ASSET'}
        </strong>
      </div>

      {clapboardVisible && <CinematicClapboard ready={canClap} closing={state === 'CLAP'} onClap={handleClap} />}

      <div className="d3-cinematic-sequence-caption" aria-hidden={state === 'BOOT'}>
        {state === 'GORILLA_SMOKE' && 'Ember climbs. Breath draws in.'}
        {state === 'EXHALE' && 'Smoke rolls through the cold rim light.'}
        {state === 'CIGAR_THROW' && 'The cigar leaves the hand.'}
        {state === 'CIGAR_IMPACT' && 'Impact before ignition.'}
        {state === 'IGNITION' && 'Fire takes the paper edge.'}
        {state === 'PAPER_BURN' && 'Two routes burn into view.'}
      </div>

      <CinematicModeSelector
        visible={modesVisible}
        ready={modesReady}
        activatingMode={selectedMode}
        onSelectMode={handleSelectMode}
        onHoverMode={setHoveredMode}
      />

      <div className="d3-cinematic-exit-bridge" aria-hidden="true" />
    </div>
  )
}