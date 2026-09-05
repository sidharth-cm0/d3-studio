/**
 * Environment Kits — PHASE 4C self-test.
 *
 * 14 focused tests covering kit loading, aliases, fallbacks, budgets,
 * registry compatibility, and resolver integration.
 */

import {
  getEnvironmentKit,
  listEnvironmentKits,
  resolveEnvironmentKit,
  ALL_KIT_IDS,
} from './environmentKits'
import { EnvironmentResolverService } from './environmentResolver'
import { getByKit } from './assetRegistry'

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

export function runEnvironmentKitsSelfTest(): void {
  passed = 0
  failed = 0
  failures.length = 0

  // -----------------------------------------------------------------------
  section('1. all five kits load')
  {
    assert(ALL_KIT_IDS.length === 5, 'exactly 5 kit IDs')
    assert(!!getEnvironmentKit('living_room'), 'living_room exists')
    assert(!!getEnvironmentKit('modern_office'), 'modern_office exists')
    assert(!!getEnvironmentKit('city_street'), 'city_street exists')
    assert(!!getEnvironmentKit('forest'), 'forest exists')
    assert(!!getEnvironmentKit('sci_fi_room'), 'sci_fi_room exists')
  }

  // -----------------------------------------------------------------------
  section('2. kit IDs unique')
  {
    const ids = listEnvironmentKits().map((k) => k.id)
    const unique = new Set(ids)
    assert(unique.size === ids.length, 'all kit IDs unique')
  }

  // -----------------------------------------------------------------------
  section('3. aliases resolve correctly')
  {
    assert(resolveEnvironmentKit('a cozy living room')?.id === 'living_room', 'living room alias')
    assert(resolveEnvironmentKit('lounge')?.id === 'living_room', 'lounge alias')
    assert(resolveEnvironmentKit('modern office')?.id === 'modern_office', 'modern office alias')
    assert(resolveEnvironmentKit('workspace')?.id === 'modern_office', 'workspace alias')
    assert(resolveEnvironmentKit('downtown street')?.id === 'city_street', 'city street alias')
    assert(resolveEnvironmentKit('deep forest')?.id === 'forest', 'forest alias')
    assert(resolveEnvironmentKit('woods')?.id === 'forest', 'woods alias')
    assert(resolveEnvironmentKit('spaceship interior')?.id === 'sci_fi_room', 'spaceship interior alias')
    assert(resolveEnvironmentKit('futuristic room')?.id === 'sci_fi_room', 'futuristic room alias')
  }

  // -----------------------------------------------------------------------
  section('4. unknown text returns no kit')
  {
    assert(resolveEnvironmentKit('') === undefined, 'empty string → undefined')
    assert(resolveEnvironmentKit('quantum bakery') === undefined, 'nonsense → undefined')
    assert(resolveEnvironmentKit('studio stage') === undefined, 'generic stage → undefined')
  }

  // -----------------------------------------------------------------------
  section('5-9. kit fallbacks map correctly')
  {
    assert(getEnvironmentKit('living_room')?.fallbackEnvironment === 'apartment', 'living_room → apartment')
    assert(getEnvironmentKit('modern_office')?.fallbackEnvironment === 'office', 'modern_office → office')
    assert(getEnvironmentKit('city_street')?.fallbackEnvironment === 'street', 'city_street → street')
    assert(getEnvironmentKit('forest')?.fallbackEnvironment === 'forest', 'forest → forest')
    assert(getEnvironmentKit('sci_fi_room')?.fallbackEnvironment === 'interior', 'sci_fi_room → interior')
  }

  // -----------------------------------------------------------------------
  section('10. required categories non-empty')
  {
    for (const kit of listEnvironmentKits()) {
      assert(kit.required.length > 0, `${kit.id} has required categories`)
    }
  }

  // -----------------------------------------------------------------------
  section('11. optional categories valid')
  {
    for (const kit of listEnvironmentKits()) {
      assert(kit.optional.length > 0, `${kit.id} has optional categories`)
      const overlap = kit.required.filter((r) => kit.optional.includes(r))
      assert(overlap.length === 0, `${kit.id} no required/optional overlap`)
    }
  }

  // -----------------------------------------------------------------------
  section('12. kit asset query on empty registry returns []')
  {
    for (const id of ALL_KIT_IDS) {
      const assets = getByKit(id)
      assert(assets.length === 0, `${id} → no assets (empty registry)`)
    }
  }

  // -----------------------------------------------------------------------
  section('13. resolver can expose optional kitId')
  {
    const env = EnvironmentResolverService.resolve({ searchText: 'a quiet modern office at dusk' })
    assert(env.blueprint.kitId === 'modern_office', 'resolver sets kitId for office')
    const env2 = EnvironmentResolverService.resolve({ searchText: 'deep in the forest' })
    assert(env2.blueprint.kitId === 'forest', 'resolver sets kitId for forest')
  }

  // -----------------------------------------------------------------------
  section('14. resolver behavior without kit remains backward compatible')
  {
    const env = EnvironmentResolverService.resolve({ searchText: '' })
    assert(env.blueprint.kitId === undefined, 'empty text → no kit')
    assert(typeof env.locationKind === 'string', 'locationKind present')
    assert(typeof env.blueprint.category === 'string', 'blueprint category present')
    assert(typeof env.preset === 'string', 'preset present')
    assert(typeof env.mood === 'string', 'mood present')
    assert(typeof env.blueprint.seed === 'number', 'seed present')
    assert(Array.isArray(env.blueprint.props), 'props present')
    const preset = EnvironmentResolverService.resolveForPreset('minimal')
    assert(preset.blueprint.kitId === undefined, 'preset resolve → no kit')
    assert(preset.preset === 'minimal', 'preset preserved')
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n========================================`)
  console.log(`ENVIRONMENT KITS SELF-TEST: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log(`FAILURES:\n  ${failures.join('\n  ')}`)
  }
  console.log(`========================================\n`)
}

// Run on import in dev for fast feedback.
if (import.meta.env.DEV) {
  runEnvironmentKitsSelfTest()
}