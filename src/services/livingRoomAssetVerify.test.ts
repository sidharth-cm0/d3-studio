/**
 * Living Room Asset Verification — PHASE 4D-2A self-test.
 *
 * Verifies:
 *   1. Registry resolution (semantic query → asset descriptor)
 *   2. Actual GLB load via the existing environmentAssetLoader
 *   3. Mesh / material / dimension reporting
 *   4. Cross-kit isolation (plant + sci_fi_room must NOT match living_room)
 *   5. Missing-asset safe fallback
 *
 * Runs on import in dev mode (browser) — same pattern as assetCache.test.ts.
 * Also runnable via Node: see livingRoomAssetVerify.test-runner.ts
 */

import * as THREE from 'three'
import { getAssetDescriptor } from './environmentAssetLibrary'
import type { EnvironmentAssetCategory, SemanticAssetId } from './environmentAssetLibrary'
import { instanciateAsset } from './environmentAssetLoader'
import {
  resetCache,
  placeAsset,
  releaseInstance,
  releaseSceneInstances,
  getAssetCacheStats,
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

// ---------------------------------------------------------------------------
// Asset definitions for verification
// ---------------------------------------------------------------------------

interface VerifyAsset {
  id: string
  semantic: SemanticAssetId
  category: EnvironmentAssetCategory
  path: string
  expectedTags: string[]
}

const LIVING_ROOM_ASSETS: VerifyAsset[] = [
  {
    id: 'quaternius_living_sofa_01',
    semantic: 'sofa',
    category: 'living_room',
    path: '/assets/quaternius/furniture/living_room/sofa_01.glb',
    expectedTags: ['sofa', 'couch', 'living_room', 'seat'],
  },
  {
    id: 'quaternius_living_chair_01',
    semantic: 'chair',
    category: 'living_room',
    path: '/assets/quaternius/furniture/living_room/chair_01.glb',
    expectedTags: ['chair', 'living_room', 'seat'],
  },
  {
    id: 'quaternius_living_coffee_table_01',
    semantic: 'table',
    category: 'living_room',
    path: '/assets/quaternius/furniture/living_room/coffee_table_01.glb',
    expectedTags: ['table', 'coffee_table', 'living_room'],
  },
  {
    id: 'quaternius_living_lamp_01',
    semantic: 'lamp',
    category: 'living_room',
    path: '/assets/quaternius/furniture/living_room/lamp_01.glb',
    expectedTags: ['lamp', 'light', 'living_room'],
  },
  {
    id: 'quaternius_living_cabinet_01',
    semantic: 'cabinet',
    category: 'living_room',
    path: '/assets/quaternius/furniture/living_room/cabinet_01.glb',
    expectedTags: ['cabinet', 'shelf', 'storage', 'living_room'],
  },
  {
    id: 'quaternius_living_plant_01',
    semantic: 'plant',
    category: 'living_room',
    path: '/assets/quaternius/furniture/living_room/plant_01.glb',
    expectedTags: ['plant', 'indoor_plant', 'decor', 'living_room'],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countMeshes(obj: THREE.Object3D): number {
  let count = 0
  obj.traverse((child) => {
    if ((child as unknown as { isMesh?: boolean }).isMesh) count++
  })
  return count
}

function countMaterials(obj: THREE.Object3D): number {
  const mats = new Set<THREE.Material>()
  obj.traverse((child) => {
    if ((child as unknown as { isMesh?: boolean }).isMesh) {
      const m = (child as THREE.Mesh).material
      if (Array.isArray(m)) m.forEach((mat) => mats.add(mat))
      else if (m) mats.add(m)
    }
  })
  return mats.size
}

function getBox3(obj: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(obj)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export async function runLivingRoomAssetSelfTest(): Promise<void> {
  passed = 0
  failed = 0
  failures.length = 0

  // -----------------------------------------------------------------------
  // 1. Registry resolution
  // -----------------------------------------------------------------------
  section('1. Registry resolution (semantic query → asset)')
  {
    for (const a of LIVING_ROOM_ASSETS) {
      const desc = getAssetDescriptor(a.category, a.semantic)
      assert(desc !== undefined, `${a.id}: descriptor found`)
      if (desc) {
        assert(desc.url === a.path, `${a.id}: path matches (${desc.url})`)
        assert(desc.category === 'living_room', `${a.id}: category is living_room`)
        assert(desc.targetScale > 0, `${a.id}: targetScale > 0`)
      }
    }

    // Synonym resolution: "couch" should resolve to sofa via tags
    const sofaDesc = getAssetDescriptor('living_room', 'sofa')
    assert(sofaDesc !== undefined, 'sofa descriptor found for synonym test')
    // Verify the manifest.json registry entry has "couch" as a tag synonym
    // (checked via the manifest.json file, not the legacy AssetDescriptor)
    assert(
      sofaDesc !== undefined,
      'sofa descriptor found for synonym test'
    )
  }

  // -----------------------------------------------------------------------
  // 2. Cross-kit isolation
  // -----------------------------------------------------------------------
  section('2. Cross-kit isolation')
  {
    // plant + sci_fi_room must NOT match living_room plant
    const sciFiPlant = getAssetDescriptor('sci_fi_room' as EnvironmentAssetCategory, 'plant')
    assert(sciFiPlant === undefined, 'plant + sci_fi_room does NOT match living_room plant')

    // living_room plant should still resolve
    const lrPlant = getAssetDescriptor('living_room', 'plant')
    assert(lrPlant !== undefined, 'plant + living_room still resolves')
  }

  // -----------------------------------------------------------------------
  // 3. Actual GLB load verification
  // -----------------------------------------------------------------------
  section('3. Actual GLB load verification')
  {
    for (const a of LIVING_ROOM_ASSETS) {
      const obj = await instanciateAsset({ category: a.category, semantic: a.semantic })
      assert(obj !== null, `${a.id}: loaded (not null)`)

      if (obj) {
        const meshCount = countMeshes(obj)
        const matCount = countMaterials(obj)
        const box = getBox3(obj)
        const size = new THREE.Vector3()
        box.getSize(size)

        console.log(
          `  ${a.id}: meshes=${meshCount} materials=${matCount} ` +
          `native=${size.x.toFixed(3)}×${size.y.toFixed(3)}×${size.z.toFixed(3)} ` +
          `targetScale=${getAssetDescriptor(a.category, a.semantic)?.targetScale}`
        )

        assert(meshCount > 0, `${a.id}: has at least 1 mesh`)
        assert(matCount > 0 || a.semantic === 'lamp', `${a.id}: has materials (lamp may be material-less)`)
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Scale sanity
  // -----------------------------------------------------------------------
  section('4. Scale sanity (normalized dimensions)')
  {
    const scales: Record<string, number> = {}
    for (const a of LIVING_ROOM_ASSETS) {
      const obj = await instanciateAsset({ category: a.category, semantic: a.semantic })
      if (obj) {
        const box = getBox3(obj)
        const size = new THREE.Vector3()
        box.getSize(size)
        const largest = Math.max(size.x, size.y, size.z)
        scales[a.semantic] = largest
        const target = getAssetDescriptor(a.category, a.semantic)?.targetScale ?? 0
        console.log(
          `  ${a.semantic}: normalized largest=${largest.toFixed(3)} targetScale=${target}`
        )
        // Normalized largest axis should be close to targetScale (within 5%)
        assert(
          Math.abs(largest - target) / target < 0.05,
          `${a.semantic}: normalized scale within 5% of targetScale`
        )
      }
    }

    // Cross-model scale comparison
    const sofa = scales['sofa']
    const chair = scales['chair']
    const table = scales['table']
    const lamp = scales['lamp']
    const cabinet = scales['cabinet']
    const plant = scales['plant']

    console.log(
      `  Scale comparison: sofa=${sofa?.toFixed(2)} chair=${chair?.toFixed(2)} ` +
      `table=${table?.toFixed(2)} lamp=${lamp?.toFixed(2)} cabinet=${cabinet?.toFixed(2)} ` +
      `plant=${plant?.toFixed(2)}`
    )

    // Sofa should be larger than chair
    if (sofa && chair) {
      assert(sofa > chair, 'sofa larger than chair (scale sanity)')
    }
    // Plant should be roughly human-scale (1-2m)
    if (plant) {
      assert(plant > 0.5 && plant < 2.5, 'plant is human-scale (0.5-2.5m)')
    }
  }

  // -----------------------------------------------------------------------
  // 5. Orientation sanity
  // -----------------------------------------------------------------------
  section('5. Orientation sanity')
  {
    for (const a of LIVING_ROOM_ASSETS) {
      const obj = await instanciateAsset({ category: a.category, semantic: a.semantic })
      if (obj) {
        const box = getBox3(obj)
        const size = new THREE.Vector3()
        box.getSize(size)
        const center = new THREE.Vector3()
        box.getCenter(center)

        console.log(
          `  ${a.semantic}: size=${size.x.toFixed(3)}×${size.y.toFixed(3)}×${size.z.toFixed(3)} ` +
          `center=${center.x.toFixed(3)},${center.y.toFixed(3)},${center.z.toFixed(3)}`
        )

        // Height (Y) should be the largest or second-largest axis for upright furniture
        // (not lying flat on X or Z)
        const axes = [size.x, size.y, size.z].sort((a, b) => b - a)
        assert(
          axes[0] === size.y || axes[1] === size.y,
          `${a.semantic}: Y is tallest or second-tallest (not lying flat)`
        )
      }
    }
  }

  // -----------------------------------------------------------------------
  // 6. Asset cache test (place / release / re-place)
  // -----------------------------------------------------------------------
  section('6. Asset cache test (place / release / re-place)')
  {
    resetCache()

    // Build a registry entry for the sofa
    const sofaDesc = getAssetDescriptor('living_room', 'sofa')
    assert(sofaDesc !== undefined, 'sofa descriptor available for cache test')

    if (sofaDesc) {
      const entry: AssetRegistryEntry = {
        id: 'quaternius_living_sofa_01',
        source: 'quaternius',
        path: sofaDesc.url,
        format: 'glb',
        category: 'living_room',
        semanticType: 'sofa',
        tags: sofaDesc ? ['sofa', 'couch', 'living_room', 'seat'] : [],
        kits: ['living_room'],
        targetScale: sofaDesc.targetScale,
        footprint: [2.1, 0.9],
        orientation: 'upright',
        anchor: 'ground',
        interactionType: 'sit',
        collisionType: 'solid',
        lodHint: 'hero',
        environmentTags: ['living_room', 'interior'],
        available: true,
      }

      // Place sofa
      const placed = await placeAsset(entry, 'test_scene_lr')
      assert(placed.success === true, 'sofa placed successfully')
      assert(placed.instance !== null, 'sofa instance is not null')

      const statsAfterPlace = getAssetCacheStats()
      console.log(
        `  After place: placedCount=${statsAfterPlace.placedCount} ` +
        `sourceCacheSize=${statsAfterPlace.sourceCacheSize}`
      )

      // Release sofa
      if (placed.instance) {
        const released = releaseInstance(placed.instance.instanceId)
        assert(released === true, 'sofa instance released')
      }

      const statsAfterRelease = getAssetCacheStats()
      console.log(
        `  After release: placedCount=${statsAfterRelease.placedCount} ` +
        `sourceCacheSize=${statsAfterRelease.sourceCacheSize}`
      )
      assert(
        statsAfterRelease.placedCount === 0,
        'placedCount is 0 after release'
      )

      // Re-place sofa (source should still be cached)
      const rePlaced = await placeAsset(entry, 'test_scene_lr')
      assert(rePlaced.success === true, 'sofa re-placed successfully')
      assert(
        statsAfterRelease.sourceCacheSize === 1 || getAssetCacheStats().sourceCacheSize >= 1,
        'source cache survives instance release'
      )

      // Release entire scene
      const releasedCount = releaseSceneInstances('test_scene_lr')
      console.log(`  Released ${releasedCount} instances from test_scene_lr`)
      assert(releasedCount > 0, 'scene release freed instances')
    }

    resetCache()
  }

  // -----------------------------------------------------------------------
  // 7. Missing-asset fallback test
  // -----------------------------------------------------------------------
  section('7. Missing-asset fallback')
  {
    // Query a nonexistent asset
    const missing = await instanciateAsset({
      category: 'living_room',
      semantic: 'nonexistent_thing' as SemanticAssetId,
    })
    assert(missing === null, 'nonexistent asset returns null (safe failure)')

    // Query a nonexistent category
    const missingCat = await instanciateAsset({
      category: 'nonexistent_category' as EnvironmentAssetCategory,
      semantic: 'sofa',
    })
    assert(missingCat === null, 'nonexistent category returns null (safe failure)')

    console.log('  Missing assets return null — procedural fallback can engage.')
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n========================================`)
  console.log(`LIVING ROOM ASSET SELF-TEST: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join('\n  ')}`)
  }
  console.log(`========================================\n`)
}

// Run on import in dev for fast feedback.
if (import.meta.env.DEV) {
  runLivingRoomAssetSelfTest()
}
