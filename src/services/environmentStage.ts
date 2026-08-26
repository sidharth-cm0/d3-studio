/**
 * Environment Stage — Three.js side of the PROCEDURAL ENVIRONMENT BUILDER.
 *
 *   ResolvedEnvironment.blueprint (from environmentResolver.ts)
 *     → PROP LIBRARY      — reusable low-poly builders (Box/Cylinder/Cone/Plane)
 *     → LAYOUT ZONES      — camera-aware depth layers computed from the real
 *                           camera: camera sits at (0, ~1.55, +2.8) looking at
 *                           the actor pivot at origin, FOV ~40° (16:9).
 *                           Visible half-width at depth z is ≈ (2.8 − z) · 0.62:
 *                             z= 0 → ±1.8   z=-3 → ±3.7
 *                             z=-1 → ±2.4   z=-5 → ±5.0
 *                             z=-2 → ±3.1   z=-7 → ±6.3
 *     → SEEDED PLACEMENT  — deterministic rejection sampling (mulberry32 seed
 *                           from scene/location id — same scene ⇒ same layout,
 *                           different scene ⇒ different layout, never random
 *                           per render)
 *     → CATEGORY COMPOSERS — warehouse · railway · apartment · studio · office ·
 *                             interior · street · forest
 *     → buildEnvironmentGroup() — one disposable THREE.Group
 *     → disposeObjectDeep()     — full geometry/material cleanup on switch
 *
 * Visual contract (recognizability without reading the prompt):
 *  - Depth layers: FOREGROUND EDGE (frame margins, z ≈ -1.2…0.5),
 *    MIDGROUND ACTOR AREA (kept clear), BACKGROUND STRUCTURE (z ≈ -3…-8).
 *  - Walls are taller than actors, trees 2–4x actor height, platform/tracks
 *    span the scene width, furniture sized for VRM avatars.
 *  - Distinct materials per surface (warehouse: grey/metal/brown crates;
 *    railway: concrete + dark rails; apartment: warm neutrals + darker
 *    furniture; forest: brown trunks + green canopies; studio: dark neutral +
 *    bright panel accents).
 *
 * Performance contract (older MacBook):
 *  - Primitives ONLY (Box / Plane / Cylinder / Cone / Dodecahedron detail 0).
 *  - Shared material instances per build (MaterialBank cache).
 *  - Static meshes: matrixAutoUpdate = false (zero per-frame matrix math).
 *  - NO lights, textures, listeners or animation loops generated here — the
 *    group is pure static geometry, so disposal is trivially complete.
 */

import * as THREE from 'three'
import type {
  EnvironmentBlueprint,
  EnvironmentDetails,
  PropType,
  ResolvedEnvironment,
} from './environmentResolver'
import { assetCategoryForLocation } from './environmentAssetLibrary'
import type { SemanticAssetId } from './environmentAssetLibrary'
import { environmentAssetLoader } from './environmentAssetLoader'

// ---------------------------------------------------------------------------
// Asset-supply helpers — SEMANTIC slot tagging + async GLB overlay pass
// ---------------------------------------------------------------------------
//
// The composer builds the FULL procedural environment synchronously (that is
// the baseline look). Each prop is tagged with an `assetSlot` semantic id
// (e.g. "crate", "tree_01") at the placement site. After the group is built,
// attachAssetOverlays() tries to load the matching local GLB/GLTF for every
// slot (cached by URL, parsed once per asset). If the file exists, an instance
// is cloned and placed at the exact same position/rotation/scale as the
// procedural prop it replaces, and the procedural prop is hidden. If the file
// is MISSING (or fails), the procedural prop REMAINS VISIBLE — the existing
// primitive is the automatic fallback. Assets just "assist" the environment;
// they never replace the procedural engine.
//
// ---------------------------------------------------------------------------

function tagAssetSlot(obj: THREE.Object3D, slot: SemanticAssetId): void {
  obj.userData.assetSlot = slot
}

/**
 * Async overlays: 1:1 replace every tagged procedural prop with its semantic
 * GLB/GLTF instance when the local asset exists. Fire-and-forget from
 * buildEnvironmentGroup — never blocks the stage, never throws.
 */
async function attachAssetOverlays(
  group: THREE.Group,
  env: ResolvedEnvironment
): Promise<void> {
  const category = assetCategoryForLocation(env.locationKind)
  if (!category) return // stage / alley have no bespoke asset library

  const tagged = new Map<SemanticAssetId, THREE.Object3D[]>()
  group.traverse((obj) => {
    const slot = (obj as THREE.Object3D).userData.assetSlot as SemanticAssetId | undefined
    if (!slot) return
    const arr = tagged.get(slot)
    if (arr) arr.push(obj)
    else tagged.set(slot, [obj])
  })
  if (tagged.size === 0) return

  await Promise.all(
    Array.from(tagged.entries()).map(async ([slot, targets]) => {
      const clones = await environmentAssetLoader.instanciateAssets(
        { category, semantic: slot, name: `asset:${slot}` },
        targets.length
      )
      clones.forEach((clone, i) => {
        const src = targets[i]
        if (!clone || !src) return
        // Preserve the procedural placement (position + rotation). The
        // loader already normalized the clone's scale to the manifest
        // targetScale, so we keep that and skip the procedural scale.
        clone.position.copy(src.position)
        clone.rotation.copy(src.rotation)
        // Hide the procedural prop — the asset now covers this slot.
        src.visible = false
        src.parent?.add(clone)
      })
    })
  )
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Recursively dispose geometries and materials of an object subtree.
 * Used when the environment group is replaced so old environments never leak
 * GPU memory across scene switches. Safe to call twice (three.js dispose is
 * idempotent).
 */
export function disposeObjectDeep(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) {
      mesh.geometry.dispose()
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (same implementation as the resolver's seed hash source)
// ---------------------------------------------------------------------------

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
// Material bank — lightweight variation + per-build sharing
// ---------------------------------------------------------------------------

interface MatOpts {
  rough?: number
  metal?: number
  emissive?: number
  emissiveIntensity?: number
}

class MaterialBank {
  private cache = new Map<string, THREE.MeshStandardMaterial>()

  constructor(
    /** Palette darkening from story details (old / abandoned / rain). */
    private darken: number,
    /** Rain lowers roughness on coarse surfaces (wet look, no textures). */
    private wet: boolean
  ) {}

  get(hex: number, opts: MatOpts = {}): THREE.MeshStandardMaterial {
    const color = new THREE.Color(hex).multiplyScalar(this.darken)
    let rough = opts.rough ?? 0.85
    if (this.wet && rough > 0.55) rough *= 0.55
    const metal = opts.metal ?? 0.05
    const key = `${color.getHexString()}|${rough.toFixed(2)}|${metal.toFixed(2)}|${opts.emissive ?? 0}|${opts.emissiveIntensity ?? 1}`
    let mat = this.cache.get(key)
    if (!mat) {
      // Visibility lift: non-emissive materials self-illuminate faintly so
      // blockout geometry reads even under night/midnight grades.
      const emissive =
        opts.emissive !== undefined ? new THREE.Color(opts.emissive) : color.clone()
      const emissiveIntensity =
        opts.emissive !== undefined ? (opts.emissiveIntensity ?? 1) : 0.55
      mat = new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        metalness: metal,
        emissive,
        emissiveIntensity,
      })
      this.cache.set(key, mat)
    }
    return mat
  }
}

// ---------------------------------------------------------------------------
// Build context — zones, occupancy, mesh budget
// ---------------------------------------------------------------------------

/**
 * Actor performance area: Lead/Supporting VRMs stand near (±0.75, 0, 0).
 * All permanent geometry is kept clear of this rectangle (x ±2.5, z −1.5…+2.5)
 * so no wall/prop ever intersects the actor zone or blocks the camera.
 */
const ACTOR_HALF_X = 2.5
const ACTOR_HALF_Z = 1.5
/** Camera-safe radius: no prop footprints inside this distance of origin. */
const CAM_SAFE_R = 2.55

interface Zone {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Camera-aware layering zones (see header comment for the wedge math). */
const ZONES = {
  /** Far background shell — back walls, signs, canopies. z ≈ −7.5…−5.2 */
  bgDeep: { x0: -6.4, x1: 6.4, z0: -7.5, z1: -5.2 } as Zone,
  /** Mid background — racks, tall crates, mid tree line. z ≈ −5.4…−3.4 */
  bg: { x0: -5.2, x1: 5.2, z0: -5.4, z1: -3.4 } as Zone,
  /** Side margins — industrial props / bushes visible at z ≤ −3.4. */
  sideL: { x0: -4.6, x1: -2.6, z0: -5.0, z1: -3.4 } as Zone,
  sideR: { x0: 2.6, x1: 4.6, z0: -5.0, z1: -3.4 } as Zone,
  /** Foreground accents — low plants at the lower frame edges, OUTSIDE the
   *  widened actor safe zone so nothing lands between camera and actors. */
  fgL: { x0: -4.3, x1: -2.65, z0: -1.5, z1: 0.5 } as Zone,
  fgR: { x0: 2.65, x1: 4.3, z0: -1.5, z1: 0.5 } as Zone,
}

interface Ctx {
  group: THREE.Group
  rng: () => number
  mats: MaterialBank
  count: number
  occupied: Array<{ x: number; z: number; r: number }>
  night: boolean
  details: EnvironmentDetails
}

function mkMesh(
  ctx: Ctx,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  ry = 0
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  if (ry) m.rotation.y = ry
  // Static scenery — skip per-frame matrix updates entirely.
  m.matrixAutoUpdate = false
  m.updateMatrix()
  ctx.count++
  return m
}

function bx(
  ctx: Ctx,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  ry = 0
): THREE.Mesh {
  return mkMesh(ctx, new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry)
}

/**
 * Deterministic zoned placement for "fill" props (crates, rocks, bushes…).
 * The zone rectangles encode the WEDGE SAFETY MARGIN themselves, so anything
 * placed inside them is already visible in the common two-shot.
 */
function placeInZone(ctx: Ctx, radius: number, zone: Zone): { x: number; z: number } {
  let fallback = { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 }
  for (let i = 0; i < 40; i++) {
    const x = zone.x0 + ctx.rng() * (zone.x1 - zone.x0)
    const z = zone.z0 + ctx.rng() * (zone.z1 - zone.z0)
    fallback = { x, z }
    if (Math.abs(x) < ACTOR_HALF_X + radius && Math.abs(z) < ACTOR_HALF_Z + radius) {
      continue
    }
    if (Math.hypot(x, z) < CAM_SAFE_R + radius) continue
    let blocked = false
    for (const o of ctx.occupied) {
      if (Math.hypot(x - o.x, z - o.z) < radius + o.r + 0.15) {
        blocked = true
        break
      }
    }
    if (!blocked) {
      ctx.occupied.push({ x, z, r: radius })
      return { x, z }
    }
  }
  ctx.occupied.push({ x: fallback.x, z: fallback.z, r: radius })
  return fallback
}

function registerFootprint(ctx: Ctx, x: number, z: number, r: number): void {
  ctx.occupied.push({ x, z, r })
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — every builder returns a fresh Group, primitives only
// ---------------------------------------------------------------------------

function newProp(name: string): THREE.Group {
  const g = new THREE.Group()
  g.name = `prop:${name}`
  return g
}

// --- architecture -----------------------------------------------------------

function buildFloor(ctx: Ctx, size = 18, hex = 0x16171b, rough = 0.92): THREE.Group {
  const g = newProp('floor')
  const mat = ctx.mats.get(hex, { rough })
  const plane = mkMesh(ctx, new THREE.PlaneGeometry(size, size), mat)
  plane.rotation.x = -Math.PI / 2
  g.add(plane)
  return g
}

function buildWall(ctx: Ctx, w = 14, h = 3.4, t = 0.3, hex = 0x32353d): THREE.Group {
  const g = newProp('wall')
  g.add(bx(ctx, w, h, t, ctx.mats.get(hex, { rough: 0.9 }), 0, h / 2, 0))
  return g
}

/** Side wall — long dimension runs along Z (toward the camera). */
function buildSidePanel(
  ctx: Ctx,
  gitOut: number,
  h = 3.4,
  t = 0.3,
  hex = 0x32353d
): THREE.Group {
  const g = newProp('sideWall')
  g.add(bx(ctx, t, h, gitOut, ctx.mats.get(hex, { rough: 0.9 }), 0, h / 2, 0))
  return g
}

function buildCeiling(ctx: Ctx, span = 16, hex = 0x1b1c22): THREE.Group {
  const g = newProp('ceiling')
  const mat = ctx.mats.get(hex)
  for (const z of [-2.8, -4.6, -6.2]) {
    g.add(bx(ctx, span, 0.25, 0.35, mat, 0, 5.9, z))
  }
  return g
}

function buildDoorway(ctx: Ctx, w = 1.3, h = 2.3, hex = 0x241d16): THREE.Group {
  const g = newProp('doorway')
  const frame = ctx.mats.get(hex, { rough: 0.85 })
  const dark = ctx.mats.get(0x05060a, { rough: 1 })
  const jamb = 0.16
  g.add(bx(ctx, jamb, h, 0.34, frame, -(w / 2 + jamb / 2), h / 2, 0))
  g.add(bx(ctx, jamb, h, 0.34, frame, w / 2 + jamb / 2, h / 2, 0))
  g.add(bx(ctx, w + jamb * 2, 0.22, 0.34, frame, 0, h + 0.11, 0))
  g.add(bx(ctx, w, h - 0.05, 0.06, dark, 0, (h - 0.05) / 2, -0.08))
  return g
}

function buildWindow(
  ctx: Ctx,
  w = 1.9,
  h = 1.4,
  glowHex?: number,
  glowIntensity = 0.85
): THREE.Group {
  const g = newProp('window')
  const frame = ctx.mats.get(0x2a2119, { rough: 0.9 })
  const glassHex = glowHex ?? (ctx.night ? 0xe8a34a : 0xa8c4ec)
  const glass = ctx.mats.get(0x0c1220, {
    rough: 0.4,
    emissive: glassHex,
    emissiveIntensity: glowIntensity,
  })
  g.add(bx(ctx, w + 0.24, h + 0.24, 0.06, frame, 0, 0, 0))
  g.add(mkMesh(ctx, new THREE.PlaneGeometry(w, h), glass, 0, 0, 0.045))
  g.add(bx(ctx, 0.05, h, 0.03, frame, 0, 0, 0.075))
  g.add(bx(ctx, w, 0.05, 0.03, frame, 0, 0, 0.075))
  return g
}

function buildPillar(ctx: Ctx, h = 4.6, hex = 0x23262c): THREE.Group {
  const g = newProp('pillar')
  const mat = ctx.mats.get(hex, { rough: 0.6, metal: 0.3 })
  g.add(bx(ctx, 0.55, h, 0.55, mat, 0, h / 2, 0))
  g.add(bx(ctx, 0.8, 0.14, 0.8, ctx.mats.get(0x1b1d22), 0, h + 0.07, 0))
  return g
}

function buildPlatform(ctx: Ctx, w = 15, d = 3.2, h = 0.85, hex = 0x1d2026): THREE.Group {
  const g = newProp('platform')
  g.add(bx(ctx, w, h, d, ctx.mats.get(hex, { rough: 0.85 }), 0, h / 2, 0))
  // safety line along the FRONT edge (facing the camera / tracks)
  g.add(
    bx(
      ctx,
      w,
      0.025,
      0.18,
      ctx.night
        ? ctx.mats.get(0xcaa64b, { rough: 0.6, emissive: 0xcaa64b, emissiveIntensity: 0.5 })
        : ctx.mats.get(0xcaa64b, { rough: 0.6 }),
      0,
      h + 0.012,
      -d / 2 + 0.3
    )
  )
  return g
}

// --- furniture -------------------------------------------------------------

function buildTable(ctx: Ctx, w = 1.15, h = 0.42, d = 0.65, hex = 0x5c4531): THREE.Group {
  const g = newProp('table')
  const top = ctx.mats.get(hex, { rough: 0.7 })
  const leg = ctx.mats.get(0x4a3728, { rough: 0.8 })
  g.add(bx(ctx, w, 0.07, d, top, 0, h, 0))
  for (const [lx, lz] of [
    [-w / 2 + 0.09, -d / 2 + 0.09],
    [w / 2 - 0.09, -d / 2 + 0.09],
    [-w / 2 + 0.09, d / 2 - 0.09],
    [w / 2 - 0.09, d / 2 - 0.09],
  ]) {
    g.add(bx(ctx, 0.07, h, 0.07, leg, lx, h / 2, lz))
  }
  return g
}

function buildDesk(ctx: Ctx, w = 3.4, hex = 0x18263f): THREE.Group {
  const g = newProp('desk')
  const top = ctx.mats.get(hex, { rough: 0.4 })
  const body = ctx.mats.get(0x101b30, { rough: 0.7 })
  const accent = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0x6366f1,
    emissiveIntensity: 1.1,
  })
  g.add(bx(ctx, w, 0.09, 0.95, top, 0, 1.02, 0))
  g.add(bx(ctx, w - 0.2, 0.95, 0.75, body, 0, 0.5, -0.08))
  g.add(mkMesh(ctx, new THREE.PlaneGeometry(w - 0.4, 0.08), accent, 0, 0.52, 0.385))
  return g
}

function buildChair(ctx: Ctx, hex = 0x39404d): THREE.Group {
  const g = newProp('chair')
  const mat = ctx.mats.get(hex, { rough: 0.85 })
  g.add(bx(ctx, 0.46, 0.07, 0.46, mat, 0, 0.46, 0))
  g.add(bx(ctx, 0.46, 0.55, 0.07, mat, 0, 0.76, -0.2))
  for (const [lx, lz] of [
    [-0.19, -0.19],
    [0.19, -0.19],
    [-0.19, 0.19],
    [0.19, 0.19],
  ]) {
    g.add(bx(ctx, 0.06, 0.46, 0.06, mat, lx, 0.23, lz))
  }
  return g
}

function buildSofa(ctx: Ctx, hex = 0x4a5a74): THREE.Group {
  const g = newProp('sofa')
  const base = ctx.mats.get(hex, { rough: 1 })
  const dark = ctx.mats.get(0x43536b, { rough: 1 })
  g.add(bx(ctx, 2.1, 0.48, 0.85, base, 0, 0.24, 0))
  g.add(bx(ctx, 2.1, 0.6, 0.22, dark, 0, 0.68, 0.38))
  g.add(bx(ctx, 0.22, 0.55, 0.85, dark, -1.12, 0.5, 0))
  g.add(bx(ctx, 0.22, 0.55, 0.85, dark, 1.12, 0.5, 0))
  return g
}

function buildShelf(ctx: Ctx, tall = false, metal = false): THREE.Group {
  const g = newProp(tall ? 'rack' : 'shelf')
  const h = tall ? 2.3 : 1.9
  const w = tall ? 1.8 : 1.6
  const frame = ctx.mats.get(metal ? 0x262a31 : 0x3a2f26, {
    rough: metal ? 0.5 : 0.85,
    metal: metal ? 0.45 : 0.05,
  })
  const shelfMat = ctx.mats.get(metal ? 0x20242b : 0x453b33, { rough: 0.8 })
  g.add(bx(ctx, 0.09, h, 0.4, frame, -w / 2, h / 2, 0))
  g.add(bx(ctx, 0.09, h, 0.4, frame, w / 2, h / 2, 0))
  const shelves = tall ? 4 : 3
  for (let i = 0; i < shelves; i++) {
    g.add(bx(ctx, w, 0.05, 0.4, shelfMat, 0, 0.25 + (i * (h - 0.3)) / (shelves - 1), 0))
  }
  return g
}

// --- industrial ------------------------------------------------------------

function buildCrate(ctx: Ctx, s = 0.8, hex = 0x2b241c): THREE.Group {
  const g = newProp('crate')
  const wood = ctx.mats.get(hex, { rough: 0.9 })
  const lid = ctx.mats.get(0x241f18, { rough: 0.9 })
  g.add(bx(ctx, s, s, s, wood, 0, s / 2, 0))
  g.add(bx(ctx, s * 1.04, 0.06, s * 1.04, lid, 0, s - 0.02, 0))
  return g
}

/** Wooden shipping pallet — flat floor prop for the warehouse aisles. */
function buildPallet(ctx: Ctx, w = 1.25, d = 1.05, h = 0.16, hex = 0x241d16): THREE.Group {
  const g = newProp('pallet')
  const wood = ctx.mats.get(hex, { rough: 0.95 })
  // Deck boards
  for (let i = 0; i < 5; i++) {
    const boardX = -w / 2 + (i * w) / 4 + w / 8
    g.add(bx(ctx, w / 4, 0.045, d, wood, boardX, h - 0.045, 0))
  }
  // Stringers (two rails underneath for the forklift gap)
  for (const sx of [-w / 4, w / 4]) {
    g.add(bx(ctx, 0.16, h, d - 0.18, wood, sx, h / 2, 0))
  }
  return g
}

function buildBarrel(ctx: Ctx, hex = 0x26303a): THREE.Group {
  const g = newProp('barrel')
  g.add(
    mkMesh(
      ctx,
      new THREE.CylinderGeometry(0.42, 0.42, 0.9, 10),
      ctx.mats.get(hex, { rough: 0.5, metal: 0.6 }),
      0,
      0.45,
      0
    )
  )
  return g
}

function buildPipe(ctx: Ctx, len = 12, hex = 0x3a4048): THREE.Group {
  const g = newProp('pipe')
  const mat = ctx.mats.get(hex, { rough: 0.5, metal: 0.55 })
  const pipe = mkMesh(ctx, new THREE.CylinderGeometry(0.14, 0.14, len, 8), mat)
  pipe.rotation.z = Math.PI / 2
  pipe.position.set(0, 0, 0)
  g.add(pipe)
  for (const fx of [-len / 2 + 0.5, 0, len / 2 - 0.5]) {
    g.add(
      mkMesh(
        ctx,
        new THREE.CylinderGeometry(0.2, 0.2, 0.14, 8),
        ctx.mats.get(0x2a2f36, { rough: 0.5, metal: 0.6 }),
        fx,
        0,
        0
      )
    )
  }
  return g
}

function buildBeam(ctx: Ctx, len = 6, hex = 0x1b1c22): THREE.Group {
  const g = newProp('beam')
  g.add(bx(ctx, len, 0.25, 0.35, ctx.mats.get(hex), 0, 0, 0))
  return g
}

// --- outdoor ----------------------------------------------------------------

function buildRoad(ctx: Ctx, len = 18, wet = false): THREE.Group {
  const g = newProp('road')
  const asphalt = ctx.mats.get(0x14151a, { rough: wet ? 0.32 : 0.85, metal: 0.05 })
  const plane = mkMesh(ctx, new THREE.PlaneGeometry(7, len), asphalt)
  plane.rotation.x = -Math.PI / 2
  g.add(plane)
  const dash = ctx.mats.get(0x8a8672, { rough: 0.8 })
  for (let i = 0; i < 6; i++) {
    g.add(bx(ctx, 0.12, 0.01, 0.9, dash, 0, 0.012, -len / 2 + 1.4 + i * 2.6))
  }
  return g
}

function buildSidewalk(ctx: Ctx, len = 18, hex = 0x2b2d33): THREE.Group {
  const g = newProp('sidewalk')
  g.add(bx(ctx, 1.7, 0.13, len, ctx.mats.get(hex, { rough: 0.9 }), 0, 0.065, 0))
  return g
}

function buildLampPost(ctx: Ctx, h = 3.6, lit = true): THREE.Group {
  const g = newProp('lampPost')
  const pole = ctx.mats.get(0x22262c, { rough: 0.6, metal: 0.4 })
  g.add(mkMesh(ctx, new THREE.CylinderGeometry(0.06, 0.09, h, 8), pole, 0, h / 2, 0))
  g.add(bx(ctx, 0.7, 0.07, 0.07, pole, 0.32, h - 0.03, 0))
  const head = ctx.mats.get(0x0b0d10, {
    rough: 0.5,
    emissive: lit ? 0xffd9a0 : 0x111111,
    emissiveIntensity: lit ? 1.5 : 0,
  })
  g.add(bx(ctx, 0.34, 0.12, 0.2, head, 0.6, h - 0.12, 0))
  return g
}

/**
 * Tree — 2–4x an actor's height when the scale is 1.2–1.7.
 * Visible bare trunk + double-layer cone canopy.
 */
function buildTree(ctx: Ctx, scale = 1): THREE.Group {
  const g = newProp('tree')
  const trunk = ctx.mats.get(0x4a3c2e, { rough: 0.95 })
  const leavesDark = ctx.mats.get(ctx.night ? 0x142218 : 0x1d3a24, { rough: 0.95 })
  const leavesLight = ctx.mats.get(ctx.night ? 0x1d3024 : 0x27603a, { rough: 0.9 })
  const trunkH = 1.35
  // Trunk
  g.add(mkMesh(ctx, new THREE.CylinderGeometry(0.12, 0.18, trunkH, 6), trunk, 0, trunkH / 2, 0))
  // Broad lower canopy
  g.add(mkMesh(ctx, new THREE.ConeGeometry(1.15, 1.8, 8), leavesDark, 0, trunkH + 0.9, 0))
  // Pointed upper canopy
  g.add(mkMesh(ctx, new THREE.ConeGeometry(0.78, 1.45, 8), leavesLight, 0, trunkH + 2.1, 0))
  g.scale.setScalar(scale)
  return g
}

function buildBush(ctx: Ctx, s = 0.5): THREE.Group {
  const g = newProp('bush')
  g.add(
    mkMesh(
      ctx,
      new THREE.IcosahedronGeometry(s, 0),
      ctx.mats.get(ctx.night ? 0x14251c : 0x1e5332, { rough: 1 }),
      0,
      s * 0.55,
      0
    )
  )
  return g
}

function buildBuilding(ctx: Ctx, w = 3.4, h = 5.5, d = 3, litWindows = true): THREE.Group {
  const g = newProp('building')
  const wallMat = ctx.mats.get(0x181b23, { rough: 0.9 })
  g.add(bx(ctx, w, h, d, wallMat, 0, h / 2, 0))
  const win = ctx.mats.get(0x05070c, {
    rough: 0.4,
    emissive: ctx.night ? 0xffd28a : 0x9fc3ef,
    emissiveIntensity: litWindows ? 0.9 : 0,
  })
  const rows = Math.max(1, Math.floor(h / 1.6))
  for (let r = 0; r < rows; r++) {
    const wy = 1.1 + r * 1.5
    if (wy > h - 0.6) break
    g.add(mkMesh(ctx, new THREE.PlaneGeometry(0.55, 0.7), win, -w / 4, wy, d / 2 + 0.02))
    g.add(mkMesh(ctx, new THREE.PlaneGeometry(0.55, 0.7), win, w / 4, wy, d / 2 + 0.02))
  }
  return g
}

function buildFence(ctx: Ctx, len = 3.2, hex = 0x2a2d33): THREE.Group {
  const g = newProp('fence')
  const mat = ctx.mats.get(hex, { rough: 0.8, metal: 0.2 })
  const posts = Math.max(2, Math.round(len / 0.8))
  for (let i = 0; i <= posts; i++) {
    g.add(bx(ctx, 0.07, 1.0, 0.07, mat, -len / 2 + (i * len) / posts, 0.5, 0))
  }
  g.add(bx(ctx, len, 0.06, 0.05, mat, 0, 0.55, 0))
  g.add(bx(ctx, len, 0.06, 0.05, mat, 0, 0.9, 0))
  return g
}

// --- railway ------------------------------------------------------------------

/**
 * A pair of rails running along Z with perpendicular sleepers.
 * `pairX` controls the rail gauge (distance from track center).
 */
function buildTrackSegment(
  ctx: Ctx,
  len = 16,
  pairX = 1.0,
  y = 0,
  hexRail = 0x6e747d,
  hexSleeper = 0x241d16
): THREE.Group {
  const g = newProp('track')
  const rail = ctx.mats.get(hexRail, { rough: 0.6, metal: 0.85 })
  const sleeper = ctx.mats.get(hexSleeper, { rough: 0.95 })
  for (const sx of [-pairX, pairX]) {
    g.add(bx(ctx, 0.09, 0.12, len, rail, sx, y + 0.06, 0))
  }
  const sleeperGeo = new THREE.BoxGeometry(pairX * 2 + 0.35, 0.05, 0.24)
  const n = Math.max(6, Math.floor(len / 1.4))
  for (let i = 0; i < n; i++) {
    const sz = -len / 2 + 0.8 + i * ((len - 1.6) / (n - 1))
    g.add(mkMesh(ctx, sleeperGeo, sleeper, 0, y, sz))
  }
  return g
}

function buildBench(ctx: Ctx, hex = 0x3a2f26): THREE.Group {
  const g = newProp('bench')
  const wood = ctx.mats.get(hex, { rough: 0.85 })
  const iron = ctx.mats.get(0x22262c, { rough: 0.6, metal: 0.4 })
  g.add(bx(ctx, 1.7, 0.07, 0.5, wood, 0, 0.45, 0))
  g.add(bx(ctx, 1.7, 0.5, 0.06, wood, 0, 0.72, -0.24))
  g.add(bx(ctx, 0.07, 0.45, 0.44, iron, -0.75, 0.22, 0))
  g.add(bx(ctx, 0.07, 0.45, 0.44, iron, 0.75, 0.22, 0))
  return g
}

function buildStationLight(ctx: Ctx, lit = true): THREE.Group {
  const g = newProp('stationLight')
  const fixture = ctx.mats.get(0x0b0d10, {
    rough: 0.5,
    emissive: lit ? 0xdcecff : 0x111111,
    emissiveIntensity: lit ? 1.4 : 0,
  })
  g.add(bx(ctx, 0.9, 0.08, 0.3, fixture, 0, 0, 0))
  return g
}

// --- misc ---------------------------------------------------------------------

function buildRock(ctx: Ctx, s = 0.5): THREE.Group {
  const g = newProp('rock')
  const geo = new THREE.DodecahedronGeometry(s, 0)
  const m = mkMesh(ctx, geo, ctx.mats.get(0x33363d, { rough: 0.95 }), 0, s * 0.55, 0)
  m.scale.set(1 + ctx.rng() * 0.4, 0.6 + ctx.rng() * 0.4, 1 + ctx.rng() * 0.3)
  m.updateMatrix()
  g.add(m)
  return g
}

function buildScreen(ctx: Ctx, w = 7.2, h = 2.6): THREE.Group {
  const g = newProp('screen')
  const frame = ctx.mats.get(0x0d1730, { rough: 0.85 })
  const face = ctx.mats.get(0x060a14, {
    rough: 0.3,
    emissive: 0x3aa0ff,
    emissiveIntensity: 0.9,
  })
  g.add(bx(ctx, w + 0.3, h + 0.3, 0.12, frame, 0, 0, 0))
  g.add(mkMesh(ctx, new THREE.PlaneGeometry(w, h), face, 0, 0, 0.08))
  return g
}

/** Sign board: dark frame + bright readable slab (no text — pure geometry). */
function buildSign(ctx: Ctx, w = 4.4, h = 1.6, hex = 0x2c2320, glow = 0xbfb088): THREE.Group {
  const g = newProp('sign')
  g.add(bx(ctx, w, h, 0.22, ctx.mats.get(hex), 0, 0, 0))
  g.add(
    mkMesh(
      ctx,
      new THREE.PlaneGeometry(w - 0.2, h - 0.2),
      ctx.mats.get(0x0a0608, {
        rough: 0.4,
        emissive: glow,
        emissiveIntensity: ctx.night ? 0.9 : 0.35,
      }),
      0,
      0,
      0.12
    )
  )
  return g
}

// ---------------------------------------------------------------------------
// CATEGORY COMPOSERS — recognizable spatial layouts per environment kind
// ---------------------------------------------------------------------------

type Composer = (ctx: Ctx, bp: EnvironmentBlueprint) => void

function requestCount(bp: EnvironmentBlueprint, type: PropType): number {
  return bp.props.find((p) => p.type === type)?.count ?? 0
}

function composeWarehouse(ctx: Ctx, bp: EnvironmentBlueprint): void {
  // --- floor + shell ---
  ctx.group.add(buildFloor(ctx, 26, 0x14151a, 0.95).children[0])

  // Tall back wall — the end of a large hall.
  const back = buildWall(ctx, 22, 7.4, 0.5, 0x111217)
  back.position.set(0, 0, -8.0)
  ctx.group.add(back)

  // Side walls just outside the actor safe zone (frame the view, never block).
  for (const sx of [2.7, -2.7]) {
    const side = buildSidePanel(ctx, 3.1, 3.6, 0.3, sx < 0 ? 0x12151b : 0x101318)
    side.position.set(sx, 0, -1.4)
    ctx.group.add(side)
  }

  // Concrete kicker along the back walls for depth separation.
  for (const sx of [-2.7, 2.7]) {
    ctx.group.add(
      bx(ctx, 0.35, 0.8, 10, ctx.mats.get(0x1b2026, { rough: 0.85 }), sx, 0.4, -4.4)
    )
  }

  // Ceiling beams across the visible span.
  const beamMat = ctx.mats.get(0x16171c)
  for (const bz of [-2.8, -4.0, -5.2, -6.4, -7.2]) {
    ctx.group.add(bx(ctx, 13.5, 0.3, 0.38, beamMat, 0, 5.85, bz))
  }

  // Hanging work lamps (abandoned → one lamp).
  const lampCount = ctx.details.abandoned ? 1 : 2
  for (let i = 0; i < lampCount; i++) {
    const lx = lampCount === 1 ? 0 : i === 0 ? -2.4 : 2.4
    const cord = ctx.mats.get(0x0c0c0f)
    ctx.group.add(
      mkMesh(ctx, new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), cord, lx, 5.1, -3.4)
    )
    const lamp = ctx.mats.get(0x0c0c0f, {
      rough: 0.5,
      emissive: 0xffd9a0,
      emissiveIntensity: 1.55,
    })
    ctx.group.add(mkMesh(ctx, new THREE.CylinderGeometry(0.05, 0.2, 0.3, 10), lamp, lx, 4.35, -3.4))
  }

  // --- pillars (hero silhouettes) ---
  const pillarXs = [-3.6, -1.8, 0, 1.8, 3.6]
  const pillarCount = Math.min(requestCount(bp, 'pillar') + 1, pillarXs.length)
  for (let i = 0; i < pillarCount; i++) {
    const p = buildPillar(ctx, 5.4)
    p.position.set(pillarXs[i], 0, -3.6)
    tagAssetSlot(p, 'pillar')
    ctx.group.add(p)
    registerFootprint(ctx, pillarXs[i], -3.6, 0.5)
  }

  // --- racks against the side walls (visible) ---
  const rackCount = requestCount(bp, 'rack')
  const rackPositions: Array<[number, number]> = [
    [-3.9, -4.3],
    [3.9, -4.3],
  ]
  for (let i = 0; i < rackCount; i++) {
    const [rx, rz] = rackPositions[i % rackPositions.length]
    const rack = buildShelf(ctx, true, true)
    rack.position.set(rx, 0, rz)
    rack.rotation.y = rx < 0 ? Math.PI / 2 : -Math.PI / 2
    tagAssetSlot(rack, 'shelf')
    ctx.group.add(rack)
    registerFootprint(ctx, rx, rz, 1.0)
  }

  // --- Pipes on the back wall ---
  const pipeCount = requestCount(bp, 'pipe')
  for (let i = 0; i < pipeCount; i++) {
    const pipe = buildPipe(ctx, 14, 0x494e56)
    pipe.position.set(0, 2.5 + i * 0.55, -7.65)
    ctx.group.add(pipe)
  }

  // --- Crates (foreground edge + midground, then fill) ---
  const crateColors = [0x2d2417, 0x332a1f, 0x403423, 0x262016]
  let cratesLeft = requestCount(bp, 'crate')
  let stackIdx = 0

  const crateAnchors: Array<[number, number]> = [
    // Frame edges — OUTSIDE the actor safe zone (never between camera/actors).
    [-2.75, -1.7],
    [2.75, -1.65],
    // Midground left + right.
    [-3.1, -2.9],
    [3.2, -3.1],
    // Deep side fill.
    [-4.2, -4.6],
    [4.3, -4.4],
  ]
  for (const [ax, az] of crateAnchors) {
    if (cratesLeft <= 0) break
    const levels = Math.min(1 + Math.floor(ctx.rng() * 3), cratesLeft)
    let y = 0
    for (let l = 0; l < levels; l++) {
      const s = 1.0 - l * 0.16
      const crate = buildCrate(ctx, s, crateColors[(stackIdx + l) % crateColors.length])
      crate.position.set(ax + (ctx.rng() - 0.5) * 0.1, y, az + (ctx.rng() - 0.5) * 0.1)
      crate.rotation.y = (ctx.rng() - 0.5) * 0.4
      if (ctx.details.abandoned && l === 0 && stackIdx % 2 === 0) {
        crate.rotation.z = 0.5
        crate.position.y = s * 0.3
      }
      tagAssetSlot(crate, 'crate')
      ctx.group.add(crate)
      y += s
    }
    registerFootprint(ctx, ax, az, 0.8)
    cratesLeft -= levels
    stackIdx++
  }

  // Any leftover crates go to the side margins.
  while (cratesLeft > 0 && stackIdx < 10) {
    const zone = stackIdx % 2 === 0 ? ZONES.sideL : ZONES.sideR
    const pos = placeInZone(ctx, 0.7, zone)
    const levels = Math.min(1 + Math.floor(ctx.rng() * 2), cratesLeft)
    let y = 0
    for (let l = 0; l < levels; l++) {
      const s = 1.0 - l * 0.16
      const crate = buildCrate(ctx, s, crateColors[(stackIdx + l) % crateColors.length])
      crate.position.set(pos.x, y, pos.z)
      tagAssetSlot(crate, 'crate')
      ctx.group.add(crate)
      y += s
    }
    registerFootprint(ctx, pos.x, pos.z, 0.7)
    cratesLeft -= levels
    stackIdx++
  }

  // --- Barrels near the frame edges ---
  const barrelCount = requestCount(bp, 'barrel')
  for (let i = 0; i < barrelCount && i < 2; i++) {
    const barrelX = i === 0 ? -2.75 : 2.75
    const barrelZ = -2.3
    const barrel = buildBarrel(ctx, i === 0 ? 0x26303a : 0x20303c)
    barrel.position.set(barrelX, 0, barrelZ)
    tagAssetSlot(barrel, 'barrel')
    ctx.group.add(barrel)
    registerFootprint(ctx, barrelX, barrelZ, 0.5)
  }

  // --- Pallets distributed around the aisles (clear of actors/camera) ---
  const palletSpots: Array<[number, number]> = [
    [-4.4, -4.8],
    [4.4, -4.8],
    [-3.7, -1.6],
  ]
  for (const [px, pz] of palletSpots) {
    const pallet = buildPallet(ctx, 1.25, 1.05, 0.16)
    pallet.position.set(px, 0.015, pz)
    pallet.rotation.y = ctx.rng() > 0.5 ? Math.PI / 2 : 0
    tagAssetSlot(pallet, 'pallet')
    ctx.group.add(pallet)
    registerFootprint(ctx, px, pz, 0.8)
  }

  // --- Industrial roll-up bay door + signage on the back wall ---
  const bayFrame = ctx.mats.get(0x1a1d23, { rough: 0.7, metal: 0.4 })
  const bayDark = ctx.mats.get(0x05060a, { rough: 1 })
  const bayLight = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0xffd9a0,
    emissiveIntensity: ctx.night ? 0.9 : 0.4,
  })
  ctx.group.add(bx(ctx, 4.6, 0.6, 0.08, bayFrame, 0, 5.55, -7.72))
  ctx.group.add(bx(ctx, 4.4, 3.2, 0.06, bayDark, 0, 3.95, -7.7))
  ctx.group.add(bx(ctx, 4.4, 0.5, 0.06, bayLight, 0, 4.1, -7.68))
  for (const dx of [-2.3, 2.3]) {
    ctx.group.add(bx(ctx, 0.18, 4.6, 0.12, bayFrame, dx, 2.3, -7.66))
  }
  const baySign = buildSign(ctx, 5.2, 1.0, 0x2b312c, 0xbfd8e8)
  baySign.position.set(0, 5.95, -7.6)
  ctx.group.add(baySign)

  // --- Extra stacked crates at the bay door (hero pile) ---
  if (requestCount(bp, 'crate') > 4) {
    const stackBase: Array<[number, number]> = [
      [1.5, -5.6],
      [1.5, -4.9],
      [0.7, -5.6],
    ]
    for (const [cx, cz] of stackBase) {
      const pallet = buildCrate(ctx, 1.0, 0x403423)
      pallet.position.set(cx, 0.0, cz)
      tagAssetSlot(pallet, 'crate')
      ctx.group.add(pallet)
      registerFootprint(ctx, cx, cz, 0.7)
    }
    const topCrate = buildCrate(ctx, 0.85, 0x332a1f)
    topCrate.position.set(1.55, 1.0, -5.3)
    topCrate.rotation.y = 0.5
    tagAssetSlot(topCrate, 'crate')
    ctx.group.add(topCrate)
  }
}

function composeRailway(ctx: Ctx, bp: EnvironmentBlueprint): void {
  // --- Gravel ground ---
  ctx.group.add(buildFloor(ctx, 28, 0x16171c, 0.97).children[0])

  // --- Concrete platform (BEHIND the actor zone, spans the scene width) ---
  const platform = buildPlatform(ctx, 15, 3.2, 0.9)
  platform.position.set(0, 0.02, -3.6)
  tagAssetSlot(platform, 'platform')
  ctx.group.add(platform)

  // --- Tracks: pair BEHIND the actors (never crossing the stage center) ---
  const track = buildTrackSegment(ctx, 17, 1.05, 0, 0x6e747d, 0x241d16)
  track.position.set(0, 0, -1.75)
  ctx.group.add(track)

  const trackDeep = buildTrackSegment(ctx, 14, 1.0, 0, 0x5a6068, 0x201b14)
  trackDeep.position.set(0, 0.015, -9.2)
  trackDeep.scale.set(0.8, 0.8, 0.8)
  ctx.group.add(trackDeep)

  // --- Rear station body + station sign (background structure) ---
  const rearBase = buildWall(ctx, 19, 5.8, 0.4, 0x24262c)
  rearBase.position.set(0, 0, -8.4)
  ctx.group.add(rearBase)

  const sign = buildSign(ctx, 6.4, 2.0, 0x2c3a46, 0xd8e4f0)
  sign.position.set(0, 5.35, -8.15)
  tagAssetSlot(sign, 'station_sign')
  ctx.group.add(sign)

  // --- Canopy pillars (midground) + roof slab ---
  const pillarXs = [-3.4, -1.6, 1.6, 3.4]
  const canopyH = 4.2
  for (let i = 0; i < pillarXs.length; i++) {
    const p = newProp('pillar')
    p.add(
      mkMesh(
        ctx,
        new THREE.CylinderGeometry(0.16, 0.2, canopyH, 8),
        ctx.mats.get(0x565d68, { rough: 0.5, metal: 0.4 }),
        0,
        canopyH / 2,
        0
      )
    )
    p.position.set(pillarXs[i], 0, -4.7)
    ctx.group.add(p)
  }
  // Roof slab above the pillars (spans the visible scene width).
  ctx.group.add(
    bx(
      ctx,
      11.2,
      0.14,
      7.6,
      ctx.mats.get(0x262c35, { rough: 0.55, metal: 0.5 }),
      0,
      canopyH - 0.1,
      -4.5
    )
  )

  // --- Overhead lights (hang from the canopy) ---
  const lightCount = ctx.details.abandoned ? 1 : Math.min(requestCount(bp, 'stationLight'), 3)
  for (let i = 0; i < lightCount; i++) {
    const lightX = lightCount === 1 ? 0 : [-3, 0, 3][i]
    ctx.group.add(
      mkMesh(ctx, new THREE.CylinderGeometry(0.02, 0.02, 0.7, 4), ctx.mats.get(0x14161a), lightX, canopyH - 0.24, -4.7)
    )
    const light = buildStationLight(ctx, !ctx.details.abandoned || i === 0)
    light.position.set(lightX, canopyH - 0.55, -4.7)
    ctx.group.add(light)
  }

  // --- Benches on the platform edge (clear of the actor zone) ---
  const benchCount = requestCount(bp, 'bench')
  const benchXs = [-3.2, 3.4]
  for (let i = 0; i < benchCount; i++) {
    const x = benchXs[i % benchXs.length]
    const bench = buildBench(ctx)
    bench.position.set(x, 0.92, -3.6)
    bench.rotation.y = Math.PI // face the tracks
    tagAssetSlot(bench, 'bench')
    ctx.group.add(bench)
  }

  // --- Platform edge posts to frame the view ---
  for (const px of [-6.4, 5.9]) {
    ctx.group.add(
      bx(ctx, 0.14, 1.1, 0.14, ctx.mats.get(0x33393f, { rough: 0.6, metal: 0.3 }), px, 0.55, -3.9)
    )
  }
}

/**
 * Shared room composer — floor, walls, rug, window, doorway, shelf,
 * sofa + table + chair, warm lamp.
 */
function composeInteriorRoom(
  ctx: Ctx,
  bp: EnvironmentBlueprint,
  opts: { warm: boolean; withChair: boolean; withWindow: boolean }
): void {
  const floorHex = opts.warm ? 0x3f332c : 0x23262e
  ctx.group.add(buildFloor(ctx, 18, floorHex, 0.92).children[0])

  if (opts.warm) {
    const rug = ctx.mats.get(0x4e3d31, { rough: 1 })
    const rugMesh = mkMesh(ctx, new THREE.PlaneGeometry(3.8, 2.8), rug, 0, 0.006, 0.4)
    rugMesh.rotation.x = -Math.PI / 2
    ctx.group.add(rugMesh)
  }

  // Back wall + side walls (frame edges).
  const wallHex = opts.warm ? 0x8a7663 : 0x2b303c
  const back = buildWall(ctx, 17, 4.6, 0.35, wallHex)
  back.position.set(0, 0, -7.2)
  ctx.group.add(back)

  for (const sx of [2.7, -2.7]) {
    const side = buildSidePanel(ctx, 3.2, 3.6, 0.3, sx < 0 ? 0x7e6c5b : 0x75634f)
    side.position.set(sx, 0, -1.4)
    ctx.group.add(side)
  }

  // Window on the back wall (right of center).
  if (opts.withWindow && requestCount(bp, 'window') > 0) {
    const win = buildWindow(ctx, 2.0, 1.5, ctx.night ? 0xffd9a8 : 0xa8c4ec, ctx.night ? 1.05 : 0.7)
    win.position.set(2.0, 2.35, -7.0)
    ctx.group.add(win)
    // Window frame bars.
    ctx.group.add(bx(ctx, 0.06, 1.5, 0.1, ctx.mats.get(0x2a2119), 2.0, 2.35, -6.98))
    ctx.group.add(bx(ctx, 2.0, 0.06, 0.1, ctx.mats.get(0x2a2119), 2.0, 2.35, -6.98))
  }

  // Doorway on the back wall (far right).
  if (requestCount(bp, 'doorway') > 0) {
    const door = buildDoorway(ctx)
    door.position.set(4.4, 0, -7.02)
    ctx.group.add(door)
  }

  // Shelf against the back wall (left).
  if (requestCount(bp, 'shelf') > 0) {
    const shelf = buildShelf(ctx)
    shelf.position.set(-4.2, 0, -6.95)
    shelf.rotation.y = 0.12
    tagAssetSlot(shelf, 'shelf')
    ctx.group.add(shelf)
  }

  // Sofa + coffee table (left, visible midground).
  if (requestCount(bp, 'sofa') > 0) {
    const sofa = buildSofa(ctx, opts.warm ? 0x7b5a42 : 0x4a5a74)
    sofa.position.set(-2.7, 0, -2.4)
    sofa.rotation.y = -0.42
    tagAssetSlot(sofa, 'sofa')
    ctx.group.add(sofa)
    registerFootprint(ctx, -2.7, -2.4, 1.2)
  }
  if (requestCount(bp, 'table') > 0) {
    const table = buildTable(ctx, 1.2, 0.4, 0.7, opts.warm ? 0x5c4531 : 0x39404d)
    table.position.set(2.7, 0, -1.9)
    tagAssetSlot(table, 'table')
    ctx.group.add(table)
  }

  // Chair on the right (behind the actor zone).
  if (opts.withChair && requestCount(bp, 'chair') > 0) {
    const chair = buildChair(ctx, opts.warm ? 0x6b4a32 : 0x39404d)
    chair.position.set(2.75, 0, -2.6)
    chair.rotation.y = 0.7
    tagAssetSlot(chair, 'chair')
    ctx.group.add(chair)
  }

  // Warm floor lamp (emissive at night) near the right frame edge.
  if (opts.warm) {
    const poleMat = ctx.mats.get(0x22262c, { rough: 0.5, metal: 0.5 })
    ctx.group.add(
      mkMesh(ctx, new THREE.CylinderGeometry(0.035, 0.035, 1.7, 8), poleMat, 2.6, 0.85, -0.2)
    )
    const shade = ctx.mats.get(0x2a2018, {
      rough: 0.6,
      emissive: 0xffd9a8,
      emissiveIntensity: ctx.night ? 1.4 : 0.9,
    })
    ctx.group.add(
      mkMesh(ctx, new THREE.CylinderGeometry(0.18, 0.26, 0.34, 12), shade, 2.6, 1.75, -0.2)
    )
  }
}

function composeApartment(ctx: Ctx, bp: EnvironmentBlueprint): void {
  composeInteriorRoom(ctx, bp, { warm: true, withChair: true, withWindow: true })
}

function composeOffice(ctx: Ctx, bp: EnvironmentBlueprint): void {
  ctx.group.add(buildFloor(ctx, 18, 0x23262e, 0.6).children[0])
  const back = buildWall(ctx, 17, 4.4, 0.3, 0x2b303c)
  back.position.set(0, 0, -7.2)
  ctx.group.add(back)
  for (const sx of [2.7, -2.7]) {
    const side = buildSidePanel(ctx, 3.4, 3.6, 0.3, 0x272c37)
    side.position.set(sx, 0, -1.5)
    ctx.group.add(side)
  }
  if (requestCount(bp, 'window') > 0) {
    const win = buildWindow(ctx, 2.4, 1.5, 0x9fc3ef, 0.8)
    win.position.set(1.4, 2.1, -7.0)
    ctx.group.add(win)
  }
  if (requestCount(bp, 'desk') > 0) {
    const desk = buildDesk(ctx, 1.9)
    desk.position.set(-1.35, 0, -2.35)
    desk.rotation.y = 0.35
    tagAssetSlot(desk, 'desk')
    ctx.group.add(desk)
    const monitor = ctx.mats.get(0x05070c, {
      rough: 0.3,
      emissive: 0x7dd3fc,
      emissiveIntensity: 0.9,
    })
    ctx.group.add(
      mkMesh(ctx, new THREE.PlaneGeometry(0.85, 0.5), monitor, -0.6, 1.45, -2.4)
    )
  }
  if (requestCount(bp, 'chair') > 0) {
    const chair = buildChair(ctx)
    chair.position.set(2.7, 0, -2.0)
    chair.rotation.y = -0.6
    ctx.group.add(chair)
  }
  if (requestCount(bp, 'shelf') > 0) {
    const shelf = buildShelf(ctx)
    shelf.position.set(-4.2, 0, -6.95)
    shelf.rotation.y = 0.1
    ctx.group.add(shelf)
  }
}

function composeBroadcast(ctx: Ctx, bp: EnvironmentBlueprint): void {
  // Glossy studio floor + raised platform slab.
  ctx.group.add(buildFloor(ctx, 24, 0x10141f, 0.35).children[0])
  ctx.group.add(
    bx(ctx, 13.5, 0.09, 8.2, ctx.mats.get(0x0e1530, { rough: 0.8 }), 0, 0.02, -2.4)
  )

  // --- Backdrop wall + giant screen ---
  const backdrop = buildWall(ctx, 23, 6.6, 0.4, 0x0d1730)
  backdrop.position.set(0, 0, -8.2)
  ctx.group.add(backdrop)
  if (requestCount(bp, 'screen') > 0) {
    const screen = buildScreen(ctx, 13.5, 3.4)
    screen.position.set(0, 3.3, -7.98)
    tagAssetSlot(screen, 'screen')
    ctx.group.add(screen)
    // Glowing news-ticker strip at the bottom of the screen.
    const ticker = ctx.mats.get(0x05070c, {
      rough: 0.4,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.5,
    })
    ctx.group.add(bx(ctx, 13.8, 0.18, 0.1, ticker, 0, 1.42, -7.95))
  }

  // --- Flanking studio panels with lit inner edges ---
  for (const px of [-4.5, 4.5]) {
    const panel = buildWall(ctx, 1.8, 3.8, 0.2, 0x12203c)
    panel.position.set(px, 0.4, -3.4)
    tagAssetSlot(panel, 'panel')
    ctx.group.add(panel)
    const edge = ctx.mats.get(0x05070c, {
      rough: 0.5,
      emissive: 0x67e8f9,
      emissiveIntensity: 1.4,
    })
    ctx.group.add(
      mkMesh(ctx, new THREE.PlaneGeometry(0.09, 3.4), edge, px, 2.15, -3.28)
    )
  }

  // Side paneling (background, angled in).
  for (const sx of [-5.6, 5.6]) {
    const pane = buildSidePanel(ctx, 3.6, 3.4, 0.25, 0x0e1830)
    pane.position.set(sx, 0.4, -3.6)
    ctx.group.add(pane)
  }

  // --- Presenter desk (behind the actor slots) ---
  if (requestCount(bp, 'desk') > 0) {
    const desk = buildDesk(ctx, 3.6)
    desk.position.set(0, 0, -2.5)
    tagAssetSlot(desk, 'desk')
    ctx.group.add(desk)
    // Desk riser + lower body.
    ctx.group.add(
      bx(ctx, 3.9, 0.14, 1.15, ctx.mats.get(0x16233d, { rough: 0.8 }), 0, 0.07, -2.5)
    )
    // Glowing logo panel on the desk front.
    const logo = ctx.mats.get(0x05070c, {
      rough: 0.3,
      emissive: 0x6366f1,
      emissiveIntensity: 1.4,
    })
    ctx.group.add(bx(ctx, 0.6, 0.11, 0.05, logo, 0, 0.62, -2.4))
  }

  // --- Studio light bars ---
  const lightBarMat = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0xffffff,
    emissiveIntensity: 2.2,
  })
  for (const lx of [-3.3, 3.3]) {
    ctx.group.add(bx(ctx, 1.0, 0.1, 0.18, lightBarMat, lx, 4.2, -2.6))
  }
  const lowBarMat = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0xfff4d6,
    emissiveIntensity: 1.4,
  })
  ctx.group.add(bx(ctx, 0.9, 0.1, 0.16, lowBarMat, 0, 2.0, -4.9))
  ctx.group.add(bx(ctx, 0.9, 0.1, 0.16, lowBarMat, -4.4, 2.0, -3.4))
}

function composeStreet(ctx: Ctx, bp: EnvironmentBlueprint): void {
  // Road along z through the actor zone.
  if (requestCount(bp, 'road') > 0) {
    ctx.group.add(buildRoad(ctx, 24, ctx.details.rain))
  }

  // Sidewalks.
  const sidewalkCount = requestCount(bp, 'sidewalk')
  for (let i = 0; i < sidewalkCount; i++) {
    const sw = buildSidewalk(ctx, 24)
    sw.position.set(i % 2 === 0 ? -4.35 : 4.35, 0.12, -2.5)
    tagAssetSlot(sw, 'sidewalk')
    ctx.group.add(sw)
  }

  // Building canyon: three in sight per side.
  const buildingCount = requestCount(bp, 'building')
  // Buildings stay at |x| ≥ 4.3 so their footprints never enter the actor
  // safe zone — a canyon wall must never stand behind/beside the actors.
  const buildPos: Array<[number, number]> = [
    [-4.6, -6.4], [4.6, -6.4],
    [-4.3, -4.0], [4.3, -4.0],
    [-4.6, -1.6], [4.6, -1.6],
  ]
  for (let i = 0; i < buildingCount; i++) {
    const [sx, z] = buildPos[i % buildPos.length]
    const h = 4.2 + ctx.rng() * 3.2
    const b = buildBuilding(
      ctx,
      2.6 + ctx.rng() * 0.8,
      h,
      2.8,
      !ctx.details.abandoned || i % 2 === 0
    )
    b.position.set(sx, 0, z)
    tagAssetSlot(b, 'building')
    ctx.group.add(b)
    registerFootprint(ctx, sx, z, 1.8)
  }

  // Street lamps.
  const lampCount = ctx.details.abandoned ? 1 : Math.min(requestCount(bp, 'lampPost'), 3)
  for (let i = 0; i < lampCount; i++) {
    const lamp = buildLampPost(ctx, 3.6, true)
    lamp.position.set(i % 2 === 0 ? -3.9 : 3.9, 0.13, -4.5 + i * 4.2)
    lamp.rotation.y = i % 2 === 0 ? 0 : Math.PI
    tagAssetSlot(lamp, 'lamp')
    ctx.group.add(lamp)
  }

  // Fences.
  const fenceCount = requestCount(bp, 'fence')
  for (let i = 0; i < fenceCount; i++) {
    const pos = placeInZone(ctx, 1.0, i % 2 === 0 ? ZONES.sideL : ZONES.sideR)
    const fence = buildFence(ctx)
    fence.position.set(pos.x, 0.13, pos.z)
    fence.rotation.y = ctx.rng() > 0.5 ? 0 : Math.PI / 2
    ctx.group.add(fence)
  }
}

function composeForest(ctx: Ctx, bp: EnvironmentBlueprint): void {
  // Forest floor.
  ctx.group.add(
    buildFloor(ctx, 28, ctx.details.rain ? 0x142a20 : 0x21402c, 0.97).children[0]
  )

  const treeCount = requestCount(bp, 'tree')

  // --- Anchored trees: frame-edge foreground, midground, deep rows ---
  const treeAnchors: Array<[number, number, number]> = [
    // Frame-edge near trees (outside the actor safe zone, dominate the sides).
    [-2.7, -1.35, 1.5],
    [2.7, -1.3, 1.5],
    // Midground row — visible trunks behind the actor area.
    [-3.1, -2.7, 1.35],
    [-1.4, -2.9, 1.5],
    [0.4, -2.8, 1.5],
    [2.3, -3.0, 1.4],
    // Deep canopy row.
    [-4.6, -4.9, 1.3],
    [-2.6, -5.1, 1.35],
    [1.2, -4.8, 1.35],
    [3.5, -5.3, 1.3],
  ]
  for (let i = 0; i < Math.min(treeCount, treeAnchors.length); i++) {
    const [tx, tz, scale] = treeAnchors[i]
    const tree = buildTree(ctx, scale)
    tree.position.set(tx, 0, tz)
    tree.rotation.y = ctx.rng() * Math.PI * 2
    // Alternate the two forest tree variants so scenes repeat assets.
    tagAssetSlot(tree, i % 2 === 0 ? 'tree_01' : 'tree_02')
    ctx.group.add(tree)
    registerFootprint(ctx, tx, tz, 1.0 * scale)
  }

  // Surplus trees (crowded scenes) → zone fill.
  let extraTrees = treeCount - Math.min(treeCount, treeAnchors.length)
  let guard = 0
  while (extraTrees > 0 && guard < 10) {
    const pos = placeInZone(ctx, 0.9, ZONES.bg)
    const tree = buildTree(ctx, 1.2 + ctx.rng() * 0.4)
    tree.position.set(pos.x, 0, pos.z)
    tagAssetSlot(tree, guard % 2 === 0 ? 'tree_01' : 'tree_02')
    ctx.group.add(tree)
    extraTrees--
    guard++
  }

  // Bushes along the foreground frame edge.
  const bushCount = Math.max(2, Math.round(treeCount / 2))
  for (let i = 0; i < bushCount; i++) {
    const pos = placeInZone(ctx, 0.4, i % 2 === 0 ? ZONES.fgL : ZONES.fgR)
    const bush = buildBush(ctx, 0.28 + ctx.rng() * 0.25)
    bush.position.set(pos.x, 0, pos.z)
    tagAssetSlot(bush, 'bush')
    ctx.group.add(bush)
  }

  // Rocks scattered (foreground + midground).
  const rockCount = requestCount(bp, 'rock')
  const rockSpots: Array<[number, number]> = [
    [-2.8, -0.9],
    [2.8, -0.85],
    [-3.1, -2.1],
    [2.6, -1.9],
    [-4.1, -3.9],
    [3.6, -4.1],
  ]
  for (let i = 0; i < rockCount; i++) {
    const [rx, rz] = rockSpots[i % rockSpots.length]
    const rock = buildRock(ctx, 0.35 + ctx.rng() * 0.35)
    rock.position.set(rx, 0, rz)
    rock.rotation.y = ctx.rng() * Math.PI * 2
    tagAssetSlot(rock, 'rock')
    ctx.group.add(rock)
  }

  // Abandoned woods → fallen log.
  if (ctx.details.abandoned) {
    const log = buildBeam(ctx, 3.2, 0x3c2c1e)
    log.position.set(-3.6, 0.22, -1.4)
    log.rotation.y = 0.7
    ctx.group.add(log)
  }
}

/** Local alias so the COMPOSERS table reads cleanly without importing values. */
type EnvironmentLocationKindAlias = ResolvedEnvironment['locationKind']

const COMPOSERS: Partial<Record<EnvironmentLocationKindAlias, Composer>> = {
  warehouse: composeWarehouse,
  railway: composeRailway,
  apartment: composeApartment,
  interior: (ctx, bp) => {
    composeInteriorRoom(ctx, bp, { warm: false, withChair: false, withWindow: false })
  },
  office: composeOffice,
  broadcast: composeBroadcast,
  street: composeStreet,
  forest: composeForest,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compose the full procedural environment for a resolved blueprint.
 * Returns ONE Group containing only static primitive geometry — no lights,
 * no textures, no listeners — so replacing it fully disposes the old world.
 */
export function buildEnvironmentGroup(env: ResolvedEnvironment): THREE.Group {
  const group = new THREE.Group()
  group.name = 'proceduralEnvironment'

  const bp = env.blueprint
  const darken =
    (bp.details.old ? 0.84 : 1) * (bp.details.abandoned ? 0.86 : 1) * (bp.details.rain ? 0.92 : 1)

  const ctx: Ctx = {
    group,
    rng: mulberry32(bp.seed),
    mats: new MaterialBank(darken, bp.details.rain),
    count: 0,
    occupied: [],
    night: bp.timeOfDay === 'night',
    details: bp.details,
  }

  const composer = COMPOSERS[env.locationKind]
  if (composer) {
    composer(ctx, bp)
  } else {
    // Unknown bespoke kind → neutral room fallback (never empty).
    composeInteriorRoom(ctx, bp, { warm: false, withChair: false, withWindow: false })
  }

  group.userData.meshCount = ctx.count

  // Asset-assisted pass: asynchronously try to load and place the local
  // GLB/GLTF equivalents for tagged semantic slots. Missing assets keep the
  // procedural props already in the scene — the existing primitive IS the
  // automatic fallback. Fire-and-forget; never blocks the stage.
  void attachAssetOverlays(group, env).catch((err) => {
    console.warn('Environment asset overlay failed:', err)
  })

  return group
}
