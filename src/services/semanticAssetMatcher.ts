/**
 * Semantic Asset Matcher — PHASE 3.
 *
 * Given a validated SceneObjectSpec (a semantic object request), choose either:
 *   1. a matching local GLB/GLTF asset from the manifest, or
 *   2. a procedural fallback primitive type.
 *
 * Scoring is lightweight (no embeddings / vector DB):
 *   - exact tag match
 *   - synonym match
 *   - semantic type match
 *   - environment compatibility
 *   - material / category compatibility
 *
 * The matcher NEVER returns no result: if no GLB asset clears the match
 * threshold (or the manifest is empty), a procedural fallback is always
 * returned.
 *
 * This module is pure data + pure functions (no Three.js). It is safe to call
 * from the builder, the self-test, or any future LLM integration path.
 */

import type {
  AssetManifest,
  AssetManifestEntry,
  AssetMatchResult,
  PrimitiveFallback,
  SceneObjectSpec,
} from './sceneGraphTypes'

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

/**
 * The manifest is a static JSON file served from /public/assets/manifest.json.
 * In a browser/Vite context it is fetched at runtime; in a Node/test context
 * it is read from the filesystem. The matcher caches the parsed result so the
 * file is only loaded once per session.
 *
 * The manifest shape:
 *   { "assets": [ { id, path, type, tags, scaleHint, footprint, orientation,
 *                   environmentTags?, materialTags? } ] }
 */
let manifestCache: AssetManifest | null = null
let manifestLoadPromise: Promise<AssetManifest> | null = null

/**
 * Load (and cache) the asset manifest.
 *
 * Resolution order:
 *   1. If a manifest was explicitly set via setManifest(), use it.
 *   2. Try to fetch /assets/manifest.json (browser / Vite dev / Vite build).
 *   3. If the fetch fails (e.g. running in a pure Node test without a server),
 *      fall back to an empty manifest — the matcher still works via procedural
 *      fallbacks.
 */
export function loadManifest(): Promise<AssetManifest> {
  if (manifestCache !== null) return Promise.resolve(manifestCache)
  if (manifestLoadPromise !== null) return manifestLoadPromise

  manifestLoadPromise = (async (): Promise<AssetManifest> => {
    try {
      const res = await fetch('/assets/manifest.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as unknown
      const parsed = parseManifest(data)
      manifestCache = parsed
      return parsed
    } catch {
      // No server / file not found / parse error → empty manifest.
      // The matcher still resolves everything to procedural fallbacks.
      manifestCache = { assets: [] }
      return manifestCache
    }
  })()

  return manifestLoadPromise
}

/**
 * Synchronously retrieve the cached manifest, or null if not yet loaded.
 * Useful for callers that already have the manifest or want to avoid async.
 */
export function getCachedManifest(): AssetManifest | null {
  return manifestCache
}

/**
 * Explicitly inject a manifest (used by tests and by callers that already
 * have the data). Bypasses the fetch path entirely.
 */
export function setManifest(manifest: AssetManifest): void {
  manifestCache = parseManifest(manifest)
  manifestLoadPromise = null
}

/**
 * Reset the manifest cache — forces a re-fetch on the next loadManifest() call.
 * Primarily for testing.
 */
export function resetManifestCache(): void {
  manifestCache = null
  manifestLoadPromise = null
}

/**
 * Validate + normalize a raw manifest value into AssetManifest.
 * Malformed entries are silently skipped (never throws).
 */
function parseManifest(raw: unknown): AssetManifest {
  if (!raw || typeof raw !== 'object') return { assets: [] }
  const obj = raw as Record<string, unknown>
  const arr = Array.isArray(obj.assets) ? obj.assets : []
  const assets: AssetManifestEntry[] = []
  for (const entry of arr) {
    const parsed = parseEntry(entry)
    if (parsed) assets.push(parsed)
  }
  return { assets }
}

function parseEntry(raw: unknown): AssetManifestEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  const path = typeof o.path === 'string' && o.path.trim() ? o.path.trim() : null
  const type =
    typeof o.type === 'string' && (o.type === 'glb' || o.type === 'gltf' || o.type === 'procedural')
      ? (o.type as AssetManifestEntry['type'])
      : null

  if (!id || !path || !type) return null

  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().trim())
    : []

  const scaleHint =
    Array.isArray(o.scaleHint) &&
    typeof o.scaleHint[0] === 'number' &&
    typeof o.scaleHint[1] === 'number' &&
    typeof o.scaleHint[2] === 'number'
      ? ([o.scaleHint[0], o.scaleHint[1], o.scaleHint[2]] as [number, number, number])
      : undefined

  const footprint =
    Array.isArray(o.footprint) &&
    typeof o.footprint[0] === 'number' &&
    typeof o.footprint[1] === 'number'
      ? ([o.footprint[0], o.footprint[1]] as [number, number])
      : undefined

  const orientation =
    typeof o.orientation === 'string' &&
    (o.orientation === 'face_camera' ||
      o.orientation === 'upright' ||
      o.orientation === 'flat' ||
      o.orientation === 'random')
      ? (o.orientation as AssetManifestEntry['orientation'])
      : undefined

  const environmentTags = Array.isArray(o.environmentTags)
    ? o.environmentTags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().trim())
    : undefined

  const materialTags = Array.isArray(o.materialTags)
    ? o.materialTags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().trim())
    : undefined

  return {
    id,
    path,
    type,
    tags,
    scaleHint,
    footprint,
    orientation,
    environmentTags,
    materialTags,
  }
}

// ---------------------------------------------------------------------------
// Synonym support
// ---------------------------------------------------------------------------

/**
 * Synonym groups — each group is a set of terms that are semantically
 * interchangeable for asset matching purposes.
 *
 * Lookup is O(1): given any term, we find its group and return all members.
 */
const SYNONYM_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['desk', 'table', 'counter']),
  new Set(['sofa', 'couch']),
  new Set(['rock', 'boulder']),
  new Set(['lamp', 'light']),
  new Set(['shelf', 'shelving']),
  new Set(['spaceship', 'spacecraft', 'ship']),
  new Set(['screen', 'monitor', 'display']),
  new Set(['crate', 'cargo', 'cargo_box', 'box']),
  new Set(['road', 'street', 'asphalt']),
  new Set(['tree', 'vegetation']),
  new Set(['chair', 'seat']),
  new Set(['bench', 'seat']),
  new Set(['machine', 'apparatus', 'device', 'generator', 'reactor']),
  new Set(['building', 'structure']),
  new Set(['pillar', 'column']),
  new Set(['wall', 'panel']),
  new Set(['floor', 'ground']),
  new Set(['window', 'glass']),
  new Set(['door', 'doorway', 'entrance']),
  new Set(['path', 'walkway', 'walk', 'trail']),
  new Set(['rail', 'track']),
  new Set(['sign', 'signage', 'signboard']),
  new Set(['platform', 'stage', 'dais']),
  new Set(['bed', 'cot']),
  new Set(['cabinet', 'wardrobe', 'chest']),
  new Set(['bush', 'shrub', 'undergrowth']),
  new Set(['plant', 'foliage', 'greenery']),
  new Set(['fire', 'flame', 'torch']),
  new Set(['lamp_post', 'street_lamp', 'light_post']),
  new Set(['screen_panel', 'display_panel', 'monitor_stand']),
  new Set(['lab_machine', 'scientific_machine', 'scientific_apparatus']),
  new Set(['spaceship_wreck', 'spacecraft_wreck', 'ship_wreck', 'wreck', 'crashed_ship']),
  new Set(['debris_field', 'debris', 'wreckage']),
  new Set(['engine_cylinder', 'engine', 'thruster', 'exhaust']),
  new Set(['rock_formation', 'formation', 'outcropping']),
  new Set(['crater_rim', 'crater']),
  new Set(['dune', 'sand_dune']),
  new Set(['palm_tree', 'palm']),
  new Set(['stalagmite', 'spike', 'pillar_rock']),
  new Set(['crystal', 'gem', 'gemstone']),
  new Set(['tent', 'shelter']),
  new Set(['campfire', 'firepit', 'bonfire']),
  new Set(['log_seat', 'log', 'stump']),
  new Set(['vehicle_body', 'vehicle', 'car', 'truck']),
  new Set(['rubble', 'debris_ground', 'scattered']),
  new Set(['hedge', 'hedgerow']),
  new Set(['statue', 'sculpture', 'monument']),
  new Set(['fountain', 'water_feature']),
  new Set(['bridge', 'arch', 'tunnel_arch']),
  new Set(['stairs', 'steps', 'staircase']),
  new Set(['pipe', 'tube', 'conduit']),
  new Set(['beam', 'girder', 'strut']),
  new Set(['rack', 'rack_upright', 'shelving_unit']),
  new Set(['barrel', 'cask', 'keg']),
  new Set(['pallet', 'skid']),
  new Set(['cargo_box', 'shipping_container', 'container']),
  // Phase 4 asset-library expansion (conservative alias sets).
  new Set(['streetlight', 'street_light']),
  new Set(['trashcan', 'bin', 'trash_bin', 'garbage_can', 'dumpster']),
  new Set(['traffic_light', 'stoplight']),
  new Set(['sidewalk', 'pavement', 'curb']),
  new Set(['shop', 'store', 'storefront']),
  new Set(['pine', 'conifer']),
  new Set(['console', 'control_panel', 'terminal_panel']),
  new Set(['monitor', 'screen', 'display']),
  new Set(['file_cabinet', 'drawer_cabinet', 'filing_cabinet']),
  new Set(['bookcase', 'bookshelf']),
  new Set(['grass', 'grass_clump', 'turf']),
  new Set(['mushroom', 'fungus', 'toadstool']),
]

/**
 * Build a reverse index: term → set of all synonyms (including itself).
 * Computed once on first use.
 */
let synonymIndex: Map<string, string[]> | null = null

function getSynonymIndex(): Map<string, string[]> {
  if (synonymIndex !== null) return synonymIndex
  const index = new Map<string, string[]>()
  for (const group of SYNONYM_GROUPS) {
    const members = Array.from(group)
    for (const term of members) {
      // Merge with any existing entries (a term could appear in multiple groups).
      const existing = index.get(term)
      if (existing) {
        for (const m of members) {
          if (!existing.includes(m)) existing.push(m)
        }
      } else {
        index.set(term, [...members])
      }
    }
  }
  synonymIndex = index
  return index
}

/**
 * Return all synonyms for a term (including the term itself).
 * If the term has no synonym group, returns [term].
 */
export function getSynonyms(term: string): string[] {
  const idx = getSynonymIndex()
  const lower = term.toLowerCase().trim()
  return idx.get(lower) ?? [lower]
}

/**
 * Check whether two terms are synonyms (directly or transitively).
 */
export function areSynonyms(a: string, b: string): boolean {
  const sa = a.toLowerCase().trim()
  const sb = b.toLowerCase().trim()
  if (sa === sb) return true
  const syns = getSynonyms(sa)
  return syns.includes(sb)
}

// ---------------------------------------------------------------------------
// Procedural fallback mapping
// ---------------------------------------------------------------------------

/**
 * Maps a semantic type (or any tag) to its best procedural primitive fallback.
 * This is the "never return no result" guarantee: every semantic concept maps
 * to at least one primitive.
 *
 * The mapping is derived from the TYPE_PRIMITIVE table in sceneGraphParser.ts
 * (which the parser already uses to assign primitiveFallback on each object),
 * extended with the synonym groups so that synonyms resolve to the same
 * fallback.
 */
const SEMANTIC_TO_PRIMITIVE: Record<string, PrimitiveFallback> = {
  // Structures / architecture
  building: 'compound',
  structure: 'compound',
  wall: 'box',
  panel: 'box',
  platform: 'box',
  stage: 'box',
  dais: 'box',
  stairs: 'extrusion',
  steps: 'extrusion',
  staircase: 'extrusion',
  bridge: 'compound',
  arch: 'compound',
  tunnel_arch: 'compound',
  column: 'cylinder',
  pillar: 'cylinder',
  beam: 'box',
  girder: 'box',
  strut: 'box',
  pipe: 'cylinder',
  tube: 'cylinder',
  conduit: 'cylinder',

  // Vehicles / spacecraft
  spaceship: 'compound',
  spacecraft: 'compound',
  ship: 'compound',
  spaceship_wreck: 'compound',
  spacecraft_wreck: 'compound',
  ship_wreck: 'compound',
  wreck: 'compound',
  crashed_ship: 'compound',
  vehicle: 'compound',
  vehicle_body: 'compound',
  car: 'compound',
  truck: 'compound',
  engine: 'cylinder',
  engine_cylinder: 'cylinder',
  thruster: 'cylinder',
  exhaust: 'cylinder',

  // Nature / terrain
  tree: 'compound',
  vegetation: 'compound',
  plant: 'compound',
  foliage: 'compound',
  greenery: 'compound',
  palm_tree: 'compound',
  palm: 'compound',
  bush: 'sphere',
  shrub: 'sphere',
  undergrowth: 'sphere',
  rock: 'compound',
  boulder: 'compound',
  rock_formation: 'compound',
  formation: 'compound',
  outcropping: 'compound',
  crater: 'compound',
  crater_rim: 'compound',
  dune: 'extrusion',
  sand_dune: 'extrusion',
  stalagmite: 'cone',
  spike: 'cone',
  pillar_rock: 'cone',
  crystal: 'compound',
  gem: 'compound',
  gemstone: 'compound',
  hedge: 'box',
  hedgerow: 'box',
  rubble: 'compound',
  debris_ground: 'compound',
  scattered: 'compound',
  debris: 'compound',
  wreckage: 'compound',

  // Furniture / fixtures
  table: 'compound',
  desk: 'compound',
  counter: 'compound',
  chair: 'compound',
  seat: 'compound',
  bench: 'compound',
  sofa: 'compound',
  couch: 'compound',
  bed: 'compound',
  cot: 'compound',
  cabinet: 'box',
  wardrobe: 'box',
  chest: 'box',
  shelf: 'compound',
  shelving: 'compound',
  shelving_unit: 'compound',
  rack: 'compound',
  rack_upright: 'compound',
  bookshelf: 'compound',
  bookcase: 'compound',

  // Lighting / electronics
  lamp: 'compound',
  light: 'compound',
  lamp_post: 'compound',
  street_lamp: 'compound',
  light_post: 'compound',
  screen: 'box',
  monitor: 'box',
  display: 'box',
  screen_panel: 'box',
  display_panel: 'box',
  monitor_stand: 'box',
  sign: 'box',
  signage: 'box',
  signboard: 'box',
  station_sign: 'box',

  // Industrial / machinery
  machine: 'compound',
  apparatus: 'compound',
  device: 'compound',
  generator: 'compound',
  reactor: 'compound',
  lab_machine: 'compound',
  scientific_machine: 'compound',
  scientific_apparatus: 'compound',
  crate: 'box',
  cargo: 'box',
  cargo_box: 'box',
  box: 'box',
  barrel: 'cylinder',
  cask: 'cylinder',
  keg: 'cylinder',
  pallet: 'box',
  skid: 'box',
  container: 'box',
  shipping_container: 'box',

  // Outdoor / infrastructure
  road: 'plane',
  street: 'plane',
  asphalt: 'plane',
  sidewalk: 'plane',
  rail: 'box',
  track: 'box',
  path: 'plane',
  walkway: 'plane',
  walk: 'plane',
  trail: 'plane',
  fence: 'compound',
  window: 'plane',
  glass: 'plane',
  door: 'box',
  doorway: 'box',
  entrance: 'box',
  floor: 'plane',
  ground: 'plane',

  // Fire / light sources
  fire: 'compound',
  flame: 'compound',
  torch: 'compound',
  campfire: 'compound',
  firepit: 'compound',
  bonfire: 'compound',
  log_seat: 'cylinder',
  log: 'cylinder',
  stump: 'cylinder',

  // Miscellaneous
  tent: 'compound',
  shelter: 'compound',
  statue: 'compound',
  sculpture: 'compound',
  monument: 'compound',
  fountain: 'compound',
  water_feature: 'compound',
}

/**
 * Resolve the best procedural fallback for a semantic type + tags.
 *
 * Strategy:
 *   1. Check the semanticType directly.
 *   2. Check each tag (tags often carry the more specific noun).
 *   3. Check synonyms of the semanticType and each tag.
 *   4. Fall back to the spec's own primitiveFallback (set by the parser/validator).
 *   5. Ultimate fallback: 'compound' (always valid, always renders something).
 */
export function resolveProceduralFallback(spec: SceneObjectSpec): PrimitiveFallback {
  // 1. Direct semanticType match.
  const direct = SEMANTIC_TO_PRIMITIVE[spec.semanticType.toLowerCase()]
  if (direct) return direct

  // 2. Tag matches.
  for (const tag of spec.tags) {
    const t = tag.toLowerCase()
    const found = SEMANTIC_TO_PRIMITIVE[t]
    if (found) return found
  }

  // 3. Synonym expansion of semanticType.
  for (const syn of getSynonyms(spec.semanticType)) {
    const found = SEMANTIC_TO_PRIMITIVE[syn]
    if (found) return found
  }

  // 4. Synonym expansion of tags.
  for (const tag of spec.tags) {
    for (const syn of getSynonyms(tag)) {
      const found = SEMANTIC_TO_PRIMITIVE[syn]
      if (found) return found
    }
  }

  // 5. Use the spec's own primitiveFallback (parser/validator already set this).
  if (spec.primitiveFallback) return spec.primitiveFallback

  // 6. Ultimate fallback.
  return 'compound'
}

/**
 * Derive a compound hint string for procedural builders.
 * This gives the procedural geometry generator a semantic category to build
 * a more specific compound shape (e.g. "spaceship" → compound with hull + wings).
 */
export function resolveCompoundHint(spec: SceneObjectSpec): string | undefined {
  // Prefer the spec's own compoundHint if set.
  if (spec.compoundHint) return spec.compoundHint

  // Derive from semanticType via synonyms.
  const type = spec.semanticType.toLowerCase()
  for (const syn of getSynonyms(type)) {
    if (SEMANTIC_TO_PRIMITIVE[syn] === 'compound') {
      return syn
    }
  }

  // Check tags.
  for (const tag of spec.tags) {
    const t = tag.toLowerCase()
    for (const syn of getSynonyms(t)) {
      if (SEMANTIC_TO_PRIMITIVE[syn] === 'compound') {
        return syn
      }
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Match threshold: a GLB asset must score at least this to be selected. */
export const MATCH_THRESHOLD = 0.35

/**
 * Scoring weights — each component contributes to the final score in [0, 1].
 * The weights are tuned so that:
 *   - exact tag match is the strongest signal (an asset tagged "spaceship"
 *     matching a request for "spaceship" is a near-certain match)
 *   - synonym match is strong but slightly weaker (asset tagged "couch"
 *     matching a request for "sofa")
 *   - semantic type match is moderate (the asset's id or primary tag matches
 *     the request's semanticType)
 *   - environment compatibility is a bonus (asset tagged for the right
 *     environment family)
 *   - material/category compatibility is a smaller bonus
 */
const SCORE_WEIGHTS = {
  exactTag: 0.45,
  synonym: 0.35,
  semanticType: 0.3,
  environment: 0.15,
  material: 0.1,
}

/**
 * Score how well a manifest asset matches a SceneObjectSpec.
 * Returns a score in [0, 1] and the list of matched tags.
 */
function scoreAsset(
  spec: SceneObjectSpec,
  entry: AssetManifestEntry,
  environmentFamily?: string
): { score: number; matchedTags: string[] } {
  const specTags = spec.tags.map((t) => t.toLowerCase())
  const specType = spec.semanticType.toLowerCase()
  const assetTags = entry.tags.map((t) => t.toLowerCase())
  const assetId = entry.id.toLowerCase()

  const matchedTags: string[] = []
  let score = 0

  // --- Exact tag match (strongest) ---
  for (const st of specTags) {
    for (const at of assetTags) {
      if (st === at) {
        score += SCORE_WEIGHTS.exactTag
        if (!matchedTags.includes(at)) matchedTags.push(at)
      }
    }
  }

  // --- Synonym match ---
  for (const st of specTags) {
    for (const at of assetTags) {
      if (st !== at && areSynonyms(st, at)) {
        score += SCORE_WEIGHTS.synonym
        if (!matchedTags.includes(at)) matchedTags.push(at)
      }
    }
  }

  // --- Semantic type match (asset id or tags contain the spec's semanticType) ---
  if (assetId === specType || assetTags.includes(specType)) {
    score += SCORE_WEIGHTS.semanticType
    if (!matchedTags.includes(specType)) matchedTags.push(specType)
  } else {
    // Synonym of semanticType in asset tags/id
    for (const at of [...assetTags, assetId]) {
      if (at !== specType && areSynonyms(specType, at)) {
        score += SCORE_WEIGHTS.semanticType * 0.7
        if (!matchedTags.includes(at)) matchedTags.push(at)
      }
    }
  }

  // --- Environment compatibility ---
  if (environmentFamily && entry.environmentTags && entry.environmentTags.length > 0) {
    const envLower = environmentFamily.toLowerCase()
    for (const et of entry.environmentTags) {
      if (et === envLower || areSynonyms(et, envLower)) {
        score += SCORE_WEIGHTS.environment
        if (!matchedTags.includes(et)) matchedTags.push(et)
      }
    }
  }

  // --- Material / category compatibility ---
  if (entry.materialTags && entry.materialTags.length > 0) {
    for (const mt of entry.materialTags) {
      for (const st of specTags) {
        if (st === mt || areSynonyms(st, mt)) {
          score += SCORE_WEIGHTS.material
          if (!matchedTags.includes(mt)) matchedTags.push(mt)
        }
      }
    }
  }

  // --- preferredAsset bonus ---
  if (spec.preferredAsset) {
    const pref = spec.preferredAsset.toLowerCase()
    if (assetId === pref || assetTags.includes(pref)) {
      score += 0.2
      if (!matchedTags.includes(pref)) matchedTags.push(pref)
    }
  }

  // Clamp to [0, 1].
  score = Math.min(1, Math.max(0, score))

  return { score, matchedTags }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match a single SceneObjectSpec against the manifest.
 *
 * Returns an AssetMatchResult that is NEVER null:
 *   - If a GLB/GLTF asset scores above MATCH_THRESHOLD, source is "glb"/"gltf"
 *     and assetId/assetPath are populated.
 *   - Otherwise, source is "procedural" and fallbackPrimitive is set.
 *
 * @param spec             The validated SceneObjectSpec to match.
 * @param manifest         Optional pre-loaded manifest. If omitted, the cached
 *                         manifest is used (loaded via loadManifest if needed).
 * @param environmentFamily Optional environment family string (e.g. "warehouse",
 *                         "forest", "mars") for environment compatibility scoring.
 */
export async function matchAsset(
  spec: SceneObjectSpec,
  manifest?: AssetManifest,
  environmentFamily?: string
): Promise<AssetMatchResult> {
  const man = manifest ?? (manifestCache ?? (await loadManifest()))

  // Only consider GLB/GLTF assets (procedural entries in the manifest are
  // treated as hints, not loadable files).
  const glbAssets = man.assets.filter((a) => a.type === 'glb' || a.type === 'gltf')

  let bestScore = 0
  let bestEntry: AssetManifestEntry | null = null
  let bestMatchedTags: string[] = []

  for (const entry of glbAssets) {
    const { score, matchedTags } = scoreAsset(spec, entry, environmentFamily)
    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
      bestMatchedTags = matchedTags
    }
  }

  // If the best GLB match clears the threshold, return it.
  if (bestEntry && bestScore >= MATCH_THRESHOLD) {
    return {
      assetId: bestEntry.id,
      assetPath: bestEntry.path,
      assetType: bestEntry.type,
      score: bestScore,
      matchedTags: bestMatchedTags,
      fallbackPrimitive: resolveProceduralFallback(spec),
      fallbackCompoundHint: resolveCompoundHint(spec),
    }
  }

  // Otherwise: procedural fallback (NEVER returns null).
  const fallbackPrimitive = resolveProceduralFallback(spec)
  const fallbackCompoundHint = resolveCompoundHint(spec)

  return {
    assetId: null,
    assetPath: null,
    assetType: 'procedural',
    score: bestScore, // may be 0 if manifest is empty
    matchedTags: bestMatchedTags,
    fallbackPrimitive,
    fallbackCompoundHint,
  }
}

/**
 * Synchronous version of matchAsset — uses only the cached manifest.
 * If the manifest hasn't been loaded yet, it operates on an empty manifest
 * (all results will be procedural fallbacks).
 *
 * This is the primary entry point for the builder, which already has the
 * manifest loaded (or accepts procedural fallbacks).
 */
export function matchAssetSync(
  spec: SceneObjectSpec,
  manifest?: AssetManifest,
  environmentFamily?: string
): AssetMatchResult {
  const man = manifest ?? manifestCache ?? { assets: [] }

  const glbAssets = man.assets.filter((a) => a.type === 'glb' || a.type === 'gltf')

  let bestScore = 0
  let bestEntry: AssetManifestEntry | null = null
  let bestMatchedTags: string[] = []

  for (const entry of glbAssets) {
    const { score, matchedTags } = scoreAsset(spec, entry, environmentFamily)
    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
      bestMatchedTags = matchedTags
    }
  }

  if (bestEntry && bestScore >= MATCH_THRESHOLD) {
    return {
      assetId: bestEntry.id,
      assetPath: bestEntry.path,
      assetType: bestEntry.type,
      score: bestScore,
      matchedTags: bestMatchedTags,
      fallbackPrimitive: resolveProceduralFallback(spec),
      fallbackCompoundHint: resolveCompoundHint(spec),
    }
  }

  const fallbackPrimitive = resolveProceduralFallback(spec)
  const fallbackCompoundHint = resolveCompoundHint(spec)

  return {
    assetId: null,
    assetPath: null,
    assetType: 'procedural',
    score: bestScore,
    matchedTags: bestMatchedTags,
    fallbackPrimitive,
    fallbackCompoundHint,
  }
}

/**
 * Match multiple SceneObjectSpecs at once (batch convenience).
 * Returns results in the same order as the input specs.
 */
export async function matchAssets(
  specs: SceneObjectSpec[],
  manifest?: AssetManifest,
  environmentFamily?: string
): Promise<AssetMatchResult[]> {
  return Promise.all(specs.map((s) => matchAsset(s, manifest, environmentFamily)))
}

/**
 * Match multiple SceneObjectSpecs synchronously (batch convenience).
 */
export function matchAssetsSync(
  specs: SceneObjectSpec[],
  manifest?: AssetManifest,
  environmentFamily?: string
): AssetMatchResult[] {
  return specs.map((s) => matchAssetSync(s, manifest, environmentFamily))
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * Run the semantic asset matcher self-test.
 *
 * Tests the 7 required cases plus the empty-manifest guarantee.
 * Prints a readable report to the console.
 *
 * This function is safe to call in any environment (browser, Node, test).
 * It does NOT require a running server — it uses setManifest() to inject
 * test manifests directly.
 */
export function runSemanticMatcherSelfTest(): void {
  const results: Array<{
    label: string
    spec: SceneObjectSpec
    result: AssetMatchResult
  }> = []

  // Test cases from the task specification.
  const testCases: Array<{ label: string; semanticType: string; tags: string[] }> = [
    { label: 'spaceship', semanticType: 'spaceship', tags: ['spaceship', 'scifi', 'wreck'] },
    { label: 'tea counter', semanticType: 'counter', tags: ['counter', 'tea', 'shop', 'wood'] },
    { label: 'rock', semanticType: 'rock', tags: ['rock', 'boulder', 'terrain'] },
    { label: 'scientific machine', semanticType: 'lab_machine', tags: ['machine', 'scientific', 'lab', 'metal'] },
    { label: 'news desk', semanticType: 'desk', tags: ['desk', 'news', 'broadcast', 'screen'] },
    { label: 'railway bench', semanticType: 'bench', tags: ['bench', 'railway', 'station', 'wood'] },
    { label: 'unknown alien artifact', semanticType: 'alien_artifact', tags: ['alien', 'artifact', 'unknown', 'mystery'] },
  ]

  // --- Test 1: Empty manifest (all must resolve to procedural) ---
  setManifest({ assets: [] })

  console.group('[D3 MATCHER] Self-Test: Empty Manifest')
  for (const tc of testCases) {
    const spec: SceneObjectSpec = {
      id: `test_${tc.label.replace(/\s+/g, '_')}`,
      semanticType: tc.semanticType,
      tags: tc.tags,
      importance: 'hero',
      primitiveFallback: 'compound',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      zone: 'midground',
      avoidActors: true,
      cameraImportant: true,
    }
    const result = matchAssetSync(spec)
    results.push({ label: tc.label, spec, result })

    const source = result.assetType === 'procedural' ? 'procedural' : `${result.assetType}:${result.assetId}`
    console.log(
      `  ${tc.label.padEnd(22)} → source=${source.padEnd(20)} ` +
        `score=${result.score.toFixed(2)} primitive=${result.fallbackPrimitive}` +
        (result.fallbackCompoundHint ? ` hint=${result.fallbackCompoundHint}` : '') +
        ` matchedTags=[${result.matchedTags.join(', ')}]`
    )

    // Verify: empty manifest MUST always return procedural.
    if (result.assetType !== 'procedural') {
      console.error(`  FAIL: "${tc.label}" should be procedural with empty manifest but got ${result.assetType}`)
    }
  }
  console.groupEnd()

  // --- Test 2: Populated manifest (some should match GLB) ---
  const populatedManifest: AssetManifest = {
    assets: [
      {
        id: 'spaceship_01',
        path: 'assets/environments/scifi/spaceship_01.glb',
        type: 'glb',
        tags: ['spaceship', 'spacecraft', 'ship', 'scifi', 'wreck', 'metal'],
        scaleHint: [5.5, 2.6, 7],
        footprint: [7, 5],
        orientation: 'face_camera',
        environmentTags: ['scifi_wreck', 'mars', 'moon'],
        materialTags: ['metal', 'industrial'],
      },
      {
        id: 'crate_01',
        path: 'assets/environments/warehouse/crate_01.glb',
        type: 'glb',
        tags: ['crate', 'cargo', 'cargo_box', 'box', 'wood', 'industrial'],
        scaleHint: [0.8, 0.8, 0.8],
        footprint: [1, 1],
        orientation: 'face_camera',
        environmentTags: ['warehouse', 'industrial'],
        materialTags: ['wood', 'industrial'],
      },
      {
        id: 'rock_01',
        path: 'assets/environments/forest/rock_01.glb',
        type: 'glb',
        tags: ['rock', 'boulder', 'stone', 'terrain', 'natural'],
        scaleHint: [0.8, 0.6, 0.8],
        footprint: [1, 1],
        orientation: 'upright',
        environmentTags: ['forest', 'mountains', 'cave', 'mars'],
        materialTags: ['stone', 'natural'],
      },
      {
        id: 'desk_01',
        path: 'assets/environments/studio/desk_01.glb',
        type: 'glb',
        tags: ['desk', 'table', 'counter', 'wood', 'studio', 'news'],
        scaleHint: [1.6, 0.78, 0.8],
        footprint: [1.6, 0.8],
        orientation: 'upright',
        environmentTags: ['studio', 'broadcast', 'office'],
        materialTags: ['wood', 'studio'],
      },
      {
        id: 'bench_01',
        path: 'assets/environments/railway/bench_01.glb',
        type: 'glb',
        tags: ['bench', 'seat', 'wood', 'railway', 'station'],
        scaleHint: [1.7, 0.8, 0.55],
        footprint: [1.7, 0.55],
        orientation: 'upright',
        environmentTags: ['railway', 'city', 'park'],
        materialTags: ['wood', 'metal'],
      },
      {
        id: 'lab_machine_01',
        path: 'assets/environments/laboratory/lab_machine_01.glb',
        type: 'glb',
        tags: ['lab_machine', 'machine', 'scientific', 'apparatus', 'metal', 'lab'],
        scaleHint: [2.2, 2.4, 1.4],
        footprint: [2.2, 1.4],
        orientation: 'upright',
        environmentTags: ['laboratory', 'office'],
        materialTags: ['metal', 'industrial'],
      },
    ],
  }

  setManifest(populatedManifest)

  console.group('[D3 MATCHER] Self-Test: Populated Manifest')
  for (const tc of testCases) {
    const spec: SceneObjectSpec = {
      id: `test_${tc.label.replace(/\s+/g, '_')}`,
      semanticType: tc.semanticType,
      tags: tc.tags,
      importance: 'hero',
      primitiveFallback: 'compound',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      zone: 'midground',
      avoidActors: true,
      cameraImportant: true,
    }
    const result = matchAssetSync(spec, populatedManifest)

    const source = result.assetType === 'procedural' ? 'procedural' : `${result.assetType}:${result.assetId}`
    console.log(
      `  ${tc.label.padEnd(22)} → source=${source.padEnd(24)} ` +
        `score=${result.score.toFixed(2)} primitive=${result.fallbackPrimitive}` +
        (result.fallbackCompoundHint ? ` hint=${result.fallbackCompoundHint}` : '') +
        ` matchedTags=[${result.matchedTags.join(', ')}]`
    )
  }
  console.groupEnd()

  // --- Test 3: Synonym verification ---
  console.group('[D3 MATCHER] Self-Test: Synonyms')
  const synonymTests: Array<[string, string, boolean]> = [
    ['desk', 'table', true],
    ['sofa', 'couch', true],
    ['rock', 'boulder', true],
    ['lamp', 'light', true],
    ['shelf', 'shelving', true],
    ['spaceship', 'spacecraft', true],
    ['spaceship', 'ship', true],
    ['screen', 'monitor', true],
    ['screen', 'display', true],
    ['crate', 'cargo', true],
    ['crate', 'cargo_box', true],
    ['road', 'street', true],
    ['road', 'asphalt', true],
    ['tree', 'vegetation', true],
    ['chair', 'seat', true],
    ['bench', 'seat', true],
    ['desk', 'chair', false],
    ['spaceship', 'tree', false],
    ['rock', 'lamp', false],
  ]
  for (const [a, b, expected] of synonymTests) {
    const actual = areSynonyms(a, b)
    const ok = actual === expected
    console.log(`  ${ok ? '✓' : '✗'} areSynonyms("${a}", "${b}") = ${actual} (expected ${expected})`)
  }
  console.groupEnd()

  // --- Test 4: Empty manifest guarantee ---
  setManifest({ assets: [] })
  let allProcedural = true
  for (const tc of testCases) {
    const spec: SceneObjectSpec = {
      id: `test_${tc.label.replace(/\s+/g, '_')}`,
      semanticType: tc.semanticType,
      tags: tc.tags,
      importance: 'hero',
      primitiveFallback: 'compound',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      zone: 'midground',
      avoidActors: true,
      cameraImportant: true,
    }
    const result = matchAssetSync(spec)
    if (result.assetType !== 'procedural' || result.fallbackPrimitive === null) {
      allProcedural = false
    }
  }
  console.log(`[D3 MATCHER] Empty-manifest guarantee: ${allProcedural ? 'PASS' : 'FAIL'}`)

  // Reset to empty manifest for production use.
  resetManifestCache()
}

// Re-export types for convenience.
export type { AssetMatchResult, AssetManifest, AssetManifestEntry, PrimitiveFallback }
