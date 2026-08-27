/**
 * Spatial Layout Engine — Self-Test Runner (PHASE 3).
 *
 * Verifies:
 *  - determinism            (same seed ⇒ identical transforms)
 *  - actor safety           (no prop intersects the 1.2 m actor zone)
 *  - hero visibility        (hero objects inside the Two-Shot frustum)
 *  - large wall safety      (rear wall behind actors, no camera blocking)
 *  - scale normalization    (absurd parser/LLM scale clamped to human scale)
 *  - orientation            (face_camera / upright / flat resolution)
 *  - bounded collision retries (MAX_COLLISION_RETRIES respected)
 *  - scene stress tests     (Mars layout, cyberpunk tea shop)
 *
 * Usage: compile + run with node (the project has no ts-node dev runner):
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-layout-test \
 *     src/services/sceneGraphTypes.ts \
 *     src/services/spatialLayoutEngine.ts \
 *     src/services/spatialLayoutEngine.test.ts
 *   node /tmp/d3-layout-test/spatialLayoutEngine.test.js
 */

import {
  ACTOR_SAFETY_RADIUS,
  DEFAULT_ACTOR_ANCHORS,
  MAX_COLLISION_RETRIES,
  planLayout,
  twoShotWideCamera,
  type LayoutInput,
  type ResolvedSceneObject,
} from './spatialLayoutEngine'
import { mulberry32 } from './spatialLayoutEngine'
import type { SceneGraph, SceneImportance, SceneObjectSpec } from './sceneGraphTypes'

// ---------------------------------------------------------------------------
// Test spec factory
// ---------------------------------------------------------------------------

function makeSpec(
  id: string,
  semanticType: string,
  importance: SceneImportance,
  scale: [number, number, number] = [1, 1, 1],
  rotationY = 0
): SceneObjectSpec {
  return {
    id,
    semanticType,
    tags: [semanticType],
    importance,
    primitiveFallback: 'compound',
    position: [0, 0, 0],
    rotation: [0, rotationY, 0],
    scale,
    zone: importance === 'hero' ? 'midground' : 'background',
    avoidActors: true,
    cameraImportant: importance !== 'dressing',
  }
}

function makeInput(seed: number, objects: SceneObjectSpec[]): LayoutInput {
  const sg = {} as SceneGraph
  return { sceneGraph: sg, objects, seed }
}

function dist2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

const pass = (name: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

export function runSpatialLayoutSelfTest(): void {
  const camera = twoShotWideCamera()
  const anchors = DEFAULT_ACTOR_ANCHORS

  console.log('[D3 LAYOUT] Self-Test')

  // --- 1. Determinism ------------------------------------------------------
  console.group('  determinism')
  const detObjects = [
    makeSpec('a', 'spaceship', 'hero'),
    makeSpec('b', 'rock', 'dressing', [0.5, 0.5, 0.5]),
    makeSpec('c', 'crate', 'dressing'),
    makeSpec('d', 'bench', 'supporting'),
  ]
  const r1 = planLayout(makeInput(12345, detObjects))
  const r2 = planLayout(makeInput(12345, detObjects))
  const r3 = planLayout(makeInput(999, detObjects))
  let identical = r1.objects.length === r2.objects.length
  for (let i = 0; i < r1.objects.length && identical; i++) {
    const a = r1.objects[i]
    const b = r2.objects[i]
    identical =
      a.position[0] === b.position[0] &&
      a.position[1] === b.position[1] &&
      a.position[2] === b.position[2] &&
      a.rotation[1] === b.rotation[1] &&
      a.scale[0] === b.scale[0]
  }
  let differentSeedDiffers = false
  for (let i = 0; i < r1.objects.length; i++) {
    if (r1.objects[i].position[0] !== r3.objects[i].position[0]) {
      differentSeedDiffers = true
      break
    }
  }
  pass('same seed → identical transforms', identical)
  pass('different seed → different layout', differentSeedDiffers)
  console.groupEnd()

  // --- 2. Actor safety -----------------------------------------------------
  console.group('  actor safety')
  const actorObjects = [
    makeSpec('h', 'machine', 'hero', [1, 1, 1]),
    makeSpec('s1', 'table', 'supporting'),
    makeSpec('s2', 'chair', 'supporting'),
    makeSpec('d1', 'crate', 'dressing'),
    makeSpec('d2', 'rock', 'dressing'),
    makeSpec('d3', 'barrel', 'dressing'),
  ]
  const actorLayout = planLayout(makeInput(777, actorObjects))
  let actorHits = 0
  for (const o of actorLayout.objects) {
    for (const a of anchors) {
      const r = Math.max(o.scale[0], o.scale[2]) * 0.5
      if (dist2D(o.position[0], o.position[2], a.position[0], a.position[2]) < r + a.safetyRadius) {
        actorHits++
      }
    }
  }
  pass(
    'no prop intersects actor safety volumes',
    actorHits === 0 && actorLayout.stats.actorCollisionViolations === 0,
    `violations=${actorLayout.stats.actorCollisionViolations}`
  )
  console.groupEnd()

  // --- 3. Hero visibility --------------------------------------------------
  console.group('  hero visibility')
  const heroObjects = [
    makeSpec('hero1', 'spaceship', 'hero', [1, 1, 1]),
    makeSpec('hero2', 'counter', 'hero', [1, 1, 1]),
    makeSpec('s', 'bench', 'supporting'),
  ]
  const heroLayout = planLayout(makeInput(4242, heroObjects))
  const heroes = heroLayout.objects.filter((o) => o.importance === 'hero')
  const visibleHeroes = heroes.filter((o) => o.cameraVisible && o.heroVisible)
  pass(
    'hero objects visible in Two-Shot',
    heroes.length > 0 && visibleHeroes.length === heroes.length,
    `${visibleHeroes.length}/${heroes.length}`
  )
  console.groupEnd()

  // --- 4. Large wall safety (occlusion) ------------------------------------
  console.group('  large wall safety')
  const wallObjects = [
    makeSpec('wall', 'wall', 'supporting', [1, 1, 1]),
    makeSpec('h', 'machine', 'hero', [1, 1, 1]),
  ]
  const wallLayout = planLayout(makeInput(55555, wallObjects))
  const wall = wallLayout.objects.find((o) => o.semanticType === 'wall')
  pass('wall exists', !!wall)
  if (wall) {
    const behind = wall.position[2] <= -2.5
    const safe = wall.occlusionSafe && behind
    pass('wall placed behind actors / occlusion-safe', safe, `z=${wall.position[2]} occlusionSafe=${wall.occlusionSafe}`)
  }
  console.groupEnd()

  // --- 5. Scale normalization ----------------------------------------------
  console.group('  scale normalization')
  // Absurd parser values (scale = [50, 50, 50]) must be clamped.
  const generous = makeSpec('big', 'chair', 'dressing', [50, 50, 50])
  const scaleLayout = planLayout(makeInput(31, [generous]))
  const chairScale = scaleLayout.objects[0].scale
  const sane = chairScale[1] <= 2.0 && chairScale[0] <= 1.5
  pass('absurd chair scale clamped to human scale', sane, `scale=[${chairScale.join(',')}]`)
  const tiny = makeSpec('tiny', 'crate', 'dressing', [0.001, 0.001, 0.001])
  const tinyLayout = planLayout(makeInput(32, [tiny]))
  const tinyScale = tinyLayout.objects[0].scale
  // Crate reference is 0.8 m; min dressing multiplier is 0.35 ⇒ 0.28 m floor.
  // The clamp must keep it ≥ the human-scale floor, never 0.001 m.
  pass('tiny crate scale stays readable', tinyScale[0] >= 0.25 && tinyScale[0] <= 0.32, `scale=[${tinyScale.join(',')}]`)
  console.groupEnd()

  // --- 6. Orientation ------------------------------------------------------
  console.group('  orientation')
  const screenSpec = makeSpec('scr', 'screen', 'supporting', [1, 1, 1])
  const screenLayout = planLayout(makeInput(33, [screenSpec]))
  const screen = screenLayout.objects[0]
  // face_camera: yaw ≈ atan2(cam.x - x, cam.z - z)
  const expectedYaw = Math.atan2(camera.position[0] - screen.position[0], camera.position[2] - screen.position[2])
  pass(
    'screen faces camera',
    Math.abs(screen.rotation[1] - expectedYaw) < 0.01,
    `yaw=${screen.rotation[1].toFixed(3)} expected=${expectedYaw.toFixed(3)}`
  )
  console.groupEnd()

  // --- 7. Bounded collision retries ----------------------------------------
  console.group('  bounded collision retries')
  const packed = Array.from({ length: 30 }, (_, i) =>
    makeSpec(`d${i}`, 'crate', 'dressing', [0.8, 0.8, 0.8])
  )
  const packedLayout = planLayout(makeInput(90210, packed))
  pass(
    'retries stay bounded',
    packedLayout.stats.objectCollisionRetries <= packed.length * MAX_COLLISION_RETRIES,
    `retries=${packedLayout.stats.objectCollisionRetries} max=${packed.length * MAX_COLLISION_RETRIES}`
  )
  pass('every object placed (never dropped)', packedLayout.objects.length === packed.length)
  console.groupEnd()

  // --- 8. Mars layout stress test ------------------------------------------
  console.group('  mars layout (pirate on Mars beside crashed spaceship)')
  const marsObjects = [
    makeSpec('ship', 'spaceship', 'hero', [1.2, 1.2, 1.2]),
    makeSpec('rock1', 'rock', 'supporting', [1, 1, 1]),
    makeSpec('rock2', 'rock', 'supporting', [1, 1, 1]),
    makeSpec('rock3', 'rock', 'supporting', [1, 1, 1]),
    makeSpec('debris1', 'debris', 'dressing', [0.6, 0.5, 0.6]),
    makeSpec('debris2', 'debris', 'dressing', [0.6, 0.5, 0.6]),
    makeSpec('craters', 'crater', 'dressing', [1.5, 0.3, 1.5]),
    makeSpec('formation', 'rock_formation', 'supporting', [1.2, 1.5, 1.2]),
  ]
  const marsLayout = planLayout(makeInput(1337, marsObjects))
  const marsShip = marsLayout.objects.find((o) => o.semanticType === 'spaceship')
  const marsZ = marsLayout.objects.map((o) => o.position[2])
  const spread = Math.max(...marsZ) - Math.min(...marsZ)
  pass('spaceship readable & visible', !!marsShip && marsShip.cameraVisible, marsShip ? `pos=(${marsShip.position.map((v) => v.toFixed(1)).join(',')})` : '')
  pass('actors clear', marsLayout.stats.actorCollisionViolations === 0, `violations=${marsLayout.stats.actorCollisionViolations}`)
  pass('rocks distributed', spread > 1.5, `depth=${spread.toFixed(1)}`)
  const depthZones = new Set(marsLayout.objects.map((o) => o.zone))
  pass('foreground/mid/background depth exists', depthZones.size >= 2, `zones=[${Array.from(depthZones).join(',')}]`)
  console.groupEnd()

  // --- 9. Cyberpunk tea shop stress test -----------------------------------
  console.group('  cyberpunk tea shop (two friends drink tea)')
  const shopObjects = [
    makeSpec('counter', 'counter', 'hero', [1, 1, 1]),
    makeSpec('table1', 'table', 'supporting'),
    makeSpec('table2', 'table', 'supporting'),
    makeSpec('chair1', 'chair', 'supporting'),
    makeSpec('chair2', 'chair', 'supporting'),
    makeSpec('shelf1', 'shelf', 'supporting'),
    makeSpec('shelf2', 'shelf', 'supporting'),
    makeSpec('neon', 'neon_sign', 'dressing', [1.4, 0.9, 0.12]),
    makeSpec('arch1', 'wall', 'supporting', [1, 1, 1]),
  ]
  const shopLayout = planLayout(makeInput(2024, shopObjects))
  const counter = shopLayout.objects.find((o) => o.semanticType === 'counter')
  pass('counter readable & visible', !!counter && counter.cameraVisible, counter ? `pos=(${counter.position.map((v) => v.toFixed(1)).join(',')})` : '')
  pass('actors not blocked', shopLayout.stats.actorCollisionViolations === 0, `violations=${shopLayout.stats.actorCollisionViolations}`)
  pass(
    'furniture does not intersect actors',
    shopLayout.objects.every((o) => o.actorSafe)
  )
  const tables = shopLayout.objects.filter((o) => o.semanticType === 'table')
  const chairs = shopLayout.objects.filter((o) => o.semanticType === 'chair')
  pass('tables+chairs placed', tables.length === 2 && chairs.length === 2, `${tables.length} tables, ${chairs.length} chairs`)
  const arch = shopLayout.objects.find((o) => o.semanticType === 'wall')
  pass('architecture behind/side', !arch || arch.occlusionSafe, arch ? `occlusionSafe=${arch.occlusionSafe}` : '')
  console.groupEnd()

  // --- 10. Diagnostic report -----------------------------------------------
  console.log('[D3 LAYOUT] Determinism check:', r1.objects.length === r2.objects.length && r1.stats.objectCollisionRetries === r2.stats.objectCollisionRetries ? 'PASS' : 'FAIL')
  console.log('[D3 LAYOUT] Self-test complete.')
}

