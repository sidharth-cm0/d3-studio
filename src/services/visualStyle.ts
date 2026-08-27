/**
 * Visual Style System — PHASE 1 + 1.1 (D3 Studio)
 *
 * A small typed catalog of cinematic looks layered ON TOP of the existing
 * environment pipeline:
 *
 *   Story → Episode → Environment → **Visual Style** → Lighting/Atmosphere
 *     → Characters → Motion → Camera → Render
 *
 * Design rules:
 *  - 'default' MUST preserve the current working look bit-for-bit. The
 *    controller treats it as "re-apply whatever the Environment Resolver
 *    graded" (an identity operation) — see visualStyleController.ts.
 *  - Only 'default' and 'noir_deco' are fully integrated in Phase 1. The
 *    other presets carry conservative placeholder values for future phases.
 *  - Pure data only: no Three.js imports here, mirroring the
 *    environmentResolver.ts pattern (cheap, testable, swappable).
 */

export type VisualStyle =
  | 'default'
  | 'noir_deco'
  | 'cyberpunk'
  | 'broadcast'
  | 'minimal'

/**
 * Conservative environment-MATERIAL grade (Phase 1.1) — applied to stage/
 * prop meshes only, NEVER to VRM character materials. All values are
 * multipliers/fractions derived from captured baselines (see
 * visualStyleController.ts), so repeated apply/restore cycles cannot
 * accumulate.
 */
export interface EnvironmentGradeParams {
  /** Baseline material-color brightness multiplier (HSL-lightness scale). */
  brightness: number
  /** 0..1 — fraction of baseline saturation removed (0 = keep, 1 = gray). */
  desaturation: number
  /** Baseline emissiveIntensity multiplier (tames self-lit env materials). */
  emissiveScale: number
}

export interface VisualStylePreset {
  id: VisualStyle
  label: string

  /** Scene background (mutated in place — no allocation per apply). */
  backgroundColor: string
  fogColor: string
  fogNear: number
  fogFar: number

  ambientIntensity: number

  keyLightIntensity: number
  keyLightColor: string

  rimLightIntensity: number
  rimLightColor: string

  fillLightIntensity: number
  fillLightColor: string

  /**
   * Optional light-position overrides (Phase 1.1). When present, the
   * controller moves the EXISTING lights while this style is active and
   * restores their baseline positions on 'default'. Omitted ⇒ positions
   * are left untouched (placeholder presets).
   */
  keyLightPosition?: [number, number, number]
  rimLightPosition?: [number, number, number]
  fillLightPosition?: [number, number, number]

  /**
   * Optional environment-material grade (Phase 1.1). When present, the
   * controller grades stage/prop materials (reversibly). Omitted ⇒ a mild
   * conservative fallback is used so early-enablement stays readable.
   */
  envGrade?: EnvironmentGradeParams

  /** Renderer tone-mapping exposure (ACESFilmic). */
  exposure: number

  /**
   * Visual animation sampling rate. `null` = native (update every rendered
   * frame). 24/12 quantizes CHARACTER motion time only — camera tweens, UI
   * and MediaPipe stay on native time. Rendering itself remains at the
   * browser refresh rate.
   */
  steppedFps: number | null

  /** 0..1 — CSS radial vignette opacity over the viewport. */
  vignetteStrength: number
  /** 0..1 — CSS film-grain layer opacity over the viewport. */
  grainStrength: number
}

/**
 * 'default' mirrors the app's ORIGINAL baseline (pre-style engine):
 * ambient 1.4 · key 1.5 #fff7ed · fill 1.1 #dbeafe · rim 1.8 #a0a0a0 ·
 * exposure 1.15 · no fog/atmosphere overrides of its own.
 *
 * NOTE: when style = 'default' the controller ignores most of these values
 * and re-applies the live EnvironmentResolver grade instead, so dynamic
 * story environments keep working exactly as before. The numbers below are
 * the documented fallback/baseline.
 */
const DEFAULT_PRESET: VisualStylePreset = {
  id: 'default',
  label: 'Default',
  backgroundColor: '#090909',
  fogColor: '#0b0f19',
  fogNear: 14,
  fogFar: 30,
  ambientIntensity: 1.4,
  keyLightIntensity: 1.5,
  keyLightColor: '#fff7ed',
  rimLightIntensity: 1.8,
  rimLightColor: '#a0a0a0',
  fillLightIntensity: 1.1,
  fillLightColor: '#dbeafe',
  exposure: 1.15,
  steppedFps: null,
  vignetteStrength: 0,
  grainStrength: 0,
}

/**
 * NOIR DECO — cinematic noir television-animation staging (1990s noir +
 * Art Deco theatrical feel, built from general principles only).
 *
 *  - deep charcoal/near-black stage, muted palette
 *  - very low but NON-ZERO ambient (faces stay readable)
 *  - strong warm-white frontal key from the existing upper/front position
 *  - strong cool steel rim from the existing rear position → silhouette pop
 *  - weak neutral-cool fill (shadows stay deep, not crushed)
 *  - subtle distant fog for atmospheric depth
 *  - slightly reduced exposure; gentle vignette + faint grain
 *  - 24 fps stepped motion sampling (filmic; safer than 12 for readability)
 *
 * Cel look strategy: VRM/MToon materials are ALREADY a toon shader — the
 * noir contrast comes from lighting ratios, not material replacement.
 */
const NOIR_DECO_PRESET: VisualStylePreset = {
  id: 'noir_deco',
  label: 'Noir Deco',
  backgroundColor: '#050607',
  fogColor: '#0a0d14',
  fogNear: 10,
  fogFar: 26,
  ambientIntensity: 0.18,
  keyLightIntensity: 2.2,
  keyLightColor: '#ffe0bd',
  rimLightIntensity: 2.8,
  rimLightColor: '#9bc6e3',
  fillLightIntensity: 0.12,
  fillLightColor: '#8fa3b8',
  // Front-left/upper-left key · rear-right/upper-right cool rim · weak
  // right-front fill — classic noir cross-lighting on the EXISTING lights.
  keyLightPosition: [-1.9, 2.6, 2.4],
  rimLightPosition: [2.6, 3.1, -2.3],
  fillLightPosition: [1.4, 1.5, 2.3],
  // Environment GRADE (not replacement): darken + desaturate stage/prop
  // materials and tame their self-illumination so bright day/dawn forests
  // read as dark blue-green atmosphere instead of a bright green screen.
  envGrade: { brightness: 0.62, desaturation: 0.32, emissiveScale: 0.45 },
  exposure: 0.85,
  steppedFps: 24,
  vignetteStrength: 0.48,
  grainStrength: 0.07,
}

/**
 * Mild fallback grade for presets without art-directed values yet — keeps
 * early enablement readable without committing to a full look. Exported for
 * the controller, which applies it when a preset omits `envGrade`.
 */
export const MILD_ENV_GRADE: EnvironmentGradeParams = {
  brightness: 0.85,
  desaturation: 0.15,
  emissiveScale: 0.8,
}

/**
 * Placeholder presets (Phase 2 candidates) — conservative values chosen not
 * to harm readability if enabled early; not fully art-directed yet.
 */
const CYBERPUNK_PLACEHOLDER: VisualStylePreset = {
  id: 'cyberpunk',
  label: 'Cyberpunk',
  backgroundColor: '#07080f',
  fogColor: '#0a0f1e',
  fogNear: 10,
  fogFar: 28,
  ambientIntensity: 0.5,
  keyLightIntensity: 1.9,
  keyLightColor: '#e8f4ff',
  rimLightIntensity: 2.6,
  rimLightColor: '#ff4d88',
  fillLightIntensity: 0.5,
  fillLightColor: '#67e8f9',
  exposure: 1.05,
  steppedFps: null,
  vignetteStrength: 0.3,
  grainStrength: 0.04,
}

const BROADCAST_PLACEHOLDER: VisualStylePreset = {
  id: 'broadcast',
  label: 'Broadcast',
  backgroundColor: '#101418',
  fogColor: '#141a20',
  fogNear: 16,
  fogFar: 34,
  ambientIntensity: 1.7,
  keyLightIntensity: 1.9,
  keyLightColor: '#ffffff',
  rimLightIntensity: 1.2,
  rimLightColor: '#aab4cc',
  fillLightIntensity: 1.35,
  fillLightColor: '#e8f1fa',
  exposure: 1.1,
  steppedFps: null,
  vignetteStrength: 0.12,
  grainStrength: 0.02,
}

const MINIMAL_PLACEHOLDER: VisualStylePreset = {
  id: 'minimal',
  label: 'Minimal',
  backgroundColor: '#0d1117',
  fogColor: '#11161d',
  fogNear: 14,
  fogFar: 30,
  ambientIntensity: 1.3,
  keyLightIntensity: 1.6,
  keyLightColor: '#ffffff',
  rimLightIntensity: 1.4,
  rimLightColor: '#c8cdd8',
  fillLightIntensity: 1.0,
  fillLightColor: '#dde3ee',
  exposure: 1.08,
  steppedFps: null,
  vignetteStrength: 0.15,
  grainStrength: 0.02,
}

/** Ordered catalog — also drives the UI selector. */
const PRESETS: Record<VisualStyle, VisualStylePreset> = {
  default: DEFAULT_PRESET,
  noir_deco: NOIR_DECO_PRESET,
  cyberpunk: CYBERPUNK_PLACEHOLDER,
  broadcast: BROADCAST_PLACEHOLDER,
  minimal: MINIMAL_PLACEHOLDER,
}

export const VISUAL_STYLE_OPTIONS: Array<{ id: VisualStyle; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'noir_deco', label: 'Noir Deco' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'minimal', label: 'Minimal' },
]

/** Look up a preset by id (falls back to 'default' on unknown input). */
export function getVisualStylePreset(id: VisualStyle): VisualStylePreset {
  return PRESETS[id] ?? DEFAULT_PRESET
}