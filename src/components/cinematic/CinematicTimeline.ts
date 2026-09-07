export type D3IntroMode = 'ai' | 'director'

export type CinematicState =
  | 'BOOT'
  | 'STUDIO_REVEAL'
  | 'CLAPBOARD_READY'
  | 'CLAP'
  | 'CAMERA_TRAVEL'
  | 'WOLF_REVEAL'
  | 'WOLF_IDLE'
  | 'WOLF_SMOKE'
  | 'EXHALE'
  | 'CIGAR_THROW'
  | 'CIGAR_IMPACT'
  | 'IGNITION'
  | 'PAPER_BURN'
  | 'MODES_REVEAL'
  | 'MODES_READY'
  | 'MODE_SELECTED'
  | 'EXIT'

export type QualityTier = 'high' | 'medium' | 'low'

export const CINEMATIC_STATE_ORDER: CinematicState[] = [
  'BOOT',
  'STUDIO_REVEAL',
  'CLAPBOARD_READY',
  'CLAP',
  'CAMERA_TRAVEL',
  'WOLF_REVEAL',
  'WOLF_IDLE',
  'WOLF_SMOKE',
  'EXHALE',
  'CIGAR_THROW',
  'CIGAR_IMPACT',
  'IGNITION',
  'PAPER_BURN',
  'MODES_REVEAL',
  'MODES_READY',
  'MODE_SELECTED',
  'EXIT',
]

export const ALLOWED_TRANSITIONS: Record<CinematicState, CinematicState[]> = {
  BOOT: ['STUDIO_REVEAL', 'EXIT'],
  STUDIO_REVEAL: ['CLAPBOARD_READY', 'EXIT'],
  CLAPBOARD_READY: ['CLAP', 'EXIT'],
  CLAP: ['CAMERA_TRAVEL', 'EXIT'],
  CAMERA_TRAVEL: ['WOLF_REVEAL', 'EXIT'],
  WOLF_REVEAL: ['WOLF_IDLE', 'EXIT'],
  WOLF_IDLE: ['WOLF_SMOKE', 'EXIT'],
  WOLF_SMOKE: ['EXHALE', 'EXIT'],
  EXHALE: ['CIGAR_THROW', 'EXIT'],
  CIGAR_THROW: ['CIGAR_IMPACT', 'EXIT'],
  CIGAR_IMPACT: ['IGNITION', 'EXIT'],
  IGNITION: ['PAPER_BURN', 'EXIT'],
  PAPER_BURN: ['MODES_REVEAL', 'EXIT'],
  MODES_REVEAL: ['MODES_READY', 'EXIT'],
  MODES_READY: ['MODE_SELECTED', 'EXIT'],
  MODE_SELECTED: ['EXIT'],
  EXIT: [],
}

interface TimelineCue {
  at: number
  state: CinematicState
}

const INTRO_CUES: TimelineCue[] = [
  { at: 90, state: 'STUDIO_REVEAL' },
  { at: 1850, state: 'CLAPBOARD_READY' },
]

const POST_CLAP_CUES: TimelineCue[] = [
  { at: 0, state: 'CLAP' },
  { at: 330, state: 'CAMERA_TRAVEL' },
  { at: 1720, state: 'WOLF_REVEAL' },
  { at: 3040, state: 'WOLF_IDLE' },
  { at: 4040, state: 'WOLF_SMOKE' },
  { at: 5480, state: 'EXHALE' },
  { at: 7040, state: 'CIGAR_THROW' },
  { at: 8180, state: 'CIGAR_IMPACT' },
  { at: 8610, state: 'IGNITION' },
  { at: 9480, state: 'PAPER_BURN' },
  { at: 11620, state: 'MODES_REVEAL' },
  { at: 13080, state: 'MODES_READY' },
]

export interface CinematicTimelineOptions {
  reducedMotion: boolean
  onState: (state: CinematicState, previous: CinematicState | null) => void
}

export class CinematicTimeline {
  private current: CinematicState = 'BOOT'
  private readonly reducedMotion: boolean
  private readonly onState: (state: CinematicState, previous: CinematicState | null) => void
  private readonly timers: number[] = []

  constructor(options: CinematicTimelineOptions) {
    this.reducedMotion = options.reducedMotion
    this.onState = options.onState
  }

  get state() {
    return this.current
  }

  start() {
    this.clearTimers()
    this.force('BOOT')
    INTRO_CUES.forEach((cue) => this.schedule(cue.state, cue.at))
  }

  clap() {
    if (this.current !== 'CLAPBOARD_READY') return false
    this.clearTimers()
    POST_CLAP_CUES.forEach((cue) => this.schedule(cue.state, cue.at))
    return true
  }

  selectMode() {
    if (this.current !== 'MODES_READY') return false
    this.clearTimers()
    this.transition('MODE_SELECTED')
    this.schedule('EXIT', this.reducedMotion ? 420 : 1220)
    return true
  }

  skip() {
    this.clearTimers()
    this.force('EXIT')
  }

  dispose() {
    this.clearTimers()
  }

  private schedule(state: CinematicState, baseDelay: number) {
    const timer = window.setTimeout(() => this.transition(state), this.scaleDelay(baseDelay))
    this.timers.push(timer)
  }

  private transition(next: CinematicState) {
    if (next === this.current) return
    if (!ALLOWED_TRANSITIONS[this.current].includes(next)) {
      if (import.meta.env.DEV) {
        console.warn(`[D3 CINEMATIC] Blocked invalid transition ${this.current} → ${next}`)
      }
      return
    }
    this.force(next)
  }

  private force(next: CinematicState) {
    const previous = this.current
    this.current = next
    this.onState(next, previous === next ? null : previous)
  }

  private scaleDelay(delay: number) {
    if (!this.reducedMotion) return delay
    return Math.max(80, Math.round(delay * 0.32))
  }

  private clearTimers() {
    this.timers.forEach((timer) => window.clearTimeout(timer))
    this.timers.length = 0
  }
}

export function isAtOrAfter(state: CinematicState, marker: CinematicState) {
  return CINEMATIC_STATE_ORDER.indexOf(state) >= CINEMATIC_STATE_ORDER.indexOf(marker)
}

export function stateClassName(state: CinematicState) {
  return state.toLowerCase().replace(/_/g, '-')
}

export function getQualityTier(reducedMotion: boolean): QualityTier {
  if (typeof window === 'undefined' || reducedMotion) return 'low'

  const width = window.innerWidth
  const cores = window.navigator.hardwareConcurrency || 4
  const pixelRatio = window.devicePixelRatio || 1

  if (width < 720 || cores <= 4 || pixelRatio > 2.4) return 'low'
  if (width < 1180 || cores <= 6) return 'medium'
  return 'high'
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}
