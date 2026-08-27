/**
 * Environment Props — SHARED PROCEDURAL PROP LIBRARY (Phase 2).
 *
 * Extracted from environmentStage.ts so the category composers can stay
 * readable. Everything in here is:
 *
 *  - DETERMINISTIC  — all randomness flows from the caller's seeded PRNG
 *                     (mulberry32). Same seed ⇒ same props, always.
 *  - LOW-POLY       — Box / Plane / Cylinder / Cone / Icosahedron /
 *                     Dodecahedron primitives only. Detail-0 polyhedra.
 *  - DRAW-CALL CHEAP— GeometryBank shares one BufferGeometry across every
 *                     mesh with identical dimensions; mkInstanced() packs
 *                     repeated props (trees, rocks, crates, sleepers…) into
 *                     ONE InstancedMesh with per-instance transform + tint.
 *  - DISPOSABLE     — geometries/materials created per build; the stage's
 *                     disposeObjectDeep() frees them all on switch. Nothing
 *                     here is cached globally across builds.
 *  - STYLE-GRADEABLE— all materials are MeshStandardMaterials produced by the
 *                     per-build MaterialBank, so VisualStyleController can
 *                     darken/desaturate them (Noir Deco) from its baselines.
 *
 * SAFETY MODEL (enforced by the audit in registerFootprint):
 *  - ACTOR SPAWN safety — nothing within reach of (±0.75, 0, 0).
 *  - SIGHTLINE safety  — nothing crosses the camera↔actor corridor
 *                        (the segment x≈0, z ∈ [-0.5, +2.8]).
 *  - CAMERA safety     — nothing inside CAM_SAFE_R of the camera pivot.
 */

import * as THREE from 'three'
import type {
  BlueprintPropRequest,
  EnvironmentDetails,
  PaletteSpec,
  PropType,
} from './environmentResolver'

// ---------------------------------------------------------------------------
// Deterministic PRNG + color helpers
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

/** Multiply a hex color's channels by a seeded jitter (amt 0…1). */
export function jitterHex(hex: number, rng: () => number, amt: number): number {
  const r = ((hex >> 16) & 255) / 255
  const g = ((hex >> 8) & 255) / 255
  const b = (hex & 255) / 255
  const ch = (v: number) => {
    const f = 1 - amt / 2 + rng() * amt
    return Math.max(0, Math.min(255, Math.round(v * f * 255)))
  }
  return (ch(r) << 16) | (ch(g) << 8) | ch(b)
}

/** Linear blend between two hex colors (t=0 → a, t=1 → b). */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255
  const ag = (a >> 8) & 255
  const ab = a & 255
  const br = (b >> 16) & 255
  const bg = (b >> 8) & 255
  const bb = b & 255
  const l = (x: number, y: number) => Math.round(x + (y - x) * t)
  return (l(ar, br) << 16) | (l(ag, bg) << 8) | l(ab, bb)
}

// ---------------------------------------------------------------------------
// Material bank — per-build shared MeshStandardMaterials
// ---------------------------------------------------------------------------

export interface MatOpts {
  rough?: number
  metal?: number
  emissive?: number
  emissiveIntensity?: number
}

export class MaterialBank {
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

  /** Every material created by this bank (debug/inspection aid). */
  get materialCount(): number {
    return this.cache.size
  }
}

// ---------------------------------------------------------------------------
// Geometry bank — shared BufferGeometries per build (fewer GPU buffers)
// ---------------------------------------------------------------------------

export class GeometryBank {
  private cache = new Map<string, THREE.BufferGeometry>()

  private make<T extends THREE.BufferGeometry>(key: string, fn: () => T): T {
    let g = this.cache.get(key) as T | undefined
    if (!g) {
      g = fn()
      this.cache.set(key, g)
    }
    return g
  }

  box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.make(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d))
  }

  cyl(rt: number, rb: number, h: number, seg = 8): THREE.CylinderGeometry {
    return this.make(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg))
  }

  cone(r: number, h: number, seg = 8): THREE.ConeGeometry {
    return this.make(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg))
  }

  plane(w: number, h: number): THREE.PlaneGeometry {
    return this.make(`p${w}|${h}`, () => new THREE.PlaneGeometry(w, h))
  }

  ico(r: number, detail = 0): THREE.IcosahedronGeometry {
    return this.make(`i${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail))
  }

  dodeca(r: number): THREE.DodecahedronGeometry {
    return this.make(`d${r}`, () => new THREE.DodecahedronGeometry(r))
  }

  sphere(r: number, w = 8, h = 6): THREE.SphereGeometry {
    return this.make(`s${r}|${w}|${h}`, () => new THREE.SphereGeometry(r, w, h))
  }
}

// ---------------------------------------------------------------------------
// Build context — zones, occupancy, budget, safety audit
// ---------------------------------------------------------------------------

/** Actor performance area (Lead/Supporting VRMs stand near (±0.75, 0, 0)). */
export const ACTOR_HALF_X = 2.5
export const ACTOR_HALF_Z = 1.5
/** Camera-safe radius: no prop footprints inside this distance of origin. */
export const CAM_SAFE_R = 2.55
/** Camera pivot (default shot) — sightline runs from here to just past actors. */
export const CAMERA_Z = 2.8

export interface Zone {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Camera-aware layering zones (visible half-width at z ≈ (2.8 − z) · 0.62). */
export const ZONES = {
  /** Far background shell — back walls, signs, canopies. z ≈ −7.5…−5.2 */
  bgDeep: { x0: -6.4, x1: 6.4, z0: -7.5, z1: -5.2 } as Zone,
  /** Mid background — racks, tall crates, mid tree line. z ≈ −5.4…−3.4 */
  bg: { x0: -5.2, x1: 5.2, z0: -5.4, z1: -3.4 } as Zone,
  /** Side margins — industrial props / bushes visible at z ≤ −3.4. */
  sideL: { x0: -4.6, x1: -2.6, z0: -5.0, z1: -3.4 } as Zone,
  sideR: { x0: 2.6, x1: 4.6, z0: -5.0, z1: -3.4 } as Zone,
  /** Foreground accents at the lower frame edges, OUTSIDE the actor zone. */
  fgL: { x0: -4.3, x1: -2.65, z0: -1.5, z1: 0.5 } as Zone,
  fgR: { x0: 2.65, x1: 4.3, z0: -1.5, z1: 0.5 } as Zone,
} as const

export interface Ctx {
  group: THREE.Group
  rng: () => number
  mats: MaterialBank
  geos: GeometryBank
  palette: PaletteSpec
  /** Regular mesh count (InstancedMesh counts as 1). */
  count: number
  /** Total instances packed into InstancedMeshes. */
  instancedCount: number
  occupied: Array<{ x: number; z: number; r: number }>
  night: boolean
  details: EnvironmentDetails
  /** Recognized prop census: semantic name → count (for traces/tests). */
  census: Map<string, number>
  /** Safety audit results — MUST stay 0 for every composer. */
  actorViolations: number
  cameraViolations: number
  /**
   * Phase 2.1 VISUAL-OCCLUSION audit: counts large opaque surfaces that sit
   * between the default Two-Shot camera and the actor zone (the "giant
   * blocking plane" failure). Composers register wall-scale slabs through
   * registerOccluder(); anything flagged would swallow the central frame.
   */
  occlusionViolations: number
}

/**
 * Phase 2.1 occlusion audit. A big architectural slab is SAFE only when it is
 * BEHIND the actors (z < −3.2), BELOW their sightline (h ≤ 1.2, e.g. floors,
 * platforms, rugs) or pushed far enough sideways that it only grazes the
 * frame edge (|x| ≥ 4.6). Everything else — a tall wall crossing the mid
 * ground beside/behind the camera side of the actors — registers as an
 * occlusion violation. Floors/walls never enter `occupied`, so this is the
 * dedicated gate for architecture.
 */
export function registerOccluder(
  ctx: Ctx,
  x: number,
  z: number,
  w: number,
  h: number
): void {
  const behindActors = z <= -3.2
  const lowProfile = h <= 1.2
  const frameEdge = Math.abs(x) - w / 2 >= 4.6
  if (!behindActors && !lowProfile && !frameEdge) {
    ctx.occlusionViolations++
  }
}

export function recordProp(ctx: Ctx, name: string): void {
  ctx.census.set(name, (ctx.census.get(name) ?? 0) + 1)
}

// ---------------------------------------------------------------------------
// Mesh helpers
// ---------------------------------------------------------------------------

export function mkMesh(
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

export function bx(
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
  return mkMesh(ctx, ctx.geos.box(w, h, d), mat, x, y, z, ry)
}

export function newProp(name: string): THREE.Group {
  const g = new THREE.Group()
  g.name = `prop:${name}`
  return g
}

// ---------------------------------------------------------------------------
// Instancing — ONE InstancedMesh per repeated prop family
// ---------------------------------------------------------------------------

export interface Placement {
  x: number
  y: number
  z: number
  ry?: number
  /** Roll around Z (tilted crates / fallen props). */
  rz?: number
  sx?: number
  sy?: number
  sz?: number
}

/**
 * Pack `placements` into a single InstancedMesh. Optional per-instance
 * brightness/hue jitter gives organic variation (foliage, rocks, crates)
 * without extra materials or draw calls. Deterministic: jitter draws from
 * the context RNG in placement order.
 */
export function mkInstanced(
  ctx: Ctx,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
  name: string,
  opts: { jitter?: number; hueJitter?: boolean } = {}
): THREE.InstancedMesh {
  const n = Math.max(1, placements.length)
  const mesh = new THREE.InstancedMesh(geometry, material, n)
  mesh.name = `inst:${name}`
  mesh.count = placements.length
  const dummy = new THREE.Object3D()
  const col = new THREE.Color()
  const hsl = { h: 0, s: 0, l: 0 }
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]
    dummy.position.set(p.x, p.y, p.z)
    dummy.rotation.set(0, p.ry ?? 0, p.rz ?? 0)
    dummy.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    if (opts.jitter) {
      const l = 1 - opts.jitter / 2 + ctx.rng() * opts.jitter
      col.setRGB(l, l, l)
      if (opts.hueJitter) {
        col.getHSL(hsl)
        col.setHSL((hsl.h + (ctx.rng() - 0.5) * 0.04 + 1) % 1, hsl.s, hsl.l)
      }
      mesh.setColorAt(i, col)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  ctx.count++
  ctx.instancedCount += placements.length
  recordProp(ctx, name)
  return mesh
}

// ---------------------------------------------------------------------------
// Placement + SAFETY AUDIT
// ---------------------------------------------------------------------------

/**
 * Distance from (x,z) to the camera↔actor sightline segment
 * (x=0, z from −0.5 to CAMERA_Z). Props near this corridor would cut
 * through Two Shot / Close Up / OTS framings.
 */
function sightlineDistance(x: number, z: number): number {
  if (z >= -0.5 && z <= CAMERA_Z) return Math.abs(x)
  return Math.min(Math.hypot(x, z + 0.5), Math.hypot(x, z - CAMERA_Z))
}

/**
 * Register a prop footprint AND run the safety audit. Violations are counted
 * (never thrown) so the runtime trace can report actor-safe-zone status.
 * Large architectural surfaces (floors, walls, platforms) are exempt —
 * callers simply don't register them.
 */
export function registerFootprint(ctx: Ctx, x: number, z: number, r: number): void {
  ctx.occupied.push({ x, z, r })
  // 1) Actor spawns at (±0.75, 0, 0).
  for (const ax of [-0.75, 0.75]) {
    if (Math.hypot(x - ax, z) < r + 0.55) {
      ctx.actorViolations++
      return
    }
  }
  // 2) Camera↔actor sightline corridor.
  if (sightlineDistance(x, z) < r + 0.35) {
    ctx.cameraViolations++
    return
  }
  // 3) Camera pivot itself.
  if (Math.hypot(x, z - CAMERA_Z) < r + 0.45) {
    ctx.cameraViolations++
  }
}

/**
 * Deterministic zoned placement for "fill" props. The zone rectangles encode
 * the WEDGE SAFETY MARGIN themselves; the audit in registerFootprint is the
 * final gate.
 */
export function placeInZone(ctx: Ctx, radius: number, zone: Zone): { x: number; z: number } {
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
      registerFootprint(ctx, x, z, radius)
      return { x, z }
    }
  }
  registerFootprint(ctx, fallback.x, fallback.z, radius)
  return fallback
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — architecture
// ---------------------------------------------------------------------------

/** Ground plane (flat). Forest uses buildTerrain-style displaced ground in the stage. */
export function buildFloorMesh(
  ctx: Ctx,
  size = 18,
  hex = 0x16171b,
  rough = 0.92
): THREE.Mesh {
  const plane = mkMesh(ctx, ctx.geos.plane(size, size), ctx.mats.get(hex, { rough }))
  plane.rotation.x = -Math.PI / 2
  recordProp(ctx, 'floor')
  return plane
}

export function buildWall(
  ctx: Ctx,
  w = 14,
  h = 3.4,
  t = 0.3,
  hex = 0x32353d,
  /**
   * Phase 2.1: per-wall albedo lift (default 1 = unchanged). Interior sets
   * pass ~1.25–1.45 so walls read as lit surfaces under night grades
   * instead of near-black planes.
   */
  tone = 1
): THREE.Group {
  const g = newProp('wall')
  const wallHex = tone === 1 ? hex : mixHex(hex, 0xffffff, Math.min(tone - 1, 0.6))
  g.add(bx(ctx, w, h, t, ctx.mats.get(wallHex, { rough: 0.9 }), 0, h / 2, 0))
  recordProp(ctx, 'wall')
  return g
}

/** Side wall — long dimension runs along Z (toward the camera). */
export function buildSidePanel(
  ctx: Ctx,
  lenZ: number,
  h = 3.4,
  t = 0.3,
  hex = 0x32353d,
  /** Phase 2.1: same albedo-lift seam as buildWall(). */
  tone = 1
): THREE.Group {
  const g = newProp('sideWall')
  const panelHex = tone === 1 ? hex : mixHex(hex, 0xffffff, Math.min(tone - 1, 0.6))
  g.add(bx(ctx, t, h, lenZ, ctx.mats.get(panelHex, { rough: 0.9 }), 0, h / 2, 0))
  recordProp(ctx, 'side_wall')
  return g
}

export function buildDoorway(ctx: Ctx, w = 1.3, h = 2.3, hex = 0x241d16): THREE.Group {
  const g = newProp('doorway')
  const frame = ctx.mats.get(hex, { rough: 0.85 })
  const dark = ctx.mats.get(0x05060a, { rough: 1 })
  const jamb = 0.16
  g.add(bx(ctx, jamb, h, 0.34, frame, -(w / 2 + jamb / 2), h / 2, 0))
  g.add(bx(ctx, jamb, h, 0.34, frame, w / 2 + jamb / 2, h / 2, 0))
  g.add(bx(ctx, w + jamb * 2, 0.22, 0.34, frame, 0, h + 0.11, 0))
  g.add(bx(ctx, w, h - 0.05, 0.06, dark, 0, (h - 0.05) / 2, -0.08))
  recordProp(ctx, 'doorway')
  return g
}

export function buildWindow(
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
  g.add(mkMesh(ctx, ctx.geos.plane(w, h), glass, 0, 0, 0.045))
  g.add(bx(ctx, 0.05, h, 0.03, frame, 0, 0, 0.075))
  g.add(bx(ctx, w, 0.05, 0.03, frame, 0, 0, 0.075))
  recordProp(ctx, 'window')
  return g
}

export function buildPillar(ctx: Ctx, h = 4.6, hex = 0x23262c): THREE.Group {
  const g = newProp('pillar')
  const mat = ctx.mats.get(hex, { rough: 0.6, metal: 0.3 })
  g.add(bx(ctx, 0.55, h, 0.55, mat, 0, h / 2, 0))
  g.add(bx(ctx, 0.8, 0.14, 0.8, ctx.mats.get(0x1b1d22), 0, h + 0.07, 0))
  recordProp(ctx, 'pillar')
  return g
}

export function buildPlatform(
  ctx: Ctx,
  w = 15,
  d = 3.2,
  h = 0.85,
  hex = 0x1d2026
): THREE.Group {
  const g = newProp('platform')
  g.add(bx(ctx, w, h, d, ctx.mats.get(hex, { rough: 0.85 }), 0, h / 2, 0))
  // Safety line along the FRONT edge (facing the camera / tracks).
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
  recordProp(ctx, 'platform')
  return g
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — furniture
// ---------------------------------------------------------------------------

export function buildTable(
  ctx: Ctx,
  w = 1.15,
  h = 0.42,
  d = 0.65,
  hex = 0x5c4531
): THREE.Group {
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
  recordProp(ctx, 'table')
  return g
}

export function buildDesk(ctx: Ctx, w = 3.4, hex = 0x18263f): THREE.Group {
  const g = newProp('desk')
  const top = ctx.mats.get(hex, { rough: 0.4 })
  // Phase 2.1: desk front strip glows harder so the anchor desk reads as the
  // studio's hero furniture even in wide shots (restrained, style-gradeable).
  const body = ctx.mats.get(0x101b30, { rough: 0.7 })
  const accent = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0x6366f1,
    emissiveIntensity: 1.5,
  })
  g.add(bx(ctx, w, 0.09, 0.95, top, 0, 1.02, 0))
  g.add(bx(ctx, w - 0.2, 0.95, 0.75, body, 0, 0.5, -0.08))
  g.add(mkMesh(ctx, ctx.geos.plane(w - 0.4, 0.08), accent, 0, 0.52, 0.385))
  recordProp(ctx, 'desk')
  return g
}

export function buildChair(ctx: Ctx, hex = 0x39404d): THREE.Group {
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
  recordProp(ctx, 'chair')
  return g
}

export function buildSofa(ctx: Ctx, hex = 0x4a5a74): THREE.Group {
  const g = newProp('sofa')
  const base = ctx.mats.get(hex, { rough: 1 })
  const dark = ctx.mats.get(mixHex(hex, 0x000000, 0.18), { rough: 1 })
  g.add(bx(ctx, 2.1, 0.48, 0.85, base, 0, 0.24, 0))
  g.add(bx(ctx, 2.1, 0.6, 0.22, dark, 0, 0.68, 0.38))
  g.add(bx(ctx, 0.22, 0.55, 0.85, dark, -1.12, 0.5, 0))
  g.add(bx(ctx, 0.22, 0.55, 0.85, dark, 1.12, 0.5, 0))
  recordProp(ctx, 'sofa')
  return g
}

export function buildShelf(ctx: Ctx, tall = false, metal = false): THREE.Group {
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
  recordProp(ctx, tall ? 'rack' : 'shelf')
  return g
}

/** Low storage cabinet — body + two door fronts + plinth. */
export function buildCabinet(ctx: Ctx, w = 1.5, h = 0.9, hex = 0x4a3a2c): THREE.Group {
  const g = newProp('cabinet')
  const body = ctx.mats.get(hex, { rough: 0.8 })
  const door = ctx.mats.get(mixHex(hex, 0x000000, 0.15), { rough: 0.75 })
  g.add(bx(ctx, w, h, 0.5, body, 0, h / 2 + 0.06, 0))
  g.add(bx(ctx, w / 2 - 0.04, h - 0.14, 0.03, door, -w / 4, h / 2 + 0.06, 0.26))
  g.add(bx(ctx, w / 2 - 0.04, h - 0.14, 0.03, door, w / 4, h / 2 + 0.06, 0.26))
  g.add(bx(ctx, w, 0.12, 0.54, ctx.mats.get(0x241d16), 0, 0.06, 0))
  recordProp(ctx, 'cabinet')
  return g
}

/** Row of book spines for shelves — pure dressing, seeded color jitter. */
export function buildBookRow(ctx: Ctx, w = 1.2): THREE.Group {
  const g = newProp('books')
  const hues = [0x6b3a2e, 0x3a4a6b, 0x4a6b3a, 0x6b5a2e, 0x54385a]
  let x = -w / 2
  let i = 0
  while (x < w / 2 - 0.08) {
    const bw = 0.05 + ctx.rng() * 0.05
    const bh = 0.22 + ctx.rng() * 0.12
    g.add(
      bx(
        ctx,
        bw,
        bh,
        0.24,
        ctx.mats.get(hues[i % hues.length], { rough: 0.9 }),
        x + bw / 2,
        bh / 2,
        0
      )
    )
    x += bw + 0.012
    i++
  }
  recordProp(ctx, 'books')
  return g
}

/** Framed picture for walls — muted canvas, never emissive. */
export function buildPictureFrame(
  ctx: Ctx,
  w = 0.7,
  h = 0.55,
  frameHex = 0x3a2c1e,
  canvasHex = 0x59616e
): THREE.Group {
  const g = newProp('picture')
  g.add(bx(ctx, w, h, 0.05, ctx.mats.get(frameHex, { rough: 0.7 }), 0, 0, 0))
  g.add(mkMesh(ctx, ctx.geos.plane(w - 0.1, h - 0.1), ctx.mats.get(canvasHex, { rough: 0.95 }), 0, 0, 0.03))
  recordProp(ctx, 'picture')
  return g
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — industrial
// ---------------------------------------------------------------------------

/** Single wooden crate (unique placements use this; stacks use instancing). */
export function buildCrate(ctx: Ctx, s = 0.8, hex = 0x2b241c): THREE.Group {
  const g = newProp('crate')
  const wood = ctx.mats.get(hex, { rough: 0.9 })
  const lid = ctx.mats.get(0x241f18, { rough: 0.9 })
  g.add(bx(ctx, s, s, s, wood, 0, s / 2, 0))
  g.add(bx(ctx, s * 1.04, 0.06, s * 1.04, lid, 0, s - 0.02, 0))
  recordProp(ctx, 'crate')
  return g
}

/** Wooden shipping pallet — flat floor prop for the warehouse aisles. */
export function buildPallet(
  ctx: Ctx,
  w = 1.25,
  d = 1.05,
  h = 0.16,
  hex = 0x241d16
): THREE.Group {
  const g = newProp('pallet')
  const wood = ctx.mats.get(hex, { rough: 0.95 })
  for (let i = 0; i < 5; i++) {
    const boardX = -w / 2 + (i * w) / 4 + w / 8
    g.add(bx(ctx, w / 4, 0.045, d, wood, boardX, h - 0.045, 0))
  }
  for (const sx of [-w / 4, w / 4]) {
    g.add(bx(ctx, 0.16, h, d - 0.18, wood, sx, h / 2, 0))
  }
  recordProp(ctx, 'pallet')
  return g
}

export function buildBarrel(ctx: Ctx, hex = 0x26303a): THREE.Group {
  const g = newProp('barrel')
  g.add(
    mkMesh(
      ctx,
      ctx.geos.cyl(0.42, 0.42, 0.9, 10),
      ctx.mats.get(hex, { rough: 0.5, metal: 0.6 }),
      0,
      0.45,
      0
    )
  )
  recordProp(ctx, 'barrel')
  return g
}

export function buildPipe(ctx: Ctx, len = 12, hex = 0x3a4048): THREE.Group {
  const g = newProp('pipe')
  const mat = ctx.mats.get(hex, { rough: 0.5, metal: 0.55 })
  const pipe = mkMesh(ctx, ctx.geos.cyl(0.14, 0.14, len, 8), mat)
  pipe.rotation.z = Math.PI / 2
  g.add(pipe)
  for (const fx of [-len / 2 + 0.5, 0, len / 2 - 0.5]) {
    g.add(
      mkMesh(ctx, ctx.geos.cyl(0.2, 0.2, 0.14, 8), ctx.mats.get(0x2a2f36, { rough: 0.5, metal: 0.6 }), fx, 0, 0)
    )
  }
  recordProp(ctx, 'pipe')
  return g
}

export function buildBeam(ctx: Ctx, len = 6, hex = 0x1b1c22): THREE.Group {
  const g = newProp('beam')
  g.add(bx(ctx, len, 0.25, 0.35, ctx.mats.get(hex), 0, 0, 0))
  recordProp(ctx, 'beam')
  return g
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — outdoor / street
// ---------------------------------------------------------------------------

export function buildRoad(ctx: Ctx, len = 18, wet = false): THREE.Group {
  const g = newProp('road')
  const asphalt = ctx.mats.get(0x14151a, { rough: wet ? 0.32 : 0.85, metal: 0.05 })
  const plane = mkMesh(ctx, ctx.geos.plane(7, len), asphalt)
  plane.rotation.x = -Math.PI / 2
  g.add(plane)
  const dash = ctx.mats.get(0x8a8672, { rough: 0.8 })
  for (let i = 0; i < 6; i++) {
    g.add(bx(ctx, 0.12, 0.01, 0.9, dash, 0, 0.012, -len / 2 + 1.4 + i * 2.6))
  }
  recordProp(ctx, 'road')
  return g
}

export function buildSidewalk(ctx: Ctx, len = 18, hex = 0x2b2d33): THREE.Group {
  const g = newProp('sidewalk')
  g.add(bx(ctx, 1.7, 0.13, len, ctx.mats.get(hex, { rough: 0.9 }), 0, 0.065, 0))
  recordProp(ctx, 'sidewalk')
  return g
}

export function buildLampPost(ctx: Ctx, h = 3.6, lit = true): THREE.Group {
  const g = newProp('lampPost')
  const pole = ctx.mats.get(0x22262c, { rough: 0.6, metal: 0.4 })
  g.add(mkMesh(ctx, ctx.geos.cyl(0.06, 0.09, h, 8), pole, 0, h / 2, 0))
  g.add(bx(ctx, 0.7, 0.07, 0.07, pole, 0.32, h - 0.03, 0))
  const head = ctx.mats.get(0x0b0d10, {
    rough: 0.5,
    emissive: lit ? 0xffd9a0 : 0x111111,
    emissiveIntensity: lit ? 1.5 : 0,
  })
  g.add(bx(ctx, 0.34, 0.12, 0.2, head, 0.6, h - 0.12, 0))
  recordProp(ctx, 'lamp_post')
  return g
}

/**
 * Tree — hero variant (individual Group). 2–4× actor height at scale 1.2–1.7.
 * Visible bare trunk + double-layer cone canopy with seeded variation.
 */
export function buildTree(ctx: Ctx, scale = 1): THREE.Group {
  const g = newProp('tree')
  const trunkHex = ctx.night ? 0x3a2f24 : ctx.palette.accent
  const leafA = ctx.night ? 0x142218 : ctx.palette.secondary
  const leafB = ctx.night ? 0x1d3024 : ctx.palette.primary
  const trunkH = 1.45 + ctx.rng() * 0.5
  const trunkR = 0.11 + ctx.rng() * 0.05
  g.add(
    mkMesh(
      ctx,
      ctx.geos.cyl(trunkR, trunkR * 1.55, trunkH, 6),
      ctx.mats.get(jitterHex(trunkHex, ctx.rng, 0.16), { rough: 0.95 }),
      0,
      trunkH / 2,
      0
    )
  )
  const r1 = 1.0 + ctx.rng() * 0.35
  g.add(
    mkMesh(
      ctx,
      ctx.geos.cone(r1, 1.9, 8),
      ctx.mats.get(jitterHex(leafA, ctx.rng, 0.18), { rough: 0.95 }),
      0,
      trunkH + 0.82,
      0
    )
  )
  g.add(
    mkMesh(
      ctx,
      ctx.geos.cone(r1 * 0.62, 1.5, 8),
      ctx.mats.get(jitterHex(leafB, ctx.rng, 0.18), { rough: 0.9 }),
      0,
      trunkH + 1.95,
      0
    )
  )
  g.scale.setScalar(scale)
  recordProp(ctx, 'tree')
  return g
}

export function buildBush(ctx: Ctx, s = 0.5): THREE.Group {
  const g = newProp('bush')
  g.add(
    mkMesh(
      ctx,
      ctx.geos.ico(s, 0),
      ctx.mats.get(ctx.night ? 0x14251c : 0x1e5332, { rough: 1 }),
      0,
      s * 0.55,
      0
    )
  )
  recordProp(ctx, 'bush')
  return g
}

/**
 * City building — window quads are COLLECTED (not created) so the composer
 * can pack every window of the whole street into ONE InstancedMesh.
 */
export function buildBuilding(
  ctx: Ctx,
  w: number,
  h: number,
  d: number,
  px: number,
  pz: number,
  windowsOut: Placement[],
  litWindows: boolean
): THREE.Group {
  const g = newProp('building')
  const wallHex = jitterHex(ctx.palette.primary, ctx.rng, 0.22)
  g.add(bx(ctx, w, h, d, ctx.mats.get(wallHex, { rough: 0.9 }), 0, h / 2, 0))
  const rows = Math.max(1, Math.floor(h / 1.6))
  const cols = Math.max(1, Math.floor(w / 1.1))
  for (let r = 0; r < rows; r++) {
    const wy = 1.1 + r * 1.5
    if (wy > h - 0.6) break
    for (let c = 0; c < cols; c++) {
      const wx = -w / 2 + (c + 0.5) * (w / cols)
      windowsOut.push({ x: px + wx, y: wy, z: pz + d / 2 + 0.02 })
    }
  }
  recordProp(ctx, 'building')
  return g
}

export function buildFence(ctx: Ctx, len = 3.2, hex = 0x2a2d33): THREE.Group {
  const g = newProp('fence')
  const mat = ctx.mats.get(hex, { rough: 0.8, metal: 0.2 })
  const posts = Math.max(2, Math.round(len / 0.8))
  for (let i = 0; i <= posts; i++) {
    g.add(bx(ctx, 0.07, 1.0, 0.07, mat, -len / 2 + (i * len) / posts, 0.5, 0))
  }
  g.add(bx(ctx, len, 0.06, 0.05, mat, 0, 0.55, 0))
  g.add(bx(ctx, len, 0.06, 0.05, mat, 0, 0.9, 0))
  recordProp(ctx, 'fence')
  return g
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — railway
// ---------------------------------------------------------------------------

/**
 * A pair of rails running along Z; sleepers packed into ONE InstancedMesh.
 * `pairX` controls the rail gauge (distance from track center).
 */
export function buildTrackSegment(
  ctx: Ctx,
  len = 16,
  pairX = 1.0,
  y = 0,
  hexRail = 0x6e747d,
  hexSleeper = 0x241d16,
  /** Phase 2.1: sleeper albedo lift for dark station beds (default 1). */
  sleeperTone = 1
): THREE.Group {
  const g = newProp('track')
  const rail = ctx.mats.get(hexRail, { rough: 0.55, metal: 0.85 })
  for (const sx of [-pairX, pairX]) {
    g.add(bx(ctx, 0.09, 0.12, len, rail, sx, y + 0.06, 0))
  }
  const n = Math.max(6, Math.floor(len / 1.4))
  const sleeperGeo = ctx.geos.box(pairX * 2 + 0.35, 0.05, 0.24)
  const placements: Placement[] = []
  for (let i = 0; i < n; i++) {
    const sz = -len / 2 + 0.8 + i * ((len - 1.6) / (n - 1))
    placements.push({ x: 0, y, z: sz })
  }
  const sleeperHex =
    sleeperTone === 1 ? hexSleeper : mixHex(hexSleeper, 0xffffff, Math.min(sleeperTone - 1, 0.6))
  g.add(mkInstanced(ctx, sleeperGeo, ctx.mats.get(sleeperHex, { rough: 0.95 }), placements, 'sleeper'))
  recordProp(ctx, 'track')
  return g
}

export function buildBench(ctx: Ctx, hex = 0x3a2f26): THREE.Group {
  const g = newProp('bench')
  const wood = ctx.mats.get(hex, { rough: 0.85 })
  const iron = ctx.mats.get(0x22262c, { rough: 0.6, metal: 0.4 })
  g.add(bx(ctx, 1.7, 0.07, 0.5, wood, 0, 0.45, 0))
  g.add(bx(ctx, 1.7, 0.5, 0.06, wood, 0, 0.72, -0.24))
  g.add(bx(ctx, 0.07, 0.45, 0.44, iron, -0.75, 0.22, 0))
  g.add(bx(ctx, 0.07, 0.45, 0.44, iron, 0.75, 0.22, 0))
  recordProp(ctx, 'bench')
  return g
}

export function buildStationLight(ctx: Ctx, lit = true): THREE.Group {
  const g = newProp('stationLight')
  const fixture = ctx.mats.get(0x0b0d10, {
    rough: 0.5,
    emissive: lit ? 0xdcecff : 0x111111,
    emissiveIntensity: lit ? 1.4 : 0,
  })
  g.add(bx(ctx, 0.9, 0.08, 0.3, fixture, 0, 0, 0))
  recordProp(ctx, 'station_light')
  return g
}

// ---------------------------------------------------------------------------
// PROP LIBRARY — misc
// ---------------------------------------------------------------------------

export function buildRock(ctx: Ctx, s = 0.5): THREE.Group {
  const g = newProp('rock')
  const m = mkMesh(ctx, ctx.geos.dodeca(s), ctx.mats.get(0x33363d, { rough: 0.95 }), 0, s * 0.55, 0)
  m.scale.set(1 + ctx.rng() * 0.4, 0.6 + ctx.rng() * 0.4, 1 + ctx.rng() * 0.3)
  m.updateMatrix()
  g.add(m)
  recordProp(ctx, 'rock')
  return g
}

export function buildScreen(ctx: Ctx, w = 7.2, h = 2.6): THREE.Group {
  const g = newProp('screen')
  const frame = ctx.mats.get(0x0d1730, { rough: 0.85 })
  // Phase 2.1: news-wall screen emits noticeably more so the broadcast
  // backdrop reads as a LIVE screen from the Two-Shot (still ≤1.5 emissive).
  const face = ctx.mats.get(0x060a14, {
    rough: 0.3,
    emissive: 0x3aa0ff,
    emissiveIntensity: 1.35,
  })
  g.add(bx(ctx, w + 0.3, h + 0.3, 0.12, frame, 0, 0, 0))
  g.add(mkMesh(ctx, ctx.geos.plane(w, h), face, 0, 0, 0.08))
  recordProp(ctx, 'screen')
  return g
}

/** Sign board: dark frame + bright readable slab (no text — pure geometry). */
export function buildSign(
  ctx: Ctx,
  w = 4.4,
  h = 1.6,
  hex = 0x2c2320,
  glow = 0xbfb088
): THREE.Group {
  const g = newProp('sign')
  g.add(bx(ctx, w, h, 0.22, ctx.mats.get(hex), 0, 0, 0))
  g.add(
    mkMesh(
      ctx,
      ctx.geos.plane(w - 0.2, h - 0.2),
      ctx.mats.get(0x0a0608, {
        rough: 0.4,
        emissive: glow,
        // Phase 2.1: signs are identity cues — at night they must GLOW to be
        // read across the set (was 0.9, which vanished into the grade).
        emissiveIntensity: ctx.night ? 1.5 : 0.55,
      }),
      0,
      0,
      0.12
    )
  )
  recordProp(ctx, 'sign')
  return g
}

/** Thin emissive floor strip (studio floor lanes, runway marks). */
export function buildFloorStrip(
  ctx: Ctx,
  w: number,
  l: number,
  hex: number,
  intensity: number,
  x = 0,
  z = 0
): THREE.Mesh {
  const mat = ctx.mats.get(0x05070c, {
    rough: 0.4,
    emissive: hex,
    emissiveIntensity: intensity,
  })
  const strip = bx(ctx, w, 0.02, l, mat, x, 0.015, z)
  recordProp(ctx, 'floor_strip')
  return strip
}

/** Vertical emissive light column (studio side towers). */
export function buildLightColumn(ctx: Ctx, h = 3.2, hex = 0x67e8f9): THREE.Group {
  const g = newProp('lightColumn')
  g.add(bx(ctx, 0.34, 0.08, 0.34, ctx.mats.get(0x0d1118, { rough: 0.6 }), 0, 0.04, 0))
  g.add(
    bx(
      ctx,
      0.12,
      h,
      0.12,
      ctx.mats.get(0x05070c, { rough: 0.4, emissive: hex, emissiveIntensity: 1.3 }),
      0,
      h / 2 + 0.06,
      0
    )
  )
  g.add(bx(ctx, 0.2, 0.06, 0.2, ctx.mats.get(0x0d1118, { rough: 0.6 }), 0, h + 0.09, 0))
  recordProp(ctx, 'light_column')
  return g
}

/** Dark tunnel / arch opening — pure silhouette depth cue. */
export function buildTunnelArch(ctx: Ctx, w = 2.8, h = 3.4): THREE.Group {
  const g = newProp('tunnelArch')
  const concrete = ctx.mats.get(0x2e3238, { rough: 0.9 })
  const void_ = ctx.mats.get(0x030407, { rough: 1 })
  g.add(bx(ctx, w, h, 0.4, void_, 0, h / 2, 0))
  g.add(bx(ctx, w + 0.7, 0.45, 0.55, concrete, 0, h + 0.2, 0.05))
  g.add(bx(ctx, 0.35, h, 0.55, concrete, -(w / 2 + 0.17), h / 2, 0.05))
  g.add(bx(ctx, 0.35, h, 0.55, concrete, w / 2 + 0.17, h / 2, 0.05))
  recordProp(ctx, 'tunnel_arch')
  return g
}

// ---------------------------------------------------------------------------
// Cleanup — full geometry/material disposal of an object subtree
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
    // InstancedMesh carries its own GPU instance buffers — free them too.
    const im = child as THREE.InstancedMesh
    if ((im as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      im.dispose()
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
// Blueprint request helpers (used by the composers)
// ---------------------------------------------------------------------------

export function countIn(list: BlueprintPropRequest[], type: PropType): number {
  return list.find((p) => p.type === type)?.count ?? 0
}

export interface LightRequestLike {
  kind: string
  count: number
  lit: boolean
}

export function lightRequest(
  bp: { lights: Array<{ kind: string; count: number; lit: boolean }> },
  kind: string
): { count: number; lit: boolean } {
  const found = bp.lights.find((l) => l.kind === kind)
  return { count: found?.count ?? 0, lit: found?.lit ?? true }
}