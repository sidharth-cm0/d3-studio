/**
 * Dynamic Environment Builder — PHASE 3.
 *
 *   ValidatedSceneGraph  (sceneGraphTypes.ts — semantic intent)
 *   + AssetMatchResult[] (semanticAssetMatcher.ts — GLB vs procedural)
 *   + ResolvedSceneObject[] (spatialLayoutEngine.ts — AUTHORITATIVE transforms)
 *     → buildDynamicEnvironment()
 *     → { group: THREE.Group, stats: DynamicEnvironmentStats }
 *
 * The returned group is a disposable, style-gradeable environment compatible
 * with the existing stageGroup / VisualStyleController model:
 *  - every material is a MeshStandardMaterial from a per-build MaterialBank
 *  - static matrices (matrixAutoUpdate = false), no lights, no RAF, no physics
 *  - full metadata on group.userData (counts, diagnostics, lighting requests,
 *    atmosphere/fog metadata, prop census)
 *
 * BASE ENVIRONMENT GUARANTEE — every generated scene contains ground,
 * meaningful background/atmosphere metadata, foreground/midground/background
 * depth and contextual geometry, even when the asset manifest is empty, all
 * GLBs fail, or unknown semantic types appear. The builder NEVER returns an
 * empty group and NEVER throws on optional asset failure.
 *
 * TRANSFORM AUTHORITY: the Spatial Layout Engine remains authoritative. The
 * builder applies position/rotation/scale from ResolvedSceneObject as-is,
 * with only implementation-level pivot corrections (prop groups are
 * base-pivot; layout reports center height) and organic settle for
 * ground-dressing props whose `flat` layout rotation assumes plane pivots.
 *
 * DISPOSAL: disposeDynamicEnvironment(group) frees per-build geometries,
 * materials and owned textures; shared GLB cache resources are never
 * double-disposed. Safe to call twice; build→dispose→build→dispose cycles
 * are safe.
 *
 * This module is NOT wired into the live app — standalone Phase 3 only.
 */

import * as THREE from 'three'
import type {
  AssetMatchResult,
  SceneGraph,
  SceneLightSpec,
  SceneObjectSpec,
  ValidatedSceneGraph,
} from './sceneGraphTypes'
import type { LayoutStats, ResolvedSceneObject } from './spatialLayoutEngine'
import {
  type Ctx,
  type Placement,
  ZONES,
  GeometryBank,
  MaterialBank,
  bx,
  buildBarrel,
  buildBeam,
  buildBench,
  buildBush,
  buildCabinet,
  buildChair,
  buildCrate,
  buildDesk,
  buildDoorway,
  buildFence,
  buildFloorMesh,
  buildLampPost,
  buildPallet,
  buildPipe,
  buildPlatform,
  buildPillar,
  buildRock,
  buildRoad,
  buildShelf,
  buildScreen,
  buildSidewalk,
  buildSign,
  buildSofa,
  buildTable,
  buildTrackSegment,
  buildTree,
  buildTunnelArch,
  buildWall,
  buildWindow,
  disposeObjectDeep,
  jitterHex,
  mixHex,
  mkInstanced,
  mkMesh,
  mulberry32,
  newProp,
  placeInZone,
  recordProp,
  registerOccluder,
} from './environmentProps'
import {
  buildAltar,
  buildArtifact,
  buildBed,
  buildBoat,
  buildBuildingBlock,
  buildCampfire,
  buildConsole,
  buildCounter,
  buildCrater,
  buildCrystal,
  buildDebris,
  buildDune,
  buildGenericCompound,
  buildGlowFlora,
  buildHouse,
  buildLabMachine,
  buildMonitor,
  buildPottedPlant,
  buildRockFormation,
  buildSpaceship,
  buildStairs,
  buildStalagmite,
  buildStatue,
  buildTent,
  buildVehicle,
} from './dynamicEnvironmentCompounds'
import { buildEntityVisual, resolveVisualCategory } from './entityVisualResolver'

/** Categories supported by the entityVisualResolver's buildEntityVisual(). */
const ENTITY_VISUAL_CATEGORIES = new Set([
  'crate', 'door', 'lamp', 'streetlight', 'sofa', 'chair', 'table', 'machinery', 'pillar',
])

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DynamicEnvironmentInput {
  /** Validated + normalized scene graph (semantic intent). */
  sceneGraph: ValidatedSceneGraph
  /** Authoritative transforms from the Spatial Layout Engine. */
  resolvedObjects: ResolvedSceneObject[]
  /**
   * Asset matches parallel to `sceneGraph.objects` (same order, from
   * matchAssetsSync) OR a record keyed by SceneObjectSpec.id.
   * Missing/empty ⇒ everything renders procedurally (fully supported).
   */
  assetMatches?: AssetMatchResult[] | Record<string, AssetMatchResult>
  /** Deterministic seed (defaults to sceneGraph.seed). */
  seed?: number
  /** Optional layout diagnostics to preserve verbatim in metadata. */
  layoutStats?: LayoutStats
}

export interface DynamicEnvironmentStats {
  generator: 'dynamic'
  sceneGraphVersion: number
  seed: number
  environmentType: string
  objectCount: number
  heroObjectCount: number
  meshCount: number
  instancedMeshCount: number
  instanceCount: number
  drawCallEstimate: number
  assetCount: number
  proceduralCount: number
  fallbackCount: number
  frustumVisibleRatio: number
  collisionViolations: number
  occlusionViolations: number
  depthCueCount: number
  generationTimeMs: number
}

export interface DynamicEnvironmentResult {
  group: THREE.Group
  stats: DynamicEnvironmentStats
}

/** Semantic lighting REQUEST (metadata only — no THREE lights are created). */
export interface DynamicLightingRequest {
  role: 'primary' | 'fill' | 'accent'
  intent: string
  color: string
  intensityHint: string
  castShadows: boolean
  suggestedPosition: [number, number, number]
}

export interface DynamicLightingMetadata {
  /** ≤ 3 requests — one primary, one fill, one accent (runtime budget). */
  lights: DynamicLightingRequest[]
  /** Emissive practicals represented as geometry (never runtime lights). */
  practicals: Array<{ kind: string; position: [number, number, number]; color: string }>
  maxRuntimeLights: 3
}

export interface DynamicAtmosphereMetadata {
  backgroundColor: string
  fogColor: string
  fogNear: number
  fogFar: number
  skyType: string
}

// ---------------------------------------------------------------------------
// Helpers — colors, numbers
// ---------------------------------------------------------------------------

/** '#rrggbb' | 'rgb(...)' | named → int hex (never NaN; fallback on failure). */
export function hexToInt(hex: string | undefined, fallback = 0x808080): number {
  if (typeof hex !== 'string' || !hex.trim()) return fallback
  try {
    const c = new THREE.Color(hex)
    if (!Number.isFinite(c.r) || !Number.isFinite(c.g) || !Number.isFinite(c.b)) return fallback
    return c.getHex()
  } catch {
    return fallback
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.min(40, Math.max(0.02, v))
}

function dim(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, safeNum(v, min)))
}

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}

// ---------------------------------------------------------------------------
// Build context — Phase 2 Ctx constructed from a SceneGraph
// ---------------------------------------------------------------------------

const NIGHT_TIMES = new Set(['evening', 'night', 'midnight'])

/**
 * Build a Phase-2-compatible Ctx from the SceneGraph so the entire existing
 * prop library (MaterialBank, GeometryBank, mkInstanced, safety audits,
 * census) is reused without duplication.
 */
function makeCtx(group: THREE.Group, sg: SceneGraph, rng: () => number): Ctx {
  const primary = hexToInt(sg.palette.primary, 0x4a505a)
  const secondary = hexToInt(sg.palette.secondary, 0x5c6470)
  const accent = hexToInt(sg.palette.accent, 0x8a95a3)
  const ground = hexToInt(sg.palette.ground ?? sg.ground.color, 0x3a3f47)
  const background = hexToInt(sg.palette.background, 0x14182a)
  const darken = sg.details.old || sg.details.abandoned ? 0.82 : 1
  return {
    group,
    rng,
    mats: new MaterialBank(darken, sg.details.rain),
    geos: new GeometryBank(),
    palette: {
      primary,
      secondary,
      accent,
      ground,
      wall: mixHex(primary, background, 0.35),
    },
    count: 0,
    instancedCount: 0,
    occupied: [],
    night: NIGHT_TIMES.has(sg.timeOfDay),
    details: { ...sg.details },
    census: new Map<string, number>(),
    actorViolations: 0,
    cameraViolations: 0,
    occlusionViolations: 0,
  }
}

// ---------------------------------------------------------------------------
// Ground generation — semantic, never a generic grey plane
// ---------------------------------------------------------------------------

type GroundProfile = 'terrain' | 'interior' | 'asphalt'
type InteriorStyle = 'wood' | 'industrial' | 'tile' | 'plain'

interface GroundPlan {
  profile: GroundProfile
  interiorStyle: InteriorStyle
  colorHex: number
  relief: number
}

function resolveGroundPlan(sg: SceneGraph): GroundPlan {
  const gt = (sg.ground.type || '').toLowerCase()
  const env = (sg.environment.type || '').toLowerCase()
  const semanticColor = hexToInt(sg.ground.color, hexToInt(sg.palette.ground, 0x3a3f47))
  // Rust terrain must remain visibly warm after story-level aging/abandonment
  // grading. This is a semantic Mars material bias, not a visual-style grade;
  // MaterialBank still owns all later darkening and runtime style compatibility.
  const colorHex = env === 'mars' || gt.includes('rocky_red')
    ? mixHex(semanticColor, 0xc8663d, 0.38)
    : semanticColor
  const relief = safeNum(sg.ground.relief, 0.3)

  if (gt === 'road' || gt === 'street' || gt === 'asphalt' || env === 'street' || env === 'vehicle_scene') {
    return { profile: 'asphalt', interiorStyle: 'plain', colorHex: mixHex(colorHex, 0x0c0d12, 0.55), relief: 0 }
  }
  // Concrete plaza / urban pavement — flat slab with expansion joints.
  if (gt === 'concrete' || gt === 'pavement') {
    return { profile: 'asphalt', interiorStyle: 'plain', colorHex: mixHex(colorHex, 0x8a8d94, 0.35), relief: 0 }
  }
  if (gt === 'stone_floor') {
    return { profile: 'interior', interiorStyle: 'tile', colorHex, relief: 0 }
  }
  if (gt === 'floor' || gt === 'metal_floor') {
    const style: InteriorStyle =
      env === 'apartment' ? 'wood'
      : env === 'shop' || env === 'cyberpunk' ? 'tile'
      : 'industrial'
    return { profile: 'interior', interiorStyle: style, colorHex, relief: 0 }
  }
  // Outdoor terrain families (rocky_red_terrain, rocky_terrain, sand, snow,
  // forest_floor, grass, water_edge, unknown).
  return { profile: 'terrain', interiorStyle: 'plain', colorHex, relief }
}

/**
 * Displaced low-poly terrain — sum-of-sines relief, FLAT inside the actor /
 * placement radius (r < 6) so resolved object heights stay valid, rising
 * toward a distant relief ring (depth cue, never under placed props).
 */
function buildTerrainGround(ctx: Ctx, plan: GroundPlan, rough: number): THREE.Mesh {
  const size = 38
  const segs = 30
  const geo = new THREE.PlaneGeometry(size, size, segs, segs)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const rng = ctx.rng
  const p1 = rng() * Math.PI * 2
  const p2 = rng() * Math.PI * 2
  const p3 = rng() * Math.PI * 2
  const f1 = 0.16 + rng() * 0.1
  const f2 = 0.14 + rng() * 0.1
  const f3 = 0.3 + rng() * 0.16
  const amp = 0.16 + plan.relief * 0.5
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i) // plane-local; becomes world −z after rotation
    const d = Math.hypot(x, y)
    // Flat inside the placement area, full relief in the far ring only.
    const t = THREE.MathUtils.smoothstep(d, 6.0, 11.0)
    const h =
      amp * t *
      (Math.sin(x * f1 + p1) * 0.5 + Math.sin(y * f2 + p2) * 0.35 + Math.sin((x + y) * f3 + p3) * 0.3)
    pos.setZ(i, h)
  }
  geo.computeVertexNormals()
  const mat = ctx.mats.get(jitterHex(plan.colorHex, rng, 0.1), {
    rough: Math.min(1, Math.max(0.4, rough)),
    metal: 0.02,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'dynamicGround'
  mesh.userData.role = 'ground'
  mesh.rotation.x = -Math.PI / 2
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  ctx.count++
  recordProp(ctx, 'ground_terrain')
  return mesh
}

/** Interior floor — flat slab + semantic detail (planks / joints / tiles). */
function buildInteriorFloor(ctx: Ctx, plan: GroundPlan): void {
  const rough = plan.interiorStyle === 'industrial' ? 0.8 : 0.68
  const floor = buildFloorMesh(ctx, 26, plan.colorHex, rough)
  floor.name = 'dynamicGround'
  floor.userData.role = 'ground'
  ctx.group.add(floor)
  recordProp(ctx, `ground_${plan.interiorStyle}`)

  if (plan.interiorStyle === 'wood') {
    // Plank seams running along Z — one instanced mesh.
    const plankGeo = ctx.geos.box(0.045, 0.012, 26)
    const plankMat = ctx.mats.get(mixHex(plan.colorHex, 0x000000, 0.35), { rough: 0.9 })
    const placements: Placement[] = []
    for (let i = 0; i < 15; i++) {
      placements.push({ x: -4.2 + i * 0.6, y: 0.008, z: 0 })
    }
    ctx.group.add(mkInstanced(ctx, plankGeo, plankMat, placements, 'floor_planks', { jitter: 0.22 }))
  } else if (plan.interiorStyle === 'industrial' || plan.interiorStyle === 'tile') {
    // Expansion joints / tile grout — one instanced mesh, both axes.
    const jointGeo = ctx.geos.box(0.05, 0.012, 26)
    const jointHex =
      plan.interiorStyle === 'industrial'
        ? mixHex(plan.colorHex, 0x000000, 0.4)
        : mixHex(plan.colorHex, 0xffffff, 0.18)
    const jointMat = ctx.mats.get(jointHex, { rough: 0.9 })
    const placements: Placement[] = []
    for (let i = 0; i < 7; i++) {
      placements.push({ x: -7.5 + i * 2.5, y: 0.008, z: 0, ry: 0 })
    }
    for (let i = 0; i < 5; i++) {
      placements.push({ x: 0, y: 0.009, z: -8 + i * 2.6, ry: Math.PI / 2 })
    }
    ctx.group.add(mkInstanced(ctx, jointGeo, jointMat, placements, 'floor_joints'))
  }
}

/** Asphalt — dark slab + lane dashes. */
function buildAsphaltGround(ctx: Ctx, plan: GroundPlan): void {
  const floor = buildFloorMesh(ctx, 28, plan.colorHex, 0.88)
  floor.name = 'dynamicGround'
  floor.userData.role = 'ground'
  ctx.group.add(floor)
  recordProp(ctx, 'ground_asphalt')
  const dashMat = ctx.mats.get(0x8a8672, { rough: 0.8 })
  const dashGeo = ctx.geos.box(0.14, 0.012, 1.0)
  const placements: Placement[] = []
  for (let i = 0; i < 8; i++) {
    placements.push({ x: 0, y: 0.008, z: -10 + i * 2.4 })
  }
  ctx.group.add(mkInstanced(ctx, dashGeo, dashMat, placements, 'road_dashes'))
}

function buildSemanticGround(ctx: Ctx, sg: SceneGraph): GroundPlan {
  const plan = resolveGroundPlan(sg)
  const rough = Math.min(1, Math.max(0.35, safeNum(sg.ground.roughness, 0.95)))
  if (plan.profile === 'terrain') {
    ctx.group.add(buildTerrainGround(ctx, plan, rough))
    // Sand ripples — semantic surface character, one instanced mesh.
    if ((sg.ground.type || '').toLowerCase().includes('sand')) {
      const rippleGeo = ctx.geos.box(3.4, 0.045, 0.5)
      const rippleMat = ctx.mats.get(mixHex(plan.colorHex, 0x000000, 0.14), { rough: 1 })
      const placements: Placement[] = []
      for (let i = 0; i < 7; i++) {
        placements.push({
          x: (ctx.rng() - 0.5) * 16,
          y: 0.02,
          z: -2.5 - ctx.rng() * 9,
          ry: (ctx.rng() - 0.5) * 0.7,
        })
      }
      ctx.group.add(mkInstanced(ctx, rippleGeo, rippleMat, placements, 'sand_ripples'))
    }
  } else if (plan.profile === 'asphalt') {
    buildAsphaltGround(ctx, plan)
  } else {
    buildInteriorFloor(ctx, plan)
  }
  return plan
}

// ---------------------------------------------------------------------------
// Backdrop / depth shell — guaranteed background, never a flat color void
// ---------------------------------------------------------------------------

type BackdropKind = 'formations' | 'dunes' | 'trees' | 'cavern' | 'skyline' | 'walls'

function resolveBackdropKind(sg: SceneGraph): BackdropKind {
  const env = (sg.environment.type || '').toLowerCase()
  const indoor = sg.environment.indoorOutdoor === 'indoor'
  // A cave is semantically indoor, but its enclosure must be generated as a
  // rocky cavern shell rather than falling through to generic room walls.
  if (env === 'cave') return 'cavern'
  if (indoor || env === 'shop' || env === 'cyberpunk' || env === 'laboratory' || env === 'hospital' || env === 'school' || env === 'office' || env === 'castle' || env === 'apartment' || env === 'factory') return 'walls'
  if (env === 'desert') return 'dunes'
  if (env === 'forest' || env === 'camp' || env === 'garden' || env === 'waterside' || env === 'beach' || env === 'village') return 'trees'
  if (env === 'street' || env === 'vehicle_scene' || env === 'city') return 'skyline'
  return 'formations'
}

type Practical = { kind: string; position: [number, number, number]; color: string }

/** Distant instanced silhouettes — 1–3 draw calls for a whole depth ring. */
function buildBackdrop(ctx: Ctx, sg: SceneGraph, practicals: Practical[]): BackdropKind {
  const kind = resolveBackdropKind(sg)
  const pal = ctx.palette
  const lit = !sg.details.abandoned

  if (kind === 'walls') {
    // Rear wall + side returns — always BEHIND the actor line (occlusion-safe).
    const back = buildWall(ctx, 22, 5.4, 0.4, ctx.palette.wall)
    back.position.set(0, 0, -8.4)
    ctx.group.add(back)
    registerOccluder(ctx, 0, -8.4, 22, 5.4)
    for (const sx of [-6.4, 6.4]) {
      const side = buildWall(ctx, 0.4, 4.6, 7.0, mixHex(ctx.palette.wall, 0x000000, 0.12))
      side.position.set(sx, 0, -5.2)
      ctx.group.add(side)
      registerOccluder(ctx, sx, -5.2, 0.4, 4.6)
    }
    // Family dressing on the rear shell (budget-guarded).
    const env = (sg.environment.type || '').toLowerCase()
    const glow = pal.accent
    if ((env === 'shop' || env === 'cyberpunk') && ctx.count < 40) {
      for (const [sx, sy] of [[-2.9, 2.75], [2.9, 3.0]] as Array<[number, number]>) {
        const sign = buildSign(ctx, 2.2, 0.9, mixHex(pal.primary, 0x000000, 0.2), glow)
        sign.position.set(sx, sy, -8.12)
        ctx.group.add(sign)
        practicals.push({ kind: 'sign', position: [sx, sy, -8.05], color: hexToCss(glow) })
      }
      const screen = buildScreen(ctx, 3.2, 1.8)
      screen.position.set(0, 2.35, -8.2)
      ctx.group.add(screen)
      practicals.push({ kind: 'screen', position: [0, 2.35, -8.1], color: '#3aa0ff' })
    } else if ((env === 'laboratory' || env === 'hospital' || env === 'school' || env === 'office') && ctx.count < 40) {
      for (const sx of [-3.4, 3.4]) {
        const screen = buildScreen(ctx, 2.4, 1.4)
        screen.position.set(sx, 2.5, -8.12)
        ctx.group.add(screen)
        practicals.push({ kind: 'screen', position: [sx, 2.5, -8.0], color: '#3aa0ff' })
      }
      // Two service pipes and their six collars share geometry/materials and
      // render in two instanced draw calls instead of eight individual meshes.
      const pipeMaterial = ctx.mats.get(0x3a4048, { rough: 0.5, metal: 0.55 })
      const collarMaterial = ctx.mats.get(0x2a2f36, { rough: 0.5, metal: 0.6 })
      const pipePlacements: Placement[] = [3.4, 3.9].map((y) => ({
        x: 0, y, z: -8.05, rz: Math.PI / 2,
      }))
      const collarPlacements: Placement[] = []
      for (const y of [3.4, 3.9]) {
        for (const x of [-7.5, 0, 7.5]) {
          collarPlacements.push({ x, y, z: -8.05, rz: Math.PI / 2 })
        }
      }
      ctx.group.add(mkInstanced(ctx, ctx.geos.cyl(0.14, 0.14, 16, 8), pipeMaterial, pipePlacements, 'lab_service_pipe'))
      ctx.group.add(mkInstanced(ctx, ctx.geos.cyl(0.2, 0.2, 0.14, 8), collarMaterial, collarPlacements, 'lab_pipe_collar'))
      recordProp(ctx, 'pipe')
    } else if ((env === 'castle' || env === 'temple') && ctx.count < 40) {
      for (const sx of [-3.6, 3.6]) {
        const pillar = buildPillar(ctx, 4.6, mixHex(pal.primary, 0x000000, 0.15))
        pillar.position.set(sx, 0, -7.5)
        ctx.group.add(pillar)
      }
      for (const sx of [-2.2, 2.2]) {
        const torch = bx(
          ctx,
          0.12,
          0.3,
          0.12,
          ctx.mats.get(0x05070c, {
            rough: 0.5,
            emissive: lit ? 0xffb36b : 0x1a120c,
            emissiveIntensity: lit ? 1.3 : 0.1,
          }),
          sx,
          2.4,
          -8.1
        )
        torch.name = 'torch_sconce'
        ctx.group.add(torch)
        if (lit) practicals.push({ kind: 'torch', position: [sx, 2.55, -8.0], color: '#ffb36b' })
      }
    } else if (ctx.count < 42) {
      for (const sx of [-3.4, 3.4]) {
        ctx.group.add(mkWallPanel(ctx, 3.0, 2.2, mixHex(ctx.palette.wall, 0xffffff, 0.1), sx, 1.9, -8.15))
      }
    }
    recordProp(ctx, 'backdrop_walls')
    return kind
  }

  if (kind === 'dunes') {
    const placements: Placement[] = []
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? -1 : 1
      placements.push({
        x: side * (2 + ctx.rng() * 11),
        y: 0.15,
        z: -9 - ctx.rng() * 5,
        sx: 3 + ctx.rng() * 3.5,
        sy: 0.9 + ctx.rng() * 1.1,
        sz: 2.2 + ctx.rng() * 1.6,
        ry: ctx.rng() * Math.PI,
      })
    }
    ctx.group.add(
      mkInstanced(
        ctx,
        ctx.geos.sphere(1, 9, 6),
        ctx.mats.get(mixHex(ctx.palette.ground, 0x000000, 0.18), { rough: 1 }),
        placements,
        'bg_dune',
        { jitter: 0.22 }
      )
    )
    recordProp(ctx, 'backdrop_dunes')
    return kind
  }

  if (kind === 'trees') {
    const trunkPlacements: Placement[] = []
    const canopyA: Placement[] = []
    const canopyB: Placement[] = []
    for (let i = 0; i < 10; i++) {
      const x = -11 + (i / 9) * 22 + (ctx.rng() - 0.5) * 2.2
      const z = -8.5 - ctx.rng() * 4
      const s = 1.4 + ctx.rng() * 1.1
      trunkPlacements.push({ x, y: 1.1 * s, z, sx: s, sy: s, sz: s })
      canopyA.push({ x, y: 2.6 * s, z, sx: s, sy: s, sz: s, ry: ctx.rng() * Math.PI })
      canopyB.push({ x, y: 3.9 * s, z, sx: s * 0.72, sy: s, sz: s * 0.72, ry: ctx.rng() * Math.PI })
    }
    ctx.group.add(mkInstanced(ctx, ctx.geos.cyl(0.14, 0.24, 2.2, 6), ctx.mats.get(0x33261a, { rough: 1 }), trunkPlacements, 'bg_tree_trunk', { jitter: 0.2 }))
    ctx.group.add(mkInstanced(ctx, ctx.geos.cone(1.5, 3.0, 7), ctx.mats.get(mixHex(ctx.palette.secondary, 0x000000, 0.25), { rough: 1 }), canopyA, 'bg_tree_canopy_a', { jitter: 0.24 }))
    ctx.group.add(mkInstanced(ctx, ctx.geos.cone(1.0, 2.4, 7), ctx.mats.get(mixHex(ctx.palette.primary, 0x000000, 0.2), { rough: 1 }), canopyB, 'bg_tree_canopy_b', { jitter: 0.24 }))
    recordProp(ctx, 'backdrop_trees')
    return kind
  }

  if (kind === 'cavern') {
    const shellPlacements: Placement[] = []
    const spikePlacements: Placement[] = []
    const crystalPlacements: Placement[] = []
    // Rear rock shell closes the frame with tangible background geometry.
    for (let i = 0; i < 7; i++) {
      const x = -9 + i * 3
      shellPlacements.push({
        x,
        y: 2.2 + (i % 2) * 0.55,
        z: -11.2 - (i % 3) * 0.35,
        sx: 2.1,
        sy: 2.8 + (i % 2) * 0.5,
        sz: 1.5,
        ry: ctx.rng() * Math.PI,
      })
    }
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const x = side * (2.2 + ctx.rng() * 9)
      const z = -7.5 - ctx.rng() * 4.5
      const s = 0.9 + ctx.rng() * 1.4
      spikePlacements.push({ x, y: 1.1 * s, z, sx: s, sy: s, sz: s, ry: ctx.rng() * Math.PI })
      if (i % 2 === 0) {
        crystalPlacements.push({
          x: x + (ctx.rng() - 0.5) * 1.4,
          y: 0.5,
          z: z + 1.2,
          sx: 1 + ctx.rng(),
          sy: 0.8 + ctx.rng() * 0.9,
          sz: 1,
          ry: ctx.rng() * Math.PI,
        })
      }
    }
    ctx.group.add(mkInstanced(ctx, ctx.geos.dodeca(1), ctx.mats.get(mixHex(ctx.palette.primary, 0x000000, 0.28), { rough: 0.98 }), shellPlacements, 'bg_cavern_shell', { jitter: 0.18 }))
    ctx.group.add(mkInstanced(ctx, ctx.geos.cone(0.55, 2.4, 6), ctx.mats.get(mixHex(ctx.palette.primary, 0x000000, 0.2), { rough: 0.9 }), spikePlacements, 'bg_stalagmite', { jitter: 0.25 }))
    ctx.group.add(
      mkInstanced(
        ctx,
        ctx.geos.cone(0.3, 1.1, 5),
        ctx.mats.get(0x0a2030, { rough: 0.3, emissive: pal.accent, emissiveIntensity: 0.9 }),
        crystalPlacements,
        'bg_crystal',
        { jitter: 0.2 }
      )
    )
    if (lit) practicals.push({ kind: 'crystal', position: [0, 1.2, -9], color: hexToCss(pal.accent) })
    recordProp(ctx, 'backdrop_cavern')
    return kind
  }

  if (kind === 'skyline') {
    const bodyPlacements: Placement[] = []
    const winPlacements: Placement[] = []
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const x = side * (3 + ctx.rng() * 11)
      const z = -11 - ctx.rng() * 4
      const w = 3 + ctx.rng() * 2.5
      const h = 5 + ctx.rng() * 7
      const d = 3 + ctx.rng() * 2
      bodyPlacements.push({ x, y: h / 2, z, sx: w, sy: h, sz: d })
      if (lit) {
        winPlacements.push({ x: x + (ctx.rng() - 0.5) * w * 0.4, y: h * 0.35, z: z + d / 2 + 0.05 })
        winPlacements.push({ x: x + (ctx.rng() - 0.5) * w * 0.4, y: h * 0.68, z: z + d / 2 + 0.05 })
      }
    }
    ctx.group.add(mkInstanced(ctx, ctx.geos.box(1, 1, 1), ctx.mats.get(mixHex(ctx.palette.primary, 0x000000, 0.3), { rough: 0.9 }), bodyPlacements, 'bg_building', { jitter: 0.2 }))
    ctx.group.add(
      mkInstanced(
        ctx,
        ctx.geos.box(1.5, 0.5, 0.06),
        ctx.mats.get(0x0a0e18, { rough: 0.4, emissive: lit ? 0xe8c47a : 0x0a0e18, emissiveIntensity: lit ? 0.8 : 0.05 }),
        winPlacements,
        'bg_windows',
        { jitter: 0.3 }
      )
    )
    recordProp(ctx, 'backdrop_skyline')
    return kind
  }

  // formations (default outdoor) — rocky silhouettes sinking into fog.
  const bodyPlacements: Placement[] = []
  const spikePlacements: Placement[] = []
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (2.5 + ctx.rng() * 10.5)
    const z = -8.5 - ctx.rng() * 5
    const s = 1.4 + ctx.rng() * 1.9
    bodyPlacements.push({ x, y: s * 0.55, z, sx: s, sy: s * (0.7 + ctx.rng() * 0.5), sz: s, ry: ctx.rng() * Math.PI })
    if (i % 3 === 0) {
      spikePlacements.push({ x: x + side * 1.6, y: s * 0.7, z: z - 1.2, sx: s * 0.5, sy: s * (0.9 + ctx.rng() * 0.6), sz: s * 0.5, ry: ctx.rng() * Math.PI })
    }
  }
  ctx.group.add(mkInstanced(ctx, ctx.geos.dodeca(1), ctx.mats.get(mixHex(ctx.palette.primary, 0x000000, 0.22), { rough: 0.95 }), bodyPlacements, 'bg_formation', { jitter: 0.28 }))
  ctx.group.add(mkInstanced(ctx, ctx.geos.cone(0.9, 2.6, 6), ctx.mats.get(mixHex(ctx.palette.secondary, 0x000000, 0.28), { rough: 0.95 }), spikePlacements, 'bg_formation_spike', { jitter: 0.25 }))
  recordProp(ctx, 'backdrop_formations')
  return kind
}

/** Flat wall panel helper (default interior dressing). */
function mkWallPanel(ctx: Ctx, w: number, h: number, hex: number, x: number, y: number, z: number): THREE.Group {
  const g = newProp('wall_panel')
  g.add(mkMesh(ctx, ctx.geos.box(w, h, 0.14), ctx.mats.get(hex, { rough: 0.9 }), 0, 0, 0))
  g.position.set(x, y, z)
  g.matrixAutoUpdate = false
  g.updateMatrix()
  return g
}

// ---------------------------------------------------------------------------
// Instanced dressing families — repeated props collapse into ONE draw call
// ---------------------------------------------------------------------------

interface InstancedFamilySpec {
  natural: [number, number, number]
  geo: (ctx: Ctx) => THREE.BufferGeometry
  mat: (ctx: Ctx) => THREE.Material
  jitter: number
}

const INSTANCED_FAMILIES: Record<string, InstancedFamilySpec> = {
  rock: {
    natural: [0.95, 0.78, 0.95],
    geo: (c) => c.geos.dodeca(0.5),
    mat: (c) => c.mats.get(mixHex(c.palette.ground, 0x555a60, 0.45), { rough: 0.95 }),
    jitter: 0.28,
  },
  boulder: {
    natural: [0.95, 0.78, 0.95],
    geo: (c) => c.geos.dodeca(0.5),
    mat: (c) => c.mats.get(mixHex(c.palette.ground, 0x555a60, 0.45), { rough: 0.95 }),
    jitter: 0.28,
  },
  crate: {
    natural: [0.8, 0.8, 0.8],
    geo: (c) => c.geos.box(0.8, 0.8, 0.8),
    mat: (c) => c.mats.get(0x6b5638, { rough: 0.9 }),
    jitter: 0.2,
  },
  debris: {
    natural: [0.55, 0.32, 0.55],
    geo: (c) => c.geos.box(0.5, 0.26, 0.5),
    mat: (c) => c.mats.get(0x2a2620, { rough: 0.95 }),
    jitter: 0.3,
  },
  debris_field: {
    natural: [0.55, 0.4, 0.55],
    geo: (c) => c.geos.box(0.5, 0.3, 0.5),
    mat: (c) => c.mats.get(0x2a2620, { rough: 0.95 }),
    jitter: 0.3,
  },
  rubble: {
    natural: [0.6, 0.35, 0.6],
    geo: (c) => c.geos.dodeca(0.3),
    mat: (c) => c.mats.get(0x2e2a24, { rough: 0.95 }),
    jitter: 0.3,
  },
  wreckage: {
    natural: [0.8, 0.6, 0.8],
    geo: (c) => c.geos.box(0.7, 0.4, 0.7),
    mat: (c) => c.mats.get(0x33363d, { rough: 0.7, metal: 0.4 }),
    jitter: 0.25,
  },
  crystal: {
    natural: [0.45, 1.0, 0.45],
    geo: (c) => c.geos.cone(0.2, 0.85, 5),
    mat: (c) => c.mats.get(0x0a2030, { rough: 0.3, emissive: c.palette.accent, emissiveIntensity: 0.95 }),
    jitter: 0.22,
  },
  glow_flora: {
    natural: [0.7, 1.3, 0.7],
    geo: (c) => c.geos.ico(0.16, 0),
    mat: (c) => c.mats.get(0x0a2030, { rough: 0.35, emissive: c.palette.accent, emissiveIntensity: 1.05 }),
    jitter: 0.25,
  },
  stalagmite: {
    natural: [0.65, 1.5, 0.65],
    geo: (c) => c.geos.cone(0.3, 1.3, 6),
    mat: (c) => c.mats.get(mixHex(c.palette.ground, 0x000000, 0.2), { rough: 0.9 }),
    jitter: 0.2,
  },
  bush: {
    natural: [0.85, 0.7, 0.85],
    geo: (c) => c.geos.ico(0.4, 0),
    mat: (c) => c.mats.get(c.night ? 0x12231a : 0x1e5332, { rough: 1 }),
    jitter: 0.3,
  },
  shrub: {
    natural: [0.8, 0.7, 0.85],
    geo: (c) => c.geos.ico(0.4, 0),
    mat: (c) => c.mats.get(c.night ? 0x12231a : 0x1e5332, { rough: 1 }),
    jitter: 0.3,
  },
  barrel: {
    natural: [0.84, 0.9, 0.84],
    geo: (c) => c.geos.cyl(0.42, 0.42, 0.9, 10),
    mat: (c) => c.mats.get(0x26303a, { rough: 0.5, metal: 0.6 }),
    jitter: 0.15,
  },
  dune: {
    natural: [2.0, 2.0, 2.0],
    geo: (c) => c.geos.sphere(1, 9, 6),
    mat: (c) => c.mats.get(c.palette.ground, { rough: 1 }),
    jitter: 0.15,
  },
  sand_dune: {
    natural: [2.0, 2.0, 2.0],
    geo: (c) => c.geos.sphere(1, 9, 6),
    mat: (c) => c.mats.get(c.palette.ground, { rough: 1 }),
    jitter: 0.15,
  },
}

/** Semantic types whose layout `flat` rotation assumes a plane pivot. */
const GROUND_DRESSING_TYPES = new Set([
  'rock', 'boulder', 'crate', 'barrel', 'pallet', 'debris', 'debris_field',
  'rubble', 'bush', 'shrub', 'stump', 'log', 'log_seat', 'crystal',
  'crater', 'crater_rim', 'dune', 'sand_dune', 'stalagmite', 'plant',
  'wreckage', 'scattered', 'debris_ground', 'glow_flora',
])

// ---------------------------------------------------------------------------
// Prop dispatch — semantic type → compound / Phase 2 builder / primitive
// ---------------------------------------------------------------------------

interface PropBuild {
  group: THREE.Group
  ref: [number, number, number]
  practicalKind?: string
}

/**
 * Build the procedural prop for one resolved object. The spatial layout is
 * authoritative — this only decides WHAT geometry realizes the semantic type.
 */
function dispatchProp(
  ctx: Ctx,
  ro: ResolvedSceneObject,
  spec: SceneObjectSpec | undefined,
  glowHex: number
): PropBuild {
  const t = (ro.semanticType || '').toLowerCase()
  const tags = (spec?.tags ?? []).map((x) => x.toLowerCase())
  const has = (...names: string[]) => names.includes(t) || tags.some((tag) => names.includes(tag))
  const lit = !ctx.details.abandoned
  const woodHex = hexToInt(spec?.color, 0x5c4531)

  // --- Phase 3 compound builders -------------------------------------------
  if (has('spaceship', 'spacecraft', 'spaceship_wreck', 'ship_wreck', 'crashed_ship', 'wreck', 'ship')) {
    const wreck = ctx.details.abandoned || t.includes('wreck') || tags.some((x) => x.includes('wreck'))
    return { group: buildSpaceship(ctx, { wreck }), ref: [5.5, 2.6, 7.0], practicalKind: 'engine' }
  }
  if (has('lab_machine', 'scientific_machine', 'scientific_apparatus', 'machine', 'generator', 'reactor', 'apparatus', 'device')) {
    return { group: buildLabMachine(ctx), ref: [2.2, 2.4, 1.4], practicalKind: 'screen' }
  }
  if (has('console')) return { group: buildConsole(ctx, glowHex), ref: [1.4, 1.1, 0.6], practicalKind: 'screen' }
  if (has('counter')) return { group: buildCounter(ctx, woodHex), ref: [2.6, 1.05, 0.7], practicalKind: 'lamp' }
  if (has('crystal', 'gem', 'gemstone')) return { group: buildCrystal(ctx, glowHex), ref: [0.5, 1.1, 0.5], practicalKind: 'crystal' }
  if (has('rock_formation', 'formation', 'outcropping')) {
    return { group: buildRockFormation(ctx, mixHex(ctx.palette.ground, 0x555a60, 0.4)), ref: [2.4, 3.2, 2.0] }
  }
  if (has('dune', 'sand_dune')) return { group: buildDune(ctx, ctx.palette.ground), ref: [4.0, 1.2, 3.0] }
  if (has('crater', 'crater_rim')) return { group: buildCrater(ctx, mixHex(ctx.palette.ground, 0x000000, 0.25)), ref: [2.6, 0.5, 2.6] }
  if (has('stalagmite', 'spike', 'pillar_rock')) return { group: buildStalagmite(ctx, mixHex(ctx.palette.ground, 0x000000, 0.15)), ref: [0.7, 1.6, 0.7] }
  if (has('debris', 'debris_field', 'rubble', 'wreckage', 'scattered', 'debris_ground')) return { group: buildDebris(ctx), ref: [0.6, 0.4, 0.6] }
  if (has('campfire', 'firepit', 'bonfire', 'fire', 'flame', 'torch')) {
    return { group: buildCampfire(ctx, lit), ref: [0.9, 0.5, 0.9], practicalKind: 'fire' }
  }
  if (has('tent', 'shelter')) return { group: buildTent(ctx), ref: [2.2, 1.6, 2.2] }
  if (has('statue', 'sculpture', 'monument')) return { group: buildStatue(ctx), ref: [0.9, 2.4, 0.9] }
  if (has('alien_artifact', 'artifact', 'relic')) {
    return { group: buildArtifact(ctx, glowHex), ref: [0.9, 1.6, 0.9], practicalKind: 'crystal' }
  }
  if (has('bed', 'cot', 'hospital_bed')) return { group: buildBed(ctx, woodHex), ref: [1.0, 0.6, 2.0] }
  if (has('vehicle', 'car', 'truck', 'vehicle_body', 'caravan')) return { group: buildVehicle(ctx), ref: [2.0, 1.5, 4.4] }
  if (has('stairs', 'steps', 'staircase')) return { group: buildStairs(ctx), ref: [1.6, 1.2, 1.4] }
  if (has('plant', 'foliage', 'greenery')) return { group: buildPottedPlant(ctx), ref: [0.5, 1.0, 0.5] }
  if (has('boat', 'rowboat', 'canoe', 'sailboat', 'fishing_boat', 'vessel')) {
    const wreck = ctx.details.abandoned || has('dim_boat')
    return { group: buildBoat(ctx, woodHex, { wreck }), ref: [3.2, 1.4, 1.4] }
  }
  if (has('house', 'cottage', 'hut', 'cabin', 'farmhouse', 'home')) {
    const ruined = ctx.details.abandoned || ctx.details.old || tags.some((x) => x.includes('ruin'))
    return { group: buildHouse(ctx, mixHex(ctx.palette.primary, 0xffffff, 0.06), { ruined, lit }), ref: [3.4, 3.0, 3.0] }
  }
  if (has('glow_flora', 'glowing_plant', 'bioluminescent', 'luminous_flora')) {
    return { group: buildGlowFlora(ctx, glowHex), ref: [0.7, 1.3, 0.7], practicalKind: 'crystal' }
  }
  if (has('altar', 'dais', 'sacrificial_stone')) {
    return { group: buildAltar(ctx, mixHex(ctx.palette.primary, 0xffffff, 0.1), 0xffb36b), ref: [1.6, 1.1, 1.0], practicalKind: 'torch' }
  }

  // --- Phase 2 prop library reuse -------------------------------------------
  if (has('table')) {
    const w = dim(ro.scale[0], 0.5, 4)
    const h = dim(ro.scale[1], 0.3, 1.4)
    const d = dim(ro.scale[2], 0.4, 3)
    return { group: buildTable(ctx, w, h, d, woodHex), ref: [w, h, d] }
  }
  if (has('desk', 'workbench')) {
    const w = dim(ro.scale[0], 0.8, 5)
    return { group: buildDesk(ctx, w, hexToInt(spec?.color, 0x18263f)), ref: [w, 1.07, 0.95], practicalKind: 'screen' }
  }
  if (has('chair', 'seat', 'stool')) return { group: buildChair(ctx, woodHex), ref: [0.46, 1.03, 0.46] }
  if (has('bench')) return { group: buildBench(ctx, woodHex), ref: [1.7, 0.97, 0.5] }
  if (has('shelf', 'shelving', 'bookshelf', 'bookcase', 'rack', 'shelving_unit')) {
    const tall = has('rack', 'shelving_unit')
    return { group: buildShelf(ctx, tall, tags.includes('metal')), ref: tall ? [1.8, 2.3, 0.4] : [1.6, 1.9, 0.4] }
  }
  if (has('building', 'structure')) {
    return { group: buildBuildingBlock(ctx, ctx.palette.primary, lit), ref: [10, 8, 8] }
  }
  if (has('tree', 'palm_tree', 'vegetation')) return { group: buildTree(ctx, 1), ref: [2.7, 3.9, 2.7] }
  if (has('rock', 'boulder')) return { group: buildRock(ctx, 0.5), ref: [0.8, 0.7, 0.8] }
  if (has('lamp', 'light', 'lamp_post', 'street_lamp', 'light_post')) {
    const h = dim(ro.scale[1], 0.8, 6)
    return { group: buildLampPost(ctx, h, lit), ref: [0.95, h, 0.4], practicalKind: 'lamp' }
  }
  if (has('crate', 'cargo', 'cargo_box', 'box', 'container', 'shipping_container')) {
    const s = dim(ro.scale[0], 0.3, 2.5)
    return { group: buildCrate(ctx, s, mixHex(woodHex, 0x000000, 0.1)), ref: [s, s, s] }
  }
  if (has('screen', 'monitor', 'display', 'screen_panel', 'display_panel', 'hologram')) {
    const w = dim(ro.scale[0], 0.5, 8)
    const h = dim(ro.scale[1], 0.35, 3)
    return { group: buildMonitor(ctx, w * 0.9, h * 0.9, glowHex), ref: [w, h, 0.15], practicalKind: 'screen' }
  }
  if (has('sign', 'signage', 'signboard', 'neon_sign', 'station_sign')) {
    const w = dim(ro.scale[0], 0.5, 6)
    const h = dim(ro.scale[1], 0.3, 2.5)
    return {
      group: buildSign(ctx, w * 0.95, h * 0.95, mixHex(ctx.palette.primary, 0x000000, 0.2), glowHex),
      ref: [w, h, 0.25],
      practicalKind: 'sign',
    }
  }
  if (has('wall', 'panel', 'backdrop', 'rear_wall')) {
    const w = dim(ro.scale[0], 1, 30)
    const h = dim(ro.scale[1], 0.8, 12)
    return { group: buildWall(ctx, w, h, 0.3, ctx.palette.wall), ref: [w, h, 0.3] }
  }
  if (has('door', 'doorway', 'entrance')) {
    const w = dim(ro.scale[0], 0.7, 2.5)
    const h = dim(ro.scale[1], 1.4, 3.5)
    return { group: buildDoorway(ctx, w * 0.9, h * 0.92), ref: [w, h, 0.35] }
  }
  if (has('window', 'glass')) {
    const w = dim(ro.scale[0], 0.5, 4)
    const h = dim(ro.scale[1], 0.4, 3)
    return {
      group: buildWindow(ctx, w * 0.85, h * 0.85, lit ? glowHex : undefined, 0.85),
      ref: [w, h, 0.1],
      practicalKind: 'window',
    }
  }
  if (has('pillar', 'column', 'stone_column')) {
    const h = dim(ro.scale[1], 1, 9)
    return { group: buildPillar(ctx, h, mixHex(ctx.palette.primary, 0x000000, 0.1)), ref: [0.8, h + 0.14, 0.8] }
  }
  if (has('sofa', 'couch')) return { group: buildSofa(ctx, woodHex), ref: [2.1, 1.28, 0.85] }
  if (has('cabinet', 'wardrobe', 'chest')) {
    const w = dim(ro.scale[0], 0.5, 3)
    const h = dim(ro.scale[1], 0.4, 2.5)
    return { group: buildCabinet(ctx, w, h * 0.9, woodHex), ref: [w, h, 0.54] }
  }
  if (has('barrel', 'cask', 'keg')) return { group: buildBarrel(ctx), ref: [0.84, 0.9, 0.84] }
  if (has('pallet', 'skid')) {
    const w = dim(ro.scale[0], 0.6, 2)
    const d = dim(ro.scale[2], 0.6, 2)
    return { group: buildPallet(ctx, w, d), ref: [w, 0.16, d] }
  }
  if (has('pipe', 'tube', 'conduit')) {
    const len = dim(ro.scale[0], 1, 20)
    return { group: buildPipe(ctx, len), ref: [len, 0.3, 0.3] }
  }
  if (has('beam', 'girder', 'strut')) {
    const len = dim(ro.scale[0], 1, 20)
    return { group: buildBeam(ctx, len), ref: [len, 0.25, 0.35] }
  }
  if (has('fence')) {
    const len = dim(ro.scale[0], 0.8, 12)
    return { group: buildFence(ctx, len), ref: [len, 1.0, 0.1] }
  }
  if (has('hedge', 'hedgerow')) {
    const w = dim(ro.scale[0], 0.5, 8)
    const h = dim(ro.scale[1], 0.3, 2)
    const g = newProp('hedge')
    g.add(mkBox(ctx, w, h, 0.6, ctx.mats.get(0x1e4a2c, { rough: 1 }), 0, h / 2, 0))
    recordProp(ctx, 'hedge')
    return { group: g, ref: [w, h, 0.6] }
  }
  if (has('bush', 'shrub', 'undergrowth')) return { group: buildBush(ctx, 0.5), ref: [0.85, 0.75, 0.85] }
  if (has('platform', 'stage', 'dais')) {
    const w = dim(ro.scale[0], 2, 30)
    const d = dim(ro.scale[2], 1, 12)
    const h = dim(ro.scale[1], 0.2, 2)
    return { group: buildPlatform(ctx, w, d, h), ref: [w, h, d] }
  }
  if (has('road', 'street', 'asphalt', 'path', 'walkway', 'trail')) {
    const len = dim(ro.scale[2], 4, 30)
    return { group: buildRoad(ctx, len), ref: [7, 0.05, len] }
  }
  if (has('sidewalk')) {
    const len = dim(ro.scale[2], 2, 30)
    return { group: buildSidewalk(ctx, len), ref: [1.7, 0.13, len] }
  }
  if (has('track', 'rail')) {
    const len = dim(ro.scale[2], 3, 30)
    return { group: buildTrackSegment(ctx, len), ref: [2.4, 0.25, len] }
  }
  if (has('bridge', 'arch', 'tunnel_arch')) {
    const w = dim(ro.scale[0], 1.5, 8)
    const h = dim(ro.scale[1], 1.5, 7)
    return { group: buildTunnelArch(ctx, w, h), ref: [w + 0.7, h + 0.45, 0.55] }
  }
  if (has('log', 'log_seat', 'stump')) {
    const len = dim(ro.scale[2], 0.4, 6)
    const g = newProp('log')
    g.add(mkMesh(ctx, ctx.geos.cyl(0.18, 0.22, len, 7), ctx.mats.get(ctx.night ? 0x2c2118 : 0x4a3826, { rough: 0.95 }), 0, 0.2, 0))
    recordProp(ctx, 'log')
    return { group: g, ref: [0.5, 0.45, len] }
  }
  if (has('banner')) {
    const g = newProp('banner')
    g.add(mkBox(ctx, 0.8, 2.2, 0.05, ctx.mats.get(hexToInt(spec?.color, 0x6b3a2e), { rough: 0.95 }), 0, 1.1, 0))
    recordProp(ctx, 'banner')
    return { group: g, ref: [0.8, 2.4, 0.06] }
  }
  if (has('board')) {
    const g = newProp('board')
    g.add(mkBox(ctx, 2.0, 1.2, 0.06, ctx.mats.get(0x2a2d33, { rough: 0.9 }), 0, 0.6, 0))
    g.add(mkPlane(ctx, 1.85, 1.05, ctx.mats.get(0x1a2c22, { rough: 0.95 }), 0, 0.6, 0.04))
    recordProp(ctx, 'board')
    return { group: g, ref: [2.0, 1.2, 0.08] }
  }
  if (has('torch_sconce')) {
    const g = newProp('torch_sconce')
    g.add(mkBox(ctx, 0.12, 0.3, 0.12, ctx.mats.get(0x05070c, {
      rough: 0.5,
      emissive: lit ? 0xffb36b : 0x1a120c,
      emissiveIntensity: lit ? 1.3 : 0.1,
    }), 0, 0.45, 0))
    recordProp(ctx, 'torch_sconce')
    return { group: g, ref: [0.3, 0.9, 0.3], practicalKind: 'torch' }
  }
  if (has('fountain', 'water_feature', 'throne')) {
    return { group: buildGenericCompound(ctx, mixHex(ctx.palette.primary, 0xffffff, 0.08)), ref: [1.2, 1.2, 1.2] }
  }

  // --- Primitive fallbacks (never fails) ------------------------------------
  const prim = spec?.primitiveFallback ?? ro.fallbackPrimitive ?? 'compound'
  switch (prim) {
    case 'box': {
      const g = newProp('primitive_box')
      const s = 0.8
      g.add(mkBox(ctx, s, s, s, ctx.mats.get(mixHex(ctx.palette.secondary, 0x000000, 0.1), { rough: 0.85 }), 0, s / 2, 0))
      recordProp(ctx, 'primitive_box')
      return { group: g, ref: [1, 1, 1] }
    }
    case 'cylinder': {
      const g = newProp('primitive_cylinder')
      g.add(mkMesh(ctx, ctx.geos.cyl(0.35, 0.4, 0.9, 8), ctx.mats.get(mixHex(ctx.palette.secondary, 0x000000, 0.1), { rough: 0.85 }), 0, 0.45, 0))
      recordProp(ctx, 'primitive_cylinder')
      return { group: g, ref: [0.85, 0.9, 0.85] }
    }
    case 'cone': {
      const g = newProp('primitive_cone')
      g.add(mkMesh(ctx, ctx.geos.cone(0.35, 1.1, 8), ctx.mats.get(mixHex(ctx.palette.secondary, 0x000000, 0.1), { rough: 0.9 }), 0, 0.65, 0))
      recordProp(ctx, 'primitive_cone')
      return { group: g, ref: [0.75, 1.3, 0.75] }
    }
    case 'sphere': {
      const g = newProp('primitive_sphere')
      g.add(mkMesh(ctx, ctx.geos.ico(0.4, 0), ctx.mats.get(mixHex(ctx.palette.secondary, 0x000000, 0.1), { rough: 0.95 }), 0, 0.42, 0))
      recordProp(ctx, 'primitive_sphere')
      return { group: g, ref: [0.85, 0.85, 0.85] }
    }
    case 'plane': {
      const g = newProp('primitive_plane')
      g.add(mkBox(ctx, 1.6, 1.1, 0.08, ctx.mats.get(ctx.palette.secondary, { rough: 0.9 }), 0, 0.55, 0))
      recordProp(ctx, 'primitive_plane')
      return { group: g, ref: [1.6, 1.1, 0.1] }
    }
    case 'extrusion':
      return { group: buildStairs(ctx), ref: [1.6, 1.2, 1.4] }
    case 'compound':
    default:
      return { group: buildGenericCompound(ctx, ctx.palette.secondary), ref: [1.2, 1.35, 1.1] }
  }
}

// --- tiny local mesh helpers (reuse ctx banks; keep dispatch readable) ------

function mkBox(ctx: Ctx, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(ctx.geos.box(w, h, d), mat)
  m.position.set(x, y, z)
  m.matrixAutoUpdate = false
  m.updateMatrix()
  ctx.count++
  return m
}

function mkPlane(ctx: Ctx, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(ctx.geos.plane(w, h), mat)
  m.position.set(x, y, z)
  m.matrixAutoUpdate = false
  m.updateMatrix()
  ctx.count++
  return m
}

// ---------------------------------------------------------------------------
// Placement — apply the AUTHORITATIVE resolved transform
// ---------------------------------------------------------------------------

function placeProp(
  node: THREE.Group,
  ro: ResolvedSceneObject,
  ref: [number, number, number],
  rng: () => number,
  groundDressing: boolean
): void {
  const sx = clampScale(ro.scale[0] / Math.max(0.01, ref[0]))
  const sy = clampScale(ro.scale[1] / Math.max(0.01, ref[1]))
  const sz = clampScale(ro.scale[2] / Math.max(0.01, ref[2]))
  node.scale.set(sx, sy, sz)
  // Base-pivot correction: layout reports the object CENTER height; prop
  // groups are built with y = 0 at the base.
  const baseY = safeNum(ro.position[1]) - ro.scale[1] / 2
  node.position.set(safeNum(ro.position[0]), baseY, safeNum(ro.position[2]))
  if (groundDressing) {
    // `flat` layout rotation (rx = −π/2) assumes plane pivots; these props are
    // pre-upright compounds, so keep the yaw and add a small seeded settle.
    node.rotation.set(0, safeNum(ro.rotation[1]), (rng() - 0.5) * 0.22)
  } else {
    node.rotation.set(safeNum(ro.rotation[0]), safeNum(ro.rotation[1]), safeNum(ro.rotation[2]))
  }
  node.matrixAutoUpdate = false
  node.updateMatrix()
}

// ---------------------------------------------------------------------------
// Ground scatter — contextual dressing in SAFE zones (audited)
// ---------------------------------------------------------------------------

function buildGroundScatter(ctx: Ctx, sg: SceneGraph): void {
  const env = (sg.environment.type || '').toLowerCase()
  const gt = (sg.ground.type || '').toLowerCase()
  const zones = [ZONES.fgL, ZONES.fgR, ZONES.sideL, ZONES.sideR]
  const scatterMat = ctx.mats.get(mixHex(ctx.palette.ground, 0x555a60, 0.4), { rough: 0.95 })

  const scatter = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    radius: number,
    name: string,
    jitter = 0.3
  ): void => {
    const placements: Placement[] = []
    for (let i = 0; i < count; i++) {
      const zone = zones[i % zones.length]
      const p = placeInZone(ctx, radius, zone)
      const s = 0.6 + ctx.rng() * 0.8
      placements.push({ x: p.x, y: radius * 0.55 * s, z: p.z, sx: s, sy: s, sz: s, ry: ctx.rng() * Math.PI })
    }
    ctx.group.add(mkInstanced(ctx, geo, mat, placements, name, { jitter }))
  }

  if (env === 'mars' || env === 'moon' || env === 'mountains' || env === 'scifi_wreck' || gt.includes('rocky')) {
    scatter(ctx.geos.dodeca(0.16), scatterMat, 10, 0.22, 'scatter_pebble')
    scatter(ctx.geos.box(0.4, 0.1, 0.4), ctx.mats.get(0x2a2620, { rough: 0.95 }), 5, 0.3, 'scatter_debris')
  } else if (env === 'desert' || gt.includes('sand')) {
    scatter(ctx.geos.dodeca(0.14), scatterMat, 8, 0.2, 'scatter_pebble')
    scatter(ctx.geos.ico(0.22, 0), ctx.mats.get(0x6b6248, { rough: 1 }), 4, 0.26, 'scatter_scrub')
  } else if (env === 'forest' || env === 'camp' || env === 'garden' || env === 'waterside' || env === 'beach') {
    scatter(ctx.geos.ico(0.3, 0), ctx.mats.get(ctx.night ? 0x12231a : 0x1e5332, { rough: 1 }), 7, 0.3, 'scatter_bush')
    scatter(ctx.geos.dodeca(0.18), scatterMat, 5, 0.24, 'scatter_rock')
  } else if (env === 'cave') {
    scatter(ctx.geos.cone(0.16, 0.6, 5), ctx.mats.get(0x0a2030, { rough: 0.3, emissive: ctx.palette.accent, emissiveIntensity: 0.9 }), 5, 0.22, 'scatter_crystal')
    scatter(ctx.geos.dodeca(0.16), scatterMat, 6, 0.22, 'scatter_pebble')
  } else if (env === 'warehouse' || env === 'street' || env === 'vehicle_scene' || env === 'city') {
    scatter(ctx.geos.box(0.7, 0.7, 0.7), ctx.mats.get(0x6b5638, { rough: 0.9 }), 4, 0.4, 'scatter_crate')
  } else if (env === 'village') {
    scatter(ctx.geos.box(0.6, 0.6, 0.6), ctx.mats.get(0x6b5638, { rough: 0.9 }), 3, 0.35, 'scatter_crate')
    scatter(ctx.geos.ico(0.3, 0), ctx.mats.get(ctx.night ? 0x12231a : 0x1e5332, { rough: 1 }), 5, 0.3, 'scatter_bush')
  } else if (env === 'factory' || env === 'laboratory') {
    scatter(ctx.geos.cyl(0.42, 0.42, 0.9, 10), ctx.mats.get(0x26303a, { rough: 0.5, metal: 0.6 }), 4, 0.4, 'scatter_barrel')
    scatter(ctx.geos.box(0.5, 0.26, 0.5), ctx.mats.get(0x2a2620, { rough: 0.95 }), 4, 0.3, 'scatter_debris')
  } else if (ctx.count < 40) {
    // Interiors / generic: a couple of low dressing props for near-depth.
    scatter(ctx.geos.dodeca(0.14), scatterMat, 5, 0.2, 'scatter_pebble')
  }
}

/** Contextual midground for zero-object input — one cheap instanced family. */
function buildFallbackMidground(ctx: Ctx, sg: SceneGraph): void {
  const env = (sg.environment.type || '').toLowerCase()
  const placements: Placement[] = [
    { x: -3.7, y: 0.5, z: -4.1, sx: 1.2, sy: 1.0, sz: 1.1, ry: 0.4 },
    { x: 3.8, y: 0.42, z: -4.6, sx: 0.9, sy: 0.85, sz: 1.0, ry: -0.55 },
    { x: -2.9, y: 0.3, z: -5.2, sx: 0.65, sy: 0.6, sz: 0.7, ry: 1.2 },
  ]
  const material = env === 'cave'
    ? ctx.mats.get(mixHex(ctx.palette.ground, 0x000000, 0.18), { rough: 0.95 })
    : ctx.mats.get(mixHex(ctx.palette.ground, ctx.palette.primary, 0.35), { rough: 0.95 })
  ctx.group.add(mkInstanced(ctx, ctx.geos.dodeca(0.55), material, placements, 'fallback_midground', { jitter: 0.2 }))
  recordProp(ctx, 'fallback_midground')
}

// ---------------------------------------------------------------------------
// Lighting REQUESTS — semantic metadata only (no runtime lights here)
// ---------------------------------------------------------------------------

const SUGGESTED_LIGHT_POSITIONS: Record<'primary' | 'fill' | 'accent', [number, number, number]> = {
  primary: [5, 7, 4],
  fill: [-6, 4, 2],
  accent: [0, 2.6, -3],
}

function buildLightingMetadata(sg: SceneGraph, practicals: Practical[]): DynamicLightingMetadata {
  const byRole = new Map<string, SceneLightSpec>()
  for (const l of sg.lighting) {
    if (!byRole.has(l.role)) byRole.set(l.role, l)
    if (byRole.size >= 3) break
  }
  const lights: DynamicLightingRequest[] = []
  for (const role of ['primary', 'fill', 'accent'] as const) {
    const l = byRole.get(role)
    if (!l) continue
    lights.push({
      role,
      intent: l.intent,
      color: l.color,
      intensityHint: l.intensityHint,
      castShadows: l.castShadows,
      suggestedPosition: l.position ?? SUGGESTED_LIGHT_POSITIONS[role],
    })
  }
  return { lights, practicals, maxRuntimeLights: 3 }
}

// ---------------------------------------------------------------------------
// GLB asset overlay — optional, failure-safe, cache-aware
// ---------------------------------------------------------------------------

const GLB_SOURCE_CACHE = new Map<string, Promise<THREE.Group | null>>()
const URL_PROBE_CACHE = new Map<string, Promise<boolean>>()
const ASSET_LOAD_TIMEOUT_MS = 8000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/** Vite serves index.html for missing public/ files — HEAD-probe first. */
function probeUrl(url: string): Promise<boolean> {
  const cached = URL_PROBE_CACHE.get(url)
  if (cached) return cached
  const probe = fetch(url, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) return false
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      return !ct.includes('text/html')
    })
    .catch(() => false)
  URL_PROBE_CACHE.set(url, probe)
  return probe
}

/** three-stdlib is CJS-safe (node-test friendly); loaded lazily, only on use. */
let stdlibPromise: Promise<typeof import('three-stdlib')> | null = null
function loadStdlib(): Promise<typeof import('three-stdlib')> {
  if (!stdlibPromise) stdlibPromise = import('three-stdlib')
  return stdlibPromise
}

/**
 * Load (and cache) the SOURCE scene for a manifest asset path.
 * Never throws — failures resolve to null and the procedural fallback stays.
 */
function loadGlbSource(assetPath: string): Promise<THREE.Group | null> {
  const cached = GLB_SOURCE_CACHE.get(assetPath)
  if (cached) return cached
  const entry = (async (): Promise<THREE.Group | null> => {
    try {
      const base = /^https?:\/\//i.test(assetPath) || assetPath.startsWith('/') ? assetPath : `/${assetPath}`
      const glbOk = await probeUrl(base)
      let url: string | null = glbOk ? base : null
      if (!url && /\.glb$/i.test(base)) {
        const gltfUrl = base.replace(/\.glb$/i, '.gltf')
        if (await probeUrl(gltfUrl)) url = gltfUrl
      }
      if (!url) return null
      const mod = await withTimeout(loadStdlib(), ASSET_LOAD_TIMEOUT_MS, 'three-stdlib import')
      const loader = new mod.GLTFLoader()
      const gltf = await withTimeout(
        new Promise<{ scene?: THREE.Group }>((resolve, reject) =>
          loader.load(url as string, resolve as (g: unknown) => void, undefined, reject)
        ),
        ASSET_LOAD_TIMEOUT_MS * 1.5,
        `GLB ${url}`
      )
      return gltf?.scene ?? null
    } catch {
      return null
    }
  })()
  GLB_SOURCE_CACHE.set(assetPath, entry)
  return entry
}

/**
 * Async GLB overlay pass. For every prop tagged with an assetPath, attempt a
 * local GLB/GLTF load; on success clone + normalize + apply the resolved
 * transform and hide the procedural placeholder. On ANY failure the
 * procedural fallback remains visible — the environment is never rejected.
 */
export async function attachDynamicAssetOverlays(
  group: THREE.Group,
  input: DynamicEnvironmentInput
): Promise<{ loaded: number; failed: number }> {
  interface Target { node: THREE.Object3D; ro: ResolvedSceneObject; path: string }
  const targets: Target[] = []
  group.traverse((obj) => {
    const path = obj.userData?.assetPath
    const ro = obj.userData?.resolved as ResolvedSceneObject | undefined
    if (typeof path === 'string' && path && ro) targets.push({ node: obj, ro, path })
  })
  if (targets.length === 0) return { loaded: 0, failed: 0 }

  const byPath = new Map<string, Target[]>()
  for (const t of targets) {
    const list = byPath.get(t.path)
    if (list) list.push(t)
    else byPath.set(t.path, [t])
  }

  let loaded = 0
  let failed = 0

  await Promise.all(
    Array.from(byPath.entries()).map(async ([path, list]) => {
      const source = await loadGlbSource(path)
      if (!source) {
        failed += list.length
        return
      }
      let stdlib: typeof import('three-stdlib') | null = null
      try {
        stdlib = await withTimeout(loadStdlib(), ASSET_LOAD_TIMEOUT_MS, 'three-stdlib import')
      } catch {
        failed += list.length
        return
      }
      const box = new THREE.Box3().setFromObject(source)
      const size = new THREE.Vector3()
      box.getSize(size)
      const maxSrc = Math.max(size.x, size.y, size.z)
      for (const t of list) {
        try {
          const clone = stdlib.SkeletonUtils.clone(source) as THREE.Group
          const maxTarget = Math.max(t.ro.scale[0], t.ro.scale[1], t.ro.scale[2]) || 1
          const s = maxSrc > 1e-4 ? maxTarget / maxSrc : 1
          clone.scale.setScalar(s)
          clone.position.copy(t.node.position)
          clone.rotation.copy(t.node.rotation)
          // Sit the clone on the same base line as the procedural prop.
          clone.updateMatrixWorld(true)
          const cbox = new THREE.Box3().setFromObject(clone)
          const baseY = t.ro.position[1] - t.ro.scale[1] / 2
          clone.position.y += baseY - cbox.min.y
          clone.name = `asset:${t.ro.semanticType}`
          clone.userData = { ...t.node.userData, source: 'glb' }
          // GLB materials/geometries are owned by the process-wide source
          // cache — mark them so disposal never double-frees them.
          clone.traverse((o) => {
            const mesh = o as THREE.Mesh
            const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
            for (const m of mats) {
              const mat = m as THREE.MeshStandardMaterial
              mat.userData = { ...mat.userData, dynamicShared: true }
            }
          })
          t.node.visible = false
          t.node.parent?.add(clone)
          loaded++
        } catch {
          failed++
        }
      }
    })
  )

  const stats = group.userData?.stats as DynamicEnvironmentStats | undefined
  if (stats) {
    stats.fallbackCount += failed
    stats.assetCount = Math.max(stats.assetCount, targets.length)
  }
  return { loaded, failed }
}

/**
 * Convenience: procedural build + GLB overlay in one call.
 * The group is fully valid even if every load fails.
 */
export async function buildDynamicEnvironmentWithAssets(input: DynamicEnvironmentInput): Promise<DynamicEnvironmentResult> {
  const result = buildDynamicEnvironment(input)
  await attachDynamicAssetOverlays(result.group, input)
  return result
}

// ---------------------------------------------------------------------------
// Disposal — per-build resources freed, shared cache resources preserved
// ---------------------------------------------------------------------------

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const

/**
 * Dispose a dynamic environment group. Frees per-build geometries/materials
 * (via the shared disposeObjectDeep) plus textures owned by this build.
 * Materials flagged `dynamicShared` (GLB cache clones) keep their textures —
 * the process-wide source cache still owns them. Idempotent: safe to call
 * twice, safe across build → dispose → build → dispose cycles.
 */
export function disposeDynamicEnvironment(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    const mats = Array.isArray(material) ? material : material ? [material] : []
    for (const m of mats) {
      const ud = (m as THREE.MeshStandardMaterial).userData
      if (ud?.dynamicShared) continue
      const holder = m as unknown as Record<string, { dispose?: () => void } | undefined>
      for (const key of TEXTURE_KEYS) {
        const tex = holder[key]
        if (tex && typeof tex.dispose === 'function') tex.dispose()
      }
    }
  })
  disposeObjectDeep(root)
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Convert a validated SceneGraph + semantic asset matches + resolved spatial
 * layout into a disposable THREE.Group. Synchronous, deterministic, and
 * guaranteed non-empty: ground + backdrop + depth dressing are always built,
 * and every resolved object realizes as procedural geometry (GLB assets are
 * an optional overlay — see attachDynamicAssetOverlays).
 */
export function buildDynamicEnvironment(input: DynamicEnvironmentInput): DynamicEnvironmentResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const sg: ValidatedSceneGraph = input.sceneGraph
  const seed = (input.seed ?? sg.seed ?? 1) >>> 0
  const rng = mulberry32(seed)

  const group = new THREE.Group()
  group.name = 'dynamicEnvironment'
  const groundGroup = new THREE.Group(); groundGroup.name = 'dyn:ground'
  const backdropGroup = new THREE.Group(); backdropGroup.name = 'dyn:backdrop'
  const objectsGroup = new THREE.Group(); objectsGroup.name = 'dyn:objects'
  const scatterGroup = new THREE.Group(); scatterGroup.name = 'dyn:scatter'
  group.add(groundGroup, backdropGroup, objectsGroup, scatterGroup)

  const ctx = makeCtx(group, sg, rng)
  const practicals: Practical[] = []

  // 1) Ground — semantic, never a generic grey plane.
  buildSemanticGround(ctx, sg)

  // 2) Backdrop depth shell — guaranteed background layer.
  const backdropKind = buildBackdrop(ctx, sg, practicals)

  // 3) Resolved objects — spatial layout stays authoritative.
  const specById = new Map<string, SceneObjectSpec>()
  for (const o of sg.objects) specById.set(o.id, o)

  // Asset matches: parallel array (sceneGraph.objects order) OR keyed record.
  const matchById = new Map<string, AssetMatchResult>()
  if (Array.isArray(input.assetMatches)) {
    sg.objects.forEach((spec, i) => {
      const m = (input.assetMatches as AssetMatchResult[])[i]
      if (m) matchById.set(spec.id, m)
    })
  } else if (input.assetMatches) {
    for (const [k, v] of Object.entries(input.assetMatches)) matchById.set(k, v)
  }

  // Two-pass instancing: families with ≥3 non-hero resolved objects collapse
  // into ONE InstancedMesh (setMatrixAt + setColorAt + needsUpdate inside).
  const familyCounts = new Map<string, number>()
  for (const ro of input.resolvedObjects) {
    if (ro.importance === 'hero') continue
    const t = ro.semanticType.toLowerCase()
    if (INSTANCED_FAMILIES[t]) familyCounts.set(t, (familyCounts.get(t) ?? 0) + 1)
  }
  const instancedTypes = new Set(
    Array.from(familyCounts.entries()).filter(([, n]) => n >= 3).map(([t]) => t)
  )

  const batches = new Map<string, { spec: InstancedFamilySpec; placements: Placement[] }>()
  let heroObjectCount = 0
  let assetCount = 0
  let proceduralCount = 0
  let entityVisualCount = 0
  let unsafeCount = 0
  let occlCount = 0
  const depthBands = new Set<string>()
  // Ground is the stage surface; the generated backdrop is the explicit far
  // depth band for every environment, independent of authored object zones.
  depthBands.add('background')

  for (const ro of input.resolvedObjects) {
    const spec = specById.get(ro.sourceSpecId)
    const match = matchById.get(ro.sourceSpecId)
    const isGlb = !!match && (match.assetType === 'glb' || match.assetType === 'gltf') && !!match.assetPath
    if (isGlb) assetCount++
    if (ro.importance === 'hero') heroObjectCount++
    depthBands.add(ro.zone)
    if (!ro.actorSafe) unsafeCount++
    if (!ro.occlusionSafe) occlCount++

    const t = ro.semanticType.toLowerCase()

    // Supported entity-visual categories take the dedicated buildEntityVisual
    // path FIRST — recognizable multi-part geometry with stable entity: names.
    // This prevents generic dispatchProp/instancing from consuming the object.
    const entityCategory = resolveVisualCategory(t)
    if (import.meta.env.DEV) {
      console.log(`[D3 STAGE-TRACE] ro=${ro.sourceSpecId} type=${ro.semanticType} category=${entityCategory} supported=${ENTITY_VISUAL_CATEGORIES.has(entityCategory)}`)
    }
    if (ENTITY_VISUAL_CATEGORIES.has(entityCategory)) {
      const visual = buildEntityVisual(ro)
      if (import.meta.env.DEV) console.log(`[D3 STAGE-TRACE] buildEntityVisual(${ro.sourceSpecId}) => ${visual ? visual.name : 'null'}`)
      if (visual) {
        visual.userData = {
          ...visual.userData,
          importance: ro.importance,
          zone: ro.zone,
          source: 'entity',
          resolved: ro,
          actorSafe: ro.actorSafe,
          occlusionSafe: ro.occlusionSafe,
          cameraVisible: ro.cameraVisible,
          heroVisible: ro.heroVisible ?? null,
        }
        objectsGroup.add(visual)
        entityVisualCount++
        continue
      }
    }

    const familySpec = ro.importance === 'hero' ? undefined : INSTANCED_FAMILIES[t]
    if (familySpec && instancedTypes.has(t)) {
      const batch = batches.get(t) ?? { spec: familySpec, placements: [] as Placement[] }
      batch.placements.push({
        x: safeNum(ro.position[0]),
        y: safeNum(ro.position[1]),
        z: safeNum(ro.position[2]),
        ry: safeNum(ro.rotation[1]) + (rng() - 0.5) * 0.6,
        sx: clampScale(ro.scale[0] / familySpec.natural[0]),
        sy: clampScale(ro.scale[1] / familySpec.natural[1]),
        sz: clampScale(ro.scale[2] / familySpec.natural[2]),
      })
      batches.set(t, batch)
      proceduralCount++
      continue
    }

    const glowHex = hexToInt(spec?.emissive, ctx.palette.accent)
    const built = dispatchProp(ctx, ro, spec, glowHex)
    placeProp(built.group, ro, built.ref, rng, GROUND_DRESSING_TYPES.has(t))
    built.group.name = `obj:${ro.sourceSpecId}:${ro.semanticType}`
    built.group.userData = {
      semanticType: ro.semanticType,
      importance: ro.importance,
      zone: ro.zone,
      source: isGlb ? 'glb' : 'procedural',
      assetPath: isGlb ? match?.assetPath ?? null : null,
      resolved: ro,
      actorSafe: ro.actorSafe,
      occlusionSafe: ro.occlusionSafe,
      cameraVisible: ro.cameraVisible,
      heroVisible: ro.heroVisible ?? null,
    }
    objectsGroup.add(built.group)
    proceduralCount++

    if (built.practicalKind) {
      practicals.push({
        kind: built.practicalKind,
        position: [
          safeNum(ro.position[0]),
          safeNum(ro.position[1]) + ro.scale[1] * 0.35,
          safeNum(ro.position[2]),
        ],
        color: hexToCss(glowHex),
      })
    }
  }

  // Flush instanced batches.
  for (const [key, batch] of batches) {
    if (batch.placements.length === 0) continue
    const mesh = mkInstanced(ctx, batch.spec.geo(ctx), batch.spec.mat(ctx), batch.placements, `fam_${key}`, { jitter: batch.spec.jitter })
    objectsGroup.add(mesh)
  }

  // DEV-only: prove what dyn:objects actually contains before ATTACH.
  if (import.meta.env.DEV) {
    const dynNames = objectsGroup.children.map((c) => c.name)
    const entityNames = dynNames.filter((n) => n.startsWith('entity:'))
    console.log(`[D3 STAGE-TRACE] entityVisualCount=${entityVisualCount} dyn:objects children=${objectsGroup.children.length}`)
    console.log(`[D3 STAGE-TRACE] dyn:objects names=[${dynNames.join(', ')}]`)
    console.log(`[D3 STAGE-TRACE] entity names=[${entityNames.join(', ') || 'NONE'}]`)
  }

  // Empty/minimal graphs still receive readable contextual geometry between
  // foreground scatter and the far backdrop instead of a floor plus void.
  if (input.resolvedObjects.length === 0) {
    buildFallbackMidground(ctx, sg)
    depthBands.add('midground')
  }

  // 4) Ground scatter — guaranteed foreground/midground dressing in SAFE
  //    zones (placeInZone audits actor + camera + sightline + occupancy).
  const preScatterCount = ctx.count
  buildGroundScatter(ctx, sg)
  if (ctx.count > preScatterCount) depthBands.add('foreground')

  // 5) Lighting REQUESTS (metadata only — no runtime lights created here).
  const dynamicLighting = buildLightingMetadata(sg, practicals)

  // 6) Stats + metadata.
  let instancedMeshCount = 0
  group.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) instancedMeshCount++
  })

  const frustumVisibleRatio = input.resolvedObjects.length === 0
    ? 1
    : round3(input.resolvedObjects.filter((o) => o.cameraVisible).length / input.resolvedObjects.length)
  const collisionViolations =
    (input.layoutStats?.actorCollisionViolations ?? unsafeCount) + ctx.actorViolations + ctx.cameraViolations
  const occlusionViolations = (input.layoutStats?.occlusionViolations ?? occlCount) + ctx.occlusionViolations
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()

  const stats: DynamicEnvironmentStats = {
    generator: 'dynamic',
    sceneGraphVersion: sg.version,
    seed,
    environmentType: sg.environment.type,
    objectCount: input.resolvedObjects.length,
    heroObjectCount,
    meshCount: ctx.count,
    instancedMeshCount,
    instanceCount: ctx.instancedCount,
    drawCallEstimate: ctx.count,
    assetCount,
    proceduralCount,
    fallbackCount: 0,
    frustumVisibleRatio,
    collisionViolations,
    occlusionViolations,
    depthCueCount: depthBands.size,
    generationTimeMs: round3(t1 - t0),
  }

  group.userData = {
    generator: 'dynamic',
    sceneGraphVersion: sg.version,
    seed,
    environmentType: sg.environment.type,
    objectCount: stats.objectCount,
    heroObjectCount: stats.heroObjectCount,
    meshCount: stats.meshCount,
    instancedMeshCount: stats.instancedMeshCount,
    instanceCount: stats.instanceCount,
    drawCallEstimate: stats.drawCallEstimate,
    assetCount: stats.assetCount,
    proceduralCount: stats.proceduralCount,
    fallbackCount: stats.fallbackCount,
    frustumVisibleRatio: stats.frustumVisibleRatio,
    collisionViolations: stats.collisionViolations,
    occlusionViolations: stats.occlusionViolations,
    depthCueCount: stats.depthCueCount,
    backdropKind,
    atmosphere: { ...sg.atmosphere },
    dynamicLighting,
    census: Object.fromEntries(ctx.census),
    layoutStats: input.layoutStats ?? null,
    stats,
  }

  return { group, stats }
}