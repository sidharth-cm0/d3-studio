/**
 * Entity Visual Resolver — standalone scene-entity → THREE.Object32 converter.
 *
 * Input:  ResolvedSceneObject (authoritative transform from spatialLayoutEngine)
 * Output: THREE.Group / Object3D with lightweight procedural geometry
 *
 * Deterministic. No app routing, no dynamicEnvironment semantics. Pure
 * geometry realization of a resolved entity's semanticType + transform.
 */

import * as THREE from 'three'
import type { ResolvedSceneObject } from './spatialLayoutEngine'

// ---------------------------------------------------------------------------
// Semantic alias normalization
// ---------------------------------------------------------------------------

export function resolveVisualCategory(semanticType: string): string {
  const t = (semanticType || '').toLowerCase()
  const map: Record<string, string> = {
    box: 'crate',
    cargo_box: 'crate',
    cargo: 'crate',
    container: 'crate',
    shipping_container: 'crate',
    doorway: 'door',
    entrance: 'door',
    lamp: 'lamp',
    light: 'lamp',
    light_post: 'streetlight',
    street_lamp: 'streetlight',
    lamp_post: 'streetlight',
    couch: 'sofa',
    seat: 'chair',
    stool: 'chair',
    workbench: 'table',
    desk: 'table',
    counter: 'table',
    machine: 'machinery',
    generator: 'machinery',
    reactor: 'machinery',
    apparatus: 'machinery',
    device: 'machinery',
    lab_machine: 'machinery',
    scientific_machine: 'machinery',
    column: 'pillar',
    stone_column: 'pillar',
  }
  if (map[t]) return map[t]
  if (t.includes('door')) return 'door'
  if (t.includes('lamp') || t.includes('light')) return t.includes('street') || t.includes('post') ? 'streetlight' : 'lamp'
  if (t.includes('crate') || t.includes('box') || t.includes('cargo')) return 'crate'
  if (t.includes('sofa') || t.includes('couch')) return 'sofa'
  if (t.includes('chair') || t.includes('seat') || t.includes('stool')) return 'chair'
  if (t.includes('table') || t.includes('desk') || t.includes('counter') || t.includes('bench')) return 'table'
  if (t.includes('machine') || t.includes('generator') || t.includes('reactor') || t.includes('apparatus') || t.includes('device')) return 'machinery'
  if (t.includes('pillar') || t.includes('column')) return 'pillar'
  return t
}

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

function mat(color: number, rough = 0.8, metal = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
}

function mesh(geo: THREE.BufferGeometry, material: THREE.MeshStandardMaterial, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z)
  m.matrixAutoUpdate = false
  m.updateMatrix()
  return m
}

// ---------------------------------------------------------------------------
// Builders — each returns a THREE.Group centered at local origin (base pivot)
// ---------------------------------------------------------------------------

function buildCrate(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const body = mat(0x6b5638, 0.9, 0.05)
  g.add(mesh(new THREE.BoxGeometry(w, h, d), body, 0, 0, 0))
  const frame = mat(0x4a3826, 0.95, 0.05)
  const t = 0.04
  g.add(mesh(new THREE.BoxGeometry(w + t, t, d + t), frame, 0, h / 2, 0))
  g.add(mesh(new THREE.BoxGeometry(w + t, t, d + t), frame, 0, -h / 2, 0))
  return g
}

function buildDoor(w: number, h: number): THREE.Group {
  const g = new THREE.Group()
  const frame = mat(0x3a2e22, 0.85, 0.05)
  const ft = 0.12
  g.add(mesh(new THREE.BoxGeometry(w + ft * 2, h + ft, 0.1), frame, 0, 0, 0))
  const panel = mat(0x5c4531, 0.8, 0.05)
  g.add(mesh(new THREE.BoxGeometry(w, h, 0.08), panel, 0, -0.05, 0.02))
  const knob = mat(0xb8942e, 0.4, 0.8)
  g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), knob, w * 0.35, -0.05, 0.08))
  return g
}

function buildLamp(): THREE.Group {
  const g = new THREE.Group()
  const metal = mat(0x2a2f36, 0.4, 0.7)
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.6, 8), metal, 0, 0.8, 0))
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10), metal, 0, 0.0, 0))
  const head = mat(0xfff2c0, 0.3, 0.2)
  g.add(mesh(new THREE.ConeGeometry(0.18, 0.22, 10), head, 0, 1.6 - 0.05, 0))
  return g
}

function buildStreetlight(): THREE.Group {
  const g = new THREE.Group()
  const metal = mat(0x1f242c, 0.4, 0.75)
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 3.4, 8), metal, 0, 1.7, 0))
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 10), metal, 0, 0.02, 0))
  const arm = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), metal, 0, 3.2, 0)
  arm.rotation.z = Math.PI / 2
  arm.updateMatrix()
  g.add(arm)
  const head = mat(0xfff2c0, 0.3, 0.2)
  g.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), head, 0.3, 3.2, 0))
  return g
}

function buildSofa(w: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const fabric = mat(0x4a5a6a, 0.9, 0.02)
  const seatH = 0.4
  g.add(mesh(new THREE.BoxGeometry(w, seatH, d), fabric, 0, seatH / 2, 0))
  g.add(mesh(new THREE.BoxGeometry(w, 0.5, 0.15), fabric, 0, seatH + 0.25, -d / 2 + 0.07))
  g.add(mesh(new THREE.BoxGeometry(0.15, 0.45, d), fabric, -w / 2 + 0.07, seatH + 0.22, 0))
  g.add(mesh(new THREE.BoxGeometry(0.15, 0.45, d), fabric, w / 2 - 0.07, seatH + 0.22, 0))
  const cushion = mat(0x5c6e80, 0.95, 0.02)
  g.add(mesh(new THREE.BoxGeometry(w * 0.4, 0.12, d * 0.7), cushion, -w * 0.25, seatH + 0.06, 0.02))
  g.add(mesh(new THREE.BoxGeometry(w * 0.4, 0.12, d * 0.7), cushion, w * 0.25, seatH + 0.06, 0.02))
  return g
}

function buildChair(w: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const wood = mat(0x5c4531, 0.8, 0.05)
  const seatH = 0.45
  g.add(mesh(new THREE.BoxGeometry(w, 0.06, d), wood, 0, seatH, 0))
  g.add(mesh(new THREE.BoxGeometry(w, 0.5, 0.06), wood, 0, seatH + 0.25, -d / 2 + 0.03))
  const legGeo = new THREE.BoxGeometry(0.06, seatH, 0.06)
  const lx = w / 2 - 0.05
  const lz = d / 2 - 0.05
  g.add(mesh(legGeo, wood, lx, seatH / 2, lz))
  g.add(mesh(legGeo, wood, -lx, seatH / 2, lz))
  g.add(mesh(legGeo, wood, lx, seatH / 2, -lz))
  g.add(mesh(legGeo, wood, -lx, seatH / 2, -lz))
  return g
}

function buildTable(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const wood = mat(0x6b5638, 0.8, 0.05)
  g.add(mesh(new THREE.BoxGeometry(w, 0.06, d), wood, 0, h, 0))
  const legGeo = new THREE.BoxGeometry(0.07, h, 0.07)
  const lx = w / 2 - 0.08
  const lz = d / 2 - 0.08
  g.add(mesh(legGeo, wood, lx, h / 2, lz))
  g.add(mesh(legGeo, wood, -lx, h / 2, lz))
  g.add(mesh(legGeo, wood, lx, h / 2, -lz))
  g.add(mesh(legGeo, wood, -lx, h / 2, -lz))
  return g
}

function buildMachinery(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group()
  const body = mat(0x3a4048, 0.6, 0.5)
  g.add(mesh(new THREE.BoxGeometry(w, h, d), body, 0, h / 2, 0))
  const panel = mat(0x1a2c3a, 0.4, 0.6)
  g.add(mesh(new THREE.BoxGeometry(w * 0.6, h * 0.3, 0.05), panel, 0, h * 0.7, d / 2 + 0.01))
  const pipe = mat(0x6a6a6a, 0.5, 0.7)
  const p1 = mesh(new THREE.CylinderGeometry(0.06, 0.06, h * 0.8, 8), pipe, -w / 2 - 0.05, h * 0.5, 0)
  p1.rotation.z = Math.PI / 2
  p1.updateMatrix()
  g.add(p1)
  const p2 = mesh(new THREE.CylinderGeometry(0.05, 0.05, h * 0.6, 8), pipe, w / 2 + 0.05, h * 0.4, d * 0.3)
  p2.rotation.z = Math.PI / 2
  p2.updateMatrix()
  g.add(p2)
  const dial = mat(0xb8942e, 0.3, 0.8)
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), dial, w * 0.2, h * 0.7, d / 2 + 0.04))
  return g
}

function buildPillar(h: number): THREE.Group {
  const g = new THREE.Group()
  const stone = mat(0x8a8d94, 0.85, 0.05)
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.2, 0.9), stone, 0, 0.1, 0))
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.4, h, 12), stone, 0, h / 2 + 0.2, 0))
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.2, 0.9), stone, 0, h + 0.2, 0))
  return g
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildEntityVisual(object: ResolvedSceneObject): THREE.Object3D | null {
  const category = resolveVisualCategory(object.semanticType)
  const [sx, sy, sz] = object.scale

  let node: THREE.Group

  switch (category) {
    case 'crate':
      node = buildCrate(Math.max(0.3, sx), Math.max(0.3, sy), Math.max(0.3, sz))
      break
    case 'door':
      node = buildDoor(Math.max(0.6, sx), Math.max(1.0, sy))
      break
    case 'lamp':
      node = buildLamp()
      break
    case 'streetlight':
      node = buildStreetlight()
      break
    case 'sofa':
      node = buildSofa(Math.max(0.8, sx), Math.max(0.5, sz))
      break
    case 'chair':
      node = buildChair(Math.max(0.3, sx), Math.max(0.3, sz))
      break
    case 'table':
      node = buildTable(Math.max(0.5, sx), Math.max(0.4, sy), Math.max(0.3, sz))
      break
    case 'machinery':
      node = buildMachinery(Math.max(0.5, sx), Math.max(0.5, sy), Math.max(0.5, sz))
      break
    case 'pillar':
      node = buildPillar(Math.max(1.0, sy))
      break
    default:
      node = buildCrate(Math.max(0.3, sx), Math.max(0.3, sy), Math.max(0.3, sz))
      break
  }

  // Apply authoritative resolved transform.
  node.position.set(object.position[0], object.position[1], object.position[2])
  node.rotation.set(object.rotation[0], object.rotation[1], object.rotation[2])

  // Stable identity.
  node.name = `entity:${object.sourceSpecId}:${object.semanticType}`
  node.userData = {
    sourceSpecId: object.sourceSpecId,
    semanticType: object.semanticType,
    category,
    importance: object.importance,
    zone: object.zone,
    actorSafe: object.actorSafe,
    occlusionSafe: object.occlusionSafe,
    cameraVisible: object.cameraVisible,
  }

  node.matrixAutoUpdate = false
  node.updateMatrix()
  return node
}