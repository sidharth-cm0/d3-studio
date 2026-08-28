/**
 * Spatial Layout Engine — PHASE 3.
 *
 * Converts validated semantic SceneObjectSpec requests into deterministic,
 * camera-readable, actor-safe transforms: position · rotation · scale.
 *
 * The layout engine is AUTHORITATIVE for geometry placement. The LLM/parser
 * may supply semantic placement hints, but exact world-space coordinates are
 * normalized and corrected locally here.
 *
 * Design rules:
 *  - PURE DATA: no Three.js / RAF / physics / per-frame work. Layout is
 *    generated once when a scene/environment is being built.
 *  - DETERMINISTIC: same SceneGraph + seed + camera ⇒ identical transforms.
 *    Seeded PRNG (mulberry32) drives every placement decision.
 *  - ACTOR SAFE: a 1.2 m protection radius surrounds each real actor anchor
 *    (lead ≈ (−0.75,0,0), supporting ≈ (0.75,0,0)).
 *  - CAMERA AWARE: the real D3 Two-Shot Wide camera (pos ≈ (0,1.7,+3.4),
 *    FOV 46°, half-width ≈ 0.76·(3.4−z), frame-top ≈ 1.7+0.30·(3.4−z)).
 *  - OCCLUSION SAFE: large architectural slabs pushed behind actors or to
 *    frame edges; nothing large between camera and actors.
 *  - COLLISION AVOIDANCE: lightweight circular footprints; bounded retry;
 *    safest valid fallback chosen rather than dropping the object.
 *  - SCALE NORMALIZATION: semantic human-scale references clamp absurd values.
 */

import type {
  PrimitiveFallback,
  SceneObjectSpec,
  SceneGraph,
  SceneRelation,
  SceneRelationType,
} from './sceneGraphTypes'
import type { SceneImportance } from './sceneGraphTypes'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LayoutZoneId =
  | 'foreground_left'
  | 'foreground_right'
  | 'midground_left'
  | 'midground_right'
  | 'midground_center'
  | 'behind_actors_left'
  | 'behind_actors_center'
  | 'behind_actors_right'
  | 'background_left'
  | 'background_center'
  | 'background_right'
  | 'rear_architecture'
  | 'ground_dressing'

export type ResolvedZone = 'foreground' | 'midground' | 'background'

export interface ActorAnchor {
  id: string
  position: [number, number, number]
  /** Protection radius around the actor body zone (metres). */
  safetyRadius: number
}

export interface CameraReference {
  position: [number, number, number]
  lookAt: [number, number, number]
  fov: number
  /** Visible half-width at a given depth z (metres). */
  halfWidthAt: (z: number) => number
  /** Frame-top Y at a given depth z (metres). */
  frameTopAt: (z: number) => number
  /** Vertical center Y at a given depth z (approx eye line). */
  centerYAt: (z: number) => number
}

export interface ResolvedSceneObject {
  sourceSpecId: string
  semanticType: string
  importance: SceneImportance
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  zone: ResolvedZone
  cameraVisible: boolean
  actorSafe: boolean
  occlusionSafe: boolean
  placementReason?: string
  fallbackPrimitive: PrimitiveFallback
  heroVisible?: boolean
}

export interface LayoutInput {
  sceneGraph: SceneGraph
  objects: SceneObjectSpec[]
  seed: number
  actorAnchors?: ActorAnchor[]
  camera?: CameraReference
}

export interface LayoutStats {
  objectCount: number
  heroCount: number
  visibleHeroCount: number
  frustumVisibleRatio: number
  actorCollisionViolations: number
  objectCollisionRetries: number
  occlusionViolations: number
  placementFallbacks: number
}

export interface LayoutOutput {
  objects: ResolvedSceneObject[]
  stats: LayoutStats
}

/**
 * Result of resolving a single spatial relation against the final layout.
 * Used to make directional relations geometrically testable.
 */
export interface RelationResolution {
  relation: SceneRelation
  /** Whether the relation is satisfied by the resolved transforms. */
  satisfied: boolean
  /** Human-readable reason (for tests / diagnostics). */
  detail: string
}

export interface ZoneRect {
  id: LayoutZoneId
  x0: number
  x1: number
  z0: number
  z1: number
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32 — same algorithm as environmentProps.ts)
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
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
// Constants — safety, camera, scale
// ---------------------------------------------------------------------------

/** Minimum protection radius around actor body zones for ordinary props. */
export const ACTOR_SAFETY_RADIUS = 1.2
/** Max retries per object across all candidate zones. */
export const MAX_COLLISION_RETRIES = 24
/** Camera safe radius: no prop footprint inside this distance of the camera. */
export const CAMERA_SAFE_R = 1.2
/** Obj-obj minimum clearance margin. */
export const OBJ_CLEARANCE = 0.18
/** Obstacle distance from the camera↔actor sightline that blocks the shot. */
export const SIGHTLINE_LIMIT = 0.42
/** Occlusion-safe depth: at or behind this z a large slab never blocks actors. */
export const OCCLUSION_SAFE_Z = -5.5
/** A prop is "large" (occlusion-relevant) if its width × height exceed this. */
export const LARGE_AREA = 6

export const DEFAULT_ACTOR_ANCHORS: ActorAnchor[] = [
  { id: 'lead', position: [-0.75, 0, 0], safetyRadius: ACTOR_SAFETY_RADIUS },
  { id: 'supporting', position: [0.75, 0, 0], safetyRadius: ACTOR_SAFETY_RADIUS },
]

/**
 * The real D3 Two-Shot Wide camera (from App.tsx CINEMATIC_SHOTS):
 * position ≈ (0, 1.7, +3.4), FOV 46°, half-width ≈ 0.76·(3.4−z),
 * frame-top ≈ 1.7 + 0.30·(3.4−z).
 */
export function twoShotWideCamera(): CameraReference {
  return {
    position: [0, 1.7, 3.4],
    lookAt: [0, 1.1, 0],
    fov: 46,
    halfWidthAt: (z) => 0.76 * (3.4 - z),
    frameTopAt: (z) => 1.7 + 0.3 * (3.4 - z),
    centerYAt: (z) => 0.9 + 0.12 * (3.4 - z),
  }
}

// ---------------------------------------------------------------------------
// Semantic placement zones
// ---------------------------------------------------------------------------

/**
 * Deterministic placement zones. All coordinates are in the D3 world frame:
 * camera at +z, actors near origin, stage extending toward −z. Zones encode
 * the actor-safe rectangle (±2.5 × −1.5…+1.5) and the sightline corridor.
 */
export const LAYOUT_ZONES: ZoneRect[] = [
  { id: 'foreground_left', x0: -4.3, x1: -2.7, z0: -1.4, z1: 0.4 },
  { id: 'foreground_right', x0: 2.7, x1: 4.3, z0: -1.4, z1: 0.4 },
  { id: 'midground_left', x0: -3.6, x1: -2.0, z0: -3.4, z1: -1.8 },
  { id: 'midground_right', x0: 2.0, x1: 3.6, z0: -3.4, z1: -1.8 },
  { id: 'midground_center', x0: -1.5, x1: 1.5, z0: -4.4, z1: -2.9 },
  { id: 'behind_actors_left', x0: -3.8, x1: -2.3, z0: -2.2, z1: -1.2 },
  { id: 'behind_actors_center', x0: -1.2, x1: 1.2, z0: -2.9, z1: -2.1 },
  { id: 'behind_actors_right', x0: 2.3, x1: 3.8, z0: -2.2, z1: -1.2 },
  { id: 'background_left', x0: -5.6, x1: -2.8, z0: -7.0, z1: -4.8 },
  { id: 'background_center', x0: -2.6, x1: 2.6, z0: -7.0, z1: -4.8 },
  { id: 'background_right', x0: 2.8, x1: 5.6, z0: -7.0, z1: -4.8 },
  { id: 'rear_architecture', x0: -8.5, x1: 8.5, z0: -9.5, z1: -6.2 },
  { id: 'ground_dressing', x0: -5.2, x1: 5.2, z0: -5.2, z1: -0.6 },
]

const ZONE_BY_ID: Record<LayoutZoneId, ZoneRect> = Object.fromEntries(
  LAYOUT_ZONES.map((z) => [z.id, z])
) as unknown as Record<LayoutZoneId, ZoneRect>

// ---------------------------------------------------------------------------
// Semantic human-scale references (approx real-world metres)
// ---------------------------------------------------------------------------

/** Approximate real-world size per semantic type (w, h, d in metres). */
const SCALE_REFERENCE: Record<string, [number, number, number]> = {
  // Vehicles / spacecraft
  spaceship: [5.5, 2.6, 7.0],
  spacecraft: [5.5, 2.6, 7.0],
  spaceship_wreck: [5.5, 2.6, 7.0],
  ship_wreck: [5.5, 2.6, 7.0],
  crashed_ship: [5.5, 2.6, 7.0],
  vehicle_body: [2.0, 1.5, 4.4],
  vehicle: [2.0, 1.5, 4.4],
  car: [2.0, 1.5, 4.4],
  truck: [2.4, 2.2, 6.0],
  engine_cylinder: [1.2, 1.2, 3.0],
  engine: [1.2, 1.2, 3.0],
  thruster: [0.8, 0.8, 2.2],
  // Nature
  tree: [1.6, 4.2, 1.6],
  vegetation: [1.6, 4.2, 1.6],
  palm_tree: [1.8, 4.5, 1.8],
  plant: [0.5, 1.0, 0.5],
  bush: [0.8, 0.6, 0.8],
  shrub: [0.8, 0.6, 0.8],
  rock: [0.8, 0.6, 0.8],
  boulder: [1.1, 0.9, 1.1],
  rock_formation: [2.4, 3.2, 2.0],
  formation: [2.4, 3.2, 2.0],
  crater: [2.6, 0.5, 2.6],
  crater_rim: [2.6, 0.5, 2.6],
  dune: [4.0, 1.2, 3.0],
  sand_dune: [4.0, 1.2, 3.0],
  stalagmite: [0.7, 1.6, 0.7],
  crystal: [0.5, 1.1, 0.5],
  // Furniture
  table: [1.2, 0.75, 0.7],
  desk: [1.6, 0.78, 0.8],
  counter: [2.6, 1.05, 0.7],
  chair: [0.5, 0.9, 0.5],
  seat: [0.5, 0.9, 0.5],
  bench: [1.7, 0.8, 0.55],
  sofa: [2.1, 0.85, 0.9],
  couch: [2.1, 0.85, 0.9],
  bed: [1.0, 0.6, 2.0],
  cabinet: [1.2, 1.0, 0.5],
  shelf: [1.6, 1.9, 0.4],
  shelving: [1.6, 1.9, 0.4],
  rack: [1.8, 2.3, 0.5],
  crate: [0.8, 0.8, 0.8],
  cargo_box: [1.2, 1.2, 1.2],
  box: [0.8, 0.8, 0.8],
  barrel: [0.85, 0.9, 0.85],
  pallet: [1.25, 0.16, 1.05],
  // Electronics / lighting
  screen: [1.4, 0.9, 0.1],
  monitor: [0.9, 0.55, 0.08],
  display: [1.4, 0.9, 0.1],
  screen_panel: [1.4, 0.9, 0.1],
  lamp: [0.45, 1.7, 0.45],
  light: [0.45, 1.7, 0.45],
  lamp_post: [0.4, 3.4, 0.4],
  street_lamp: [0.4, 3.4, 0.4],
  sign: [1.6, 0.9, 0.15],
  signage: [1.6, 0.9, 0.15],
  signboard: [1.6, 0.9, 0.15],
  station_sign: [1.6, 0.9, 0.15],
  neon_sign: [1.8, 1.1, 0.12],
  // Industrial / machines
  machine: [2.2, 2.4, 1.4],
  lab_machine: [2.2, 2.4, 1.4],
  scientific_machine: [2.2, 2.4, 1.4],
  console: [1.4, 1.1, 0.6],
  workbench: [2.0, 0.95, 0.7],
  generator: [1.4, 1.6, 0.9],
  reactor: [1.6, 2.2, 1.6],
  apparatus: [1.2, 1.4, 0.8],
  pipe: [2.4, 0.3, 0.3],
  beam: [6, 0.5, 0.7],
  girder: [6, 0.5, 0.7],
  // Architecture / infrastructure
  wall: [12, 4.0, 0.4],
  panel: [3.0, 2.2, 0.2],
  building: [10, 8, 8],
  structure: [10, 8, 8],
  door: [1.3, 2.3, 0.15],
  doorway: [1.3, 2.3, 0.15],
  window: [1.9, 1.4, 0.1],
  pillar: [0.9, 4.2, 0.9],
  column: [0.9, 4.2, 0.9],
  platform: [15, 0.85, 3.2],
  stage: [15, 0.85, 3.2],
  floor: [18, 0.1, 18],
  ground: [18, 0.1, 18],
  road: [7, 0.02, 18],
  street: [7, 0.02, 18],
  sidewalk: [1.7, 0.13, 18],
  track: [2.4, 0.25, 16],
  rail: [0.2, 0.15, 16],
  fence: [3.2, 1.0, 0.1],
  bridge: [6, 3, 8],
  arch: [4, 3.6, 0.6],
  tunnel_arch: [4, 3.6, 0.6],
  hedge: [1.4, 0.9, 0.6],
  tent: [2.2, 1.6, 2.2],
  shelter: [2.2, 1.6, 2.2],
  campfire: [0.9, 0.5, 0.9],
  firepit: [0.9, 0.5, 0.9],
  log_seat: [1.4, 0.4, 0.5],
  log: [0.5, 0.5, 2.8],
  stump: [0.5, 0.5, 0.5],
  rubble: [0.6, 0.35, 0.6],
  debris: [0.5, 0.4, 0.5],
  debris_field: [0.5, 0.4, 0.5],
  wreckage: [0.8, 0.6, 0.8],
  statue: [0.9, 2.4, 0.9],
  sculpture: [0.9, 2.4, 0.9],
  monument: [1.6, 3.5, 1.6],
  // Phase 3 semantic-dimension hero props
  boat: [3.2, 1.4, 1.4],
  house: [3.4, 3.0, 3.0],
  glow_flora: [0.7, 1.3, 0.7],
  altar: [1.6, 1.1, 1.0],
  fountain: [2.4, 1.4, 2.4],
  water_feature: [2.4, 1.4, 2.4],
  banner: [0.8, 2.4, 0.06],
  torch_sconce: [0.3, 0.9, 0.3],
  caravan: [2.2, 2.0, 5.0],
}

/** Types treated as architecture: always pushed to rear / frame edges. */
const ARCHITECTURE_TYPES = new Set([
  'wall', 'building', 'structure', 'floor', 'ground', 'platform', 'stage',
  'road', 'street', 'sidewalk', 'ceiling', 'bridge', 'arch', 'tunnel_arch',
  'rear_wall', 'backdrop', 'rear_architecture', 'panel', 'fence', 'hedge',
])

/** Types that are ground-level dressing (instancing-friendly). */
const GROUND_DRESSING_TYPES = new Set([
  'rock', 'boulder', 'crate', 'barrel', 'pallet', 'debris', 'debris_field',
  'rubble', 'bush', 'shrub', 'stump', 'log', 'log_seat', 'crystal',
  'crater', 'crater_rim', 'dune', 'sand_dune', 'stalagmite', 'plant',
  'wreckage', 'scattered',
])

const IMPORTANCE_ZONE_PRIORITY: Record<SceneImportance, LayoutZoneId[]> = {
  hero: [
    'midground_center',
    'background_center',
    'midground_left',
    'midground_right',
    'background_left',
    'background_right',
  ],
  supporting: [
    'behind_actors_left',
    'behind_actors_right',
    'midground_left',
    'midground_right',
    'background_left',
    'background_right',
    'behind_actors_center',
  ],
  dressing: [
    'foreground_left',
    'foreground_right',
    'ground_dressing',
    'background_left',
    'background_right',
    'midground_left',
    'midground_right',
  ],
}

const ZONE_RESOLVED: Record<LayoutZoneId, ResolvedZone> = {
  foreground_left: 'foreground',
  foreground_right: 'foreground',
  midground_left: 'midground',
  midground_right: 'midground',
  midground_center: 'midground',
  behind_actors_left: 'midground',
  behind_actors_center: 'midground',
  behind_actors_right: 'midground',
  background_left: 'background',
  background_center: 'background',
  background_right: 'background',
  rear_architecture: 'background',
  ground_dressing: 'midground',
}

// ---------------------------------------------------------------------------
// Geometry math (pure)
// ---------------------------------------------------------------------------

function dist2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * Distance from (x,z) to the camera↔actor sightline corridor (x≈0,
 * z ∈ [−0.5, cameraZ]). Used to reject props that would cut through
 * Two Shot / Close Up / OTS framings.
 */
function sightlineDistance(x: number, z: number, cameraZ: number): number {
  if (z >= -0.5 && z <= cameraZ) return Math.abs(x)
  return Math.min(Math.hypot(x, z + 0.5), Math.hypot(x, z - cameraZ))
}

interface Occupied {
  x: number
  z: number
  r: number
  semanticType: string
}

// ---------------------------------------------------------------------------
// Scale normalization (human scale)
// ---------------------------------------------------------------------------

function isArchitecture(spec: SceneObjectSpec): boolean {
  return ARCHITECTURE_TYPES.has(spec.semanticType.toLowerCase())
}

function isGroundDressing(spec: SceneObjectSpec): boolean {
  return GROUND_DRESSING_TYPES.has(spec.semanticType.toLowerCase())
}

/**
 * Resolve semantic scale hints and clamp absurd parser/LLM values.
 * Returns the final world-space scale [sx, sy, sz] in metres.
 */
function normalizeScale(spec: SceneObjectSpec, importance: SceneImportance): [number, number, number] {
  const base = SCALE_REFERENCE[spec.semanticType.toLowerCase()] ?? [1, 1, 1]

  // Scale multiplier clamp range depends on importance (hero may be several
  // times human scale; dressing stays near reference).
  const maxMul = isArchitecture(spec)
    ? 4.5
    : importance === 'hero'
      ? 2.4
      : importance === 'supporting'
        ? 1.6
        : 1.2
  const minMul = importance === 'dressing' ? 0.35 : 0.5

  const sxClamp = (v: number) => clamp(v, minMul, maxMul)
  const sx = base[0] * sxClamp(spec.scale[0] ?? 1)
  const sy = base[1] * sxClamp(spec.scale[1] ?? 1)
  const sz = base[2] * sxClamp(spec.scale[2] ?? 1)

  return [round3(sx), round3(sy), round3(sz)]
}

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------

type OrientationHint = 'face_camera' | 'face_actors' | 'upright' | 'flat' | 'random'

function pickOrientationHint(spec: SceneObjectSpec): OrientationHint {
  const joined = `${spec.semanticType} ${spec.tags.join(' ')}`.toLowerCase()
  if (/(screen|monitor|display|sign|signage|signboard|neon|billboard|panel|window)/.test(joined)) return 'face_camera'
  if (/(wall|backdrop|fence|hedge|building|structure)/.test(joined)) return 'upright'
  if (/(rubble|crate|barrel|debris|pallet|log|rock|boulder|wreckage|crystal)/.test(joined)) return 'flat'
  if (/(door|doorway|entrance)/.test(joined)) return 'face_camera'
  if (/(random|scatter|cluster)/.test(joined)) return 'random'
  return 'face_camera'
}

/**
 * Resolve the final [rx, ry, rz] Euler rotation.
 * Hero objects present their most readable face toward the camera.
 */
function resolveOrientation(
  hint: OrientationHint,
  x: number,
  z: number,
  camera: CameraReference,
  anchors: ActorAnchor[],
  rng: () => number,
  specRotY: number
): [number, number, number] {
  switch (hint) {
    case 'face_camera': {
      const yaw = Math.atan2(camera.position[0] - x, camera.position[2] - z)
      return [0, round3(yaw), 0]
    }
    case 'face_actors': {
      const meanX = anchors.reduce((s, a) => s + a.position[0], 0) / anchors.length
      const meanZ = anchors.reduce((s, a) => s + a.position[2], 0) / anchors.length
      const yaw = Math.atan2(meanX - x, meanZ - z)
      return [0, round3(yaw), 0]
    }
    case 'flat':
      return [-Math.PI / 2, 0, round3(rng() * Math.PI * 2)]
    case 'random':
      return [0, round3(rng() * Math.PI * 2), 0]
    case 'upright':
    default:
      return [0, round3(specRotY), 0]
  }
}

// ---------------------------------------------------------------------------
// Collision / visibility tests
// ---------------------------------------------------------------------------

function footprintRadius(scale: [number, number, number]): number {
  return Math.max(scale[0], scale[2]) * 0.5 * 0.92
}

function isActorSafe(
  x: number,
  z: number,
  r: number,
  anchors: ActorAnchor[]
): { safe: boolean; violations: number } {
  let violations = 0
  for (const a of anchors) {
    if (dist2D(x, z, a.position[0], a.position[2]) < r + a.safetyRadius) violations++
  }
  return { safe: violations === 0, violations }
}

function isCameraSafe(x: number, z: number, r: number, camera: CameraReference): boolean {
  return dist2D(x, z, camera.position[0], camera.position[2]) >= r + CAMERA_SAFE_R
}

function isSightlineSafe(x: number, z: number, r: number, camera: CameraReference): boolean {
  return sightlineDistance(x, z, camera.position[2]) >= r + SIGHTLINE_LIMIT
}

function isOverlapFree(x: number, z: number, r: number, occupied: Occupied[]): boolean {
  for (const o of occupied) {
    if (dist2D(x, z, o.x, o.z) < r + o.r + OBJ_CLEARANCE) return false
  }
  return true
}

/**
 * Is the object's center inside the Two-Shot frustum at its depth?
 * Hero visibility uses this as an effective hard requirement.
 */
function frustumContains(x: number, y: number, z: number, camera: CameraReference): boolean {
  const hw = camera.halfWidthAt(z)
  if (Math.abs(x) > hw) return false
  const top = camera.frameTopAt(z)
  const center = camera.centerYAt(z)
  const halfH = top - center
  const bottom = center - halfH * 1.2
  return y >= bottom && y <= top
}

/**
 * Occlusion test for LARGE surfaces: a slab sitting between the camera and
 * the actor line is dangerous. Returns true when the candidate placement
 * would block the Two-Shot.
 */
function wouldOccludeActors(
  x: number,
  z: number,
  scale: [number, number, number],
  camera: CameraReference,
  anchors: ActorAnchor[]
): boolean {
  const w = Math.max(scale[0], Math.max(scale[2], 2))
  const h = scale[1]
  const area = w * Math.max(h, 1)
  if (area < LARGE_AREA) return false

  // Behind the actors (comparatively) ⇒ never occludes the main sightline.
  const minActorZ = Math.min(...anchors.map((a) => a.position[2]))
  if (z <= minActorZ - OCCLUSION_SAFE_Z) return false
  // Far frame edges ⇒ only grazes.
  const hwAtZ = camera.halfWidthAt(z)
  if (Math.abs(x) - w / 2 >= hwAtZ * 0.78) return false
  // Between camera and actor line.
  const maxActorZ = Math.max(...anchors.map((a) => a.position[2]))
  const between = z > maxActorZ - 0.5 && z < camera.position[2] - 0.5
  if (!between) return false
  // Blocks the corridor?
  const sl = sightlineDistance(x, z, camera.position[2])
  return sl < w / 2 + 0.5
}

// ---------------------------------------------------------------------------
// Zone candidate selection
// ---------------------------------------------------------------------------

function zoneForSpec(spec: SceneObjectSpec): LayoutZoneId[] {
  const type = spec.semanticType.toLowerCase()
  const joined = `${type} ${spec.tags.join(' ')}`.toLowerCase()
  if (isArchitecture(spec) || /(wall|building|structure|backdrop|rear|architecture)/.test(joined)) {
    return ['rear_architecture', 'background_center', 'background_left', 'background_right']
  }
  if (isGroundDressing(spec) && spec.importance === 'dressing') {
    return ['ground_dressing', 'foreground_left', 'foreground_right', 'background_left', 'background_right']
  }
  return IMPORTANCE_ZONE_PRIORITY[spec.importance]
}

function samplePoint(zone: ZoneRect, rng: () => number, centerBias: number): { x: number; z: number } {
  if (centerBias > 0 && rng() < centerBias) {
    // Hero objects are placed near the zone's strong compositional center.
    const cx = (zone.x0 + zone.x1) / 2
    const cz = (zone.z0 + zone.z1) / 2
    const rx = (zone.x1 - zone.x0) / 2
    const rz = (zone.z1 - zone.z0) / 2
    return { x: cx + (rng() - 0.5) * rx * 0.6, z: cz + (rng() - 0.5) * rz * 0.6 }
  }
  return {
    x: zone.x0 + rng() * (zone.x1 - zone.x0),
    z: zone.z0 + rng() * (zone.z1 - zone.z0),
  }
}

function zoneCenter(zone: ZoneRect): { x: number; z: number } {
  return { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 }
}

// ---------------------------------------------------------------------------
// Main layout engine
// ---------------------------------------------------------------------------

export interface LayoutContext {
  occupied: Occupied[]
  rng: () => number
  camera: CameraReference
  anchors: ActorAnchor[]
  retries: number
  actorViolations: number
  occlusionViolations: number
  placementFallbacks: number
}

/**
 * Place a single object. Tries its candidate zones (bounded retries) and
 * returns a ResolvedSceneObject. Never returns null — the safest valid
 * fallback (or zone edge) is used when no ideal position exists.
 */
function placeObject(ctx: LayoutContext, spec: SceneObjectSpec, index: number): ResolvedSceneObject {
  const zones = zoneForSpec(spec)
  const isArch = isArchitecture(spec)
  const isGround = isGroundDressing(spec)
  const centerBias = spec.importance === 'hero' ? 0.75 : 0

  const scale = normalizeScale(spec, spec.importance)
  const r = footprintRadius(scale)
  const yGround = isGround ? scale[1] * 0.4 : scale[1] / 2

  // Seed the RNG per object (deterministic, no global stream coupling).
  const seedBase = (ctx.rng() * 0xffffffff) >>> 0
  const objRng = mulberry32(seedBase ^ (index * 7919 + spec.semanticType.length * 131))

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    ctx.retries++
    const zone = ZONE_BY_ID[zones[attempt % zones.length]]
    if (!zone) continue
    const p = samplePoint(zone, objRng, centerBias)

    // Actor + camera + sightline + overlap gates.
    const actorCheck = isActorSafe(p.x, p.z, r, ctx.anchors)
    if (!actorCheck.safe) continue
    if (!isCameraSafe(p.x, p.z, r, ctx.camera)) continue
    if (!isSightlineSafe(p.x, p.z, r, ctx.camera)) continue
    if (!isOverlapFree(p.x, p.z, r, ctx.occupied)) continue

    // Hero objects must actually be inside the Two-Shot frustum.
    const y = isArch ? scale[1] / 2 : yGround
    const visible = frustumContains(p.x, y, p.z, ctx.camera) || isArch
    if (spec.importance === 'hero' && spec.cameraImportant && !visible) continue

    const occlusion = wouldOccludeActors(p.x, p.z, scale, ctx.camera, ctx.anchors)
    if (occlusion) {
      ctx.occlusionViolations++
      continue
    }

    const rotation = resolveOrientation(
      pickOrientationHint(spec),
      p.x,
      p.z,
      ctx.camera,
      ctx.anchors,
      objRng,
      spec.rotation[1] ?? 0
    )
    ctx.occupied.push({ x: p.x, z: p.z, r, semanticType: spec.semanticType })

    return {
      sourceSpecId: spec.id,
      semanticType: spec.semanticType,
      importance: spec.importance,
      position: [round3(p.x), round3(y), round3(p.z)],
      rotation,
      scale,
      zone: ZONE_RESOLVED[zone.id],
      cameraVisible: visible,
      actorSafe: true,
      occlusionSafe: !occlusion,
      placementReason: `zone=${zone.id} fit=${attempt}`,
      fallbackPrimitive: spec.primitiveFallback,
      heroVisible: spec.importance === 'hero' ? visible : undefined,
    }
  }

  // --- Fallback path: no ideal slot found ----------------------------------
  ctx.placementFallbacks++
  const zone = ZONE_BY_ID[zones[0]] ?? ZONE_BY_ID.ground_dressing
  const c = zoneCenter(zone)
  const y = isArch ? scale[1] / 2 : yGround
  // Clamp into the zone and away from actors as much as possible.
  const fx = clamp(c.x, zone.x0, zone.x1)
  const fz = clamp(c.z, zone.z0, zone.z1)
  const actorCheck = isActorSafe(fx, fz, r, ctx.anchors)
  const rotation = resolveOrientation(
    pickOrientationHint(spec),
    fx,
    fz,
    ctx.camera,
    ctx.anchors,
    objRng,
    spec.rotation[1] ?? 0
  )
  const visible = frustumContains(fx, y, fz, ctx.camera)
  ctx.occupied.push({ x: fx, z: fz, r, semanticType: spec.semanticType })
  if (!actorCheck.safe) ctx.actorViolations += actorCheck.violations

  return {
    sourceSpecId: spec.id,
    semanticType: spec.semanticType,
    importance: spec.importance,
    position: [round3(fx), round3(y), round3(fz)],
    rotation,
    scale,
    zone: ZONE_RESOLVED[zone.id],
    cameraVisible: visible,
    actorSafe: actorCheck.safe,
    occlusionSafe: true,
    placementReason: `fallback=${zone.id}`,
    fallbackPrimitive: spec.primitiveFallback,
    heroVisible: spec.importance === 'hero' ? visible : undefined,
  }
}

// ---------------------------------------------------------------------------
// Relation resolution (Task 4)
// ---------------------------------------------------------------------------

/** Relations the layout engine can resolve geometrically. */
const RESOLVABLE_RELATIONS: ReadonlySet<SceneRelationType> = new Set([
  'near', 'leftOf', 'rightOf', 'inFrontOf', 'behind', 'facing',
])

/**
 * Forward-axis convention: the D3 stage extends toward −z (camera at +z,
 * actors near origin). "Behind" means further from the camera (more −z);
 * "in front of" means closer to the camera (more +z).
 */
export const FORWARD_AXIS = -1 // −z is "forward" into the stage

/** Distance threshold (metres) for a "near" relation to be satisfied. */
export const NEAR_DISTANCE = 2.2

/**
 * Test whether a single relation is geometrically satisfied by the resolved
 * transforms. Directional relations are pure geometry — no collision logic.
 */
export function relationSatisfied(
  relation: SceneRelation,
  objects: ResolvedSceneObject[]
): RelationResolution {
  const subject = objects.find((o) => o.sourceSpecId === relation.subject)
  const object = objects.find((o) => o.sourceSpecId === relation.object)
  if (!subject || !object) {
    return { relation, satisfied: false, detail: 'missing entity' }
  }

  const sx = subject.position[0]
  const sz = subject.position[2]
  const ox = object.position[0]
  const oz = object.position[2]
  const dx = sx - ox
  const dz = sz - oz
  const dist = Math.hypot(dx, dz)

  switch (relation.type) {
    case 'near':
      return { relation, satisfied: dist <= NEAR_DISTANCE, detail: `dist=${round3(dist)}` }
    case 'leftOf':
      // leftOf(A, B) ⇒ A.x < B.x
      return { relation, satisfied: sx < ox, detail: `sx=${round3(sx)} ox=${round3(ox)}` }
    case 'rightOf':
      // rightOf(A, B) ⇒ A.x > B.x
      return { relation, satisfied: sx > ox, detail: `sx=${round3(sx)} ox=${round3(ox)}` }
    case 'inFrontOf':
      // inFrontOf(A, B) ⇒ A is closer to the camera than B (A.z > B.z)
      return { relation, satisfied: sz > oz, detail: `sz=${round3(sz)} oz=${round3(oz)}` }
    case 'behind':
      // behind(A, B) ⇒ A is further from the camera than B (A.z < B.z)
      return { relation, satisfied: sz < oz, detail: `sz=${round3(sz)} oz=${round3(oz)}` }
    case 'facing': {
      // facing(A, B) ⇒ A's yaw points toward B (within tolerance).
      const yaw = subject.rotation[1]
      const desired = Math.atan2(ox - sx, oz - sz)
      const diff = Math.abs(Math.atan2(Math.sin(yaw - desired), Math.cos(yaw - desired)))
      const tol = 0.35 // ~20° tolerance
      return { relation, satisfied: diff <= tol, detail: `yaw=${round3(yaw)} desired=${round3(desired)} diff=${round3(diff)}` }
    }
    default:
      return { relation, satisfied: false, detail: 'not resolvable' }
  }
}

/**
 * Apply resolvable relations to the resolved layout. Preserves existing
 * placement behavior — relations only nudge entities that already have a
 * base placement, and never drop or re-place objects.
 *
 * Returns the (possibly adjusted) objects plus per-relation resolution
 * results for testability.
 */
export function resolveRelations(
  objects: ResolvedSceneObject[],
  relations: SceneRelation[]
): { objects: ResolvedSceneObject[]; resolutions: RelationResolution[] } {
  const resolutions: RelationResolution[] = []
  const adjusted = objects.map((object) => ({
    ...object,
    position: [...object.position] as [number, number, number],
    rotation: [...object.rotation] as [number, number, number],
    scale: [...object.scale] as [number, number, number],
  }))
  const byId = new Map(adjusted.map((object) => [object.sourceSpecId, object]))

  for (const rel of relations) {
    if (!RESOLVABLE_RELATIONS.has(rel.type)) continue
    const subject = byId.get(rel.subject)
    const object = byId.get(rel.object)
    if (!subject || !object) continue

    const sx = subject.position[0]
    const sz = subject.position[2]
    const ox = object.position[0]
    const oz = object.position[2]

    switch (rel.type) {
      case 'near': {
        // Nudge subject toward object if too far (keep it near, not exact).
        const dist = Math.hypot(sx - ox, sz - oz)
        if (dist > NEAR_DISTANCE) {
          const t = (NEAR_DISTANCE * 0.8) / dist
          subject.position = [round3(ox + (sx - ox) * t), subject.position[1], round3(oz + (sz - oz) * t)]
        }
        break
      }
      case 'leftOf': {
        // leftOf(A, B) ⇒ A.x < B.x — push A left of B by a small margin.
        if (sx >= ox) {
          const margin = 0.6
          subject.position = [round3(ox - margin), subject.position[1], subject.position[2]]
        }
        break
      }
      case 'rightOf': {
        // rightOf(A, B) ⇒ A.x > B.x — push A right of B by a small margin.
        if (sx <= ox) {
          const margin = 0.6
          subject.position = [round3(ox + margin), subject.position[1], subject.position[2]]
        }
        break
      }
      case 'inFrontOf': {
        // inFrontOf(A, B) ⇒ A closer to camera (A.z > B.z).
        if (sz <= oz) {
          const margin = 0.6
          subject.position = [subject.position[0], subject.position[1], round3(oz + margin)]
        }
        break
      }
      case 'behind': {
        // behind(A, B) ⇒ A further from camera (A.z < B.z).
        if (sz >= oz) {
          const margin = 0.6
          subject.position = [subject.position[0], subject.position[1], round3(oz - margin)]
        }
        break
      }
      case 'facing': {
        // facing(A, B) ⇒ A's yaw points toward B.
        const yaw = Math.atan2(ox - sx, oz - sz)
        subject.rotation = [0, round3(yaw), 0]
        break
      }
      default:
        break
    }
  }

  for (const rel of relations) {
    if (!RESOLVABLE_RELATIONS.has(rel.type)) continue
    resolutions.push(relationSatisfied(rel, adjusted))
  }

  return { objects: adjusted, resolutions }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic spatial layout for a validated SceneGraph's
 * semantic object requests.
 *
 * Same SceneGraph + seed + camera ⇒ identical transforms.
 */
export function planLayout(input: LayoutInput): LayoutOutput {
  const camera = input.camera ?? twoShotWideCamera()
  const anchors = input.actorAnchors ?? DEFAULT_ACTOR_ANCHORS
  const rng = mulberry32(input.seed >>> 0)

  // Sort by importance so heroes/supporting claim the strong slots first.
  const weight: Record<SceneImportance, number> = { hero: 0, supporting: 1, dressing: 2 }
  const sorted = [...input.objects].sort((a, b) => weight[a.importance] - weight[b.importance])

  const ctx: LayoutContext = {
    occupied: [],
    rng,
    camera,
    anchors,
    retries: 0,
    actorViolations: 0,
    occlusionViolations: 0,
    placementFallbacks: 0,
  }

  const objects = sorted.map((spec, i) => placeObject(ctx, spec, i))

  // Apply resolvable relations (near/leftOf/rightOf/inFrontOf/behind/facing)
  // after base placement. Preserves existing placement behavior — relations
  // only nudge entities, never drop or re-place them.
  const relations = input.sceneGraph?.relations ?? []
  const resolved = resolveRelations(objects, relations)

  const heroCount = resolved.objects.filter((o) => o.importance === 'hero').length
  const visibleHeroCount = resolved.objects.filter((o) => o.importance === 'hero' && o.cameraVisible).length
  const visibleTotal = resolved.objects.filter((o) => o.cameraVisible).length
  const frustumVisibleRatio = resolved.objects.length === 0 ? 1 : visibleTotal / resolved.objects.length

  const stats: LayoutStats = {
    objectCount: resolved.objects.length,
    heroCount,
    visibleHeroCount,
    frustumVisibleRatio: round3(frustumVisibleRatio),
    actorCollisionViolations: ctx.actorViolations,
    objectCollisionRetries: ctx.retries,
    occlusionViolations: ctx.occlusionViolations,
    placementFallbacks: ctx.placementFallbacks,
  }

  return { objects: resolved.objects, stats }
}

/**
 * DEV-only concise layout report. Spams nothing by default — callers opt in.
 */
export function logLayoutReport(out: LayoutOutput, label = 'layout'): void {
  if (typeof console === 'undefined') return
  const s = out.stats
  console.log(
    `[D3 LAYOUT] ${label}: ${s.objectCount} objects · heroes ${s.visibleHeroCount}/${s.heroCount} visible · ` +
      `frustum ${(s.frustumVisibleRatio * 100).toFixed(0)}% · actorHits ${s.actorCollisionViolations} · ` +
      `retries ${s.objectCollisionRetries} · occlusions ${s.occlusionViolations} · fallbacks ${s.placementFallbacks}`
  )
}