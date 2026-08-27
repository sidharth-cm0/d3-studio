/**
 * Environment Stage — Three.js side of the PROCEDURAL ENVIRONMENT BUILDER.
 * PHASE 2: structured zoned composition (near/mid/far depth layers).
 *
 *   ResolvedEnvironment.blueprint (from environmentResolver.ts)
 *     → PROP LIBRARY       — environmentProps.ts (shared low-poly builders,
 *                            GeometryBank, MaterialBank, mkInstanced)
 *     → LAYOUT ZONES       — camera-aware depth layers computed from the real
 *                            camera: camera sits at (0, ~1.55, +2.8) looking at
 *                            the actor pivot at origin, FOV ~40° (16:9).
 *                            Visible half-width at depth z ≈ (2.8 − z) · 0.62.
 *     → SEEDED PLACEMENT   — deterministic rejection sampling (mulberry32 from
 *                            scene/location id — same scene ⇒ same layout).
 *     → CATEGORY COMPOSERS — forest · warehouse · railway · apartment ·
 *                            broadcast · office · interior · street
 *     → buildEnvironmentGroup() — one disposable THREE.Group carrying
 *                            userData stats (mesh/instance counts, prop
 *                            census, safety-audit results).
 *     → disposeObjectDeep()     — full geometry/material cleanup on switch.
 *
 * Phase 2 visual contract (recognizable PLACE, not colored background):
 *  - EVERY environment renders ≥3 depth layers: NEAR dressing at the frame
 *    edges, MIDGROUND structures behind the actor zone, FAR silhouettes
 *    sinking into fog. Never a flat backdrop.
 *  - Actor-safe rectangle (±2.5, −1.5…+1.5 around origin) and the
 *    camera↔actor sightline stay geometry-free; registerFootprint() audits
 *    every prop and counts violations into group.userData.
 *  - Semantic prop registry: every prop records a census entry (tree, rock,
 *    crate, bench…) — traces/tests verify REAL composition, not colors.
 *
 * Performance contract (older MacBook):
 *  - Primitives ONLY; GeometryBank shares buffers; repeated props (trees,
 *    rocks, crates, sleepers, windows…) collapse into InstancedMeshes.
 *  - Shared materials per build (MaterialBank); static matrices
 *    (matrixAutoUpdate=false); no lights/textures/listeners/loops here.
 */

import * as THREE from 'three'
import type { ResolvedEnvironment } from './environmentResolver'
import {
  type Ctx,
  type Placement,
  type Zone,
  ZONES,
  bx,
  buildBench,
  buildBookRow,
  buildBuilding,
  buildCabinet,
  buildChair,
  buildDesk,
  buildDoorway,
  buildFence,
  buildFloorStrip,
  buildFloorMesh,
  buildLightColumn,
  buildLampPost,
  buildPictureFrame,
  buildPlatform,
  buildPipe,
  buildRoad,
  buildScreen,
  buildShelf,
  buildSidePanel,
  buildSign,
  buildSidewalk,
  buildSofa,
  buildTable,
  buildTrackSegment,
  buildTree,
  buildTunnelArch,
  buildWall,
  buildWindow,
  countIn,
  jitterHex,
  mixHex,
  mkInstanced,
  mkMesh,
  mulberry32,
  newProp,
  placeInZone,
  recordProp,
  registerFootprint,
  registerOccluder,
  MaterialBank,
  GeometryBank,
} from './environmentProps'
import { assetCategoryForLocation } from './environmentAssetLibrary'
import type { SemanticAssetId } from './environmentAssetLibrary'
import { environmentAssetLoader } from './environmentAssetLoader'

// Re-export for App.tsx / self-test compatibility.
export { disposeObjectDeep } from './environmentProps'
import { disposeObjectDeep } from './environmentProps'

// ---------------------------------------------------------------------------
// Asset-supply helpers — SEMANTIC slot tagging + async GLB overlay pass
// ---------------------------------------------------------------------------
//
// The composer builds the FULL procedural environment synchronously (that is
// the baseline look). Hero props are tagged with an `assetSlot` semantic id
// (e.g. "crate", "tree_01") at the placement site. After the group is built,
// attachAssetOverlays() tries to load the matching local GLB/GLTF for every
// slot (cached by URL, parsed once per asset). If the file exists, an instance
// is cloned and placed at the exact same position/rotation as the procedural
// prop it replaces, and the procedural prop is hidden. If the file is MISSING
// (or fails), the procedural prop REMAINS VISIBLE — the existing primitive is
// the automatic fallback. Assets assist; they never replace the engine.

function tagAssetSlot(obj: THREE.Object3D, slot: SemanticAssetId): void {
  obj.userData.assetSlot = slot
}

async function attachAssetOverlays(
  group: THREE.Group,
  env: ResolvedEnvironment
): Promise<void> {
  const category = assetCategoryForLocation(env.locationKind)
  if (!category) return // stage / alley have no bespoke asset library

  const tagged = new Map<SemanticAssetId, THREE.Object3D[]>()
  group.traverse((obj) => {
    const slot = obj.userData.assetSlot as SemanticAssetId | undefined
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
        clone.position.copy(src.position)
        clone.rotation.copy(src.rotation)
        src.visible = false
        src.parent?.add(clone)
      })
    })
  )
}

// ---------------------------------------------------------------------------
// Shared composer helpers
// ---------------------------------------------------------------------------

/** Emissive hanging work lamp (cord + shade). Used by warehouse/office. */
function addHangingLamp(ctx: Ctx, x: number, y: number, z: number, lit: boolean): void {
  ctx.group.add(
    mkMesh(ctx, ctx.geos.cyl(0.03, 0.03, 1.4, 6), ctx.mats.get(0x0c0c0f), x, y, z)
  )
  const shadeMat = ctx.mats.get(0x0c0c0f, {
    rough: 0.5,
    emissive: lit ? 0xffd9a0 : 0x111111,
    emissiveIntensity: lit ? 1.55 : 0,
  })
  ctx.group.add(mkMesh(ctx, ctx.geos.cyl(0.05, 0.2, 0.3, 10), shadeMat, x, y - 0.75, z))
  recordProp(ctx, lit ? 'lamp_lit' : 'lamp_dark')
}

/**
 * Displaced low-poly terrain — the forest ground. Seeded sum-of-sines bumps,
 * flattened inside the actor-safe radius and damped along the walking path.
 */
function buildTerrain(ctx: Ctx, size = 30, segs = 26): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const rng = ctx.rng
  const p1 = rng() * Math.PI * 2
  const p2 = rng() * Math.PI * 2
  const p3 = rng() * Math.PI * 2
  const f1 = 0.22 + rng() * 0.14
  const f2 = 0.2 + rng() * 0.14
  const f3 = 0.36 + rng() * 0.2
  const amp = 0.34
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i) // plane-local; becomes world −z after rotation
    const d = Math.hypot(x, y)
    // Flat inside the actor-safe circle, full relief beyond r≈6.
    const t = THREE.MathUtils.smoothstep(d, 2.6, 6.0)
    // Damp relief along the central walking corridor.
    const pathMask = Math.abs(x) < 1.5 ? 0.3 : 1
    const h =
      amp * t * pathMask *
      (Math.sin(x * f1 + p1) * 0.5 + Math.sin(y * f2 + p2) * 0.35 + Math.sin((x + y) * f3 + p3) * 0.3)
    pos.setZ(i, h)
  }
  geo.computeVertexNormals()
  const mat = ctx.mats.get(jitterHex(ctx.palette.ground, rng, 0.08), { rough: 0.97 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  ctx.count++
  recordProp(ctx, 'terrain')
  return mesh
}

/** Dirt walking path through the forest clearing (flat, slightly raised). */
function buildDirtPath(ctx: Ctx): THREE.Mesh {
  const hex = mixHex(ctx.palette.ground, 0x8a7a5c, 0.5)
  const mat = ctx.mats.get(hex, { rough: 0.95 })
  const geo = ctx.geos.plane(1.9, 8.5)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, 0.045, -1.6)
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  ctx.count++
  recordProp(ctx, 'path')
  return mesh
}

// ---------------------------------------------------------------------------
// FOREST COMPOSER — trunks, canopies, rocks, bushes, path, far silhouettes
// ---------------------------------------------------------------------------

function composeForest(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  // FAR layer first: displaced terrain + dirt path through the clearing.
  ctx.group.add(buildTerrain(ctx))
  ctx.group.add(buildDirtPath(ctx))

  const treeCount = countIn(bp.props, 'tree')

  // --- MIDGROUND hero trees (individual Groups, asset-slot tagged) ---------
  // Frame-edge + mid rows; positions get seeded jitter for organic clusters.
  const heroAnchors: Array<[number, number, number]> = [
    [-2.75, -1.35, 1.5],
    [2.75, -1.3, 1.5],
    [-3.2, -2.8, 1.35],
    [-1.5, -3.0, 1.5],
    [0.6, -2.9, 1.45],
    [2.4, -3.1, 1.4],
    [-4.4, -4.6, 1.3],
    [3.8, -4.9, 1.3],
  ]
  for (let i = 0; i < Math.min(treeCount, heroAnchors.length); i++) {
    const [ax, az, scale] = heroAnchors[i]
    const tx = ax + (ctx.rng() - 0.5) * 0.5
    const tz = az + (ctx.rng() - 0.5) * 0.5
    const tree = buildTree(ctx, scale + (ctx.rng() - 0.5) * 0.2)
    tree.position.set(tx, 0, tz)
    tree.rotation.y = ctx.rng() * Math.PI * 2
    tagAssetSlot(tree, i % 2 === 0 ? 'tree_01' : 'tree_02')
    ctx.group.add(tree)
    registerFootprint(ctx, tx, tz, 0.9 * scale)
  }

  // Surplus trees (crowded scenes) → seeded side-margin fill, capped so the
  // whole forest stays inside the 20–50 visible-mesh budget.
  let extraTrees = Math.min(treeCount - Math.min(treeCount, heroAnchors.length), 4)
  while (extraTrees > 0) {
    const pos = placeInZone(ctx, 0.9, ctx.rng() > 0.5 ? ZONES.sideL : ZONES.sideR)
    const tree = buildTree(ctx, 1.2 + ctx.rng() * 0.4)
    tree.position.set(pos.x, 0, pos.z)
    tagAssetSlot(tree, extraTrees % 2 === 0 ? 'tree_01' : 'tree_02')
    ctx.group.add(tree)
    extraTrees--
  }

  // --- FAR layer: background tree WALL as instanced silhouettes -------------
  // Trunks + two canopy tiers = 3 draw calls for a whole deep forest row.
  const bgTreeCount = 13
  const bgTrunkPlacements: Placement[] = []
  const bgCanopyA: Placement[] = []
  const bgCanopyB: Placement[] = []
  for (let i = 0; i < bgTreeCount; i++) {
    const x = -8.5 + (i / (bgTreeCount - 1)) * 17 + (ctx.rng() - 0.5) * 1.6
    const z = -8.2 - ctx.rng() * 3.2
    const s = 1.5 + ctx.rng() * 0.9
    const th = 2.2 * s
    bgTrunkPlacements.push({ x, y: th / 2, z, sx: s, sy: s, sz: s })
    bgCanopyA.push({ x, y: th + 1.5 * s, z, sx: s, sy: s, sz: s, ry: ctx.rng() * Math.PI })
    bgCanopyB.push({ x, y: th + 2.9 * s, z, sx: s * 0.8, sy: s, sz: s * 0.8, ry: ctx.rng() * Math.PI })
  }
  const trunkHex = ctx.night ? 0x241c14 : 0x33261a
  const canopyDark = ctx.night ? 0x0c1610 : 0x14301e
  const canopyMid = ctx.night ? 0x11201a : 0x1c4629
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.cyl(0.14, 0.22, 2.2, 6),
      ctx.mats.get(trunkHex, { rough: 1 }),
      bgTrunkPlacements,
      'bg_tree_trunk',
      { jitter: 0.2 }
    )
  )
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.cone(1.5, 3.0, 7),
      ctx.mats.get(canopyDark, { rough: 1 }),
      bgCanopyA,
      'bg_tree_canopy_a',
      { jitter: 0.22 }
    )
  )
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.cone(1.0, 2.4, 7),
      ctx.mats.get(canopyMid, { rough: 1 }),
      bgCanopyB,
      'bg_tree_canopy_b',
      { jitter: 0.22 }
    )
  )

  // --- Rocks: instanced irregular boulders (midground + foreground edges) ---
  const rockSpots: Array<[number, number]> = [
    [-2.8, -0.9],
    [2.8, -0.85],
    [-3.3, -2.2],
    [2.7, -2.0],
    [-4.2, -3.8],
    [3.7, -4.0],
    [-2.9, -4.4],
    [3.1, -4.6],
  ]
  const rockPlacements: Placement[] = []
  for (let i = 0; i < Math.min(countIn(bp.props, 'rock') + 2, rockSpots.length); i++) {
    const [rx, rz] = rockSpots[i]
    const s = 0.3 + ctx.rng() * 0.4
    rockPlacements.push({
      x: rx + (ctx.rng() - 0.5) * 0.4,
      y: s * 0.42,
      z: rz + (ctx.rng() - 0.5) * 0.4,
      sx: 1 + ctx.rng() * 0.5,
      sy: 0.6 + ctx.rng() * 0.4,
      sz: 1 + ctx.rng() * 0.4,
      ry: ctx.rng() * Math.PI * 2,
    })
    registerFootprint(ctx, rx, rz, s + 0.2)
  }
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.dodeca(0.42),
      ctx.mats.get(ctx.night ? 0x23262c : 0x3d4148, { rough: 0.95 }),
      rockPlacements,
      'rock',
      { jitter: 0.25 }
    )
  )

  // --- Bushes: instanced undergrowth at the frame edges ---------------------
  const bushPlacements: Placement[] = []
  const bushZones: Zone[] = [ZONES.fgL, ZONES.fgR, ZONES.sideL, ZONES.sideR]
  const bushTotal = Math.max(4, Math.round(treeCount / 2))
  for (let i = 0; i < bushTotal; i++) {
    const pos = placeInZone(ctx, 0.35, bushZones[i % bushZones.length])
    const s = 0.26 + ctx.rng() * 0.24
    bushPlacements.push({ x: pos.x, y: s * 0.55, z: pos.z, sx: 1 + ctx.rng() * 0.5, sy: 0.8, sz: 1 + ctx.rng() * 0.5 })
  }
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.ico(0.34, 0),
      ctx.mats.get(ctx.night ? 0x12231a : 0x1e5332, { rough: 1 }),
      bushPlacements,
      'bush',
      { jitter: 0.3 }
    )
  )

  // --- Fallen log (semantic registry: forest.fallen_log) --------------------
  const logLen = 2.6 + ctx.rng() * 0.8
  const log = newProp('fallenLog')
  log.add(
    mkMesh(
      ctx,
      ctx.geos.cyl(0.19, 0.23, logLen, 7),
      ctx.mats.get(ctx.night ? 0x2c2118 : 0x4a3826, { rough: 0.95 }),
      0,
      0.21,
      0
    )
  )
  log.position.set(-3.5, 0, -1.6)
  log.rotation.y = 0.65 + ctx.rng() * 0.4
  log.matrixAutoUpdate = false
  log.updateMatrix()
  ctx.group.add(log)
  registerFootprint(ctx, -3.5, -1.6, 1.2)
  recordProp(ctx, 'fallen_log')
}

// ---------------------------------------------------------------------------
// WAREHOUSE COMPOSER — shell, beams, pillar row, racks, instanced crates
// ---------------------------------------------------------------------------

function composeWarehouse(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  // PHASE 2.1 CAMERA ENVELOPE (Two-Shot Wide: cam ≈ (0, 1.7, +3.4), FOV 46°):
  //   frame-top y ≈ 1.7 + 0.30·(3.4 − z)  → rear wall (z=−8) shows y 0…≈5.1
  //   half-width ≈ 0.76·(3.4 − z)         → ±5.1 at z=−3.5, ±8.6 at z=−8
  // Every identity cue MUST live inside that wedge. The previous build hung
  // its sign (y5.95), ceiling beams (y5.85) and lamp shades (y4.35) ABOVE the
  // frame top and parked its racks edge-on at the side walls — technically
  // present in the scene graph, invisible in the viewport.
  ctx.group.add(buildFloorMesh(ctx, 26, ctx.palette.ground, 0.95))

  // Rear shell + loading-bay wall (behind actors ⇒ occlusion-safe).
  const back = buildWall(ctx, 22, 7.4, 0.5, ctx.palette.wall)
  back.position.set(0, 0, -8.0)
  ctx.group.add(back)
  registerOccluder(ctx, 0, -8.0, 22, 7.4)

  // Side walls pushed OUT to the frame edges (enclosure without blocking).
  for (const sx of [-5.6, 5.6]) {
    const side = buildSidePanel(ctx, 8.5, 5.2, 0.3, sx < 0 ? 0x4a505a : 0x444a54)
    side.position.set(sx, 0, -4.2)
    ctx.group.add(side)
    registerOccluder(ctx, sx, -4.2, 0.3, 5.2)
  }

  // Concrete kickers along the side walls (low-profile depth separation).
  for (const sx of [-5.35, 5.35]) {
    ctx.group.add(bx(ctx, 0.35, 0.8, 9, ctx.mats.get(0x565e69, { rough: 0.85 }), sx, 0.4, -4.4))
  }

  // Mezzanine beams LOWERED into the visible band (was y5.85 = out of frame;
  // frame-top at z is 1.7 + 0.31·(3.38 − z), so y4.5 clears from z≈−5.7 back).
  const beamMat = ctx.mats.get(0x3a4048)
  for (const bz of [-4.6, -6.0, -7.4]) {
    ctx.group.add(bx(ctx, 12.5, 0.28, 0.36, beamMat, 0, 4.5, bz))
  }

  // Hanging work lamps dropped so the shades sit at y≈3.4 — clearly in frame.
  const hangReq = bp.lights.find((l) => l.kind === 'hanging')
  const lampCount = hangReq?.count ?? 2
  for (let i = 0; i < lampCount; i++) {
    const lx = lampCount === 1 ? 0 : i === 0 ? -2.2 : 2.2
    addHangingLamp(ctx, lx, 4.15, -3.6, hangReq?.lit ?? true)
  }

  // --- Steel columns: LEFT+RIGHT midground pair, deep echo pair, and one
  //     off-center deep column (asymmetry). Actor center stays clear. -------
  const pillarSpots: Array<[number, number]> = [
    [-3.6, -3.0],
    [3.6, -3.0],
    [-3.6, -5.8],
    [3.6, -5.8],
    [1.9, -5.8],
  ]
  const pillarCount = Math.min(Math.max(countIn(bp.props, 'pillar') + 1, 4), pillarSpots.length)
  const pillarH = 4.7
  const pillarBodies: Placement[] = []
  const pillarCaps: Placement[] = []
  for (let i = 0; i < pillarCount; i++) {
    const [px, pz] = pillarSpots[i]
    pillarBodies.push({ x: px, y: pillarH / 2, z: pz })
    pillarCaps.push({ x: px, y: pillarH + 0.07, z: pz })
    registerFootprint(ctx, px, pz, 0.5)
  }
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(0.55, pillarH, 0.55), ctx.mats.get(ctx.palette.accent, { rough: 0.6, metal: 0.3 }), pillarBodies, 'pillar')
  )
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(0.8, 0.14, 0.8), ctx.mats.get(0x1b1d22), pillarCaps, 'pillar_cap')
  )

  // --- Shelving racks — OPEN/readable side faces the camera (ry=0).
  //     (Was: edge-on profiles rotated ±π/2 at the side walls.)
  const rackCount = Math.max(2, countIn(bp.props, 'rack'))
  const rackAnchors: Array<[number, number, number]> = [
    [-3.5, -4.3, 0],
    [3.7, -6.1, 0],
    [-4.1, -6.3, 0],
    [4.0, -4.2, 0],
  ]
  const uprights: Placement[] = []
  const planks: Placement[] = []
  const cargoBoxes: Placement[] = []
  for (let r = 0; r < Math.min(rackCount, rackAnchors.length); r++) {
    const [rx, rz, ry] = rackAnchors[r]
    for (const dx of [-0.9, 0.9]) {
      uprights.push({
        x: rx + Math.cos(ry) * dx,
        y: 1.15,
        z: rz - Math.sin(ry) * dx,
        ry,
      })
    }
    for (let s = 0; s < 4; s++) {
      planks.push({ x: rx, y: 0.25 + s * 0.62, z: rz, ry })
      if (ctx.rng() > 0.35) {
        cargoBoxes.push({
          x: rx + (Math.cos(ry) * (ctx.rng() - 0.5)) * 1.2,
          y: 0.32 + s * 0.62,
          z: rz - Math.sin(ry) * (ctx.rng() - 0.5) * 1.2,
          ry: ctx.rng() * 0.6,
          sx: 0.42, sy: 0.34, sz: 0.42,
        })
      }
    }
    registerFootprint(ctx, rx, rz, 1.05)
  }
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(0.09, 2.3, 0.4), ctx.mats.get(0x262a31, { rough: 0.5, metal: 0.45 }), uprights, 'rack_upright')
  )
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(1.8, 0.05, 0.4), ctx.mats.get(0x20242b, { rough: 0.8 }), planks, 'rack_plank')
  )
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(0.42, 0.34, 0.42), ctx.mats.get(0x37301f, { rough: 0.9 }), cargoBoxes, 'rack_cargo', { jitter: 0.2 })
  )

  // --- Pipes on the back wall -----------------------------------------------
  const pipeCount = countIn(bp.props, 'pipe')
  for (let i = 0; i < pipeCount; i++) {
    const pipe = buildPipe(ctx, 14, 0x494e56)
    pipe.position.set(0, 2.5 + i * 0.55, -7.65)
    ctx.group.add(pipe)
  }

  // --- Crates: instanced stacks (bodies + lids = 2 draw calls) ---------------
  // Phase 2.1: lifted wood tones (was 0x26–0x40 near-black) so stacks read as
  // timber under midnight lighting; knee-to-waist scale kept.
  const crateColors = [0x6b5638, 0x7a6444, 0x8a7350, 0x5d4b31]
  let cratesLeft = countIn(bp.props, 'crate')
  const crateAnchors: Array<[number, number]> = [
    [-2.75, -1.7],
    [2.75, -1.65],
    [-3.1, -2.9],
    [3.2, -3.1],
    [-4.2, -4.6],
    [4.3, -4.4],
    [1.5, -5.6],
    [0.7, -5.6],
  ]
  const crateBodies: Placement[] = []
  const crateLids: Placement[] = []
  let stackIdx = 0
  for (const [ax, az] of crateAnchors) {
    if (cratesLeft <= 0) break
    const levels = Math.min(1 + Math.floor(ctx.rng() * 3), cratesLeft)
    let y = 0
    for (let l = 0; l < levels; l++) {
      const s = 1.0 - l * 0.16
      let tilt = 0
      let ty = y + s / 2
      if (ctx.details.abandoned && l === 0 && stackIdx % 3 === 0) {
        tilt = 0.5
        ty = s * 0.3
      }
      crateBodies.push({
        x: ax + (ctx.rng() - 0.5) * 0.1,
        y: ty,
        z: az + (ctx.rng() - 0.5) * 0.1,
        ry: (ctx.rng() - 0.5) * 0.4,
        rz: tilt,
        sx: s, sy: s, sz: s,
      })
      crateLids.push({
        x: ax + (ctx.rng() - 0.5) * 0.1,
        y: ty + s / 2 - 0.02,
        z: az + (ctx.rng() - 0.5) * 0.1,
        ry: (ctx.rng() - 0.5) * 0.4,
        rz: tilt,
        sx: s, sy: 1, sz: s,
      })
      y += s
    }
    registerFootprint(ctx, ax, az, 0.8)
    cratesLeft -= levels
    stackIdx++
  }
  // Surplus crates fill the side margins.
  while (cratesLeft > 0 && stackIdx < 12) {
    const zone = stackIdx % 2 === 0 ? ZONES.sideL : ZONES.sideR
    const pos = placeInZone(ctx, 0.7, zone)
    const s = 0.85 + ctx.rng() * 0.2
    crateBodies.push({ x: pos.x, y: s / 2, z: pos.z, ry: ctx.rng() * 0.6, sx: s, sy: s, sz: s })
    crateLids.push({ x: pos.x, y: s - 0.02, z: pos.z, ry: ctx.rng() * 0.6, sx: s, sy: 1, sz: s })
    cratesLeft--
    stackIdx++
  }
  // Phase 2.1 FOREGROUND dressing: two low crate clusters at the lower frame
  // edges (outside actor zone + sightline) give the wide shot a near layer.
  for (const [fx, fz] of [[-3.9, -0.9], [3.9, -1.15]] as Array<[number, number]>) {
    const s = 0.72 + ctx.rng() * 0.14
    crateBodies.push({ x: fx, y: s / 2, z: fz, ry: ctx.rng() * 0.5, sx: s, sy: s, sz: s })
    crateLids.push({ x: fx, y: s - 0.02, z: fz, ry: ctx.rng() * 0.5, sx: s, sy: 1, sz: s })
    registerFootprint(ctx, fx, fz, 0.65)
  }
  const crateBodyMat = ctx.mats.get(crateColors[0], { rough: 0.9 })
  const crateLidMat = ctx.mats.get(0x241f18, { rough: 0.9 })
  ctx.group.add(mkInstanced(ctx, ctx.geos.box(1, 1, 1), crateBodyMat, crateBodies, 'crate', { jitter: 0.18 }))
  ctx.group.add(mkInstanced(ctx, ctx.geos.box(1.04, 0.06, 1.04), crateLidMat, crateLids, 'crate_lid'))

  // --- Barrels: instanced ----------------------------------------------------
  const barrelCount = Math.min(countIn(bp.props, 'barrel'), 4)
  const barrelPlacements: Placement[] = []
  for (let i = 0; i < barrelCount; i++) {
    const bxPos = i % 2 === 0 ? -2.75 : 2.75
    const bzPos = -2.3 - Math.floor(i / 2) * 0.9
    barrelPlacements.push({ x: bxPos, y: 0.45, z: bzPos, ry: ctx.rng() * Math.PI })
    registerFootprint(ctx, bxPos, bzPos, 0.5)
  }
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.cyl(0.42, 0.42, 0.9, 10), ctx.mats.get(0x26303a, { rough: 0.5, metal: 0.6 }), barrelPlacements, 'barrel')
  )

  // --- Pallets: instanced decks + stringers ----------------------------------
  const palletSpots: Array<[number, number]> = [
    [-4.4, -4.8],
    [4.4, -4.8],
    [-3.7, -1.6],
  ]
  const palletDecks: Placement[] = []
  const palletStringers: Placement[] = []
  for (const [px, pz] of palletSpots) {
    const rot = ctx.rng() > 0.5 ? Math.PI / 2 : 0
    palletDecks.push({ x: px, y: 0.135, z: pz, ry: rot })
    for (const sx of [-0.31, 0.31]) {
      palletStringers.push({
        x: px + Math.cos(rot) * sx,
        y: 0.08,
        z: pz - Math.sin(rot) * sx,
        ry: rot,
      })
    }
    registerFootprint(ctx, px, pz, 0.8)
  }
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(1.25, 0.05, 1.05), ctx.mats.get(0x241d16, { rough: 0.95 }), palletDecks, 'pallet_deck')
  )
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.box(0.16, 0.11, 0.87), ctx.mats.get(0x201a13, { rough: 0.95 }), palletStringers, 'pallet_stringer')
  )

  // --- Industrial roll-up bay door + signage on the back wall ----------------
  // Phase 2.1: LOWERED into the visible band. The old door top (y≈5.85) and
  // sign (y5.95) sat above the Two-Shot frame top at z=−7.7 (≈y5.1).
  const bayFrame = ctx.mats.get(0x3c434e, { rough: 0.7, metal: 0.4 })
  const bayDark = ctx.mats.get(0x14181f, { rough: 1 })
  const bayLight = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0xffd9a0,
    emissiveIntensity: ctx.night ? 1.2 : 0.5,
  })
  ctx.group.add(bx(ctx, 4.6, 0.35, 0.08, bayFrame, 0, 4.55, -7.72))
  ctx.group.add(bx(ctx, 4.4, 2.6, 0.06, bayDark, 0, 3.2, -7.7))
  ctx.group.add(bx(ctx, 4.4, 0.45, 0.06, bayLight, 0, 3.35, -7.68))
  for (const dx of [-2.25, 2.25]) {
    ctx.group.add(bx(ctx, 0.18, 3.4, 0.12, bayFrame, dx, 1.7, -7.66))
  }
  const baySign = buildSign(ctx, 5.2, 0.95, 0x39443c, 0xbfd8e8)
  baySign.position.set(0, 4.95, -7.6)
  ctx.group.add(baySign)
}

// ---------------------------------------------------------------------------
// RAILWAY COMPOSER — platform, tracks, canopy, benches, signs, tunnel arch
// ---------------------------------------------------------------------------

function composeRailway(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  // PHASE 2.1 RE-LAYOUT: the old build ran the track THROUGH the actor zone
  // (z=−1.75 crosses z=0) so actors stood in the track bed, and pushed the
  // platform behind them like a wall. New arrangement — the camera looks
  // ALONG the platform: the whole floor IS the platform, the track runs down
  // the RIGHT side from the camera into a rear tunnel arch (leading line +
  // depth), a second track echoes at the left frame edge, and the canopy/
  // sign/bench cluster sits inside the visible wedge (frame-top y at z is
  // 1.68 + 0.314·(3.38 − z)).
  ctx.group.add(buildFloorMesh(ctx, 28, ctx.palette.ground, 0.97))

  // Platform edge: painted safety line ACROSS the frame in front of the
  // actors (low profile ⇒ never occludes) + white edge kerb.
  const lineMat = ctx.night
    ? ctx.mats.get(0xcaa64b, { rough: 0.6, emissive: 0xcaa64b, emissiveIntensity: 0.65 })
    : ctx.mats.get(0xcaa64b, { rough: 0.6 })
  ctx.group.add(bx(ctx, 13.5, 0.035, 0.22, lineMat, 0, 0.02, -2.35))
  ctx.group.add(bx(ctx, 13.5, 0.09, 0.3, ctx.mats.get(0x6b727c, { rough: 0.9 }), 0, 0.045, -2.55))

  // MAIN TRACK — right side, running from the camera into the rear arch
  // (x=3.4 keeps rails/sleepers clear of the actor-zone edge at x=2.5).
  const track = buildTrackSegment(ctx, 15, 1.05, 0, ctx.palette.accent, 0x241d16, 1.5)
  track.position.set(3.4, 0, -3.4)
  tagAssetSlot(track, 'rail')
  ctx.group.add(track)

  // SECOND TRACK — left frame-edge echo (asymmetric depth).
  const trackDeep = buildTrackSegment(ctx, 12, 1.0, 0, 0x7d8794, 0x3a3630, 1.4)
  trackDeep.position.set(-5.9, 0.01, -4.5)
  ctx.group.add(trackDeep)

  // Tunnel arch WHERE THE TRACK VANISHES — strongest depth/identity cue.
  const arch = buildTunnelArch(ctx, 3.6, 3.9)
  arch.position.set(3.4, 0, -8.35)
  ctx.group.add(arch)

  // Rear station body + station sign (lowered into frame; was y5.35).
  const rearBase = buildWall(ctx, 20, 5.0, 0.4, ctx.palette.wall)
  rearBase.position.set(0, 0, -8.4)
  ctx.group.add(rearBase)
  registerOccluder(ctx, 0, -8.4, 20, 5.0)

  const sign = buildSign(ctx, 5.6, 1.3, 0x39505e, 0xd8e4f0)
  sign.position.set(-1.6, 3.9, -8.15)
  tagAssetSlot(sign, 'station_sign')
  ctx.group.add(sign)

  // Small hanging platform sign on a column — second readable cue.
  const smallSign = buildSign(ctx, 1.7, 0.55, 0x2c3a46, 0xcfe0ec)
  smallSign.position.set(-3.4, 2.75, -4.45)
  ctx.group.add(smallSign)

  // Canopy columns (instanced) + roof slab — lowered into the visible band.
  const pillarXs = [-3.4, -1.7, 1.7, 3.4]
  const canopyH = 3.75
  const colPlacements: Placement[] = pillarXs.map((x) => ({ x, y: canopyH / 2, z: -4.6 }))
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.cyl(0.16, 0.2, canopyH, 8),
      ctx.mats.get(0x767f8b, { rough: 0.5, metal: 0.4 }),
      colPlacements,
      'canopy_column'
    )
  )
  ctx.group.add(
    bx(ctx, 12.4, 0.14, 4.6, ctx.mats.get(ctx.palette.secondary, { rough: 0.55, metal: 0.5 }), 0, canopyH + 0.05, -5.5)
  )
  registerOccluder(ctx, 0, -5.5, 12.4, 0.14)

  // Overhead station lights (cords + fixtures instanced) under the canopy.
  const stReq = bp.lights.find((l) => l.kind === 'station')
  const lightCount = stReq?.count ?? 3
  const cordPlacements: Placement[] = []
  const fixturePlacements: Placement[] = []
  for (let i = 0; i < lightCount; i++) {
    const lightX = lightCount === 1 ? 0 : [-3, 0, 3][i % 3]
    cordPlacements.push({ x: lightX, y: canopyH - 0.2, z: -4.6 })
    fixturePlacements.push({ x: lightX, y: canopyH - 0.4, z: -4.6 })
  }
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.cyl(0.02, 0.02, 0.7, 4), ctx.mats.get(0x14161a), cordPlacements, 'light_cord')
  )
  const lit = stReq?.lit ?? true
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.box(0.9, 0.08, 0.3),
      ctx.mats.get(0x0b0d10, {
        rough: 0.5,
        emissive: lit ? 0xdcecff : 0x111111,
        emissiveIntensity: lit ? 1.5 : 0,
      }),
      fixturePlacements,
      'station_light_fixture'
    )
  )
  recordProp(ctx, lit ? 'station_light' : 'station_light_dark')

  // Benches — readable profiles angled toward the track/camera, staggered
  // down the LEFT platform (the right side belongs to the track).
  const benchCount = countIn(bp.props, 'bench')
  const benchSpots: Array<[number, number, number]> = [
    [-2.9, -3.5, Math.PI - 0.28],
    [-4.4, -5.5, Math.PI + 0.15],
  ]
  for (let i = 0; i < Math.min(benchCount, benchSpots.length); i++) {
    const [bxp, bzp, bry] = benchSpots[i]
    const bench = buildBench(ctx, 0x54432f)
    bench.position.set(bxp, 0, bzp)
    bench.rotation.y = bry
    tagAssetSlot(bench, 'bench')
    ctx.group.add(bench)
    registerFootprint(ctx, bxp, bzp, 1.0)
  }

  // Platform edge posts flanking the safety line INSIDE the frustum.
  for (const [px, pz] of [[-4.2, -2.4], [5.6, -4.2]] as Array<[number, number]>) {
    ctx.group.add(
      bx(ctx, 0.14, 1.1, 0.14, ctx.mats.get(0x565e69, { rough: 0.6, metal: 0.3 }), px, 0.55, pz)
    )
  }

  // NEAR layer: standing platform lamps INSIDE the visible wedge (the old
  // ±3.5/z≈−0.9 spots sat outside the frustum half-width at that depth).
  const nearLampSpots: Array<[number, number]> = [
    [-3.0, -1.6],
    [4.9, -3.4],
  ]
  for (let i = 0; i < nearLampSpots.length; i++) {
    const [lx, lz] = nearLampSpots[i]
    const lamp = buildLampPost(ctx, 3.2, lit)
    lamp.position.set(lx, 0, lz)
    lamp.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2
    tagAssetSlot(lamp, 'lamp')
    ctx.group.add(lamp)
    registerFootprint(ctx, lx, lz, 0.4)
  }

  // Abandoned stations: scattered debris crates on the tracks side.
  if (ctx.details.abandoned) {
    const debris: Placement[] = []
    for (let i = 0; i < 4; i++) {
      const dx = (ctx.rng() - 0.5) * 9
      const dz = -5.8 - ctx.rng() * 2.4
      debris.push({ x: dx, y: 0.16, z: dz, ry: ctx.rng() * Math.PI, sx: 0.32, sy: 0.32, sz: 0.32 })
    }
    ctx.group.add(
      mkInstanced(ctx, ctx.geos.box(1, 1, 1), ctx.mats.get(0x2a2620, { rough: 0.95 }), debris, 'debris', { jitter: 0.25 })
    )
  }
}

// ---------------------------------------------------------------------------
// INTERIOR ROOM COMPOSER — shared by apartment / office / fallback
// ---------------------------------------------------------------------------

interface RoomOpts {
  warm: boolean
  withChair: boolean
  withWindow: boolean
  withCabinet: boolean
  withPictures: boolean
}

function composeInteriorRoom(
  ctx: Ctx,
  bp: ResolvedEnvironment['blueprint'],
  opts: RoomOpts
): void {
  // PHASE 2.1 THREE-WALL FILM SET: the old shell put two 3.6 m brown slabs at
  // x=±2.7 spanning z −3…+0.2 — giant opaque monoliths filling the frame
  // beside/behind the actors (the reported "giant flat brown blocking
  // region"). The set is now OPEN TOWARD THE CAMERA: rear wall only + short
  // return walls pushed to the frame edges, both lifted in albedo so they
  // read as plaster under night lighting.
  const wallTone = opts.warm ? 1.42 : 1.18
  ctx.group.add(buildFloorMesh(ctx, 18, opts.warm ? ctx.palette.ground : 0x23262e, 0.92))

  if (opts.warm) {
    const rug = ctx.mats.get(mixHex(ctx.palette.secondary, 0xffffff, 0.22), { rough: 1 })
    const rugMesh = mkMesh(ctx, ctx.geos.plane(3.8, 2.8), rug, 0, 0.006, 0.4)
    rugMesh.rotation.x = -Math.PI / 2
    ctx.group.add(rugMesh)
    recordProp(ctx, 'rug')
  }

  // Rear wall — behind actors ⇒ occlusion-safe; tone-lifted.
  const back = buildWall(ctx, 17, 4.6, 0.35, ctx.palette.wall, wallTone)
  back.position.set(0, 0, -7.2)
  ctx.group.add(back)
  registerOccluder(ctx, 0, -7.2, 17, 4.6)

  // Short RETURN walls at the frame edges (open camera side between them).
  for (const sx of [-5.3, 5.3]) {
    const side = buildSidePanel(ctx, 4.6, 3.4, 0.3, sx < 0 ? 0x9a846c : 0x8f7a62, wallTone)
    side.position.set(sx, 0, -5.0)
    ctx.group.add(side)
    registerOccluder(ctx, sx, -5.0, 0.3, 3.4)
  }

  // Window on the back wall (right of center) — warm glow at night.
  if (opts.withWindow && countIn(bp.props, 'window') > 0) {
    const win = buildWindow(ctx, 2.0, 1.5, ctx.night ? 0xffd9a8 : 0xa8c4ec, ctx.night ? 1.05 : 0.7)
    win.position.set(2.0, 2.35, -7.0)
    ctx.group.add(win)
    ctx.group.add(bx(ctx, 0.06, 1.5, 0.1, ctx.mats.get(0x2a2119), 2.0, 2.35, -6.98))
    ctx.group.add(bx(ctx, 2.0, 0.06, 0.1, ctx.mats.get(0x2a2119), 2.0, 2.35, -6.98))
  }

  // Doorway (far right).
  if (countIn(bp.props, 'doorway') > 0) {
    const door = buildDoorway(ctx)
    door.position.set(4.4, 0, -7.02)
    ctx.group.add(door)
  }

  // Shelf + books against the back wall (left).
  if (countIn(bp.props, 'shelf') > 0) {
    const shelf = buildShelf(ctx)
    shelf.position.set(-4.2, 0, -6.95)
    shelf.rotation.y = 0.12
    tagAssetSlot(shelf, 'shelf')
    ctx.group.add(shelf)
    const books = buildBookRow(ctx, 1.2)
    books.position.set(-4.2, 1.32, -6.88)
    ctx.group.add(books)
  }

  // Low cabinet (right of the doorway).
  if (opts.withCabinet) {
    const cab = buildCabinet(ctx, 1.6, 0.9, 0x4a3a2c)
    cab.position.set(-2.2, 0, -6.9)
    tagAssetSlot(cab, 'cabinet')
    ctx.group.add(cab)
  }

  // Framed pictures above the sofa/cabinet.
  if (opts.withPictures) {
    for (const [px, py] of [[-2.2, 2.5], [-1.3, 2.35]] as Array<[number, number]>) {
      const pic = buildPictureFrame(ctx, 0.7, 0.55)
      pic.position.set(px, py, -7.0)
      ctx.group.add(pic)
    }
  }

  // Sofa + coffee table (left, visible midground).
  if (countIn(bp.props, 'sofa') > 0) {
    const sofa = buildSofa(ctx, opts.warm ? 0x7b5a42 : 0x4a5a74)
    sofa.position.set(-2.7, 0, -2.4)
    sofa.rotation.y = -0.42
    tagAssetSlot(sofa, 'sofa')
    ctx.group.add(sofa)
    registerFootprint(ctx, -2.7, -2.4, 1.2)
  }
  if (countIn(bp.props, 'table') > 0) {
    const table = buildTable(ctx, 1.2, 0.4, 0.7, opts.warm ? 0x5c4531 : 0x39404d)
    table.position.set(2.7, 0, -1.9)
    tagAssetSlot(table, 'table')
    ctx.group.add(table)
  }

  // Chair on the right (behind the actor zone).
  if (opts.withChair && countIn(bp.props, 'chair') > 0) {
    const chair = buildChair(ctx, opts.warm ? 0x6b4a32 : 0x39404d)
    chair.position.set(2.75, 0, -2.6)
    chair.rotation.y = 0.7
    tagAssetSlot(chair, 'chair')
    ctx.group.add(chair)
  }

  // Warm floor lamp (the night practical) near the right frame edge.
  const lampReq = bp.lights.find((l) => l.kind === 'floor_lamp')
  if (lampReq) {
    const poleMat = ctx.mats.get(0x22262c, { rough: 0.5, metal: 0.5 })
    ctx.group.add(
      mkMesh(ctx, ctx.geos.cyl(0.035, 0.035, 1.7, 8), poleMat, 2.6, 0.85, -0.2)
    )
    const shade = ctx.mats.get(0x2a2018, {
      rough: 0.6,
      emissive: 0xffd9a8,
      emissiveIntensity: lampReq.lit ? (ctx.night ? 1.4 : 0.9) : 0,
    })
    ctx.group.add(
      mkMesh(ctx, ctx.geos.cyl(0.18, 0.26, 0.34, 12), shade, 2.6, 1.75, -0.2)
    )
    registerFootprint(ctx, 2.6, -0.2, 0.3)
  }
}

function composeApartment(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  composeInteriorRoom(ctx, bp, {
    warm: true,
    withChair: true,
    withWindow: true,
    withCabinet: true,
    withPictures: true,
  })
}

function composeOffice(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  composeInteriorRoom(ctx, bp, {
    warm: false,
    withChair: true,
    withWindow: true,
    withCabinet: false,
    withPictures: false,
  })
  if (countIn(bp.props, 'desk') > 0) {
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
    ctx.group.add(mkMesh(ctx, ctx.geos.plane(0.85, 0.5), monitor, -0.6, 1.45, -2.4))
  }
}

// ---------------------------------------------------------------------------
// BROADCAST STUDIO COMPOSER — desk, screen, panels, light columns, strips
// ---------------------------------------------------------------------------

function composeBroadcast(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  // Glossy studio floor + raised platform slab.
  ctx.group.add(buildFloorMesh(ctx, 24, ctx.palette.ground, 0.35))
  ctx.group.add(
    bx(ctx, 13.5, 0.09, 8.2, ctx.mats.get(ctx.palette.secondary, { rough: 0.8 }), 0, 0.02, -2.4)
  )

  // Backdrop wall + giant screen.
  const backdrop = buildWall(ctx, 23, 6.6, 0.4, ctx.palette.wall)
  backdrop.position.set(0, 0, -8.2)
  ctx.group.add(backdrop)
  if (countIn(bp.props, 'screen') > 0) {
    const screen = buildScreen(ctx, 13.5, 3.4)
    screen.position.set(0, 3.3, -7.98)
    tagAssetSlot(screen, 'screen')
    ctx.group.add(screen)
    const ticker = ctx.mats.get(0x05070c, {
      rough: 0.4,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.5,
    })
    ctx.group.add(bx(ctx, 13.8, 0.18, 0.1, ticker, 0, 1.42, -7.95))
  }

  // Flanking studio panels with lit inner edges.
  for (const px of [-4.5, 4.5]) {
    const panel = buildWall(ctx, 1.8, 3.8, 0.2, ctx.palette.primary)
    panel.position.set(px, 0.4, -3.4)
    tagAssetSlot(panel, 'panel')
    ctx.group.add(panel)
    const edge = ctx.mats.get(0x05070c, {
      rough: 0.5,
      emissive: ctx.palette.accent,
      emissiveIntensity: 1.4,
    })
    ctx.group.add(mkMesh(ctx, ctx.geos.plane(0.09, 3.4), edge, px, 2.15, -3.28))
  }

  // Side paneling angled in — pulled inward (±5.6 sat outside the frustum
  // half-width ≈5.3 at this depth and never rendered).
  for (const sx of [-5.0, 5.0]) {
    const pane = buildSidePanel(ctx, 3.6, 3.4, 0.25, 0x1c2c50)
    pane.position.set(sx, 0.4, -3.6)
    ctx.group.add(pane)
    registerOccluder(ctx, sx, -3.6, 0.25, 3.4)
  }

  // Presenter desk (behind the actor slots).
  if (countIn(bp.props, 'desk') > 0) {
    const desk = buildDesk(ctx, 3.6)
    desk.position.set(0, 0, -2.5)
    tagAssetSlot(desk, 'desk')
    ctx.group.add(desk)
    ctx.group.add(
      bx(ctx, 3.9, 0.14, 1.15, ctx.mats.get(0x16233d, { rough: 0.8 }), 0, 0.07, -2.5)
    )
    const logo = ctx.mats.get(0x05070c, {
      rough: 0.3,
      emissive: 0x6366f1,
      emissiveIntensity: 1.4,
    })
    ctx.group.add(bx(ctx, 0.6, 0.11, 0.05, logo, 0, 0.62, -2.4))
  }

  // Studio light bars — LOWERED into frame (y4.2 sat above the Two-Shot
  // frame-top ≈3.5 at this depth; 3.2 reads as rigged set lighting).
  const barReq = bp.lights.find((l) => l.kind === 'studio_bar')
  const barLit = barReq?.lit ?? true
  const lightBarMat = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0xffffff,
    emissiveIntensity: barLit ? 2.2 : 0,
  })
  for (const lx of [-3.3, 3.3]) {
    ctx.group.add(bx(ctx, 1.0, 0.1, 0.18, lightBarMat, lx, 3.2, -2.6))
  }
  const lowBarMat = ctx.mats.get(0x05070c, {
    rough: 0.5,
    emissive: 0xfff4d6,
    emissiveIntensity: barLit ? 1.4 : 0,
  })
  ctx.group.add(bx(ctx, 0.9, 0.1, 0.16, lowBarMat, 0, 2.0, -4.9))
  ctx.group.add(bx(ctx, 0.9, 0.1, 0.16, lowBarMat, -4.4, 2.0, -3.4))

  // Side light columns (symmetry) + emissive floor strips. Columns pulled in
  // from ±4.9/z−1.2 (outside the frustum wedge) to ±3.3/z−1.6 where they
  // frame the anchors INSIDE the visible volume.
  for (const cx of [-3.3, 3.3]) {
    const col = buildLightColumn(ctx, 3.2, ctx.palette.accent)
    col.position.set(cx, 0, -1.6)
    ctx.group.add(col)
    registerFootprint(ctx, cx, -1.6, 0.35)
  }
  for (const sz of [-1.0, -3.2, -5.4]) {
    ctx.group.add(buildFloorStrip(ctx, 0.5, 7.5, ctx.palette.accent, 0.55, 0, sz))
  }
}

// ---------------------------------------------------------------------------
// CITY STREET COMPOSER — road canyon, instanced windows, lamps, silhouettes
// ---------------------------------------------------------------------------

function composeStreet(ctx: Ctx, bp: ResolvedEnvironment['blueprint']): void {
  if (countIn(bp.props, 'road') > 0) {
    const road = buildRoad(ctx, 24, ctx.details.rain)
    ctx.group.add(road)
  }

  const sidewalkCount = countIn(bp.props, 'sidewalk')
  for (let i = 0; i < sidewalkCount; i++) {
    const sw = buildSidewalk(ctx, 24)
    sw.position.set(i % 2 === 0 ? -4.35 : 4.35, 0.12, -2.5)
    tagAssetSlot(sw, 'sidewalk')
    ctx.group.add(sw)
  }

  // Building canyon — windows COLLECTED into one InstancedMesh.
  const buildingCount = countIn(bp.props, 'building')
  const buildPos: Array<[number, number]> = [
    [-4.6, -6.4], [4.6, -6.4],
    [-4.3, -4.0], [4.3, -4.0],
    [-4.6, -1.6], [4.6, -1.6],
  ]
  const windowPlacements: Placement[] = []
  for (let i = 0; i < buildingCount; i++) {
    const [sx, z] = buildPos[i % buildPos.length]
    const h = 4.2 + ctx.rng() * 3.2
    const b = buildBuilding(
      ctx,
      2.6 + ctx.rng() * 0.8,
      h,
      2.8,
      sx,
      z,
      windowPlacements,
      !ctx.details.abandoned || i % 2 === 0
    )
    b.position.set(sx, 0, z)
    tagAssetSlot(b, 'building')
    ctx.group.add(b)
    registerFootprint(ctx, sx, z, 1.8)
  }
  const winMat = ctx.mats.get(0x05070c, {
    rough: 0.4,
    emissive: ctx.night ? 0xffd28a : 0x9fc3ef,
    emissiveIntensity: ctx.details.abandoned ? 0.35 : 0.9,
  })
  ctx.group.add(
    mkInstanced(ctx, ctx.geos.plane(0.55, 0.7), winMat, windowPlacements, 'window_block')
  )

  // FAR layer: distant building silhouettes sinking into fog.
  const silhouettes: Placement[] = []
  for (let i = 0; i < 7; i++) {
    const x = -8 + i * 2.7 + (ctx.rng() - 0.5)
    const h = 5 + ctx.rng() * 4
    silhouettes.push({ x, y: h / 2, z: -11.5 - ctx.rng() * 2, sx: 2.2, sy: h, sz: 2 })
  }
  ctx.group.add(
    mkInstanced(
      ctx,
      ctx.geos.box(1, 1, 1),
      ctx.mats.get(ctx.night ? 0x0a0d14 : 0x141a26, { rough: 1 }),
      silhouettes,
      'city_silhouette'
    )
  )

  // Street lamps.
  const lampReq = bp.lights.find((l) => l.kind === 'street')
  const lampCount = Math.min(lampReq?.count ?? 3, 3)
  for (let i = 0; i < lampCount; i++) {
    const lamp = buildLampPost(ctx, 3.6, lampReq?.lit ?? true)
    lamp.position.set(i % 2 === 0 ? -3.9 : 3.9, 0.13, -4.5 + i * 4.2)
    lamp.rotation.y = i % 2 === 0 ? 0 : Math.PI
    tagAssetSlot(lamp, 'lamp')
    ctx.group.add(lamp)
  }

  // Fences at the side margins.
  const fenceCount = countIn(bp.props, 'fence')
  for (let i = 0; i < fenceCount; i++) {
    const pos = placeInZone(ctx, 1.0, i % 2 === 0 ? ZONES.sideL : ZONES.sideR)
    const fence = buildFence(ctx)
    fence.position.set(pos.x, 0.13, pos.z)
    fence.rotation.y = ctx.rng() > 0.5 ? 0 : Math.PI / 2
    ctx.group.add(fence)
  }
}

// ---------------------------------------------------------------------------
// COMPOSER TABLE + PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------

type Composer = (ctx: Ctx, bp: ResolvedEnvironment['blueprint']) => void

const COMPOSERS: Partial<Record<ResolvedEnvironment['locationKind'], Composer>> = {
  warehouse: composeWarehouse,
  railway: composeRailway,
  apartment: composeApartment,
  interior: (ctx, bp) =>
    composeInteriorRoom(ctx, bp, {
      warm: false,
      withChair: false,
      withWindow: false,
      withCabinet: false,
      withPictures: false,
    }),
  office: composeOffice,
  broadcast: composeBroadcast,
  street: composeStreet,
  forest: composeForest,
}

// ---------------------------------------------------------------------------
// Phase 2.1 CAMERA-FRUSTUM VISIBILITY DIAGNOSTIC (lightweight, always-on)
// ---------------------------------------------------------------------------
//
// Reference geometry of the DEFAULT Stage Two-Shot (App.tsx CINEMATIC_SHOTS
// two_shot_wide): pivot (0,1.35,0), radius 3.4, phi π/2.15, θ 0, FOV 46°
// (16:9) ⇒ camera at ≈(0, 1.70, +3.38) pitched down ≈5.8°. Closed-form
// frustum bounds at depth z (distance d = 3.38 − z):
//   half-width  ≈ 0.754·d      (tan(hFov/2) = tan23°·16/9)
//   frame-top y ≈ 1.70 + 0.309·d
// Every renderable mesh/instance is tested against these bounds; the counts
// land in group.userData so traces report CAMERA-VISIBLE composition instead
// of raw mesh totals ("objects exist" ≠ "the camera sees them").
const FRUSTUM_CAM_Z = 3.38
const FRUSTUM_HW_K = 0.754
const FRUSTUM_TOP_Y0 = 1.7
const FRUSTUM_TOP_K = 0.309

function countFrustumVisible(group: THREE.Group): { inFrame: number; total: number } {
  group.updateMatrixWorld(true)
  const wp = new THREE.Vector3()
  let inFrame = 0
  let total = 0
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.geometry || !mesh.visible) return
    const im = obj as THREE.InstancedMesh
    if ((im as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, _diagMat)
        wp.setFromMatrixPosition(_diagMat)
        im.localToWorld(wp)
        total++
        if (isInFrame(wp)) inFrame++
      }
      return
    }
    mesh.getWorldPosition(wp)
    total++
    if (isInFrame(wp)) inFrame++
  })
  return { inFrame, total }
}

function isInFrame(p: THREE.Vector3): boolean {
  const d = FRUSTUM_CAM_Z - p.z
  if (d <= 0.2) return false // at/behind the camera plane
  return (
    Math.abs(p.x) <= FRUSTUM_HW_K * d + 0.6 &&
    p.y <= FRUSTUM_TOP_Y0 + FRUSTUM_TOP_K * d + 0.6 &&
    p.y >= -0.4
  )
}

const _diagMat = new THREE.Matrix4()

/**
 * Compose the full procedural environment for a resolved blueprint.
 * Returns ONE Group containing static primitive geometry + InstancedMeshes —
 * no lights, no textures, no listeners — so replacing it fully disposes the
 * old world. userData carries the composition report:
 *   meshCount · instanceCount · propCensus · actorViolations ·
 *   cameraViolations · occlusionViolations · frustumVisible/frustumTotal
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
    geos: new GeometryBank(),
    palette: bp.palette,
    count: 0,
    instancedCount: 0,
    occupied: [],
    night: bp.timeOfDay === 'night',
    details: bp.details,
    census: new Map<string, number>(),
    actorViolations: 0,
    cameraViolations: 0,
    occlusionViolations: 0,
  }

  const composer = COMPOSERS[env.locationKind]
  if (composer) {
    composer(ctx, bp)
  } else {
    // Unknown bespoke kind → neutral room fallback (never empty).
    composeInteriorRoom(ctx, bp, {
      warm: false,
      withChair: false,
      withWindow: false,
      withCabinet: false,
      withPictures: false,
    })
  }

  group.userData.meshCount = ctx.count
  group.userData.instanceCount = ctx.instancedCount
  group.userData.propCensus = Object.fromEntries(ctx.census)
  group.userData.actorViolations = ctx.actorViolations
  group.userData.cameraViolations = ctx.cameraViolations
  group.userData.occlusionViolations = ctx.occlusionViolations
  const frustum = countFrustumVisible(group)
  group.userData.frustumVisible = frustum.inFrame
  group.userData.frustumTotal = frustum.total

  // Asset-assisted pass: asynchronously try to load and place the local
  // GLB/GLTF equivalents for tagged semantic slots. Missing assets keep the
  // procedural props already in the scene. Fire-and-forget; never blocks.
  void attachAssetOverlays(group, env).catch((err) => {
    console.warn('Environment asset overlay failed:', err)
  })

  return group
}