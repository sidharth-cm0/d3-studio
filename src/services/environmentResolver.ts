/**
 * Environment Resolver — story/scene metadata → SEMANTIC ENVIRONMENT BLUEPRINT.
 *
 * Pipeline position (upgrades the EXISTING stage system, does not replace it):
 *
 *   Story Prompt / Scene metadata (title, locationId, narrativeGoal,
 *   emotionalTone, timeOfDay)
 *     → EnvironmentResolverService.resolve()
 *     → ResolvedEnvironment {
 *         preset + sky/fog + lighting mood      (existing stage system)
 *         blueprint: {                          (semantic description)
 *           category · mood · timeOfDay · layout
 *           props: [{ type, count }]            (declarative prop requests)
 *           details: { abandoned, rain, luxury, crowded, empty, old }
 *           seed                                (deterministic layout identity)
 *         }
 *       }
 *     → buildEnvironmentGroup() in environmentStage.ts
 *         (reusable prop library → zoned seeded layout → Three.js Group)
 *     → existing buildStageEnvironment() in App.tsx
 *
 * Design rules:
 *  - Fully deterministic + offline (same input ⇒ same environment, always).
 *  - The resolver is PURE DATA: no Three.js here. Geometry lives in
 *    environmentStage.ts so this module stays cheap and testable.
 *  - ProceduralEnvironmentProvider is the DEFAULT and only shipped provider.
 *  - Generic keyword rules only — never hardcoded to one story's text.
 */

import type { D3StagePresetId, D3TimeOfDay } from '../types/d3'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Recognized location archetypes (keyword-driven, extensible). */
export type EnvironmentLocationKind =
  | 'stage' // no recognizable location → classic preset stage
  | 'broadcast' // news studio / newsroom
  | 'railway' // platform / station / subway
  | 'warehouse' // industrial / depot / factory
  | 'apartment' // home interior
  | 'office' // corporate / lab / data core
  | 'alley' // cyberpunk neon alley (classic base stage look)
  | 'interior' // generic indoor room
  | 'street' // outdoor city street
  | 'forest' // woods / clearing

/** Mood drives the lighting grade (time-of-day + emotional keywords). */
export type EnvironmentMood =
  | 'neutral'
  | 'bright'
  | 'soft'
  | 'somber'
  | 'night'
  | 'midnight'
  | 'dusk'
  | 'dawn'
  | 'tension'
  | 'horror'

/**
 * Semantic prop request — the resolver asks for WHAT and HOW MANY; the
 * procedural builder in environmentStage.ts decides HOW (geometry, materials,
 * exact placement inside its layout zones).
 */
export type PropType =
  // architecture
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'doorway'
  | 'window'
  | 'pillar'
  | 'platform'
  | 'stairs'
  // furniture
  | 'table'
  | 'desk'
  | 'chair'
  | 'sofa'
  | 'shelf'
  // industrial
  | 'crate'
  | 'barrel'
  | 'rack'
  | 'pipe'
  | 'beam'
  // outdoor
  | 'road'
  | 'sidewalk'
  | 'lampPost'
  | 'tree'
  | 'building'
  | 'fence'
  // railway
  | 'track'
  | 'bench'
  | 'stationLight'
  // misc
  | 'rock'
  | 'screen'

export interface BlueprintPropRequest {
  type: PropType
  count: number
}

/**
 * Per-category material palette (Phase 2). Pure data — the composers map
 * these roles onto their prop materials so every category keeps a coherent,
 * recognizable color identity that VisualStyleController can still grade.
 */
export interface PaletteSpec {
  /** Dominant surface color (walls / foliage masses / building bodies). */
  primary: number
  /** Secondary contrast surface (canopy tops / furniture / trim). */
  secondary: number
  /** Accent (trunks / rails / signage glow bases). */
  accent: number
  /** Ground/floor tone. */
  ground: number
  /** Wall/backdrop tone (interiors). */
  wall: number
}

/** Declarative light-fixture request (emissive props — NOT scene lights). */
export interface BlueprintLightRequest {
  kind: 'hanging' | 'floor_lamp' | 'station' | 'street' | 'studio_bar' | 'screen_glow'
  count: number
  /** false → fixture present but dark (abandoned scenes). */
  lit: boolean
}

/** Story-aware detail flags extracted from generic keywords. */
export interface EnvironmentDetails {
  /** "abandoned / derelict / deserted" → fewer lights, darker, scattered props. */
  abandoned: boolean
  /** "rain / storm / wet" → darker wetter ground, denser fog. No particles. */
  rain: boolean
  /** "luxury / penthouse / grand" → cleaner layout, larger open space. */
  luxury: boolean
  /** "crowded / busy / packed" → more props. */
  crowded: boolean
  /** "empty / bare / vacant" → fewer props. */
  empty: boolean
  /** "old / aged / weathered" → darker muted material palette. */
  old: boolean
}

/** Structured semantic description of the environment to generate. */
export interface EnvironmentBlueprint {
  category: EnvironmentLocationKind
  mood: EnvironmentMood
  /** Coarse time-of-day label derived from scene data + mood. */
  timeOfDay: 'day' | 'dawn' | 'dusk' | 'night'
  /** Named spatial layout the composer will realize. */
  layout: string
  /** Declarative prop requests (counts already scaled by crowded/empty). */
  props: BlueprintPropRequest[]
  details: EnvironmentDetails
  /**
   * Deterministic layout seed. Same scene/location ⇒ same seed ⇒ same layout;
   * different scene/location ⇒ different seed ⇒ different layout. Never
   * re-randomized per render.
   */
  seed: number
  /**
   * Phase 2 — structured composition spec consumed by environmentStage.ts:
   * palette roles, emissive prop requests and the safety envelope. The
   * declarative `props[]` list above stays the source of truth for WHAT to
   * place; these fields describe HOW the composition is organized.
   */
  palette: PaletteSpec
  lights: BlueprintLightRequest[]
  /** Depth composition contract: named layers back-to-front. */
  depthLayers: ('far' | 'mid' | 'near')[]
  /** Actor-safe rectangle around origin (half extents). Geometry-free zone. */
  actorSafeZone: { halfX: number; halfZ: number }
  /** Camera-safe radius around the default shot pivot (0, ~1.55, +2.8). */
  cameraSafeRadius: number
}

/** Structured environment description consumed by the Three.js stage builder. */
export interface ResolvedEnvironment {
  /** Existing D3StagePresetId this environment is anchored to (base stage colors). */
  preset: D3StagePresetId
  locationKind: EnvironmentLocationKind
  mood: EnvironmentMood
  /**
   * True  → reuse the classic disc/ring/pillar/grid stage look (existing code).
   * False → blueprint drives a composed procedural environment.
   */
  useBaseStage: boolean
  skyColor: string
  fogColor: string
  fogNear: number
  fogFar: number
  ambientIntensity: number
  keyLightIntensity: number
  fillLightIntensity: number
  rimLightIntensity: number
  keyLightColor: string
  fillLightColor: string
  rimLightColor: string
  blueprint: EnvironmentBlueprint
  /** Stable identity — equal signatures mean "already applied", skipping rebuilds. */
  signature: string
  /** Human-readable summary for status/debug. */
  label: string
}

export interface EnvironmentRequest {
  /** Free text: scene title + location name + narrativeGoal + emotionalTone… */
  searchText: string
  /** Canonical time-of-day from the scene (takes priority over text keywords). */
  timeOfDay?: D3TimeOfDay
  /** Dominant emotion string (e.g. D3Emotion) used as a last-resort mood hint. */
  emotionalTone?: string
  /** Preset to anchor to when nothing is recognized (current stage as fallback). */
  fallbackPreset?: D3StagePresetId
  /**
   * Stable identity for the seeded layout (location id, scene id, or prompt).
   * Same key ⇒ same generated layout; omitted ⇒ derived from searchText.
   */
  seedKey?: string
}

/**
 * Provider seam for future generated backgrounds/skyboxes.
 * The default MUST remain procedural/offline; remote providers are optional
 * add-ons registered via EnvironmentResolverService.setProvider().
 */
export interface EnvironmentProvider {
  readonly id: string
  resolve(request: EnvironmentRequest): ResolvedEnvironment
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (seeded from text hash — stable per scene content)
// ---------------------------------------------------------------------------

function hashString(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return h
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Rule tables — location recognition (ordered, first match wins)
// ---------------------------------------------------------------------------

const LOCATION_KIND_RULES: Array<{ keys: RegExp; kind: EnvironmentLocationKind }> = [
  {
    keys: /(news|broadcast|newsroom|anchor|television|\btv\b|press\s?room|talk\s?show)/,
    kind: 'broadcast',
  },
  {
    keys: /(railway|rail\s?yard|train\s?station|\bstation\b|platform|subway|metro|underground|tram|tunnel)/,
    kind: 'railway',
  },
  {
    keys: /(warehouse|depot|storage|factory|industrial|dock|hangar|freight|cargo|foundry|\bmill\b)/,
    kind: 'warehouse',
  },
  {
    keys: /(apartment|flat\b|living\s?room|bedroom|kitchen|\bden\b|\bhome\b|house|loft|condo)/,
    kind: 'apartment',
  },
  {
    keys: /(office|cubicle|boardroom|meeting\s?room|server\s?room|data\s?core|laborator|\blab\b|corporate|headquarters)/,
    kind: 'office',
  },
  {
    keys: /(forest|woods\b|woodland|jungle|\btrees?\b|grove|\bpark\b)/,
    kind: 'forest',
  },
  {
    keys: /(\bstreet\b|road\b|avenue|boulevard|downtown|\bcity\b|sidewalk|urban|crosswalk)/,
    kind: 'street',
  },
  {
    keys: /(alley|backstreet|neon|cyberpunk|rooftop|slum|market)/,
    kind: 'alley',
  },
  {
    keys: /(room|interior|indoors|chamber|hallway|corridor|basement|attic|garage|bunker)/,
    kind: 'interior',
  },
]

/** Which existing stage preset each location kind anchors to. */
const KIND_PRESET: Record<EnvironmentLocationKind, D3StagePresetId | 'fallback'> = {
  stage: 'fallback',
  broadcast: 'broadcast',
  railway: 'minimal',
  warehouse: 'cyberpunk',
  apartment: 'minimal',
  office: 'minimal',
  alley: 'cyberpunk',
  interior: 'fallback',
  street: 'cyberpunk',
  forest: 'minimal',
}

/** Default mood per location when text/time give no signal. */
const KIND_DEFAULT_MOOD: Record<EnvironmentLocationKind, EnvironmentMood> = {
  stage: 'neutral',
  broadcast: 'bright',
  railway: 'night',
  warehouse: 'night',
  apartment: 'soft',
  office: 'neutral',
  alley: 'night',
  interior: 'neutral',
  street: 'night',
  forest: 'dawn',
}

// ---------------------------------------------------------------------------
// Rule tables — mood recognition (ordered, first match wins)
// ---------------------------------------------------------------------------

const MOOD_RULES: Array<{ keys: RegExp; mood: EnvironmentMood }> = [
  { keys: /(horror|suspense|creepy|eerie|haunted|dread|sinister|menacing|terrif|chilling|macabre)/, mood: 'horror' },
  { keys: /\bmidnight\b/, mood: 'midnight' },
  { keys: /\b(night|nighttime|nightfall)\b/, mood: 'night' },
  { keys: /(sunset|dusk|evening|golden\s?hour|twilight)/, mood: 'dusk' },
  { keys: /(dawn|sunrise|daybreak)/, mood: 'dawn' },
  { keys: /(suspicious|suspense|tense|tension|danger|threat|mystery|noir|investigat|crime|stakeout|urgent|alarm|confrontation|angry|furious)/, mood: 'tension' },
  { keys: /(sad|melanchol|grief|lonely|somber|mourning|regret|wistful)/, mood: 'somber' },
  { keys: /(romantic|gentle|soft|calm|peaceful|quiet|tender|intimate|cozy)/, mood: 'soft' },
  { keys: /(bright|cheerful|energetic|joyful|celebrat|sunny|lively)/, mood: 'bright' },
]

/** Canonical scene.timeOfDay → mood (explicit beats text keywords). */
const TIME_OF_DAY_MOOD: Partial<Record<D3TimeOfDay, EnvironmentMood>> = {
  midnight: 'midnight',
  night: 'night',
  dusk: 'dusk',
  dawn: 'dawn',
  morning: 'neutral',
  noon: 'bright',
  afternoon: 'bright',
}

/** EmotionalTone (D3Emotion or genre words) → mood, used only as last resort. */
const EMOTION_MOOD: Record<string, EnvironmentMood> = {
  angry: 'tension',
  suspicious: 'tension',
  sad: 'somber',
  happy: 'bright',
  surprised: 'neutral',
  focused: 'neutral',
  neutral: 'neutral',
}

// ---------------------------------------------------------------------------
// Story-aware DETAIL rules — generic keywords, never one specific story
// ---------------------------------------------------------------------------

const DETAIL_RULES: Array<{ key: keyof EnvironmentDetails; re: RegExp }> = [
  { key: 'abandoned', re: /(abandon|derelict|deserted|desolate|ruined?\b)/ },
  { key: 'rain', re: /(\brain\b|rainy|downpour|\bwet\b|\bstorm\b|drizzle)/ },
  { key: 'luxury', re: /(luxur|penthouse|grand\b|mansion|elegant|opulent|villa)/ },
  { key: 'crowded', re: /(crowd|busy|packed|bustling|teeming|filled with)/ },
  { key: 'empty', re: /(\bempty\b|\bbare\b|vacant|deserted|hollow)/ },
  { key: 'old', re: /(\bold\b|aged|weathered|ancient|dilapidated|faded|rusty)/ },
]

function detectDetails(lowerText: string): EnvironmentDetails {
  const d: EnvironmentDetails = {
    abandoned: false,
    rain: false,
    luxury: false,
    crowded: false,
    empty: false,
    old: false,
  }
  for (const rule of DETAIL_RULES) {
    if (rule.re.test(lowerText)) d[rule.key] = true
  }
  return d
}

// ---------------------------------------------------------------------------
// Lighting grades per mood
// (baseline equals the app's current hardcoded lights: ambient 1.4 / key 1.5 /
//  fill 1.1 / rim 1.8 — so 'neutral' reproduces today's look exactly)
// ---------------------------------------------------------------------------

interface MoodLighting {
  sky: string
  fogColor: string
  fogNear: number
  fogFar: number
  ambient: number
  key: number
  fill: number
  rim: number
  keyColor: string
  fillColor: string
  rimColor: string
}

const MOOD_LIGHTING: Record<EnvironmentMood, MoodLighting> = {
  neutral: { sky: '#0b0f19', fogColor: '#0b0f19', fogNear: 14, fogFar: 30, ambient: 1.4, key: 1.5, fill: 1.1, rim: 1.8, keyColor: '#fff7ed', fillColor: '#dbeafe', rimColor: '#818cf8' },
  bright: { sky: '#101827', fogColor: '#101827', fogNear: 16, fogFar: 32, ambient: 1.75, key: 1.75, fill: 1.35, rim: 1.5, keyColor: '#ffffff', fillColor: '#e0f2fe', rimColor: '#a5b4fc' },
  soft: { sky: '#141126', fogColor: '#141126', fogNear: 12, fogFar: 28, ambient: 1.55, key: 1.05, fill: 1.0, rim: 1.15, keyColor: '#ffe9dc', fillColor: '#ead9f2', rimColor: '#c4b5fd' },
  somber: { sky: '#0a0d16', fogColor: '#0a0d16', fogNear: 10, fogFar: 26, ambient: 0.75, key: 0.9, fill: 0.5, rim: 1.2, keyColor: '#dfe6ff', fillColor: '#9fb0d0', rimColor: '#8b9cc9' },
  night: { sky: '#04060c', fogColor: '#04060c', fogNear: 5, fogFar: 20, ambient: 0.32, key: 0.65, fill: 0.22, rim: 1.15, keyColor: '#cfe0ff', fillColor: '#8fa8cc', rimColor: '#3b5bdb' },
  midnight: { sky: '#020308', fogColor: '#020308', fogNear: 4, fogFar: 17, ambient: 0.2, key: 0.5, fill: 0.15, rim: 1.0, keyColor: '#bfd4ff', fillColor: '#7d94bb', rimColor: '#2f4bc7' },
  dusk: { sky: '#1d1226', fogColor: '#1d1226', fogNear: 6, fogFar: 22, ambient: 0.85, key: 1.35, fill: 0.55, rim: 1.45, keyColor: '#ffb36b', fillColor: '#c97b52', rimColor: '#ff7847' },
  dawn: { sky: '#131a2a', fogColor: '#131a2a', fogNear: 10, fogFar: 26, ambient: 1.05, key: 1.25, fill: 0.8, rim: 1.3, keyColor: '#ffd9a8', fillColor: '#cdd8f0', rimColor: '#93a7f5' },
  tension: { sky: '#08070d', fogColor: '#08070d', fogNear: 5, fogFar: 19, ambient: 0.5, key: 0.95, fill: 0.3, rim: 2.0, keyColor: '#ffe4cf', fillColor: '#9aa7c7', rimColor: '#f43f5e' },
  horror: { sky: '#030407', fogColor: '#030407', fogNear: 3.5, fogFar: 15, ambient: 0.16, key: 0.55, fill: 0.07, rim: 1.7, keyColor: '#c8d8ff', fillColor: '#5a6b8c', rimColor: '#2dd4bf' },
}

/** Classic per-preset key/rim colors (preserves manual stage-button behavior). */
const PRESET_KEY_RIM: Record<D3StagePresetId, [string, string]> = {
  cyberpunk: ['#fff7ed', '#f43f5e'],
  broadcast: ['#ffffff', '#6366f1'],
  minimal: ['#ffffff', '#818cf8'],
}

// ---------------------------------------------------------------------------
// Category blueprints — named layouts + declarative prop requests
// (base counts; crowded/empty scaling applied in resolve())
// ---------------------------------------------------------------------------

type ComposableKind = Exclude<EnvironmentLocationKind, 'stage' | 'alley'>

interface CategoryTemplate {
  layout: string
  props: BlueprintPropRequest[]
}

const CATEGORY_TEMPLATES: Record<ComposableKind, CategoryTemplate> = {
  warehouse: {
    layout: 'large_industrial_interior',
    props: [
      { type: 'pillar', count: 4 },
      { type: 'rack', count: 2 },
      { type: 'crate', count: 9 },
      { type: 'barrel', count: 3 },
      { type: 'pipe', count: 2 },
    ],
  },
  railway: {
    layout: 'outdoor_platform_station',
    props: [
      { type: 'platform', count: 1 },
      { type: 'track', count: 1 },
      { type: 'pillar', count: 4 },
      { type: 'bench', count: 2 },
      { type: 'stationLight', count: 3 },
    ],
  },
  apartment: {
    layout: 'small_living_interior',
    props: [
      { type: 'sofa', count: 1 },
      { type: 'table', count: 1 },
      { type: 'chair', count: 1 },
      { type: 'window', count: 1 },
      { type: 'doorway', count: 1 },
      { type: 'shelf', count: 1 },
    ],
  },
  broadcast: {
    layout: 'television_studio_floor',
    props: [
      { type: 'desk', count: 1 },
      { type: 'screen', count: 1 },
      { type: 'wall', count: 2 },
    ],
  },
  office: {
    layout: 'corporate_office_interior',
    props: [
      { type: 'desk', count: 1 },
      { type: 'chair', count: 1 },
      { type: 'shelf', count: 1 },
      { type: 'window', count: 1 },
    ],
  },
  interior: {
    layout: 'simple_room_interior',
    props: [
      { type: 'sofa', count: 1 },
      { type: 'table', count: 1 },
      { type: 'shelf', count: 1 },
      { type: 'doorway', count: 1 },
    ],
  },
  street: {
    layout: 'city_street_canyon',
    props: [
      { type: 'road', count: 1 },
      { type: 'sidewalk', count: 2 },
      { type: 'building', count: 5 },
      { type: 'lampPost', count: 3 },
      { type: 'fence', count: 2 },
    ],
  },
  forest: {
    layout: 'forest_clearing',
    props: [
      { type: 'tree', count: 12 },
      { type: 'rock', count: 6 },
    ],
  },
}

function scaleCounts(
  props: BlueprintPropRequest[],
  scale: number
): BlueprintPropRequest[] {
  return props.map((p) => ({
    type: p.type,
    count: p.count === 0 ? 0 : Math.max(1, Math.round(p.count * scale)),
  }))
}

// ---------------------------------------------------------------------------
// Phase 2 — per-category palettes + light-fixture requests
// (pure data; the composers map these roles onto prop materials)
// ---------------------------------------------------------------------------

// Phase 2.1 VISIBILITY FIX: the first palette generation used near-black
// albedos (0x0d–0x14) for warehouse/railway/apartment/broadcast. MeshStandard
// surfaces that dark reflect almost nothing under the night/midnight grades,
// so entire environments rendered as black voids (the forest read fine because
// its palette is 3–4× brighter). These palettes keep each category's hue
// identity at forest-like luminance so structure reads in EVERY mood grade,
// including Noir Deco (which multiplies lightness by ~0.62 on top).
const CATEGORY_PALETTES: Record<ComposableKind, PaletteSpec> = {
  warehouse: { primary: 0x6a7280, secondary: 0x6b5a41, accent: 0x8b95a3, ground: 0x3a3f47, wall: 0x565e69 },
  railway: { primary: 0x59616c, secondary: 0x666e7a, accent: 0x9aa3af, ground: 0x3a3e46, wall: 0x525a64 },
  apartment: { primary: 0xb39c82, secondary: 0x8a6f52, accent: 0xa07d55, ground: 0x6b5a48, wall: 0xb39c82 },
  broadcast: { primary: 0x2e4470, secondary: 0x24365c, accent: 0x67e8f9, ground: 0x2a3348, wall: 0x1f3054 },
  office: { primary: 0x2b303c, secondary: 0x23262e, accent: 0x39404d, ground: 0x23262e, wall: 0x2b303c },
  interior: { primary: 0x2b303c, secondary: 0x39404d, accent: 0x453b33, ground: 0x23262e, wall: 0x2b303c },
  street: { primary: 0x181b23, secondary: 0x2b2d33, accent: 0x22262c, ground: 0x14151a, wall: 0x181b23 },
  forest: { primary: 0x27603a, secondary: 0x1d3a24, accent: 0x4a3c2e, ground: 0x21402c, wall: 0x1d3a24 },
}

/** Mood → coarse "is it dark out" flag for light-fixture decisions. */
function blueprintNight(mood: EnvironmentMood): boolean {
  return mood === 'night' || mood === 'midnight' || mood === 'horror'
}

/**
 * Declarative emissive-prop requests per category. Abandoned scenes keep the
 * fixtures but most go dark (`lit:false`) — sparse practicals only.
 */
function deriveLightRequests(
  kind: ComposableKind,
  details: EnvironmentDetails,
  night: boolean
): BlueprintLightRequest[] {
  const lit = !details.abandoned
  switch (kind) {
    case 'warehouse':
      return [{ kind: 'hanging', count: details.abandoned ? 1 : 2, lit }]
    case 'railway':
      return [{ kind: 'station', count: details.abandoned ? 1 : 3, lit }, { kind: 'screen_glow', count: 1, lit: false }]
    case 'apartment':
    case 'interior':
      return [{ kind: 'floor_lamp', count: 1, lit: true }] // warm practical always on — it IS the night look
    case 'broadcast':
      return [
        { kind: 'studio_bar', count: 4, lit: true },
        { kind: 'screen_glow', count: 1, lit: true },
      ]
    case 'office':
      return [{ kind: 'hanging', count: 2, lit }]
    case 'street':
      return [{ kind: 'street', count: details.abandoned ? 1 : 3, lit }]
    case 'forest':
      return [] // no artificial light in the woods
  }
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Real location keywords anywhere in the combined scene text always win.
 * Generic/placeholder labels (e.g. the director's fallback "Studio Stage")
 * carry no location information — when NO rule matches we fall through to
 * 'stage', which anchors to the caller's existing preset unchanged.
 */
function detectLocationKind(lowerText: string): EnvironmentLocationKind {
  for (const rule of LOCATION_KIND_RULES) {
    if (rule.keys.test(lowerText)) return rule.kind
  }
  return 'stage'
}

function pickMood(
  lowerText: string,
  timeOfDay: D3TimeOfDay | undefined,
  emotionalTone: string | undefined,
  kind: EnvironmentLocationKind
): EnvironmentMood {
  // 1) explicit scene time-of-day wins
  if (timeOfDay) {
    const fromTime = TIME_OF_DAY_MOOD[timeOfDay]
    if (fromTime) return fromTime
  }
  // 2) mood keywords in the combined scene text
  for (const rule of MOOD_RULES) {
    if (rule.keys.test(lowerText)) return rule.mood
  }
  // 3) dominant emotion as a last resort
  const tone = emotionalTone?.trim().toLowerCase()
  if (tone && EMOTION_MOOD[tone]) return EMOTION_MOOD[tone]
  // 4) per-location default
  return KIND_DEFAULT_MOOD[kind]
}

function deriveTimeOfDay(mood: EnvironmentMood): 'day' | 'dawn' | 'dusk' | 'night' {
  switch (mood) {
    case 'night':
    case 'midnight':
      return 'night'
    case 'dusk':
      return 'dusk'
    case 'dawn':
      return 'dawn'
    default:
      return 'day'
  }
}

// ---------------------------------------------------------------------------
// Default provider — deterministic + offline
// ---------------------------------------------------------------------------

export class ProceduralEnvironmentProvider implements EnvironmentProvider {
  readonly id = 'procedural'

  resolve(request: EnvironmentRequest): ResolvedEnvironment {
    const rawText = request.searchText || ''
    // Neutralize the director's generic fallback label ("Studio Stage") so its
    // embedded word "studio" can never masquerade as a broadcast location.
    // Genuine phrases like "news studio" are unaffected.
    const lowerText = rawText.toLowerCase().replace(/\bstudio stage\b/g, ' ')

    const kind = detectLocationKind(lowerText)
    const preset: D3StagePresetId =
      KIND_PRESET[kind] === 'fallback'
        ? request.fallbackPreset ?? 'minimal'
        : (KIND_PRESET[kind] as D3StagePresetId)
    const mood = pickMood(lowerText, request.timeOfDay, request.emotionalTone, kind)
    const L = MOOD_LIGHTING[mood]
    const details = detectDetails(lowerText)

    // Base stage (classic look) for bare presets and the neon alley;
    // composed procedural environments for recognized real-world locations.
    const useBaseStage = kind === 'stage' || kind === 'alley'

    // --- semantic blueprint -------------------------------------------------
    const template = CATEGORY_TEMPLATES[kind as ComposableKind]
    const countScale = details.crowded ? 1.5 : details.empty ? 0.55 : 1
    const composableKind = kind as ComposableKind
    const blueprint: EnvironmentBlueprint = {
      category: kind,
      mood,
      timeOfDay: deriveTimeOfDay(mood),
      layout: template?.layout ?? 'classic_preset_stage',
      props: template ? scaleCounts(template.props, countScale) : [],
      details,
      // Deterministic layout identity: same scene/location ⇒ same layout.
      seed: hashString(request.seedKey || rawText || kind),
      // Phase 2 composition spec.
      palette: CATEGORY_PALETTES[composableKind] ?? {
        primary: 0x2b303c,
        secondary: 0x39404d,
        accent: 0x453b33,
        ground: 0x16171b,
        wall: 0x2b303c,
      },
      lights: useBaseStage
        ? []
        : deriveLightRequests(composableKind, details, blueprintNight(mood)),
      depthLayers: ['far', 'mid', 'near'],
      actorSafeZone: { halfX: 2.5, halfZ: 1.5 },
      cameraSafeRadius: 2.55,
    }

    // Per-kind lighting adjustments (kept generic — never tied to one story)
    let { ambient, key, fill, rim } = L
    let keyColor = L.keyColor
    let fillColor = L.fillColor
    let rimColor = L.rimColor
    let fogNear = L.fogNear
    let fogFar = L.fogFar

    if (kind === 'stage') {
      // Pure preset mode: preserve the exact classic per-preset colors.
      const [pk, pr] = PRESET_KEY_RIM[preset]
      keyColor = pk
      rimColor = pr
    }
    if (kind === 'broadcast') {
      // News studio: bright, even, high-key lighting.
      ambient = Math.max(ambient, 1.6)
      key = Math.max(key, 1.7)
      fill = Math.max(fill, 1.2)
      keyColor = '#ffffff'
      fillColor = '#e0f2fe'
    }
    if (kind === 'alley') {
      // Cyberpunk alley: current neon stage + stronger colored rims.
      rim = Math.max(rim, 2.3)
      rimColor = '#f43f5e'
      fill = Math.max(fill, 0.5)
      fillColor = '#67e8f9'
    }

    // Bespoke composed environments are built from LIT MeshStandardMaterials
    // (unlike the unlit basic-material base stage), so the darkest mood grades
    // would otherwise render the geometry pitch-black against the sky.
    // Enforce readability floors so structures/props always read, and pull fog
    // back so the surrounding shell is not swallowed by depth fog.
    if (!useBaseStage) {
      ambient = Math.max(ambient, 0.55)
      key = Math.max(key, 0.9)
      fill = Math.max(fill, 0.35)
      fogNear = Math.max(fogNear, 8)
      fogFar = Math.max(fogFar, 26)
    }

    if (kind === 'warehouse') {
      // Industrial interiors MUST stay legible: composed environments use
      // MeshStandardMaterial blockout and ACES tone mapping crushes near-black
      // values, so "darker" is achieved via COLD BLUE tint + tighter fog —
      // never by dropping the lights below the readability floor.
      ambient = Math.max(ambient, 0.78)
      key = Math.max(key, 1.15)
      fill = Math.max(fill, 0.55)
      if (mood === 'night' || mood === 'midnight') {
        keyColor = '#cfe0ff'
        fillColor = '#9fb6d6'
        rimColor = '#5470bd'
      }
    }
    if (kind === 'railway') {
      // Outdoor platforms at night need a touch more than the generic night
      // floor so concrete, rails and the canopy read as a STATION (Phase 2.1).
      ambient = Math.max(ambient, 0.62)
      key = Math.max(key, 1.0)
      fill = Math.max(fill, 0.45)
    }
    if (kind === 'forest') {
      // Woods read best with tighter atmospheric depth.
      fogNear = Math.min(fogNear, 7)
      fogFar = Math.min(fogFar, 24)
      ambient = Math.min(ambient, 1.0)
    }
    if (kind === 'apartment' && (mood === 'night' || mood === 'midnight')) {
      // "…apartment at night" → warm practical-lit dim interior: lamp-glow
      // key/fill/rim instead of cold moonlight, kept dim for the night feel.
      // Phase 2.1: ambient floor raised 0.5 → 0.6 so the lifted warm palette
      // reads as a ROOM at night instead of a brown void.
      keyColor = '#ffd9a8'
      fillColor = '#e8b48a'
      rimColor = '#ff9d5c'
      ambient = Math.min(Math.max(ambient, 0.6), 0.62)
      key = Math.min(key, 0.75)
    }

    // Story-aware detail modifiers (generic keyword rules).
    if (details.abandoned && !useBaseStage) {
      // Fewer effective lights, grimmer grade.
      ambient *= 0.85
      key *= 0.85
      rim *= 0.9
    }
    if (details.luxury && !useBaseStage) {
      // Cleaner, brighter, more open feel.
      ambient = Math.min(ambient * 1.12, 1.9)
      fill = Math.min(fill * 1.15, 1.6)
    }
    if (details.rain && !useBaseStage) {
      // Denser atmosphere (no particles — just fog + darker/wetter ground,
      // handled by the material bank in environmentStage.ts).
      fogNear = Math.min(fogNear, 6)
      fogFar = Math.min(fogFar, 22)
    }

    return {
      preset,
      locationKind: kind,
      mood,
      useBaseStage,
      skyColor: L.sky,
      fogColor: L.fogColor,
      fogNear,
      fogFar,
      ambientIntensity: ambient,
      keyLightIntensity: key,
      fillLightIntensity: fill,
      rimLightIntensity: rim,
      keyLightColor: keyColor,
      fillLightColor: fillColor,
      rimLightColor: rimColor,
      blueprint,
      signature: `${preset}|${kind}|${mood}|${blueprint.seed.toString(36)}`,
      label: `${kind} · ${blueprint.layout} · ${mood}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Service facade — swap providers without touching callers
// ---------------------------------------------------------------------------

export class EnvironmentResolverService {
  private static provider: EnvironmentProvider = new ProceduralEnvironmentProvider()

  /** Register an alternative provider (e.g. future RemoteSkyboxProvider). */
  static setProvider(provider: EnvironmentProvider): void {
    this.provider = provider
  }

  static getProviderId(): string {
    return this.provider.id
  }

  /** Resolve an environment from scene/story metadata. */
  static resolve(request: EnvironmentRequest): ResolvedEnvironment {
    return this.provider.resolve(request)
  }

  /**
   * Resolve the classic look for a bare stage preset (manual stage buttons,
   * initial load). Reproduces the pre-resolver behavior exactly.
   */
  static resolveForPreset(preset: D3StagePresetId): ResolvedEnvironment {
    return this.provider.resolve({ searchText: '', fallbackPreset: preset })
  }
}