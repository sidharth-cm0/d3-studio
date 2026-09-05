/**
 * Dynamic Environment Builder — Self-Test Runner (PHASE 3).
 *
 * Standalone test scenes (NO live-app integration):
 *   A. Mars Pirate        — "A pirate stands on Mars beside a crashed spaceship."
 *   B. Cyberpunk Tea Shop — "Two friends drink tea in a neon-lit cyberpunk tea shop."
 *   C. Empty Desert       — "An empty desert stretches to the horizon under a blazing sun."
 *   D. Underground Lab    — "A scientist studies samples in an underground laboratory."
 *   E. Unknown scene      — "An explorer studies a glowing alien artifact inside a crystal cavern."
 *
 * Quality assertions (beyond object counts):
 *   - group exists / non-empty
 *   - ground exists (semantic, named 'dynamicGround')
 *   - hero semantic object exists
 *   - ≥ 3 depth cues (foreground / midground / background bands)
 *   - draw-call estimate within expected range (≤ 50 target)
 *   - all transforms finite (positions, rotations, scales, instance matrices)
 *   - disposal can run twice safely
 *   - deterministic build metadata for the same seed
 *
 * Usage (project has no ts-node runner):
 *   npx tsc --module commonjs --target ES2020 --esModuleInterop \
 *     --skipLibCheck --outDir /tmp/d3-dynenv-test \
 *     src/services/sceneGraphTypes.ts \
 *     src/services/semanticAssetMatcher.ts \
 *     src/services/spatialLayoutEngine.ts \
 *     src/services/environmentProps.ts \
 *     src/services/dynamicEnvironmentCompounds.ts \
 *     src/services/dynamicEnvironment.ts \
 *     src/services/dynamicEnvironment.test.ts
 *   node /tmp/d3-dynenv-test/dynamicEnvironment.test.js
 */

import * as THREE from 'three'
import { parseSceneGraph } from './sceneGraphParser'
import { matchAssetsSync, setManifest } from './semanticAssetMatcher'
import { planLayout } from './spatialLayoutEngine'
import {
  buildDynamicEnvironment,
  disposeDynamicEnvironment,
  type DynamicEnvironmentResult,
} from './dynamicEnvironment'
import type { SceneGraph } from './sceneGraphTypes'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let failureCount = 0

const pass = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failureCount++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`)
}

interface BuiltScene {
  label: string
  sceneGraph: SceneGraph
  group: import('three').Group
  stats: import('./dynamicEnvironment').DynamicEnvironmentStats
}

/** Full Phase 3 pipeline: parse → match → layout → build. */
function buildScene(text: string, seed?: number): BuiltScene {
  const parsed = parseSceneGraph(text)
  const sg = parsed.sceneGraph
  const matches = matchAssetsSync(sg.objects, { assets: [] }, sg.environment.type)
  const layout = planLayout({ sceneGraph: sg, objects: sg.objects, seed: seed ?? sg.seed })
  const result = buildDynamicEnvironment({
    sceneGraph: sg,
    resolvedObjects: layout.objects,
    assetMatches: matches,
    seed: seed ?? sg.seed,
    layoutStats: layout.stats,
  })
  return { label: text, sceneGraph: sg, group: result.group, stats: result.stats }
}

function findGround(group: import('three').Group): import('three').Object3D | null {
  let found: import('three').Object3D | null = null
  group.traverse((o) => {
    if ((o as import('three').Mesh).isMesh && o.name === 'dynamicGround') {
      if (!found) found = o
    }
  })
  return found
}

function findHero(group: import('three').Group): import('three').Object3D | null {
  let hero: import('three').Object3D | null = null
  group.traverse((o) => {
    if (o.userData?.importance === 'hero' && !hero) hero = o
  })
  return hero
}

function countSemantic(group: import('three').Group, semanticType: string): number {
  let n = 0
  group.traverse((o) => {
    if (o.userData?.semanticType === semanticType) n++
  })
  return n
}

function allTransformsFinite(group: import('three').Group): { ok: boolean; bad: string } {
  let ok = true
  let bad = ''
  group.traverse((o) => {
    if (!ok) return
    const p = o.position
    const r = o.rotation
    const s = o.scale
    for (const v of [p.x, p.y, p.z, r.x, r.y, r.z, s.x, s.y, s.z]) {
      if (!Number.isFinite(v)) {
        ok = false
        bad = `${o.name} transform`
        return
      }
    }
    const im = o as import('three').InstancedMesh
    if ((im as unknown as { isInstancedMesh?: boolean }).isInstancedMesh && im.instanceMatrix) {
      const arr = im.instanceMatrix.array as ArrayLike<number>
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) {
          ok = false
          bad = `${o.name} instanceMatrix[${i}]`
          return
        }
      }
    }
  })
  return { ok, bad }
}

/** Deterministic fingerprint: stats (minus timing) + census + child count. */
function fingerprint(scene: BuiltScene): string {
  const s = { ...scene.stats } as Record<string, unknown>
  delete s.generationTimeMs
  const census = Object.entries(
    (scene.group.userData.census ?? {}) as Record<string, number>
  ).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([s, census, scene.group.children.length])
}

interface QualityOpts {
  drawRange: [number, number]
  heroExpected?: boolean
}

/** Section 16 quality gates — applied to EVERY generated environment. */
function assertQuality(scene: BuiltScene, opts: QualityOpts): boolean {
  const { group, stats } = scene
  const failuresBefore = failureCount

  console.group(`  quality — ${scene.sceneGraph.environment.type}`)

  pass('group exists', !!group)
  pass(
    'group non-empty (no zero-object output)',
    group.children.length > 0 && group.children.length >= 4,
    `children=${group.children.length} meshes=${stats.meshCount} instancedMeshes=${stats.instancedMeshCount} instances=${stats.instanceCount} drawCalls=${stats.drawCallEstimate}`
  )

  const ground = findGround(group)
  pass('ground exists', !!ground, ground ? `type=${(ground.userData.role as string) ?? 'ground'}` : '')

  const hero = findHero(group)
  pass('hero semantic object exists', !!hero, hero ? `type=${(hero.userData.semanticType as string) ?? '?'}` : '')

  pass('≥3 depth cues', stats.depthCueCount >= 3, `bands=${stats.depthCueCount}`)
  pass(
    'draw-call estimate in range',
    stats.drawCallEstimate >= opts.drawRange[0] && stats.drawCallEstimate <= opts.drawRange[1],
    `drawCalls=${stats.drawCallEstimate} range=[${opts.drawRange[0]},${opts.drawRange[1]}]`
  )
  pass('procedural fallback fully functional (empty manifest)', stats.proceduralCount === stats.objectCount && stats.assetCount === 0, `procedural=${stats.proceduralCount}/${stats.objectCount}`)
  pass('no actor/camera safety violations', stats.collisionViolations === 0, `violations=${stats.collisionViolations}`)
  pass('no occlusion violations', stats.occlusionViolations === 0, `violations=${stats.occlusionViolations}`)

  const finite = allTransformsFinite(group)
  pass('all transforms finite (no NaN/Infinity)', finite.ok, finite.bad)

  // Determinism: rebuild with the same seed and compare metadata.
  const twin = buildScene(scene.label, scene.stats.seed)
  const fpA = fingerprint(scene)
  const fpB = fingerprint(twin)
  pass('deterministic build metadata for same seed', fpA === fpB)
  disposeDynamicEnvironment(twin.group)

  // Disposal twice must be safe (no throw).
  let disposeOk = true
  try {
    disposeDynamicEnvironment(group)
    disposeDynamicEnvironment(group)
  } catch (e) {
    disposeDynamicEnvironmentSafe(e)
    disposeOk = false
  }
  pass('disposal can run twice safely', disposeOk)

  console.groupEnd()
  return failureCount === failuresBefore
}

function disposeDynamicEnvironmentSafe(_e: unknown): void {
  /* counted by caller */
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

export function runDynamicEnvironmentSelfTest(): void {
  console.log('[D3 DYNAMIC] Self-Test — Dynamic Environment Builder')

  // Deterministic empty manifest (current project state: manifest is empty).
  setManifest({ assets: [] })

  const results: Array<{ name: string; ok: boolean }> = []

  // --- A. Mars Pirate -------------------------------------------------------
  console.group('  A. Mars Pirate (crashed spaceship)')
  {
    const failuresBefore = failureCount
    const mars = buildScene('A pirate stands on Mars beside a crashed spaceship.')
    let ship: import('three').Object3D | null = null
    mars.group.traverse((o) => {
      if (typeof o.userData?.semanticType === 'string' && o.userData.semanticType.includes('spaceship') && !ship) ship = o
    })
    pass('recognizable spaceship compound exists', !!ship)
    pass('rocky/rust ground (reddish tint)', (() => {
      const g = findGround(mars.group) as import('three').Mesh | null
      if (!g) return false
      const c = (g.material as import('three').MeshStandardMaterial).color
      return c.r > c.b && c.r > 0.2
    })())
    const census = (mars.group.userData.census ?? {}) as Record<string, number>
    const rocks = (census['fam_rock'] ?? 0) + (census['fam_boulder'] ?? 0) + (census['rock'] ?? 0) + (census['scatter_pebble'] ?? 0)
    pass('rocks/debris present', rocks > 0, `rocks+pebbles=${rocks}`)
    pass('distant formations backdrop', mars.group.userData.backdropKind === 'formations', `backdrop=${String(mars.group.userData.backdropKind)}`)
    pass('no empty void (depth cues ≥3)', mars.stats.depthCueCount >= 3, `bands=${mars.stats.depthCueCount}`)
    assertQuality(mars, { drawRange: [8, 60], heroExpected: true })
    results.push({ name: 'Mars Pirate', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- B. Cyberpunk Tea Shop -------------------------------------------------
  console.group('  B. Cyberpunk Tea Shop')
  {
    const failuresBefore = failureCount
    const shop = buildScene('Two friends drink tea in a neon-lit cyberpunk tea shop.')
    const census = (shop.group.userData.census ?? {}) as Record<string, number>
    pass('counter exists', (census['counter'] ?? 0) >= 1, `counter=${census['counter'] ?? 0}`)
    pass('tables present', (census['table'] ?? 0) >= 1, `tables=${census['table'] ?? 0}`)
    pass('chairs present', (census['chair'] ?? 0) >= 1, `chairs=${census['chair'] ?? 0}`)
    pass('shelving present', (census['shelf'] ?? 0) + (census['rack'] ?? 0) >= 1, `shelves=${(census['shelf'] ?? 0) + (census['rack'] ?? 0)}`)
    pass('signs/screens present', (census['sign'] ?? 0) + (census['screen'] ?? 0) + (census['monitor'] ?? 0) >= 1)
    pass('interior structure (rear wall + returns)', (census['wall'] ?? 0) + (census['backdrop_walls'] ?? 0) >= 1, `walls=${census['wall'] ?? 0}`)
    assertQuality(shop, { drawRange: [10, 60], heroExpected: true })
    results.push({ name: 'Cyberpunk Tea Shop', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- C. Empty Desert --------------------------------------------------------
  console.group('  C. Empty Desert')
  {
    const failuresBefore = failureCount
    const desert = buildScene('An empty desert stretches to the horizon under a blazing sun.')
    const census = (desert.group.userData.census ?? {}) as Record<string, number>
    pass('sand terrain ground', !!findGround(desert.group) && (census['ground_terrain'] ?? 0) >= 1)
    pass('dunes present', (census['dune'] ?? 0) + (census['fam_dune'] ?? 0) + (census['bg_dune'] ?? 0) >= 1, `dunes=${(census['dune'] ?? 0) + (census['fam_dune'] ?? 0) + (census['bg_dune'] ?? 0)}`)
    pass('distant depth (dune backdrop)', desert.group.userData.backdropKind === 'dunes', `backdrop=${String(desert.group.userData.backdropKind)}`)
    pass('sparse foreground dressing', (census['scatter_pebble'] ?? 0) + (census['scatter_scrub'] ?? 0) >= 1)
    assertQuality(desert, { drawRange: [8, 60], heroExpected: true })
    results.push({ name: 'Empty Desert', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- D. Underground Laboratory ----------------------------------------------
  console.group('  D. Underground Laboratory')
  {
    const failuresBefore = failureCount
    const lab = buildScene('A scientist studies samples in an underground laboratory.')
    const census = (lab.group.userData.census ?? {}) as Record<string, number>
    pass('hero scientific machine exists', (census['lab_machine'] ?? 0) >= 1, `lab_machine=${census['lab_machine'] ?? 0}`)
    pass('consoles present', (census['console'] ?? 0) >= 1, `consoles=${census['console'] ?? 0}`)
    pass('technical dressing (screens/pipes)', (census['screen'] ?? 0) + (census['pipe'] ?? 0) + (census['monitor'] ?? 0) >= 1)
    pass('rear/side architecture', (census['wall'] ?? 0) + (census['backdrop_walls'] ?? 0) >= 1)
    pass('interior/industrial floor', (census['ground_industrial'] ?? 0) + (census['ground_tile'] ?? 0) + (census['ground_terrain'] ?? 0) >= 1)
    assertQuality(lab, { drawRange: [10, 60], heroExpected: true })
    results.push({ name: 'Underground Laboratory', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- E. Unknown scene (crystal cavern) ---------------------------------------
  console.group('  E. Unknown scene (crystal cavern)')
  {
    const failuresBefore = failureCount
    const cave = buildScene('An explorer studies a glowing alien artifact inside a crystal cavern.')
    const census = (cave.group.userData.census ?? {}) as Record<string, number>
    pass('ground exists', !!findGround(cave.group))
    pass('compound artifact/hero exists', (() => {
      let hero: import('three').Object3D | null = null
      cave.group.traverse((o) => {
        if (o.userData?.importance === 'hero' && !hero) hero = o
      })
      return !!hero
    })())
    pass('crystal-like procedural forms', (census['crystal'] ?? 0) + (census['fam_crystal'] ?? 0) + (census['bg_crystal'] ?? 0) + (census['scatter_crystal'] ?? 0) >= 1)
    pass('stalagmites present', (census['stalagmite'] ?? 0) + (census['fam_stalagmite'] ?? 0) + (census['bg_stalagmite'] ?? 0) >= 1)
    pass('meaningful background (cavern backdrop)', cave.group.userData.backdropKind === 'cavern', `backdrop=${String(cave.group.userData.backdropKind)}`)
    pass('no empty stage', cave.group.children.length >= 4)
    assertQuality(cave, { drawRange: [8, 60], heroExpected: true })
    results.push({ name: 'Unknown scene', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- G. UNSEEN 1 — frozen village snowstorm (semantic composition) ----------
  console.group('  G. Unseen: frozen village snowstorm')
  {
    const failuresBefore = failureCount
    const scene = buildScene('Two explorers walk through a frozen village during a snowstorm.')
    const census = (scene.group.userData.census ?? {}) as Record<string, number>
    pass('village identity (family=village)', scene.sceneGraph.environment.type === 'village', `env=${scene.sceneGraph.environment.type}`)
    pass('snow terrain ground', scene.sceneGraph.ground.type === 'snow', `ground=${scene.sceneGraph.ground.type}`)
    pass('snow-white ground material', (() => {
      const g = findGround(scene.group) as import('three').Mesh | null
      if (!g) return false
      const c = (g.material as import('three').MeshStandardMaterial).color
      return c.r > 0.6 && c.g > 0.65 && c.b > 0.7
    })())
    pass('house structures present', (census['house'] ?? 0) + (census['house_ruined'] ?? 0) >= 1, `houses=${(census['house'] ?? 0) + (census['house_ruined'] ?? 0)}`)
    pass('village backdrop (trees)', scene.group.userData.backdropKind === 'trees', `backdrop=${String(scene.group.userData.backdropKind)}`)
    pass('snowstorm atmosphere (dense fog)', scene.sceneGraph.atmosphere.fogNear <= 5, `fogNear=${scene.sceneGraph.atmosphere.fogNear}`)
    assertQuality(scene, { drawRange: [8, 70], heroExpected: true })
    results.push({ name: 'Unseen: frozen village', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- H. UNSEEN 2 — rainy futuristic city -------------------------------------
  console.group('  H. Unseen: rainy futuristic city')
  {
    const failuresBefore = failureCount
    const scene = buildScene('A detective waits beside a streetlight in a rainy futuristic city.')
    const census = (scene.group.userData.census ?? {}) as Record<string, number>
    pass('city identity (family=city)', scene.sceneGraph.environment.type === 'city', `env=${scene.sceneGraph.environment.type}`)
    pass('street/asphalt ground', scene.sceneGraph.ground.type === 'road', `ground=${scene.sceneGraph.ground.type}`)
    pass('city skyline backdrop', scene.group.userData.backdropKind === 'skyline', `backdrop=${String(scene.group.userData.backdropKind)}`)
    pass('buildings present', (census['building'] ?? 0) >= 1, `buildings=${census['building'] ?? 0}`)
    pass('streetlight present', (census['lamp_post'] ?? 0) >= 1, `lamp_posts=${census['lamp_post'] ?? 0}`)
    pass('rain atmosphere (haze)', scene.sceneGraph.atmosphere.fogFar <= 24, `fogFar=${scene.sceneGraph.atmosphere.fogFar}`)
    assertQuality(scene, { drawRange: [8, 70], heroExpected: true })
    results.push({ name: 'Unseen: rainy city', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- I. UNSEEN 3 — tropical beach boat at sunset ------------------------------
  console.group('  I. Unseen: tropical beach boat sunset')
  {
    const failuresBefore = failureCount
    const scene = buildScene('A woman discovers an abandoned boat on a tropical beach at sunset.')
    const census = (scene.group.userData.census ?? {}) as Record<string, number>
    pass('beach identity (family=beach)', scene.sceneGraph.environment.type === 'beach', `env=${scene.sceneGraph.environment.type}`)
    pass('sand ground', scene.sceneGraph.ground.type === 'sand', `ground=${scene.sceneGraph.ground.type}`)
    pass('boat hero prop exists', (census['boat'] ?? 0) + (census['boat_wreck'] ?? 0) >= 1, `boats=${(census['boat'] ?? 0) + (census['boat_wreck'] ?? 0)}`)
    pass('palm trees present', (census['palm_tree'] ?? 0) + (census['tree'] ?? 0) >= 1, `palms=${(census['palm_tree'] ?? 0) + (census['tree'] ?? 0)}`)
    pass('sunset time detected', scene.sceneGraph.timeOfDay === 'sunset', `time=${scene.sceneGraph.timeOfDay}`)
    assertQuality(scene, { drawRange: [8, 70], heroExpected: true })
    results.push({ name: 'Unseen: beach boat', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- J. UNSEEN 4 — abandoned underground factory ------------------------------
  console.group('  J. Unseen: abandoned underground factory')
  {
    const failuresBefore = failureCount
    const scene = buildScene('Two engineers investigate an abandoned underground factory filled with pipes and machinery.')
    const census = (scene.group.userData.census ?? {}) as Record<string, number>
    pass('factory identity (NOT cavern)', scene.sceneGraph.environment.type === 'factory', `env=${scene.sceneGraph.environment.type}`)
    pass('industrial floor', (census['ground_industrial'] ?? 0) + (census['ground_tile'] ?? 0) >= 1, `floor=${(census['ground_industrial'] ?? 0) + (census['ground_tile'] ?? 0)}`)
    pass('machinery present', (census['lab_machine'] ?? 0) >= 1, `machines=${census['lab_machine'] ?? 0}`)
    pass('pipes present', (census['pipe'] ?? 0) >= 1, `pipes=${census['pipe'] ?? 0}`)
    pass('industrial dressing (barrels/crates)', (census['barrel'] ?? 0) + (census['crate'] ?? 0) >= 1, `dressing=${(census['barrel'] ?? 0) + (census['crate'] ?? 0)}`)
    pass('interior architecture (walls)', scene.group.userData.backdropKind === 'walls', `backdrop=${String(scene.group.userData.backdropKind)}`)
    assertQuality(scene, { drawRange: [8, 70], heroExpected: true })
    results.push({ name: 'Unseen: factory', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- K. UNSEEN 5 — ancient ruined temple with glowing plants ------------------
  console.group('  K. Unseen: ancient ruined temple glowing plants')
  {
    const failuresBefore = failureCount
    const scene = buildScene('A warrior enters an ancient ruined temple surrounded by giant stone pillars and glowing plants.')
    const census = (scene.group.userData.census ?? {}) as Record<string, number>
    pass('temple identity (family=temple)', scene.sceneGraph.environment.type === 'temple', `env=${scene.sceneGraph.environment.type}`)
    pass('stone floor ground', scene.sceneGraph.ground.type === 'stone_floor', `ground=${scene.sceneGraph.ground.type}`)
    pass('stone pillars present', (census['pillar'] ?? 0) + (census['stone_column'] ?? 0) >= 1, `pillars=${(census['pillar'] ?? 0) + (census['stone_column'] ?? 0)}`)
    pass('altar present', (census['altar'] ?? 0) >= 1, `altars=${census['altar'] ?? 0}`)
    pass('rubble (ruined condition)', (census['rubble'] ?? 0) + (census['fam_rubble'] ?? 0) >= 1, `rubble=${(census['rubble'] ?? 0) + (census['fam_rubble'] ?? 0)}`)
    pass('glowing flora present', (census['glow_flora'] ?? 0) + (census['fam_glow_flora'] ?? 0) >= 1, `flora=${(census['glow_flora'] ?? 0) + (census['fam_glow_flora'] ?? 0)}`)
    assertQuality(scene, { drawRange: [8, 70], heroExpected: true })
    results.push({ name: 'Unseen: temple', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- L. Forest regression (Phase 3 baseline) ----------------------------------
  console.group('  L. Forest regression')
  {
    const failuresBefore = failureCount
    const scene = buildScene('A ranger patrols the deep forest at dawn.')
    const census = (scene.group.userData.census ?? {}) as Record<string, number>
    pass('forest identity (family=forest)', scene.sceneGraph.environment.type === 'forest', `env=${scene.sceneGraph.environment.type}`)
    pass('forest floor ground', scene.sceneGraph.ground.type === 'forest_floor', `ground=${scene.sceneGraph.ground.type}`)
    pass('trees present', (census['tree'] ?? 0) >= 1, `trees=${census['tree'] ?? 0}`)
    pass('forest backdrop (trees)', scene.group.userData.backdropKind === 'trees', `backdrop=${String(scene.group.userData.backdropKind)}`)
    assertQuality(scene, { drawRange: [8, 70], heroExpected: true })
    results.push({ name: 'Forest regression', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- F. Empty-graph guarantee (never an empty group) -------------------------
  console.group('  F. Degenerate input (zero objects)')
  {
    const failuresBefore = failureCount
    const parsed = parseSceneGraph('A pirate stands on Mars beside a crashed spaceship.')
    const emptyGraph: SceneGraph = { ...parsed.sceneGraph, objects: [] }
    const result = buildDynamicEnvironment({
      sceneGraph: emptyGraph,
      resolvedObjects: [],
      assetMatches: [],
      seed: 42,
    })
    pass(
      'never returns an empty group',
      result.group.children.length > 0,
      `children=${result.group.children.length} meshes=${result.stats.meshCount} instancedMeshes=${result.stats.instancedMeshCount} instances=${result.stats.instanceCount} drawCalls=${result.stats.drawCallEstimate}`
    )
    pass('ground still exists', !!findGround(result.group))
    pass('depth cues include foreground/midground/background', result.stats.depthCueCount >= 3, `bands=${result.stats.depthCueCount}`)
    disposeDynamicEnvironment(result.group)
    disposeDynamicEnvironment(result.group)
    pass('double disposal safe', true)
    results.push({ name: 'Degenerate input', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- M. Entity visual integration (Step B) -----------------------------------
  console.group('  M. Entity visual integration')
  {
    const failuresBefore = failureCount
    const parsed = parseSceneGraph('A box in front of a door, a lamp left of a sofa, and a chair near a table.')
    const sg = parsed.sceneGraph

    // Inject explicit resolved objects for the 6 supported entity types so the
    // test is deterministic regardless of parser output.
    const resolvedObjects = [
      makeResolved('box1', 'box', [1, 1, 1], [0, 0.5, 1]),
      makeResolved('door1', 'door', [1.2, 2.3, 0.15], [2, 1.15, -1]),
      makeResolved('lamp1', 'lamp', [1, 1, 1], [-2, 0.85, -2]),
      makeResolved('sofa1', 'sofa', [2.1, 0.85, 0.9], [1.5, 0.42, -3]),
      makeResolved('chair1', 'chair', [0.5, 0.9, 0.5], [-1.5, 0.45, -2.5]),
      makeResolved('table1', 'table', [1.2, 0.75, 0.7], [0, 0.375, -2.5]),
      makeResolved('machine1', 'machine', [2.2, 2.4, 1.4], [-3, 1.2, -4]),
      makeResolved('pillar1', 'pillar', [0.9, 4.2, 0.9], [3, 2.1, -5]),
      makeResolved('unsupported1', 'spaceship', [5.5, 2.6, 7], [0, 1.3, -6]),
    ]
    const result = buildDynamicEnvironment({
      sceneGraph: sg,
      resolvedObjects,
      assetMatches: [],
      seed: 12345,
    })

    // 1-3) All supported categories appear as entity visuals
    const names: string[] = []
    result.group.traverse((o) => { if (o.name.startsWith('entity:')) names.push(o.name) })
    pass('box entity visual present', names.some((n) => n.includes(':box1:box')), `entity names=${names.join(',')}`)
    pass('door entity visual present', names.some((n) => n.includes(':door1:door')), `entity names=${names.join(',')}`)
    pass('lamp entity visual present', names.some((n) => n.includes(':lamp1:lamp')), `entity names=${names.join(',')}`)
    pass('sofa entity visual present', names.some((n) => n.includes(':sofa1:sofa')), `entity names=${names.join(',')}`)
    pass('chair entity visual present', names.some((n) => n.includes(':chair1:chair')), `entity names=${names.join(',')}`)
    pass('table entity visual present', names.some((n) => n.includes(':table1:table')), `entity names=${names.join(',')}`)
    pass('machinery entity visual present', names.some((n) => n.includes(':machine1:machine')), `entity names=${names.join(',')}`)
    pass('pillar entity visual present', names.some((n) => n.includes(':pillar1:pillar')), `entity names=${names.join(',')}`)

    // 4) Names preserve IDs
    pass('entity names preserve source IDs', names.length >= 8, `count=${names.length}`)

    // 5) Resolved positions unchanged
    const findEntity = (id: string): import('three').Object3D | undefined => {
      let found: import('three').Object3D | undefined
      result.group.traverse((o) => {
        if (o.userData?.sourceSpecId === id && o.name.startsWith('entity:')) found = o
      })
      return found
    }
    const boxEntity = findEntity('box1')
    pass('box position matches resolved transform',
      !!boxEntity && Math.abs(boxEntity.position.x - 0) < 1e-6 && Math.abs(boxEntity.position.y - 0.5) < 1e-6 && Math.abs(boxEntity.position.z - 1) < 1e-6,
      boxEntity ? `pos=${boxEntity.position.x},${boxEntity.position.y},${boxEntity.position.z}` : 'not found')
    const doorEntity = findEntity('door1')
    pass('door position matches resolved transform',
      !!doorEntity && Math.abs(doorEntity.position.x - 2) < 1e-6 && Math.abs(doorEntity.position.y - 1.15) < 1e-6 && Math.abs(doorEntity.position.z - (-1)) < 1e-6,
      doorEntity ? `pos=${doorEntity.position.x},${doorEntity.position.y},${doorEntity.position.z}` : 'not found')

    // 6) Unsupported type (spaceship) does not crash and is not rendered as entity visual
    pass('unsupported type skipped gracefully', !names.some((n) => n.includes(':unsupported1:spaceship')), `entity names=${names.join(',')}`)

    // Entity visuals are children of the objects group
    const objectsGroup = result.group.children.find((c) => c.name === 'dyn:objects')
    const entityInObjectsGroup = objectsGroup?.children.some((c) => c.name.startsWith('entity:')) ?? false
    pass('entity visuals added to objects group', entityInObjectsGroup)

    results.push({ name: 'Entity visual integration', ok: failureCount === failuresBefore })
  }
  console.groupEnd()

  // --- Summary -----------------------------------------------------------------
  const failed = results.filter((r) => !r.ok)
  console.log(
    `[D3 DYNAMIC] Self-test complete: ${results.length - failed.length}/${results.length} scenes PASS` +
      (failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(', ')}` : '')
  )
}

function makeResolved(
  id: string,
  semanticType: string,
  scale: [number, number, number],
  position: [number, number, number]
): import('./spatialLayoutEngine').ResolvedSceneObject {
  return {
    sourceSpecId: id,
    semanticType,
    importance: 'supporting',
    position,
    rotation: [0, 0, 0],
    scale,
    zone: 'midground',
    cameraVisible: true,
    actorSafe: true,
    occlusionSafe: true,
    fallbackPrimitive: 'compound',
  }
}
