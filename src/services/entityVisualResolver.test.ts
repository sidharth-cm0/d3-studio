/**
 * Entity Visual Resolver — self-test.
 *
 * Verifies:
 *  - all 8 supported categories return an Object3D
 *  - generated objects contain visible Mesh children
 *  - output uses the resolved transform
 *  - stable name/userData is present
 *  - same input produces deterministic structure
 */

import * as THREE from 'three'
import { buildEntityVisual, resolveVisualCategory } from './entityVisualResolver'
import type { ResolvedSceneObject } from './spatialLayoutEngine'

function makeEntity(
  id: string,
  semanticType: string,
  scale: [number, number, number] = [1, 1, 1],
  position: [number, number, number] = [1.5, 0.5, -3.0],
  rotation: [number, number, number] = [0, 0.5, 0]
): ResolvedSceneObject {
  return {
    sourceSpecId: id,
    semanticType,
    importance: 'supporting',
    position,
    rotation,
    scale,
    zone: 'midground',
    cameraVisible: true,
    actorSafe: true,
    occlusionSafe: true,
    fallbackPrimitive: 'compound',
  }
}

function countMeshes(obj: THREE.Object3D): number {
  let n = 0
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ })
  return n
}

interface TestCase {
  label: string
  entity: ResolvedSceneObject
  expectedCategory: string
}

const cases: TestCase[] = [
  { label: 'crate (box alias)', entity: makeEntity('box1', 'box'), expectedCategory: 'crate' },
  { label: 'door', entity: makeEntity('door1', 'door'), expectedCategory: 'door' },
  { label: 'lamp', entity: makeEntity('lamp1', 'lamp'), expectedCategory: 'lamp' },
  { label: 'streetlight (alias)', entity: makeEntity('sl1', 'street_lamp'), expectedCategory: 'streetlight' },
  { label: 'sofa', entity: makeEntity('sofa1', 'sofa'), expectedCategory: 'sofa' },
  { label: 'chair', entity: makeEntity('chair1', 'chair'), expectedCategory: 'chair' },
  { label: 'table', entity: makeEntity('table1', 'table'), expectedCategory: 'table' },
  { label: 'machinery', entity: makeEntity('mach1', 'machine'), expectedCategory: 'machinery' },
  { label: 'pillar', entity: makeEntity('pillar1', 'pillar'), expectedCategory: 'pillar' },
]

let failures = 0
const fail = (msg: string) => { failures++; console.error(`FAIL: ${msg}`) }

for (const c of cases) {
  const node = buildEntityVisual(c.entity)
  if (!node) { fail(`${c.label}: returned null`); continue }
  if (countMeshes(node) === 0) { fail(`${c.label}: no mesh children`) }
  if (node.name !== `entity:${c.entity.sourceSpecId}:${c.entity.semanticType}`) {
    fail(`${c.label}: unexpected name "${node.name}"`)
  }
  const ud = node.userData as Record<string, unknown>
  if (ud.sourceSpecId !== c.entity.sourceSpecId) fail(`${c.label}: userData.sourceSpecId mismatch`)
  if (ud.category !== c.expectedCategory) fail(`${c.label}: category "${ud.category}" !== "${c.expectedCategory}"`)
  if (ud.semanticType !== c.entity.semanticType) fail(`${c.label}: userData.semanticType mismatch`)
}

// Transform application
const txEntity = makeEntity('tx1', 'chair', [1.2, 1.0, 0.8], [2.0, 0.45, -4.0], [0, Math.PI / 4, 0])
const txNode = buildEntityVisual(txEntity)
if (txNode) {
  if (Math.abs(txNode.position.x - 2.0) > 1e-6 || Math.abs(txNode.position.y - 0.45) > 1e-6 || Math.abs(txNode.position.z - (-4.0)) > 1e-6) {
    fail(`transform: position not applied (${txNode.position.x},${txNode.position.y},${txNode.position.z})`)
  }
  if (Math.abs(txNode.rotation.y - Math.PI / 4) > 1e-6) {
    fail(`transform: rotation.y not applied (${txNode.rotation.y})`)
  }
}

// Determinism: same input → identical structure
const d1 = buildEntityVisual(makeEntity('d1', 'sofa', [2, 1, 1], [0, 0, -2])) as THREE.Group
const d2 = buildEntityVisual(makeEntity('d1', 'sofa', [2, 1, 1], [0, 0, -2])) as THREE.Group
if (d1 && d2) {
  if (d1.children.length !== d2.children.length) fail('determinism: child count differs')
  if (d1.name !== d2.name) fail('determinism: name differs')
  if (countMeshes(d1) !== countMeshes(d2)) fail('determinism: mesh count differs')
}

// Alias normalization sanity
if (resolveVisualCategory('cargo_box') !== 'crate') fail('alias: cargo_box -> crate')
if (resolveVisualCategory('street_lamp') !== 'streetlight') fail('alias: street_lamp -> streetlight')
if (resolveVisualCategory('couch') !== 'sofa') fail('alias: couch -> sofa')
if (resolveVisualCategory('column') !== 'pillar') fail('alias: column -> pillar')

if (failures === 0) {
  console.log(`PASS: entityVisualResolver — ${cases.length} categories, transforms, determinism, aliases OK`)
} else {
  throw new Error(`entityVisualResolver — ${failures} failure(s)`)
}
