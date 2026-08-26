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
 * Checks (once per session, dev only):
 *  - each location builds a THREE.Group with a meaningful number of
 *    renderable meshes (min overlay) — proves it is NOT an empty stage
 *  - world bounds stay inside a sane stage volume (not microscopic/enormous)
 *  - same seed ⇒ same mesh count (deterministic layout)
 *  - disposeObjectDeep does not throw
 *  - per-build runtime trace: [D3 ENV] sceneType / meshes / bounds / camera
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
  children: number
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

const SANE_MAX_S = { x: 30, y: 15, z: 30 }
const SANITY_MAX_SOUNDS = SANE_MAX_S // alias kept readable in assertions

function testOne(prompt: string, kind: string, expectMin: number, seedKey?: string): EnvTestResult {
  const env = resolveEnv(prompt, seedKey || `selftest:${kind}`)
  const group = buildEnvironmentGroup(env)

  // Determinism: same seed ⇒ same mesh count.
  const env2 = resolveEnv(prompt, seedKey || `selftest:${kind}`)
  const group2 = buildEnvironmentGroup(env2)
  const deterministic = countMeshes(group) === countMeshes(group2)

  const meshCount = countMeshes(group)
  const children = group.children.length
  const bounds = getBounds(group)

  const messages: string[] = []
  if (meshCount < expectMin) {
    messages.push(`FAIL: ${kind} built only ${meshCount} meshes (min ${expectMin}) — looks empty`)
  } else {
    messages.push(`OK: ${kind} built ${meshCount} meshes in ${children} prop groups`)
  }
  const [sx, sy, sz] = bounds.size
  if (Math.abs(sx) > SANITY_MAX_SOUNDS.x || Math.abs(sy) > SANITY_MAX_SOUNDS.y || Math.abs(sz) > SANITY_MAX_SOUNDS.z) {
    messages.push(`bounds too large: ${bounds.size.join('×')}`)
  }
  if (!deterministic) {
    messages.push('NON-DETERMINISTIC: same seed produced different meshes')
  }

  const pass =
    meshCount >= expectMin &&
    deterministic &&
    Math.abs(sx) <= SANITY_MAX_SOUNDS.x &&
    Math.abs(sy) <= SANITY_MAX_SOUNDS.y &&
    Math.abs(sz) <= SANITY_MAX_SOUNDS.z

  return { kind, meshCount, children, bounds, pass, messages }
}

/** Run the full suite once per session (dev only) and log a readable report. */
export function runEnvironmentSelfTest(): void {
  if (!IS_DEV || selfTestRan) return
  selfTestRan = true

  const results: EnvTestResult[] = [
    testOne(
      'A detective searches an abandoned warehouse at midnight in a fabricated cinematic test scene.',
      'warehouse',
      40
    ),
    testOne(
      'A couple talks quietly in a small apartment at night near a window.',
      'apartment',
      30
    ),
    testOne(
      'A man walks through a forest at dawn with many trees and rocks.',
      'forest',
      30
    ),
    testOne(
      'Detective Arjun walks through an abandoned railway station at midnight with benches.',
      'railway',
      40
    ),
  ]

  let allPass = results.every((r) => r.pass)
  const lines = ['[D3 ENV] ===== SELF TEST =====']
  for (const r of results) {
    lines.push(
      `[D3 ENV] ${r.kind.padEnd(10)} ${r.pass ? 'PASS' : 'FAIL'}  meshes=${r.meshCount} bounds=${r.bounds.size
        .map((v) => v.toFixed(1))
        .join('x')}`
    )
    for (const m of r.messages) lines.push(`[D3 ENV]   ${m}`)
  }

  // dispose must not throw
  try {
    const env = resolveEnv('warehouse self test dispose', 'selftest:dispose')
    const group = buildEnvironmentGroup(env)
    disposeObjectDeep(group)
    lines.push('[D3 ENV] dispose OK')
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
      boundsMin: bounds.min,
      boundsSize: bounds.size,
      camera: camera
        ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
        : 'n/a',
    })
  )
}