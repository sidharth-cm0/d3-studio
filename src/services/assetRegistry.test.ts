/**
 * Asset Registry — PHASE 4A self-test.
 *
 * 9 focused tests covering:
 *   1. versioned manifest parses
 *   2. empty assets array is valid
 *   3. malformed registry entry rejected safely
 *   4. unknown semantic returns no match
 *   5. unavailable asset is not returned as available
 *   6. kit filtering works
 *   7. source filtering works
 *   8. legacy descriptor normalization works
 *   9. procedural fallback contract remains intact
 *
 * No synthetic assets. No downloads. Safe in browser + Node.
 */

import {
  setRegistry,
  resetRegistry,
  normalizeRegistry,
  normalizeEntry,
  getRegistry,
  getById,
  getByCategory,
  getBySemanticType,
  getByTag,
  getByKit,
  getBySource,
  getBySemanticType as getBySemanticType2,
  resolveSemantic,
  isEmpty,
  entryFromLegacyDescriptor,
  entryFromManifestEntry,
  getAll,
} from './assetRegistry'
import type { AssetRegistryEntry, AssetRegistry } from './assetRegistry'
import type { AssetDescriptor } from './environmentAssetLibrary'
import type { AssetManifestEntry } from './sceneGraphTypes'

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
// Tests
// ---------------------------------------------------------------------------

export function runAssetRegistrySelfTest(): void {
  passed = 0
  failed = 0
  failures.length = 0

  // -----------------------------------------------------------------------
  section('1. versioned manifest parses')
  {
    const raw = { version: 1, assets: [] }
    const reg = normalizeRegistry(raw)
    assert(reg.version === 1, 'version preserved')
    assert(Array.isArray(reg.assets) && reg.assets.length === 0, 'empty assets array valid')

    const reg2 = normalizeRegistry({ assets: [] })
    assert(reg2.version === 1, 'missing version defaults to 1')

    const reg3 = normalizeRegistry(null)
    assert(reg3.assets.length === 0, 'null input → empty registry')

    const reg4 = normalizeRegistry({})
    assert(reg4.assets.length === 0, 'no assets key → empty registry')
  }

  // -----------------------------------------------------------------------
  section('2. empty assets array is valid')
  {
    setRegistry({ version: 1, assets: [] })
    const reg = getRegistry()
    assert(reg.assets.length === 0, 'registry has zero assets')
    assert(isEmpty() === true, 'isEmpty() true on empty registry')
    assert(getAll().length === 0, 'getAll() returns []')
    assert(getById('anything') === undefined, 'getById returns undefined')
    assert(getByCategory('furniture').length === 0, 'getByCategory returns []')
    assert(getByKit('modern_office').length === 0, 'getByKit returns []')
    resetRegistry()
  }

  // -----------------------------------------------------------------------
  section('3. malformed registry entry rejected safely')
  {
    const reg = normalizeRegistry({
      version: 1,
      assets: [
        { id: 'good', path: '/x.glb' },
        null,
        undefined,
        { id: '', path: '/x.glb' },        // empty id
        { id: 'no-path', path: '' },        // empty path
        { path: '/no-id.glb' },             // missing id
        { id: 'no-path' },                  // missing path
        { id: 123, path: '/x.glb' },        // non-string id
        'string-entry',
        42,
      ] as unknown[],
    })
    assert(reg.assets.length === 1, 'only valid entry kept')
    assert(reg.assets[0].id === 'good', 'correct entry preserved')
    assert(normalizeEntry(null) === null, 'normalizeEntry(null) → null')
    assert(normalizeEntry({}) === null, 'normalizeEntry({}) → null')
    assert(normalizeEntry({ id: 'x' }) === null, 'normalizeEntry missing path → null')
  }

  // -----------------------------------------------------------------------
  section('4. unknown semantic returns no match')
  {
    setRegistry({ version: 1, assets: [] })
    const r1 = resolveSemantic('desk')
    assert(r1.length === 0, 'empty registry: desk → no match')
    const r2 = resolveSemantic('office chair')
    assert(r2.length === 0, 'empty registry: office chair → no match')
    const r3 = resolveSemantic('nonexistent_thing_xyz')
    assert(r3.length === 0, 'empty registry: unknown → no match')
    const r4 = resolveSemantic('')
    assert(r4.length === 0, 'empty string → no match')
    resetRegistry()

    // With a real entry, unknown still returns nothing.
    setRegistry({
      version: 1,
      assets: [
        {
          id: 'crate_01',
          source: 'quaternius',
          path: '/assets/environments/warehouse/crate.glb',
          format: 'glb',
          category: 'prop',
          semanticType: 'crate',
          tags: ['crate', 'box', 'wood', 'industrial'],
          kits: ['warehouse'],
          available: false,
        },
      ],
    })
    const r5 = resolveSemantic('spaceship')
    assert(r5.length === 0, 'non-matching semantic → no match even with populated registry')
    resetRegistry()
  }

  // -----------------------------------------------------------------------
  section('5. unavailable asset is not returned as available')
  {
    setRegistry({
      version: 1,
      assets: [
        {
          id: 'desk_01',
          source: 'quaternius',
          path: '/assets/environments/studio/desk.glb',
          format: 'glb',
          category: 'furniture',
          semanticType: 'desk',
          tags: ['desk', 'table', 'wood'],
          kits: ['modern_office'],
          available: false, // declared unavailable
        },
      ],
    })
    const matches = resolveSemantic('desk')
    assert(matches.length === 1, 'desk resolves to one entry')
    assert(matches[0].available === false, 'entry available flag is false')
    // The registry never claims availability — the probe decides.
    // Here we only verify the declared flag is honored.
    resetRegistry()
  }

  // -----------------------------------------------------------------------
  section('6. kit filtering works')
  {
    setRegistry({
      version: 1,
      assets: [
        {
          id: 'chair_office',
          source: 'quaternius',
          path: '/a.glb',
          format: 'glb',
          category: 'furniture',
          semanticType: 'chair',
          tags: ['chair', 'office'],
          kits: ['modern_office'],
          available: false,
        },
        {
          id: 'sofa_01',
          source: 'quaternius',
          path: '/b.glb',
          format: 'glb',
          category: 'furniture',
          semanticType: 'sofa',
          tags: ['sofa', 'couch'],
          kits: ['living_room'],
          available: false,
        },
      ],
    })
    const office = getByKit('modern_office')
    assert(office.length === 1, 'modern_office kit → 1 asset')
    assert(office[0].id === 'chair_office', 'correct office asset')
    const living = getByKit('living_room')
    assert(living.length === 1, 'living_room kit → 1 asset')
    const none = getByKit('nonexistent_kit')
    assert(none.length === 0, 'unknown kit → []')

    // resolveSemantic with kit filter
    const r = resolveSemantic('chair', { kit: 'modern_office' })
    assert(r.length === 1, 'resolveSemantic chair + modern_office → 1')
    const r2 = resolveSemantic('chair', { kit: 'living_room' })
    assert(r2.length === 0, 'resolveSemantic chair + living_room → 0')
    resetRegistry()
  }

  // -----------------------------------------------------------------------
  section('7. source filtering works')
  {
    setRegistry({
      version: 1,
      assets: [
        {
          id: 'q1', source: 'quaternius', path: '/a.glb', format: 'glb',
          category: 'prop', semanticType: 'crate', tags: [], kits: [], available: false,
        },
        {
          id: 'k1', source: 'kenney', path: '/b.glb', format: 'glb',
          category: 'prop', semanticType: 'crate', tags: [], kits: [], available: false,
        },
      ],
    })
    const q = getBySource('quaternius')
    assert(q.length === 1, 'quaternius source → 1')
    const k = getBySource('kenney')
    assert(k.length === 1, 'kenney source → 1')
    const p = getBySource('polyhaven')
    assert(p.length === 0, 'polyhaven source → 0')
    resetRegistry()
  }

  // -----------------------------------------------------------------------
  section('8. legacy descriptor normalization works')
  {
    const legacy: AssetDescriptor = {
      semantic: 'crate',
      category: 'warehouse',
      url: '/assets/environments/warehouse/crate.glb',
      gltfUrl: '/assets/environments/warehouse/crate.gltf',
      purpose: 'Stacked crates.',
      targetScale: 0.8,
      footprintRadius: 0.6,
    }
    const entry = entryFromLegacyDescriptor(legacy)
    assert(entry.id === 'crate', 'legacy id = semantic')
    assert(entry.source === 'legacy', 'legacy source flagged')
    assert(entry.path === legacy.url, 'legacy path = url')
    assert(entry.format === 'glb', 'legacy format = glb')
    assert(entry.category === 'warehouse', 'legacy category preserved')
    assert(entry.targetScale === 0.8, 'legacy targetScale preserved')
    assert(entry.footprint?.[0] === 0.6, 'legacy footprint derived from radius')
    assert(entry.available === false, 'legacy entry NOT auto-available')
    assert(entry.anchor === 'ground', 'legacy anchor = ground')

    // Manifest entry adapter
    const manifestEntry: AssetManifestEntry = {
      id: 'spaceship_01',
      path: 'assets/environments/scifi/spaceship_01.glb',
      type: 'glb',
      tags: ['spaceship', 'scifi'],
      scaleHint: [5.5, 2.6, 7],
      footprint: [7, 5],
      orientation: 'face_camera',
      environmentTags: ['scifi'],
      materialTags: ['metal'],
    }
    const adapted = entryFromManifestEntry(manifestEntry)
    assert(adapted !== null, 'valid manifest entry adapts')
    assert(adapted!.id === 'spaceship_01', 'manifest id preserved')
    assert(adapted!.format === 'glb', 'manifest format preserved')
    assert(adapted!.available === false, 'manifest entry NOT auto-available')
    assert(adapted!.scaleHint?.[0] === 5.5, 'manifest scaleHint preserved')

    // Invalid manifest entry
    const bad = entryFromManifestEntry({ id: '', path: '', type: 'glb', tags: [] })
    assert(bad === null, 'invalid manifest entry → null')
  }

  // -----------------------------------------------------------------------
  section('9. procedural fallback contract remains intact')
  {
    // The critical contract: with zero real assets, every semantic query
    // returns no match, so the caller uses procedural fallback.
    setRegistry({ version: 1, assets: [] })

    const queries = [
      'desk', 'office chair', 'desk chair', 'sofa', 'couch',
      'table', 'street lamp', 'tree', 'crate', 'door', 'machinery',
      'chair', 'bench', 'rock', 'building', 'shelf',
    ]
    let allEmpty = true
    for (const q of queries) {
      const r = resolveSemantic(q)
      if (r.length !== 0) {
        allEmpty = false
        console.error(`    unexpected match for "${q}": ${r.map((e) => e.id).join(', ')}`)
      }
    }
    assert(allEmpty, 'all semantic queries return no match on empty registry')

    // Kit-specific queries also return nothing.
    const kitQueries = [
      ['desk', 'modern_office'],
      ['sofa', 'living_room'],
      ['tree', 'forest'],
    ]
    let allKitEmpty = true
    for (const [sem, kit] of kitQueries) {
      const r = resolveSemantic(sem, { kit })
      if (r.length !== 0) allKitEmpty = false
    }
    assert(allKitEmpty, 'kit-specific queries return no match on empty registry')

    // Registry never fabricates availability.
    assert(getAll().length === 0, 'no entries fabricated')
    assert(isEmpty() === true, 'registry stays empty')

    resetRegistry()
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n========================================`)
  console.log(`ASSET REGISTRY SELF-TEST: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join('\n  ')}`)
  }
  console.log(`========================================\n`)
}

// Run on import in dev for fast feedback (no-op in production bundles).
if (import.meta.env.DEV) {
  runAssetRegistrySelfTest()
}