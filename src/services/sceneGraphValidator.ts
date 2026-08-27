/**
 * Scene Graph Validator — PHASE 3 (parse → validate → normalize → clamp).
 *
 * Every SceneGraph — whether produced by the local parser or a future LLM
 * provider — passes through here before the builder touches Three.js.
 *
 * Guarantees:
 *  - NO NaN/Infinity reaches the renderer (rejected or repaired).
 *  - All colors are valid '#rrggbb' hex strings (invalid → family default).
 *  - roughness/metalness clamped 0…1; emissiveIntensity to safe project range
 *    (0…2.5, matching the existing composers' max ~1.5–2.2).
 *  - Object scale clamped to semantic bounds (no chair taller than a VRM).
 *  - Counts budgeted: heroes ≤ 8, unique supporting ≤ 20, dressing ≤ 80 total.
 *  - Lights ≤ 3 active roles (primary/fill/accent) — extras dropped.
 *  - Fog ranges sane (near < far, both finite).
 *  - Malformed object entries are REPAIRED where possible, SKIPPED otherwise —
 *    one bad entry never crashes environment generation.
 */

import type {
  IntensityHint,
  LightIntent,
  LightRole,
  PrimitiveFallback,
  SceneDensity,
  SceneGraph,
  SceneImportance,
  SceneObjectSpec,
  SceneTimeOfDay,
  SceneZone,
  SkyType,
} from './sceneGraphTypes'
import { SCENE_GRAPH_VERSION } from './sceneGraphTypes'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** Validate a '#rrggbb' string; returns null when invalid. */
export function isValidHex(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function strEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

// ---------------------------------------------------------------------------
// Enum tables
// ---------------------------------------------------------------------------

const TIMES: readonly SceneTimeOfDay[] = ['dawn', 'morning', 'day', 'afternoon', 'sunset', 'evening', 'night', 'midnight', 'unknown']
const SPACES: readonly SceneGraph['environment']['indoorOutdoor'][] = ['indoor', 'outdoor', 'mixed', 'unknown']
const IMPORTANCES: readonly SceneImportance[] = ['hero', 'supporting', 'dressing']
const ZONES: readonly SceneZone[] = ['foreground', 'midground', 'background']
const PRIMITIVES: readonly PrimitiveFallback[] = ['box', 'cylinder', 'cone', 'sphere', 'plane', 'extrusion', 'compound']
const ROLES: readonly LightRole[] = ['primary', 'fill', 'accent']
const INTENTS: readonly LightIntent[] = ['sun', 'moon', 'sky', 'practical', 'neon', 'fire', 'studio', 'screen']
const HINTS: readonly IntensityHint[] = ['faint', 'dim', 'moderate', 'strong', 'harsh']
const DENSITIES: readonly SceneDensity[] = ['sparse', 'medium', 'dense']
const SKIES: readonly SkyType[] = ['solid', 'gradient', 'procedural', 'hdri']

// ---------------------------------------------------------------------------
// Budgets (Section 22.F)
// ---------------------------------------------------------------------------

export const SCENE_BUDGETS = {
  heroObjects: 8,
  supportingUnique: 20,
  dressingInstances: 80,
  lights: 3,
} as const

// ---------------------------------------------------------------------------
// Object validation
// ---------------------------------------------------------------------------

function validateObject(raw: unknown, index: number): SceneObjectSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const semanticType =
    typeof o.semanticType === 'string' && o.semanticType.length > 0 && o.semanticType.length <= 64
      ? o.semanticType.replace(/[^a-z0-9_]/gi, '_').toLowerCase()
      : null
  if (!semanticType) return null

  const importance = strEnum(o.importance, IMPORTANCES, 'dressing')
  const positionRaw = Array.isArray(o.position) ? o.position : [0, 0, 0]
  const rotationRaw = Array.isArray(o.rotation) ? o.rotation : [0, 0, 0]
  const scaleRaw = Array.isArray(o.scale) ? o.scale : [1, 1, 1]

  const px = finiteNumber(positionRaw[0]) ?? 0
  const py = finiteNumber(positionRaw[1]) ?? 0
  const pz = finiteNumber(positionRaw[2]) ?? 0

  // Position clamp: keep suggestions inside the stage volume (layout engine
  // refines further, but raw AI coordinates never escape these bounds).
  const position: [number, number, number] = [
    clamp(px, -14, 14),
    clamp(py, -0.5, 12),
    clamp(pz, -16, 4),
  ]
  const rotation: [number, number, number] = [
    clamp(finiteNumber(rotationRaw[0]) ?? 0, -Math.PI * 2, Math.PI * 2),
    clamp(finiteNumber(rotationRaw[1]) ?? 0, -Math.PI * 2, Math.PI * 2),
    clamp(finiteNumber(rotationRaw[2]) ?? 0, -Math.PI * 2, Math.PI * 2),
  ]

  // Scale: semantic bounds — nothing smaller than 0.05× or larger than 6×
  // of its type's human-scale hint (validator can't know the hint, so this
  // is a generous absolute bound; the builder applies per-type hints).
  const scale: [number, number, number] = [
    clamp(finiteNumber(scaleRaw[0]) ?? 1, 0.05, 6),
    clamp(finiteNumber(scaleRaw[1]) ?? 1, 0.05, 6),
    clamp(finiteNumber(scaleRaw[2]) ?? 1, 0.05, 6),
  ]

  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 8)
    : []

  const spec: SceneObjectSpec = {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : `obj_${index}`,
    semanticType,
    tags,
    importance,
    primitiveFallback: strEnum(o.primitiveFallback, PRIMITIVES, 'compound'),
    position,
    rotation,
    scale,
    zone: strEnum(o.zone, ZONES, importance === 'hero' ? 'midground' : 'background'),
    avoidActors: o.avoidActors !== false,
    cameraImportant: o.cameraImportant !== false && importance !== 'dressing',
  }

  // Optional material fields — validated/clamped only when present.
  if (isValidHex(o.color)) spec.color = o.color
  const rough = finiteNumber(o.roughness)
  if (rough !== null) spec.roughness = clamp(rough, 0, 1)
  const metal = finiteNumber(o.metalness)
  if (metal !== null) spec.metalness = clamp(metal, 0, 1)
  if (isValidHex(o.emissive)) spec.emissive = o.emissive
  const ei = finiteNumber(o.emissiveIntensity)
  if (ei !== null) spec.emissiveIntensity = clamp(ei, 0, 2.5)

  return spec
}

// ---------------------------------------------------------------------------
// Graph validation
// ---------------------------------------------------------------------------

/**
 * Validate + normalize an untrusted SceneGraph-shaped value.
 * Returns null when the input is fundamentally unusable (not an object /
 * zero objects after repair) so callers fall back to local inference.
 */
export function validateSceneGraph(raw: unknown): SceneGraph | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>

  // --- header ---------------------------------------------------------------
  const envRaw = (g.environment ?? {}) as Record<string, unknown>
  const envType =
    typeof envRaw.type === 'string' && envRaw.type.trim()
      ? envRaw.type.replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 48)
      : 'generic'
  const indoorOutdoor = strEnum(envRaw.indoorOutdoor, SPACES, 'unknown')
  const locationDescription =
    typeof envRaw.locationDescription === 'string' ? envRaw.locationDescription.slice(0, 160) : ''

  // --- time / mood ----------------------------------------------------------
  const timeOfDay = strEnum(g.timeOfDay, TIMES, 'unknown')
  const mood = Array.isArray(g.mood)
    ? g.mood.filter((m): m is string => typeof m === 'string').slice(0, 6)
    : []

  // --- palette --------------------------------------------------------------
  const palRaw = (g.palette ?? {}) as Record<string, unknown>
  const palette = {
    primary: isValidHex(palRaw.primary) ? palRaw.primary : '#4a505a',
    secondary: isValidHex(palRaw.secondary) ? palRaw.secondary : '#5c6470',
    accent: isValidHex(palRaw.accent) ? palRaw.accent : '#6b7280',
    ground: isValidHex(palRaw.ground) ? palRaw.ground : '#3a3f47',
    background: isValidHex(palRaw.background) ? palRaw.background : '#1a2030',
  }

  // --- ground ---------------------------------------------------------------
  const groundRaw = (g.ground ?? {}) as Record<string, unknown>
  const groundRelief = finiteNumber(groundRaw.relief)
  const ground = {
    type:
      typeof groundRaw.type === 'string' && groundRaw.type.trim()
        ? groundRaw.type.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 32)
        : 'rocky_terrain',
    color: isValidHex(groundRaw.color) ? groundRaw.color : palette.ground,
    roughness: clamp(finiteNumber(groundRaw.roughness) ?? 0.95, 0, 1),
    metalness: clamp(finiteNumber(groundRaw.metalness) ?? 0.02, 0, 1),
    relief: groundRelief !== null ? clamp(groundRelief, 0, 1) : 0.35,
  }

  // --- atmosphere -----------------------------------------------------------
  const atmoRaw = (g.atmosphere ?? {}) as Record<string, unknown>
  let fogNear = clamp(finiteNumber(atmoRaw.fogNear) ?? 10, 2, 30)
  let fogFar = clamp(finiteNumber(atmoRaw.fogFar) ?? 28, 8, 60)
  if (fogNear >= fogFar) fogNear = fogFar - 4
  const atmosphere = {
    backgroundColor: isValidHex(atmoRaw.backgroundColor) ? atmoRaw.backgroundColor : palette.background,
    fogColor: isValidHex(atmoRaw.fogColor) ? atmoRaw.fogColor : palette.background,
    fogNear,
    fogFar,
    skyType: strEnum(atmoRaw.skyType, SKIES, 'solid'),
    hdriTag: typeof atmoRaw.hdriTag === 'string' ? atmoRaw.hdriTag.slice(0, 48) : undefined,
  }

  // --- lighting -------------------------------------------------------------
  const lightsRaw = Array.isArray(g.lighting) ? g.lighting : []
  const seenRoles = new Set<LightRole>()
  const lighting: SceneGraph['lighting'] = []
  for (let i = 0; i < lightsRaw.length && lighting.length < SCENE_BUDGETS.lights; i++) {
    const lRaw = lightsRaw[i] as Record<string, unknown>
    if (!lRaw || typeof lRaw !== 'object') continue
    const role = strEnum(lRaw.role, ROLES, lighting.length === 0 ? 'primary' : 'fill')
    if (seenRoles.has(role)) continue // ≤1 light per role → ≤3 active lights
    seenRoles.add(role)
    lighting.push({
      id: typeof lRaw.id === 'string' && lRaw.id ? lRaw.id.slice(0, 48) : `light_${role}`,
      role,
      intent: strEnum(lRaw.intent, INTENTS, role === 'primary' ? 'sun' : 'sky'),
      color: isValidHex(lRaw.color) ? lRaw.color : role === 'primary' ? '#fff7ed' : '#dbeafe',
      intensityHint: strEnum(lRaw.intensityHint, HINTS, 'moderate'),
      castShadows: lRaw.castShadows === true && role === 'primary',
    })
  }
  if (lighting.length === 0) {
    lighting.push({ id: 'primary', role: 'primary', intent: 'sun', color: '#fff7ed', intensityHint: 'moderate', castShadows: true })
    lighting.push({ id: 'fill', role: 'fill', intent: 'sky', color: '#dbeafe', intensityHint: 'dim', castShadows: false })
  }

  // --- objects --------------------------------------------------------------
  const objectsRaw = Array.isArray(g.objects) ? g.objects : []
  const objects: SceneObjectSpec[] = []
  let heroCount = 0
  const uniqueSupporting = new Set<string>()
  let dressingCount = 0
  for (let i = 0; i < objectsRaw.length; i++) {
    const obj = validateObject(objectsRaw[i], i)
    if (!obj) continue
    // Budget enforcement (Section 22.F).
    if (obj.importance === 'hero') {
      if (heroCount >= SCENE_BUDGETS.heroObjects) continue
      heroCount++
    } else if (obj.importance === 'supporting') {
      if (uniqueSupporting.size >= SCENE_BUDGETS.supportingUnique && !uniqueSupporting.has(obj.semanticType)) continue
      uniqueSupporting.add(obj.semanticType)
    } else {
      if (dressingCount >= SCENE_BUDGETS.dressingInstances) continue
      dressingCount++
    }
    objects.push(obj)
  }
  if (objects.length === 0) return null // unusable graph → local fallback

  // --- composition ------------------------------------------------------------
  const compRaw = (g.composition ?? {}) as Record<string, unknown>
  const composition = {
    actorSafeRadius: clamp(finiteNumber(compRaw.actorSafeRadius) ?? 1.2, 0.9, 2.5),
    cameraSafeRadius: clamp(finiteNumber(compRaw.cameraSafeRadius) ?? 2.55, 1.5, 4),
    preferredDepth: clamp(finiteNumber(compRaw.preferredDepth) ?? 8, 4, 16),
    density: strEnum(compRaw.density, DENSITIES, 'medium'),
  }

  // --- details --------------------------------------------------------------
  const detRaw = (g.details ?? {}) as Record<string, unknown>
  const details = {
    abandoned: detRaw.abandoned === true,
    rain: detRaw.rain === true,
    luxury: detRaw.luxury === true,
    crowded: detRaw.crowded === true,
    empty: detRaw.empty === true,
    old: detRaw.old === true,
  }

  const seedNum = finiteNumber(g.seed)

  return {
    version: SCENE_GRAPH_VERSION,
    environment: { type: envType, indoorOutdoor, locationDescription },
    timeOfDay,
    mood,
    palette,
    ground,
    atmosphere,
    lighting,
    objects,
    composition,
    details,
    seed: seedNum !== null ? Math.floor(seedNum) >>> 0 : 12345,
    source: g.source === 'llm' ? 'llm' : 'local',
  }
}