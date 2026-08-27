/**
 * Environment Self-Test — DEVELOPMENT ONLY.
 *
 * Verifies the actual RENDERABLE output of the procedural environment system
 * (not the resolver metadata) and prints a `[D3 ENV]` trace on every stage
 * build when running under Vite dev (`import.meta.env.DEV`).
 *
 * The whole module is inert in production builds: `import.meta.env.DEV` is
 * statically replaced with `false` by Vite/rollup, so all of this code is
 * tree-shaken out of the production bundle.
 *
 * Phase 2 checks (once per session, dev only) — for each REQUIRED test prompt:
 *  - category resolved correctly (semantic detection, not just colors)
 *  - real mesh count ≥ minimum AND instanced props present where expected
 *  - SEMANTIC PROP CENSUS: recognized props (tree/rock/crate/bench…) counted
 *  - DEPTH LAYERS: geometry present in near/mid/far z bands
 *  - ACTOR-SAFE ZONE: zero footprint violations around (±0.75, 0, 0)
 *    and the camera↔actor sightline
 *  - same seed ⇒ same mesh count (deterministic layout)
 *  - disposeObjectDeep does not throw
 */

import * as THREE from 'three'
import {
  EnvironmentResolverService,
  type ResolvedEnvironment,
} from './environmentResolver'
import { buildEnvironmentGroup, disposeObjectDeep } from './environmentStage'

const IS_DEV = import.meta.env.DEV
let selfTestRan = false

export interface EnvTestResult {
  kind: string
  meshCount: number
  instanceCount: number
  children: number
  census: Record<string, number>
  depthLayers: { near: number; mid: number; far: number }
  actorViolations: number
  cameraViolations: number
  /** Phase 2.1 — large opaque slabs blocking the central frame. */
  occlusionViolations: number
  /** Phase 2.1 — renderable objects inside the default Two-Shot frustum. */
  frustumVisible: number
  frustumTotal: number
  bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] }
  pass: boolean
  messages: string[]
}

function countMeshes(group: THREE.Group): number {
  let n = 0
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.geometry) n++
  })
  return n
}

function countInstances(group: THREE.Group): number {
  let n = 0
  group.traverse((obj) => {
    const im = obj as THREE.InstancedMesh
    if ((im as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      n += im.count
    }
  })
  return n
}

/**
 * Count renderable objects per depth band. InstancedMeshes contribute one
 * entry PER INSTANCE at its own world position — a packed background tree
 * wall counts as the 13 trees it actually renders, not one blob.
 */
function depthBands(group: THREE.Group): { near: number; mid: number; far: number } {
  const bands = { near: 0, mid: 0, far: 0 }
  const wp = new THREE.Vector3()
  group.updateMatrixWorld(true)
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.geometry || !mesh.visible) return
    const im = obj as THREE.InstancedMesh
    if ((im as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, _scratchMat)
        wp.setFromMatrixPosition(_scratchMat)
        im.localToWorld(wp)
        // NEAR dressing (frame edges / foreground), MID structures, FAR silhouettes.
        if (wp.z > -3.2 && Math.abs(wp.x) > 1.8) bands.near++
        else if (wp.z > -6.5) bands.mid++
        else bands.far++
      }
      return
    }
    mesh.getWorldPosition(wp)
    if (wp.z > -3.2 && Math.abs(wp.x) > 1.8) bands.near++
    else if (wp.z > -6.5) bands.mid++
    else bands.far++
  })
  return bands
}

const _scratchMat = new THREE.Matrix4()

function getBounds(group: THREE.Group): {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
} {
  const box = new THREE.Box3().setFromObject(group)
  const min = box.min.toArray()
  const max = box.max.toArray()
  const size = new THREE.Vector3()
  box.getSize(size)
  return {
    min: min as [number, number, number],
    max: max as [number, number, number],
    size: size.toArray() as [number, number, number],
  }
}

function resolveEnv(prompt: string, seedKey: string): ResolvedEnvironment {
  return EnvironmentResolverService.resolve({
    searchText: prompt,
    fallbackPreset: 'cyberpunk',
    seedKey,
  })
}

const SANE_MAX_S = { x: 34, y: 18, z: 34 }

interface TestSpec {
  prompt: string
  kind: string
  expectMin: number
  /** Census keys that MUST appear for the composition to be meaningful. */
  requireProps: string[]
  /** Categories expected to use InstancedMesh packing. */
  expectInstances?: boolean
}

const TEST_SPECS: TestSpec[] = [
  {
    prompt: 'A man walks through a forest at dawn.',
    kind: 'forest',
    expectMin: 30,
    requireProps: ['tree', 'rock', 'bush', 'terrain', 'path'],
    expectInstances: true,
  },
  {
    prompt: 'A detective searches an abandoned warehouse at midnight.',
    kind: 'warehouse',
    expectMin: 40,
    requireProps: ['crate', 'pillar', 'rack_upright', 'barrel', 'pallet_deck'],
    expectInstances: true,
  },
  {
    prompt: 'Detective Arjun walks through an abandoned railway station at midnight.',
    kind: 'railway',
    expectMin: 40,
    requireProps: ['platform', 'track', 'bench', 'sign', 'tunnel_arch'],
    expectInstances: true,
  },
  {
    prompt: 'A couple talks quietly in a small apartment at night.',
    kind: 'apartment',
    expectMin: 30,
    requireProps: ['sofa', 'table', 'window', 'doorway', 'shelf', 'rug'],
  },
  {
    prompt: 'A journalist presents breaking news in a television studio.',
    kind: 'broadcast',
    expectMin: 30,
    requireProps: ['desk', 'screen', 'wall', 'light_column', 'floor_strip'],
  },
]

function testOne(spec: TestSpec): EnvTestResult {
  const env = resolveEnv(spec.prompt, `selftest:${spec.kind}`)
  const group = buildEnvironmentGroup(env)

  // Determinism: same seed ⇒ same mesh count.
  const env2 = resolveEnv(spec.prompt, `selftest:${spec.kind}`)
  const group2 = buildEnvironmentGroup(env2)
  const deterministic = countMeshes(group) === countMeshes(group2)

  const meshCount = countMeshes(group)
  const instanceCount = countInstances(group)
  const children = group.children.length
  const census = (group.userData.propCensus ?? {}) as Record<string, number>
  const depthLayers = depthBands(group)
  const actorViolations = Number(group.userData.actorViolations ?? 0)
  const cameraViolations = Number(group.userData.cameraViolations ?? 0)
  const bounds = getBounds(group)

  const occlusionViolations = Number(group.userData.occlusionViolations ?? 0)
  const frustumVisible = Number(group.userData.frustumVisible ?? 0)
  const frustumTotal = Number(group.userData.frustumTotal ?? 0)

  const messages: string[] = []
  let pass = true

  // 1) Category detection.
  if (env.locationKind !== spec.kind) {
    messages.push(`FAIL: resolved '${env.locationKind}' but expected '${spec.kind}'`)
    pass = false
  }

  // 2) Mesh budget.
  if (meshCount < spec.expectMin) {
    messages.push(`FAIL: built only ${meshCount} meshes (min ${spec.expectMin}) — looks empty`)
    pass = false
  }

  // 3) Semantic prop registry — every required prop must exist in the census.
  for (const key of spec.requireProps) {
    if (!census[key]) {
      messages.push(`FAIL: missing required prop '${key}' in census`)
      pass = false
    }
  }

  // 4) Depth layers — every band must carry geometry.
  if (depthLayers.near === 0 || depthLayers.mid === 0 || depthLayers.far === 0) {
    messages.push(
      `FAIL: flat composition — depth bands near=${depthLayers.near} mid=${depthLayers.mid} far=${depthLayers.far}`
    )
    pass = false
  }

  // 5) Instancing where expected.
  if (spec.expectInstances && instanceCount === 0) {
    messages.push('FAIL: no InstancedMesh instances (expected packed repeated props)')
    pass = false
  }

  // 6) Actor/camera safety.
  if (actorViolations > 0 || cameraViolations > 0) {
    messages.push(`FAIL: safety violations actors=${actorViolations} camera=${cameraViolations}`)
    pass = false
  }

  // 7) Determinism.
  if (!deterministic) {
    messages.push('NON-DETERMINISTIC: same seed produced different meshes')
    pass = false
  }

  // 8) Sane bounds.
  const [sx, sy, sz] = bounds.size
  if (Math.abs(sx) > SANE_MAX_S.x || Math.abs(sy) > SANE_MAX_S.y || Math.abs(sz) > SANE_MAX_S.z) {
    messages.push(`bounds too large: ${bounds.size.join('×')}`)
    pass = false
  }

  // 9) Phase 2.1 — VISUAL OCCLUSION: no giant opaque slab between the default
  // Two-Shot camera and the actor zone (the apartment blocking-plane failure).
  if (occlusionViolations > 0) {
    messages.push(`FAIL: ${occlusionViolations} occluder(s) block the central frame`)
    pass = false
  }

  // 10) Phase 2.1 — CAMERA-FRUSTUM READABILITY: a meaningful share of the
  // renderable objects must sit inside the default Two-Shot frustum.
  const visibleRatio = frustumTotal > 0 ? frustumVisible / frustumTotal : 0
  if (visibleRatio < 0.45) {
    messages.push(
      `FAIL: only ${frustumVisible}/${frustumTotal} (${Math.round(visibleRatio * 100)}%) of objects are inside the default camera frustum`
    )
    pass = false
  }

  if (pass) {
    messages.push(
      `OK: ${meshCount} meshes (${children} groups), ${instanceCount} instances, ` +
        `frustum-visible ${frustumVisible}/${frustumTotal} (${Math.round(visibleRatio * 100)}%)`
    )
  }

  return {
    kind: spec.kind,
    meshCount,
    instanceCount,
    children,
    census,
    depthLayers,
    actorViolations,
    cameraViolations,
    occlusionViolations,
    frustumVisible,
    frustumTotal,
    bounds,
    pass,
    messages,
  }
}

/** Run the full suite once per session (dev only) and log a readable report. */
export function runEnvironmentSelfTest(): void {
  if (!IS_DEV || selfTestRan) return
  selfTestRan = true

  const results: EnvTestResult[] = TEST_SPECS.map(testOne)

  let allPass = results.every((r) => r.pass)
  const lines = ['[D3 ENV] ===== SELF TEST (Phase 2) =====']
  for (const r of results) {
    lines.push(
      `[D3 ENV] ${r.kind.padEnd(10)} ${r.pass ? 'PASS' : 'FAIL'}  meshes=${r.meshCount} instances=${r.instanceCount} ` +
        `depth(n/m/f)=${r.depthLayers.near}/${r.depthLayers.mid}/${r.depthLayers.far} ` +
        `safety(a/c/o)=${r.actorViolations}/${r.cameraViolations}/${r.occlusionViolations}`
    )
    lines.push(`[D3 ENV]   props: ${JSON.stringify(r.census)}`)
    for (const m of r.messages) lines.push(`[D3 ENV]   ${m}`)
  }

  // Dispose must not throw (and must not break a second call).
  try {
    const env = resolveEnv('warehouse self test dispose', 'selftest:dispose')
    const group = buildEnvironmentGroup(env)
    disposeObjectDeep(group)
    disposeObjectDeep(group) // idempotency check
    lines.push('[D3 ENV] dispose OK (double-dispose safe)')
  } catch (err) {
    allPass = false
    lines.push(`[D3 ENV] dispose FAILED: ${err}`)
  }

  lines.push(`[D3 ENV] all = ${allPass ? 'PASS' : 'FAIL'}`)
  if (IS_DEV) console.info(lines.join('\n'))
}

/** ONE per-build runtime trace (dev only): logs the live environment state. */
export function logRuntimeEnvTrace(
  env: ResolvedEnvironment,
  group: THREE.Group,
  camera?: THREE.PerspectiveCamera | null
): void {
  if (!import.meta.env.DEV) return
  const meshCount = countMeshes(group)
  const bounds = getBounds(group)
  console.info(
    '[D3 ENV]',
    JSON.stringify({
      sceneType: env.locationKind,
      locationId: env.blueprint.category,
      resolvedEnvironment: env.label,
      requestedAssets: env.blueprint.props.map((p) => p.type),
      loadedAssets: [],
      failedAssets: [],
      fallbackAssets: env.blueprint.props.length, // all procedural until GLBs arrive
      environmentChildren: group.children.length,
      environmentMeshes: meshCount,
      instanceCount: group.userData.instanceCount ?? 0,
      propCensus: group.userData.propCensus ?? {},
      actorSafeZone: {
        violations: group.userData.actorViolations ?? 0,
        halfX: env.blueprint.actorSafeZone.halfX,
        halfZ: env.blueprint.actorSafeZone.halfZ,
      },
      cameraViolations: group.userData.cameraViolations ?? 0,
      boundsMin: bounds.min,
      boundsSize: bounds.size,
      camera: camera
        ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
        : 'n/a',
    })
  )
}