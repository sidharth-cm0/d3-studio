/**
 * Dynamic Environment Compounds — PHASE 3 procedural compound builders.
 *
 * Focused helper module for the Dynamic Environment Builder
 * (dynamicEnvironment.ts). Compound = multiple simple primitives composed
 * into one recognizable silhouette (never a single cube).
 *
 * Reuse contract:
 *  - Builders take the SAME `Ctx` build context used by the Phase 2 prop
 *    library (environmentProps.ts), so MaterialBank / GeometryBank /
 *    mkInstanced / census / safety audits are shared — no duplicate
 *    material or disposal systems.
 *  - All randomness flows from ctx.rng (seeded mulberry32) ⇒ deterministic.
 *  - All materials are MeshStandardMaterials from the per-build MaterialBank
 *    ⇒ VisualStyleController can grade them later. No style is baked in.
 *  - Every builder returns a THREE.Group whose ORIGIN IS AT GROUND LEVEL
 *    (y = 0 at the base) and whose size is the documented REFERENCE size.
 *    The dispatcher scales the group so its world size matches the
 *    ResolvedSceneObject transform (spatial layout stays authoritative).
 */

import * as THREE from 'three'
import { type Ctx, bx, mkMesh, newProp, jitterHex, mixHex, recordProp } from './environmentProps'

// ---------------------------------------------------------------------------
// Compound builders — vehicles / spacecraft
// ---------------------------------------------------------------------------

export interface CompoundOpts {
  /** Wreck/damaged variant: tilted panel, scattered plates, dark exhausts. */
  wreck?: boolean
}

/**
 * Spaceship — fuselage + nose + cockpit + wings + twin engines + tail fin.
 * Reference size: 5.5 w × 2.6 h × 7.0 d (metres).
 */
export function buildSpaceship(ctx: Ctx, opts: { wreck?: boolean } = {}): THREE.Group {
  const g = newProp('spaceship')
  const hullHex = opts.wreck ? 0x5a5148 : 0x6b7280
  const hull = ctx.mats.get(hullHex, { rough: 0.55, metal: 0.65 })
  const dark = ctx.mats.get(0x1a1d24, { rough: 0.6, metal: 0.5 })
  const glassHex = opts.wreck ? 0x0a0f18 : 0x8ab4ff
  const glass = ctx.mats.get(0x0a1220, {
    rough: 0.25,
    metal: 0.3,
    emissive: glassHex,
    emissiveIntensity: opts.wreck ? 0.15 : 0.8,
  })
  const exhaustLit = opts.wreck ? 0x1a1014 : 0x67e8f9

  // Fuselage (lying along Z).
  const fus = mkMesh(ctx, ctx.geos.cyl(1.0, 1.15, 5.2, 10), hull, 0, 1.3, 0.4)
  fus.rotation.x = Math.PI / 2
  fus.updateMatrix()
  g.add(fus)
  // Nose cone (points toward −z / away from camera).
  const nose = mkMesh(ctx, ctx.geos.cone(1.0, 1.8, 10), hull, 0, 1.3, -3.1)
  nose.rotation.x = -Math.PI / 2
  nose.updateMatrix()
  g.add(nose)
  // Cockpit canopy.
  g.add(mkMesh(ctx, ctx.geos.sphere(0.55, 8, 6), glass, 0, 2.0, -1.5))
  // Wings (two swept slabs + tip fins).
  for (const side of [-1, 1]) {
    const wing = mkMesh(ctx, ctx.geos.box(2.1, 0.1, 2.0), hull, side * 1.85, 1.05, 0.9)
    wing.rotation.z = side * -0.12
    wing.updateMatrix()
    g.add(wing)
    g.add(mkMesh(ctx, ctx.geos.box(0.1, 0.7, 1.1), dark, side * 2.7, 1.35, 1.5))
  }
  // Twin engine cylinders + exhaust discs.
  for (const side of [-1, 1]) {
    const eng = mkMesh(ctx, ctx.geos.cyl(0.42, 0.48, 1.7, 8), dark, side * 1.0, 1.15, 2.9)
    eng.rotation.x = Math.PI / 2
    eng.updateMatrix()
    g.add(eng)
    g.add(
      mkMesh(
        ctx,
        ctx.geos.cyl(0.3, 0.3, 0.08, 8),
        ctx.mats.get(0x05070c, {
          rough: 0.4,
          emissive: exhaustLit,
          emissiveIntensity: opts.wreck ? 0.2 : 1.3,
        }),
        side * 1.0,
        1.15,
        3.75
      )
    )
  }
  // Tail fin.
  g.add(mkMesh(ctx, ctx.geos.box(0.12, 1.15, 1.5), hull, 0, 2.35, 2.3))
  // Damaged panel + debris for wreck variants.
  if (opts.wreck) {
    const panel = mkMesh(ctx, ctx.geos.box(1.3, 0.08, 1.7), dark, 1.9, 0.35, -0.6)
    panel.rotation.z = 0.45
    panel.updateMatrix()
    g.add(panel)
    for (let i = 0; i < 3; i++) {
      const plate = mkMesh(
        ctx,
        ctx.geos.box(0.3 + ctx.rng() * 0.3, 0.05, 0.3 + ctx.rng() * 0.3),
        dark,
        (ctx.rng() - 0.5) * 3.4,
        0.06,
        2.2 + ctx.rng() * 1.6
      )
      plate.rotation.y = ctx.rng() * Math.PI
      plate.rotation.z = (ctx.rng() - 0.5) * 0.4
      plate.updateMatrix()
      g.add(plate)
    }
  }
  recordProp(ctx, opts.wreck ? 'spaceship_wreck' : 'spaceship')
  return g
}

/**
 * Lab / scientific machine — base + body + console + screen + pipes +
 * emissive indicators. Reference size: 2.2 w × 2.4 h × 1.4 d.
 */
export function buildLabMachine(ctx: Ctx): THREE.Group {
  const g = newProp('lab_machine')
  const body = ctx.mats.get(0x2b3a4a, { rough: 0.5, metal: 0.55 })
  const dark = ctx.mats.get(0x141a22, { rough: 0.6, metal: 0.4 })
  const screen = ctx.mats.get(0x060a14, {
    rough: 0.3,
    emissive: 0x4fd1c5,
    emissiveIntensity: 1.1,
  })
  const indicator = ctx.mats.get(0x05070c, {
    rough: 0.4,
    emissive: 0x7dd3fc,
    emissiveIntensity: 1.2,
  })
  g.add(mkMesh(ctx, ctx.geos.box(2.2, 0.25, 1.4), dark, 0, 0.125, 0))
  g.add(mkMesh(ctx, ctx.geos.box(1.7, 1.5, 1.05), body, 0, 1.0, -0.1))
  // Angled console deck.
  const deck = mkMesh(ctx, ctx.geos.box(1.9, 0.08, 0.55), body, 0, 1.62, 0.5)
  deck.rotation.x = -0.38
  deck.updateMatrix()
  g.add(deck)
  // Screen.
  const scr = mkMesh(ctx, ctx.geos.box(1.25, 0.7, 0.06), screen, 0, 1.86, 0.32)
  scr.rotation.x = -0.38
  scr.updateMatrix()
  g.add(scr)
  // Side pipes.
  for (const sx of [-0.95, 0.95]) {
    g.add(mkMesh(ctx, ctx.geos.cyl(0.09, 0.09, 1.9, 6), dark, sx, 1.35, -0.35))
  }
  // Emissive indicators on the body front.
  for (let i = 0; i < 3; i++) {
    g.add(mkMesh(ctx, ctx.geos.box(0.12, 0.07, 0.04), indicator, -0.4 + i * 0.4, 0.75, 0.44))
  }
  // Top apparatus cylinder.
  g.add(mkMesh(ctx, ctx.geos.cyl(0.26, 0.32, 0.55, 8), body, 0.45, 2.0, -0.2))
  recordProp(ctx, 'lab_machine')
  return g
}

// ---------------------------------------------------------------------------
// Compound builders — furniture / fixtures
// ---------------------------------------------------------------------------

/**
 * Counter — top + front panel + ends + kick + emissive service strip.
 * Reference size: 2.6 w × 1.05 h × 0.7 d.
 */
export function buildCounter(ctx: Ctx, hex = 0x4a3a30): THREE.Group {
  const g = newProp('counter')
  const wood = ctx.mats.get(hex, { rough: 0.7 })
  const dark = ctx.mats.get(0x241d16, { rough: 0.85 })
  const strip = ctx.mats.get(0x05070c, {
    rough: 0.4,
    emissive: 0xc9a06a,
    emissiveIntensity: 0.9,
  })
  g.add(mkMesh(ctx, ctx.geos.box(2.6, 0.09, 0.7), wood, 0, 1.02, 0))
  g.add(mkMesh(ctx, ctx.geos.box(2.44, 0.85, 0.08), dark, 0, 0.52, 0.31))
  for (const sx of [-1.26, 1.26]) {
    g.add(mkMesh(ctx, ctx.geos.box(0.08, 1.0, 0.7), dark, sx, 0.5, 0))
  }
  g.add(mkMesh(ctx, ctx.geos.box(2.4, 0.12, 0.6), dark, 0, 0.06, 0))
  g.add(mkMesh(ctx, ctx.geos.box(2.6, 0.08, 0.05), wood, 0, 1.1, -0.33))
  g.add(mkMesh(ctx, ctx.geos.box(2.3, 0.04, 0.03), strip, 0, 0.96, 0.36))
  recordProp(ctx, 'counter')
  return g
}

/**
 * Control console — base + angled screen + side panels + buttons.
 * Reference size: 1.4 w × 1.1 h × 0.6 d.
 */
export function buildConsole(ctx: Ctx, glowHex = 0x4fd1c5): THREE.Group {
  const g = newProp('console')
  const body = ctx.mats.get(0x232a33, { rough: 0.55, metal: 0.5 })
  const screen = ctx.mats.get(0x060a14, {
    rough: 0.3,
    emissive: glowHex,
    emissiveIntensity: 1.05,
  })
  g.add(mkMesh(ctx, ctx.geos.box(1.4, 0.5, 0.55), body, 0, 0.25, 0))
  const slope = mkMesh(ctx, ctx.geos.box(1.4, 0.08, 0.6), body, 0, 0.68, 0.08)
  slope.rotation.x = -0.42
  slope.updateMatrix()
  g.add(slope)
  const scr = mkMesh(ctx, ctx.geos.box(1.1, 0.5, 0.05), screen, 0, 0.88, 0.06)
  scr.rotation.x = -0.42
  scr.updateMatrix()
  g.add(scr)
  for (const sx of [-0.68, 0.68]) {
    g.add(mkMesh(ctx, ctx.geos.box(0.06, 0.62, 0.5), body, sx, 0.55, 0))
  }
  for (let i = 0; i < 3; i++) {
    g.add(
      mkMesh(
        ctx,
        ctx.geos.box(0.09, 0.05, 0.04),
        ctx.mats.get(0x05070c, { rough: 0.4, emissive: glowHex, emissiveIntensity: 0.9 }),
        -0.3 + i * 0.3,
        0.56,
        0.24
      )
    )
  }
  recordProp(ctx, 'console')
  return g
}

/** Small monitor screen (frame + emissive face). Reference: 1.4 × 0.9 × 0.12. */
export function buildMonitor(ctx: Ctx, w = 1.4, h = 0.9, glowHex = 0x7dd3fc): THREE.Group {
  const g = newProp('monitor')
  const frame = ctx.mats.get(0x10141b, { rough: 0.6, metal: 0.4 })
  const face = ctx.mats.get(0x060a14, {
    rough: 0.3,
    emissive: glowHex,
    emissiveIntensity: 1.0,
  })
  g.add(mkMesh(ctx, ctx.geos.box(w + 0.12, h + 0.12, 0.1), frame, 0, h / 2 + 0.06, 0))
  g.add(mkMesh(ctx, ctx.geos.plane(w, h), face, 0, h / 2 + 0.06, 0.06))
  g.add(mkMesh(ctx, ctx.geos.box(0.1, 0.12, 0.1), frame, 0, 0.06, 0))
  recordProp(ctx, 'monitor')
  return g
}

/** Bed — frame + mattress + pillow + headboard. Reference: 1.0 × 0.6 × 2.0. */
export function buildBed(ctx: Ctx, hex = 0x4a3a30): THREE.Group {
  const g = newProp('bed')
  const frame = ctx.mats.get(0x3a2f26, { rough: 0.85 })
  const mattress = ctx.mats.get(hex, { rough: 0.95 })
  g.add(mkMesh(ctx, ctx.geos.box(1.0, 0.28, 2.0), frame, 0, 0.14, 0))
  g.add(mkMesh(ctx, ctx.geos.box(0.94, 0.18, 1.9), mattress, 0, 0.37, 0.03))
  g.add(mkMesh(ctx, ctx.geos.box(0.6, 0.1, 0.35), ctx.mats.get(0xd8d2c4, { rough: 0.95 }), 0, 0.5, -0.68))
  g.add(mkMesh(ctx, ctx.geos.box(1.0, 0.7, 0.08), frame, 0, 0.55, -0.96))
  recordProp(ctx, 'bed')
  return g
}

// ---------------------------------------------------------------------------
// Compound builders — nature / terrain
// ---------------------------------------------------------------------------

/** Crystal cluster — tilted emissive spikes. Reference: 0.5 × 1.1 × 0.5. */
export function buildCrystal(ctx: Ctx, glowHex = 0x67e8f9): THREE.Group {
  const g = newProp('crystal')
  const mat = ctx.mats.get(0x0a2030, {
    rough: 0.3,
    metal: 0.2,
    emissive: glowHex,
    emissiveIntensity: 1.0,
  })
  const main = mkMesh(ctx, ctx.geos.cone(0.2, 0.9, 5), mat, 0, 0.42, 0)
  main.rotation.z = (ctx.rng() - 0.5) * 0.3
  main.updateMatrix()
  g.add(main)
  const second = mkMesh(ctx, ctx.geos.cone(0.13, 0.55, 5), mat, 0.16, 0.26, 0.08)
  second.rotation.z = -0.35 - ctx.rng() * 0.2
  second.updateMatrix()
  g.add(second)
  const third = mkMesh(ctx, ctx.geos.cone(0.1, 0.4, 5), mat, -0.15, 0.2, 0.08)
  third.rotation.z = 0.4 + ctx.rng() * 0.2
  third.updateMatrix()
  g.add(third)
  recordProp(ctx, 'crystal')
  return g
}

/** Rock formation — stacked/clustered boulders. Reference: 2.4 × 3.2 × 2.0. */
export function buildRockFormation(ctx: Ctx, hex = 0x3d4148): THREE.Group {
  const g = newProp('rock_formation')
  const mat = ctx.mats.get(hex, { rough: 0.95 })
  const spots: Array<[number, number, number, number]> = [
    [0, 0.85, 0, 1.05],
    [0.35, 2.0, 0.1, 0.72],
    [-0.25, 2.85, 0.05, 0.55],
    [-0.95, 0.55, 0.35, 0.6],
  ]
  for (const [x, y, z, r] of spots) {
    const rock = mkMesh(ctx, ctx.geos.dodeca(r), mat, x, y, z)
    rock.scale.set(1 + ctx.rng() * 0.25, 0.75 + ctx.rng() * 0.3, 1 + ctx.rng() * 0.2)
    rock.rotation.y = ctx.rng() * Math.PI
    rock.updateMatrix()
    g.add(rock)
  }
  recordProp(ctx, 'rock_formation')
  return g
}

/** Sand dune — squashed sphere. Reference: 4.0 × 1.2 × 3.0. */
export function buildDune(ctx: Ctx, hex = 0xc9a06a): THREE.Group {
  const g = newProp('dune')
  const m = mkMesh(ctx, ctx.geos.sphere(1, 9, 6), ctx.mats.get(hex, { rough: 1 }), 0, 0.42, 0)
  m.scale.set(2.0, 0.62, 1.5)
  m.updateMatrix()
  g.add(m)
  recordProp(ctx, 'dune')
  return g
}

/** Crater — dark pit disc + rock rim. Reference: 2.6 × 0.5 × 2.6. */
export function buildCrater(ctx: Ctx, hex = 0x3a2a22): THREE.Group {
  const g = newProp('crater')
  g.add(mkMesh(ctx, ctx.geos.cyl(1.15, 1.25, 0.06, 12), ctx.mats.get(0x0d0906, { rough: 1 }), 0, 0.035, 0))
  const rim = ctx.mats.get(hex, { rough: 0.95 })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + ctx.rng() * 0.4
    const r = 1.15 + ctx.rng() * 0.15
    const rock = mkMesh(ctx, ctx.geos.dodeca(0.16 + ctx.rng() * 0.1), rim, Math.cos(a) * r, 0.1, Math.sin(a) * r)
    rock.rotation.y = ctx.rng() * Math.PI
    rock.updateMatrix()
    g.add(rock)
  }
  recordProp(ctx, 'crater')
  return g
}

/** Stalagmite — stacked cones. Reference: 0.7 × 1.6 × 0.7. */
export function buildStalagmite(ctx: Ctx, hex = 0x4a453e): THREE.Group {
  const g = newProp('stalagmite')
  const mat = ctx.mats.get(hex, { rough: 0.9 })
  g.add(mkMesh(ctx, ctx.geos.cone(0.32, 1.35, 7), mat, 0, 0.68, 0))
  const tip = mkMesh(ctx, ctx.geos.cone(0.16, 0.6, 6), mat, 0.1, 1.35, 0.04)
  tip.rotation.z = -0.18
  tip.updateMatrix()
  g.add(tip)
  recordProp(ctx, 'stalagmite')
  return g
}

/** Debris pile — tilted plates and chunks. Reference: 0.6 × 0.4 × 0.6. */
export function buildDebris(ctx: Ctx, hex = 0x2a2620): THREE.Group {
  const g = newProp('debris')
  const mat = ctx.mats.get(hex, { rough: 0.95 })
  for (let i = 0; i < 3; i++) {
    const chunk = mkMesh(
      ctx,
      ctx.geos.box(0.28 + ctx.rng() * 0.22, 0.06 + ctx.rng() * 0.08, 0.28 + ctx.rng() * 0.22),
      mat,
      (ctx.rng() - 0.5) * 0.4,
      0.06 + i * 0.09,
      (ctx.rng() - 0.5) * 0.4
    )
    chunk.rotation.y = ctx.rng() * Math.PI
    chunk.rotation.z = (ctx.rng() - 0.5) * 0.5
    chunk.updateMatrix()
    g.add(chunk)
  }
  recordProp(ctx, 'debris')
  return g
}

/** Campfire — stone ring + crossed logs + emissive flame. Reference: 0.9 × 0.5 × 0.9. */
export function buildCampfire(ctx: Ctx, lit = true): THREE.Group {
  const g = newProp('campfire')
  const stone = ctx.mats.get(0x33363d, { rough: 0.95 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + ctx.rng() * 0.5
    g.add(mkMesh(ctx, ctx.geos.dodeca(0.11), stone, Math.cos(a) * 0.38, 0.09, Math.sin(a) * 0.38))
  }
  const log = ctx.mats.get(0x4a3826, { rough: 0.95 })
  for (const rz of [0.5, -0.5]) {
    const l = mkMesh(ctx, ctx.geos.cyl(0.06, 0.07, 0.7, 6), log, 0, 0.1, 0)
    l.rotation.z = Math.PI / 2 + rz
    l.updateMatrix()
    g.add(l)
  }
  const flameHex = lit ? 0xffb36b : 0x1a120c
  g.add(
    mkMesh(
      ctx,
      ctx.geos.cone(0.16, 0.38, 6),
      ctx.mats.get(0x05070c, {
        rough: 0.5,
        emissive: flameHex,
        emissiveIntensity: lit ? 1.4 : 0.1,
      }),
      0,
      0.3,
      0
    )
  )
  recordProp(ctx, lit ? 'campfire_lit' : 'campfire_dark')
  return g
}

/** Tent — A-frame. Reference: 2.2 × 1.6 × 2.2. */
export function buildTent(ctx: Ctx, hex = 0x5c564c): THREE.Group {
  const g = newProp('tent')
  const mat = ctx.mats.get(hex, { rough: 0.95 })
  for (const rx of [0.62, -0.62]) {
    const panel = mkMesh(ctx, ctx.geos.box(1.9, 0.06, 2.0), mat, 0, 0.62, 0)
    panel.rotation.x = rx
    panel.updateMatrix()
    g.add(panel)
  }
  g.add(mkMesh(ctx, ctx.geos.box(1.9, 1.1, 0.06), ctx.mats.get(0x2a2620, { rough: 1 }), 0, 0.55, -0.92))
  recordProp(ctx, 'tent')
  return g
}

/** Statue — pedestal + body + head. Reference: 0.9 × 2.4 × 0.9. */
export function buildStatue(ctx: Ctx, hex = 0x7a7264): THREE.Group {
  const g = newProp('statue')
  const stone = ctx.mats.get(hex, { rough: 0.85 })
  g.add(mkMesh(ctx, ctx.geos.box(0.9, 0.5, 0.9), stone, 0, 0.25, 0))
  g.add(mkMesh(ctx, ctx.geos.cyl(0.22, 0.3, 1.3, 8), stone, 0, 1.2, 0))
  g.add(mkMesh(ctx, ctx.geos.sphere(0.22, 8, 6), stone, 0, 2.0, 0))
  g.add(mkMesh(ctx, ctx.geos.box(0.62, 0.14, 0.2), stone, 0, 1.72, 0))
  recordProp(ctx, 'statue')
  return g
}

// ---------------------------------------------------------------------------
// Compound builders — unknown / generic semantic types
// ---------------------------------------------------------------------------

/**
 * Alien artifact (unknown hero) — pedestal + floating emissive core +
 * two orbit rings. Reference: 0.9 × 1.6 × 0.9.
 */
export function buildArtifact(ctx: Ctx, glowHex = 0x67e8f9): THREE.Group {
  const g = newProp('artifact')
  const pedestal = ctx.mats.get(0x2a2d33, { rough: 0.7, metal: 0.3 })
  const core = ctx.mats.get(0x0a2030, {
    rough: 0.25,
    emissive: glowHex,
    emissiveIntensity: 1.35,
  })
  g.add(mkMesh(ctx, ctx.geos.cyl(0.34, 0.42, 0.8, 8), pedestal, 0, 0.4, 0))
  g.add(mkMesh(ctx, ctx.geos.cyl(0.44, 0.44, 0.07, 8), pedestal, 0, 0.84, 0))
  g.add(mkMesh(ctx, ctx.geos.ico(0.26, 0), core, 0, 1.2, 0))
  // Orbit rings — unique low-poly tori (disposed with the build).
  for (const [r, rx] of [[0.44, 0.5], [0.56, -0.9]] as Array<[number, number]>) {
    const ringGeo = new THREE.TorusGeometry(r, 0.025, 5, 18)
    const ring = new THREE.Mesh(ringGeo, pedestal)
    ring.position.set(0, 1.2, 0)
    ring.rotation.x = Math.PI / 2 + rx * 0.4
    ring.rotation.y = rx
    ring.matrixAutoUpdate = false
    ring.updateMatrix()
    ctx.count++
    g.add(ring)
  }
  recordProp(ctx, 'artifact')
  return g
}

/**
 * Generic compound fallback — stacked silhouette (base + body + top) with
 * seeded variation. Used for unknown compoundHint types. Reference ≈ 1.2³.
 */
export function buildGenericCompound(ctx: Ctx, hex = 0x4a505a): THREE.Group {
  const g = newProp('generic_compound')
  const base = ctx.mats.get(hex, { rough: 0.8 })
  const dark = ctx.mats.get(mixHex(hex, 0x000000, 0.25), { rough: 0.85 })
  const w = 0.9 + ctx.rng() * 0.3
  g.add(mkMesh(ctx, ctx.geos.box(1.1, 0.35, 1.0), base, 0, 0.175, 0))
  g.add(mkMesh(ctx, ctx.geos.box(w, 0.55, 0.85), dark, (ctx.rng() - 0.5) * 0.1, 0.62, 0))
  g.add(mkMesh(ctx, ctx.geos.box(w * 0.6, 0.3, 0.55), base, (ctx.rng() - 0.5) * 0.2, 1.05, 0))
  if (ctx.rng() > 0.5) {
    g.add(
      mkMesh(
        ctx,
        ctx.geos.cyl(0.06, 0.06, 0.4, 5),
        dark,
        (ctx.rng() - 0.5) * 0.5,
        1.35,
        0
      )
    )
  }
  recordProp(ctx, 'generic_compound')
  return g
}

// ---------------------------------------------------------------------------
// Compound builders — vehicles / misc
// ---------------------------------------------------------------------------

/** Ground vehicle — body + cabin + wheels. Reference: 2.0 × 1.5 × 4.4. */
export function buildVehicle(ctx: Ctx, hex = 0x3a3f47): THREE.Group {
  const g = newProp('vehicle')
  const body = ctx.mats.get(hex, { rough: 0.5, metal: 0.5 })
  const dark = ctx.mats.get(0x14161a, { rough: 0.8 })
  g.add(mkMesh(ctx, ctx.geos.box(2.0, 0.6, 4.4), body, 0, 0.62, 0))
  g.add(mkMesh(ctx, ctx.geos.box(1.7, 0.55, 2.0), body, 0, 1.18, -0.2))
  g.add(mkMesh(ctx, ctx.geos.box(1.72, 0.4, 0.06), ctx.mats.get(0x0a1220, { rough: 0.3 }), 0, 1.12, 0.82))
  for (const [wx, wz] of [[-0.95, -1.4], [0.95, -1.4], [-0.95, 1.4], [0.95, 1.4]] as Array<[number, number]>) {
    const wheel = mkMesh(ctx, ctx.geos.cyl(0.32, 0.32, 0.22, 10), dark, wx, 0.32, wz)
    wheel.rotation.z = Math.PI / 2
    wheel.updateMatrix()
    g.add(wheel)
  }
  recordProp(ctx, 'vehicle')
  return g
}

/** Stairs — stacked steps. Reference: 1.6 × 1.2 × 1.4. */
export function buildStairs(ctx: Ctx, hex = 0x3a3f47): THREE.Group {
  const g = newProp('stairs')
  const mat = ctx.mats.get(hex, { rough: 0.9 })
  const steps = 4
  for (let i = 0; i < steps; i++) {
    const h = ((i + 1) / steps) * 1.2
    g.add(mkMesh(ctx, ctx.geos.box(1.6, 1.2 / steps, 1.4 / steps), mat, 0, (i + 0.5) * (1.2 / steps), 0.7 - (i + 0.5) * (1.4 / steps)))
  }
  recordProp(ctx, 'stairs')
  return g
}

/** Potted plant — pot + trunk + foliage. Reference: 0.5 × 1.0 × 0.5. */
export function buildPottedPlant(ctx: Ctx): THREE.Group {
  const g = newProp('potted_plant')
  const pot = ctx.mats.get(0x5c4531, { rough: 0.9 })
  const leaf = ctx.mats.get(0x1e5332, { rough: 1 })
  g.add(mkMesh(ctx, ctx.geos.cyl(0.14, 0.18, 0.26, 8), pot, 0, 0.13, 0))
  g.add(mkMesh(ctx, ctx.geos.cyl(0.03, 0.04, 0.4, 5), ctx.mats.get(0x4a3826, { rough: 0.95 }), 0, 0.44, 0))
  const crown = mkMesh(ctx, ctx.geos.ico(0.22, 0), leaf, 0, 0.74, 0)
  crown.scale.set(1 + ctx.rng() * 0.2, 0.9, 1 + ctx.rng() * 0.2)
  crown.updateMatrix()
  g.add(crown)
  recordProp(ctx, 'plant')
  return g
}

/** Indoor floor lamp — pole + emissive shade. Reference: 0.45 × 1.7 × 0.45. */
export function buildFloorLamp(ctx: Ctx, lit = true, glowHex = 0xffd9a0): THREE.Group {
  const g = newProp('floor_lamp')
  g.add(mkMesh(ctx, ctx.geos.cyl(0.03, 0.05, 1.5, 6), ctx.mats.get(0x22262c, { rough: 0.5, metal: 0.5 }), 0, 0.75, 0))
  g.add(
    mkMesh(
      ctx,
      ctx.geos.cyl(0.14, 0.2, 0.3, 10),
      ctx.mats.get(0x2a2018, {
        rough: 0.6,
        emissive: lit ? glowHex : 0x111111,
        emissiveIntensity: lit ? 1.3 : 0,
      }),
      0,
      1.6,
      0
    )
  )
  recordProp(ctx, lit ? 'lamp_lit' : 'lamp_dark')
  return g
}

/**
 * Boat / rowboat — hull + keel + bench seats + optional mast.
 * Wreck variant: broken hull, tilted, half-sunk plates.
 * Reference: 3.2 w × 1.4 h × 1.4 d.
 */
export function buildBoat(ctx: Ctx, hex = 0x5c4531, opts: { wreck?: boolean } = {}): THREE.Group {
  const g = newProp('boat')
  const hullHex = opts.wreck ? mixHex(hex, 0x000000, 0.35) : hex
  const hull = ctx.mats.get(hullHex, { rough: 0.85 })
  const dark = ctx.mats.get(mixHex(hullHex, 0x000000, 0.3), { rough: 0.9 })
  const len = 3.2
  // Hull: two tapered sides + bow/stern caps + flat keel.
  for (const side of [-1, 1]) {
    const wall = mkMesh(ctx, ctx.geos.box(len, 0.5, 0.09), hull, 0, 0.42, side * 0.42)
    wall.rotation.x = side * 0.22
    wall.updateMatrix()
    g.add(wall)
  }
  g.add(mkMesh(ctx, ctx.geos.box(len, 0.1, 0.9), dark, 0, 0.12, 0))
  // Bow (tapered, points −z) + stern cap.
  const bow = mkMesh(ctx, ctx.geos.cone(0.48, 0.9, 4), hull, 0, 0.42, -len / 2 - 0.2)
  bow.rotation.x = -Math.PI / 2
  bow.rotation.y = Math.PI / 4
  bow.updateMatrix()
  g.add(bow)
  g.add(mkMesh(ctx, ctx.geos.box(0.12, 0.5, 0.9), hull, len / 2, 0.42, 0))
  // Bench seats.
  for (const bx2 of [-0.8, 0.1, 1.0]) {
    g.add(mkMesh(ctx, ctx.geos.box(0.28, 0.07, 0.8), dark, bx2, 0.62, 0))
  }
  if (opts.wreck) {
    // Broken gunwale + spilled plank.
    const broken = mkMesh(ctx, ctx.geos.box(0.7, 0.4, 0.09), dark, 0.9, 0.3, -0.5)
    broken.rotation.z = 0.5
    broken.updateMatrix()
    g.add(broken)
    const plank = mkMesh(ctx, ctx.geos.box(0.9, 0.06, 0.2), dark, -0.6, 0.05, 0.9)
    plank.rotation.y = ctx.rng() * Math.PI
    plank.updateMatrix()
    g.add(plank)
  } else {
    // Simple mast + boom.
    g.add(mkMesh(ctx, ctx.geos.cyl(0.05, 0.07, 2.2, 6), dark, -0.3, 1.6, 0))
    const boom = mkMesh(ctx, ctx.geos.cyl(0.03, 0.03, 1.2, 5), dark, -0.3, 2.4, 0)
    boom.rotation.z = Math.PI / 2
    boom.updateMatrix()
    g.add(boom)
  }
  recordProp(ctx, opts.wreck ? 'boat_wreck' : 'boat')
  return g
}

/**
 * House / village hut — walls + gable roof + door + window + chimney.
 * Ruined variant: collapsed roof panel, broken wall, no chimney.
 * Reference: 3.4 w × 3.0 h × 3.0 d.
 */
export function buildHouse(ctx: Ctx, hex = 0x6b5a44, opts: { ruined?: boolean; lit?: boolean } = {}): THREE.Group {
  const g = newProp('house')
  const wall = ctx.mats.get(jitterHex(hex, ctx.rng, 0.14), { rough: 0.92 })
  const roofHex = mixHex(hex, 0x2a1e14, 0.45)
  const roof = ctx.mats.get(roofHex, { rough: 0.9 })
  const dark = ctx.mats.get(mixHex(hex, 0x000000, 0.5), { rough: 0.92 })
  const lit = opts.lit !== false && !opts.ruined
  const win = ctx.mats.get(0x0a0e18, {
    rough: 0.4,
    emissive: lit ? 0xe8c47a : 0x0a0e18,
    emissiveIntensity: lit ? 0.85 : 0.05,
  })
  const w = 3.4
  const h = 2.1
  const d = 3.0
  // Four walls (front face toward +z / camera).
  g.add(mkMesh(ctx, ctx.geos.box(w, h, 0.16), wall, 0, h / 2, d / 2))
  g.add(mkMesh(ctx, ctx.geos.box(w, h, 0.16), wall, 0, h / 2, -d / 2))
  g.add(mkMesh(ctx, ctx.geos.box(0.16, h, d), wall, -w / 2, h / 2, 0))
  g.add(mkMesh(ctx, ctx.geos.box(0.16, h, d), wall, w / 2, h / 2, 0))
  // Gable roof: two slabs meeting at a ridge along X.
  const roofLen = w + 0.5
  for (const side of [-1, 1]) {
    const slab = mkMesh(ctx, ctx.geos.box(roofLen, 0.12, d * 0.72), roof, 0, h + 0.62, side * d * 0.27)
    slab.rotation.x = side * 0.62
    slab.updateMatrix()
    g.add(slab)
  }
  // Door + window on the front face.
  g.add(mkMesh(ctx, ctx.geos.box(0.62, 1.25, 0.08), dark, -0.8, 0.62, d / 2 + 0.05))
  g.add(mkMesh(ctx, ctx.geos.box(0.7, 0.6, 0.06), win, 0.8, 1.25, d / 2 + 0.05))
  if (opts.ruined) {
    // Collapsed roof corner + rubble spill + broken wall notch.
    const fallen = mkMesh(ctx, ctx.geos.box(1.6, 0.12, 1.4), roof, 1.4, 0.1, d / 2 + 0.9)
    fallen.rotation.z = 0.28
    fallen.rotation.y = ctx.rng() * 0.6
    fallen.updateMatrix()
    g.add(fallen)
    for (let i = 0; i < 4; i++) {
      const chunk = mkMesh(
        ctx,
        ctx.geos.dodeca(0.14 + ctx.rng() * 0.12),
        wall,
        (ctx.rng() - 0.5) * 2.4,
        0.1,
        d / 2 + 0.4 + ctx.rng() * 0.9
      )
      chunk.rotation.y = ctx.rng() * Math.PI
      chunk.updateMatrix()
      g.add(chunk)
    }
  } else {
    // Chimney + smoke cap.
    g.add(mkMesh(ctx, ctx.geos.box(0.34, 0.9, 0.34), ctx.mats.get(mixHex(hex, 0x000000, 0.4), { rough: 0.95 }), 1.1, h + 0.95, -0.5))
  }
  recordProp(ctx, opts.ruined ? 'house_ruined' : 'house')
  return g
}

/**
 * Glowing flora cluster — emissive fronds/spores on dark stalks.
 * Used when a story requests glowing plants / bioluminescent vegetation.
 * Reference: 0.7 w × 1.3 h × 0.7 d.
 */
export function buildGlowFlora(ctx: Ctx, glowHex = 0x67e8f9): THREE.Group {
  const g = newProp('glow_flora')
  const stalk = ctx.mats.get(0x14231c, { rough: 0.95 })
  const glow = ctx.mats.get(0x0a2030, {
    rough: 0.35,
    emissive: glowHex,
    emissiveIntensity: 1.15,
  })
  for (let i = 0; i < 3; i++) {
    const x = (ctx.rng() - 0.5) * 0.4
    const z = (ctx.rng() - 0.5) * 0.4
    const h = 0.7 + ctx.rng() * 0.6
    g.add(mkMesh(ctx, ctx.geos.cyl(0.03, 0.05, h, 5), stalk, x, h / 2, z))
    const bulb = mkMesh(ctx, ctx.geos.ico(0.12 + ctx.rng() * 0.08, 0), glow, x, h + 0.08, z)
    bulb.scale.y = 1.3
    bulb.updateMatrix()
    g.add(bulb)
  }
  // Ground spores.
  for (let i = 0; i < 2; i++) {
    g.add(
      mkMesh(
        ctx,
        ctx.geos.ico(0.07, 0),
        glow,
        (ctx.rng() - 0.5) * 0.6,
        0.07,
        (ctx.rng() - 0.5) * 0.6
      )
    )
  }
  recordProp(ctx, 'glow_flora')
  return g
}

/**
 * Stone altar — stepped base + slab + candle emissives.
 * Reference: 1.6 w × 1.1 h × 1.0 d.
 */
export function buildAltar(ctx: Ctx, hex = 0x7a7264, glowHex = 0xffb36b): THREE.Group {
  const g = newProp('altar')
  const stone = ctx.mats.get(hex, { rough: 0.88 })
  const flame = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: glowHex,
    emissiveIntensity: 1.25,
  })
  g.add(mkMesh(ctx, ctx.geos.box(1.6, 0.3, 1.0), stone, 0, 0.15, 0))
  g.add(mkMesh(ctx, ctx.geos.box(1.3, 0.28, 0.8), stone, 0, 0.44, 0))
  g.add(mkMesh(ctx, ctx.geos.box(1.5, 0.12, 0.95), stone, 0, 0.64, 0))
  // Two candle flames on the slab.
  for (const sx of [-0.5, 0.5]) {
    g.add(mkMesh(ctx, ctx.geos.cyl(0.05, 0.06, 0.18, 6), stone, sx, 0.79, 0))
    g.add(mkMesh(ctx, ctx.geos.cone(0.05, 0.14, 5), flame, sx, 0.94, 0))
  }
  recordProp(ctx, 'altar')
  return g
}

/** Simple multi-storey building block — body + window strips + roof lip. Reference: 10 × 8 × 8. */
export function buildBuildingBlock(ctx: Ctx, hex = 0x32353d, litWindows = true): THREE.Group {
  const g = newProp('building')
  const wall = ctx.mats.get(jitterHex(hex, ctx.rng, 0.18), { rough: 0.9 })
  const win = ctx.mats.get(0x0a0e18, {
    rough: 0.4,
    emissive: litWindows ? 0xe8c47a : 0x0a0e18,
    emissiveIntensity: litWindows ? 0.85 : 0.05,
  })
  g.add(mkMesh(ctx, ctx.geos.box(10, 8, 8), wall, 0, 4, 0))
  g.add(mkMesh(ctx, ctx.geos.box(10.4, 0.3, 8.3), ctx.mats.get(mixHex(hex, 0x000000, 0.25), { rough: 0.9 }), 0, 8.1, 0))
  for (const [y, z] of [[2.4, 4.02], [4.6, 4.02], [6.8, 4.02]] as Array<[number, number]>) {
    g.add(mkMesh(ctx, ctx.geos.box(7.5, 0.7, 0.06), win, 0, y, z))
  }
  recordProp(ctx, 'building')
  return g
}