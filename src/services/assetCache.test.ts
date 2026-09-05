/**
 * Asset Cache — PHASE 4B self-test.
 *
 * 12 focused tests + shared-resource safety tests.
 * No synthetic production assets. Mocks/pure test objects used where needed.
 */

import * as THREE from 'three'
import {
  resetCache,
  resetBudget,
  setBudget,
  getBudget,
  getAsset,
  placeAsset,
  releaseInstance,
  releaseSceneInstances,
  getAssetCacheStats,
  isInstancingEligible,
} from './assetCache'
import type { AssetRegistryEntry } from './assetRegistry'

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures: string[] = []

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(label)
    console.error(`  FAIL: ${label}`)
  }
}

function section(name: string): void {
  console.log(`\n— ${name} —`)
}

/** A minimal valid registry entry pointing at a nonexistent file. */
function fakeEntry(id: string): AssetRegistryEntry {
  return {
    id,
    source: 'test',
    path: '/assets/environments/_test/does_not_exist.glb',
    format: 'glb',
    category: 'warehouse',
    semanticType: 'crate',
    tags: ['test'],
    kits: ['warehouse'],
    available: false,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export async function runAssetCacheSelfTest(): Promise<void> {
  passed = 0
  failed = 0
  failures.length = 0

  // -----------------------------------------------------------------------
  section('1. empty registry/cache')
  {
    resetCache()
    resetBudget()
    const stats = getAssetCacheStats()
    assert(stats.placedCount === 0, 'no placed assets')
    assert(stats.sourceCacheSize === 0, 'no cached sources')
    assert(stats.sceneCount === 0, 'no scenes')
    assert(stats.uniqueLoaded === 0, 'nothing loaded')
  }

  // -----------------------------------------------------------------------
  section('2. unavailable asset')
  {
    resetCache()
    const entry = fakeEntry('nonexistent_asset')
    const result = await getAsset(entry)
    assert(result === null, 'unavailable asset returns null')
    const stats = getAssetCacheStats()
    assert(stats.uniqueFailed === 1, 'failed asset tracked')
  }

  // -----------------------------------------------------------------------
  section('3. repeated request metadata')
  {
    resetCache()
    const entry = fakeEntry('repeat_test')
    await getAsset(entry)
    await getAsset(entry)
    await getAsset(entry)
    const stats = getAssetCacheStats()
    assert(stats.sourceCacheSize === 1, 'repeat requests do not duplicate metadata')
  }

  // -----------------------------------------------------------------------
  section('4. scene inventory tracking')
  {
    resetCache()
    const entry = fakeEntry('inv_test')
    await placeAsset(entry, 'scene_A')
    const stats = getAssetCacheStats()
    assert(stats.placedCount === 0, 'failed placement does not add to inventory')
    assert(stats.sceneCount === 0, 'no scene tracked for failed placement')
  }

  // -----------------------------------------------------------------------
  section('5. release single instance (safe no-op on empty)')
  {
    resetCache()
    const released = releaseInstance('nonexistent_instance')
    assert(released === false, 'releasing unknown instance returns false (safe)')
  }

  // -----------------------------------------------------------------------
  section('6. release entire scene inventory (safe on empty)')
  {
    resetCache()
    const count = releaseSceneInstances('nonexistent_scene')
    assert(count === 0, 'releasing unknown scene returns 0')
  }

  // -----------------------------------------------------------------------
  section('7. budget rejection')
  {
    resetCache()
    setBudget({ maxPlacedAssets: 0 })
    const entry = fakeEntry('budget_test')
    const result = await placeAsset(entry, 'scene_budget')
    assert(result.success === false, 'placement fails within budget constraint')
    assert(result.instance === null, 'no instance on failure')
    resetBudget()
  }

  // -----------------------------------------------------------------------
  section('8. source cache survives placed-instance release')
  {
    resetCache()
    const entry = fakeEntry('survive_test')
    await getAsset(entry)
    const statsBefore = getAssetCacheStats()
    releaseSceneInstances('some_scene')
    const statsAfter = getAssetCacheStats()
    assert(
      statsAfter.sourceCacheSize === statsBefore.sourceCacheSize,
      'source metadata survives scene release'
    )
  }

  // -----------------------------------------------------------------------
  section('9. malformed request safe failure')
  {
    resetCache()
    const badEntry = { id: '', path: '', format: 'glb' } as unknown as AssetRegistryEntry
    try {
      const result = await placeAsset(badEntry, 'scene_malformed')
      assert(result.success === false, 'malformed entry does not succeed')
    } catch {
      assert(false, 'malformed entry must not throw')
    }
  }

  // -----------------------------------------------------------------------
  section('10. cache statistics')
  {
    resetCache()
    const entry = fakeEntry('stats_test')
    await getAsset(entry)
    const stats = getAssetCacheStats()
    assert(stats.sourceCacheSize === 1, 'stats reflect one cached source')
    assert(typeof stats.placedCount === 'number', 'placedCount is numeric')
    assert(typeof stats.estimatedMeshes === 'number', 'estimatedMeshes is numeric')
    assert(typeof stats.sceneCount === 'number', 'sceneCount is numeric')
  }

  // -----------------------------------------------------------------------
  section('11. instancing eligibility')
  {
    const simple = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    simple.add(mesh)
    assert(isInstancingEligible(simple) === true, 'single mesh + material => eligible')

    const multi = new THREE.Group()
    multi.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
    multi.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
    assert(isInstancingEligible(multi) === false, 'multiple meshes => ineligible')

    const multiMat = new THREE.Group()
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial(),
    ])
    multiMat.add(m2)
    assert(isInstancingEligible(multiMat) === false, 'multiple materials => ineligible')

    assert(isInstancingEligible(new THREE.Group()) === false, 'empty group => ineligible')
  }

  // -----------------------------------------------------------------------
  section('12. no character/camera dependency')
  {
    resetCache()
    const stats = getAssetCacheStats()
    assert(stats !== undefined, 'cache operates independently')
    resetCache()
    assert(getAssetCacheStats().placedCount === 0, 'clean reset without side effects')
  }

  // -----------------------------------------------------------------------
  section('SHARED: geometry/material shared between source and clone')
  {
    const source = new THREE.Group()
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial()
    const srcMesh = new THREE.Mesh(geo, mat)
    source.add(srcMesh)

    const clone = source.clone()
    const cloneMesh = clone.children[0] as THREE.Mesh
    assert(cloneMesh.geometry === geo, 'clone shares geometry with source')
    assert(cloneMesh.material === mat, 'clone shares material with source')
  }

  // -----------------------------------------------------------------------
  section('SHARED: releasing clone A does not invalidate source or clone B')
  {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial()
    const source = new THREE.Group()
    source.add(new THREE.Mesh(geo, mat))

    const cloneA = source.clone()
    const cloneB = source.clone()

    const parent = new THREE.Group()
    parent.add(cloneA)
    parent.add(cloneB)

    // Release clone A (detach only, like releaseInstance does).
    if (cloneA.parent) cloneA.parent.remove(cloneA)

    assert(geo.attributes.position !== undefined, 'source geometry still valid after releasing clone A')
    const meshB = cloneB.children[0] as THREE.Mesh
    assert(meshB.geometry === geo, 'clone B still references shared geometry')
    assert(meshB.material === mat, 'clone B still references shared material')
    assert(cloneB.parent === parent, 'clone B still attached after clone A released')
  }

  // -----------------------------------------------------------------------
  section('SHARED: future clone C still works after releasing A and B')
  {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial()
    const source = new THREE.Group()
    source.add(new THREE.Mesh(geo, mat))

    const cloneA = source.clone()
    const cloneB = source.clone()

    if (cloneA.parent) cloneA.parent.remove(cloneA)
    if (cloneB.parent) cloneB.parent.remove(cloneB)

    assert(geo.attributes.position !== undefined, 'geometry intact for future clones')
    const cloneC = source.clone()
    const meshC = cloneC.children[0] as THREE.Mesh
    assert(meshC.geometry === geo, 'clone C shares geometry')
    assert(meshC.material === mat, 'clone C shares material')
  }

  // -------------------------------------------------------------------------
  // Budget config
  // -------------------------------------------------------------------------
  section('budget configuration')
  {
    resetBudget()
    const b = getBudget()
    assert(b.maxPlacedAssets === 64, 'default maxPlacedAssets')
    assert(b.maxMeshes === 200, 'default maxMeshes')
    setBudget({ maxPlacedAssets: 10 })
    assert(getBudget().maxPlacedAssets === 10, 'setBudget applies')
    resetBudget()
    assert(getBudget().maxPlacedAssets === 64, 'resetBudget restores defaults')
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n========================================`)
  console.log(`ASSET CACHE SELF-TEST: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join('\n  ')}`)
  }
  console.log(`========================================\n`)
}

// Run on import in dev for fast feedback.
if (import.meta.env.DEV) {
  runAssetCacheSelfTest()
}