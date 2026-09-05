/**
 * Asset Registry — PHASE 4A. Unified, validated metadata registry.
 *
 * Pure data / query logic. NO Three.js. NO rendering. NO file probing.
 *
 * Single source of truth for environment-asset metadata. Consolidates the
 * legacy AssetDescriptor (environmentAssetLibrary.ts) and AssetManifestEntry
 * (sceneGraphTypes.ts) shapes into one normalized AssetRegistryEntry.
 *
 * Responsibilities:
 *   - load + normalize the versioned registry (public/assets/manifest.json)
 *   - validate entries (reject malformed, never crash)
 *   - query by id / category / semanticType / tag / kit / source
 *   - semantic resolution helpers (reuse semanticAssetMatcher synonyms)
 *   - legacy adapter for the existing ENVIRONMENT_ASSET_MANIFEST descriptors
 *
 * Empty-registry contract:
 *   With zero real assets, every query returns [] (no match). The caller uses
 *   procedural fallback. No exception. No fake path. No network download.
 *
 * Safety:
 *   An entry is "available" ONLY when its `available` flag is true AND the file
 *   is confirmed present by the loader/report probe. This module never claims
 *   availability on its own — it only reports the declared flag.
 */

import type {
  AssetDescriptor,
  EnvironmentAssetCategory,
  SemanticAssetId,
} from './environmentAssetLibrary'
import type { AssetManifestEntry } from './sceneGraphTypes'
import { getSynonyms } from './semanticAssetMatcher'

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export type AssetFormat = 'glb' | 'gltf'
export type AssetOrientation = 'face_camera' | 'upright' | 'flat' | 'random'
export type AssetAnchor = 'ground' | 'wall' | 'ceiling' | 'surface'
export type AssetInteractionType = 'sit' | 'approach' | 'open' | 'none'
export type AssetCollisionType = 'solid' | 'trigger' | 'none'
export type AssetLOD = 'hero' | 'supporting' | 'dressing'

/**
 * One normalized asset record. Fields intentionally optional except the
 * identity trio (id, path, format) so the same shape works for sparse future
 * entries without inventing metadata.
 */
export interface AssetRegistryEntry {
  /** Canonical id, e.g. "office_chair_01". */
  id: string
  /** Asset origin, e.g. "quaternius", "kenney", "polyhaven", "legacy". */
  source: string
  /** Primary local URL under /public, e.g. "/assets/.../chair.glb". */
  path: string
  format: AssetFormat
  /** Coarse grouping, e.g. "furniture", "architecture", "nature", "prop". */
  category: string
  /** Specific semantic noun, e.g. "chair", "desk", "tree". */
  semanticType: string
  /** Searchable keywords (synonyms, materials, styles). */
  tags: string[]
  /** Environment kits this asset belongs to, e.g. ["modern_office"]. */
  kits: string[]
  /** Target largest-axis size in meters after normalization (legacy alias). */
  targetScale?: number
  /** Approximate [width, height, depth] in meters (manifest alias). */
  scaleHint?: [number, number, number]
  /** Footprint [x, z] in meters for layout occupancy. */
  footprint?: [number, number]
  orientation?: AssetOrientation
  /** Where the asset attaches in the world. */
  anchor?: AssetAnchor
  /** How a character may use it. */
  interactionType?: AssetInteractionType
  /** Collision treatment. */
  collisionType?: AssetCollisionType
  /** Performance/importance band. */
  lodHint?: AssetLOD
  materialTags?: string[]
  environmentTags?: string[]
  /**
   * Declared availability. Even when true, the loader/report probe is the
   * final authority on whether the file actually exists. Defaults to false.
   */
  available: boolean
}

export interface AssetRegistry {
  version: number
  assets: AssetRegistryEntry[]
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let registry: AssetRegistry = { version: 1, assets: [] }
let loadPromise: Promise<AssetRegistry> | null = null

// ---------------------------------------------------------------------------
// Loading + normalization
// ---------------------------------------------------------------------------

export async function loadRegistry(): Promise<AssetRegistry> {
  if (loadPromise) return loadPromise
  loadPromise = (async (): Promise<AssetRegistry> => {
    try {
      const res = await fetch('/assets/manifest.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as unknown
      registry = normalizeRegistry(data)
      return registry
    } catch {
      // Missing/unreadable manifest → safe empty registry (procedural fallback).
      registry = { version: 1, assets: [] }
      return registry
    }
  })()
  return loadPromise
}

/** Replace the in-memory registry (tests / callers that already have data). */
export function setRegistry(data: unknown): void {
  registry = normalizeRegistry(data)
  loadPromise = Promise.resolve(registry)
}

export function getRegistry(): AssetRegistry {
  return registry
}

export function resetRegistry(): void {
  registry = { version: 1, assets: [] }
  loadPromise = null
}

/** Normalize raw manifest JSON, silently dropping malformed entries. */
export function normalizeRegistry(raw: unknown): AssetRegistry {
  const out: AssetRegistry = { version: 1, assets: [] }
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  if (typeof obj.version === 'number') out.version = obj.version
  if (!Array.isArray(obj.assets)) return out
  for (const item of obj.assets) {
    const entry = normalizeEntry(item)
    if (entry) out.assets.push(entry)
  }
  return out
}

/** Normalize one raw entry. Returns null when the entry is unusable. */
export function normalizeEntry(raw: unknown): AssetRegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  const path = typeof o.path === 'string' && o.path.trim() ? o.path.trim() : null
  // Identity trio is mandatory — everything else is optional.
  if (!id || !path) return null

  const format: AssetFormat = o.format === 'gltf' ? 'gltf' : 'glb'
  const category = typeof o.category === 'string' && o.category.trim() ? o.category.trim() : 'uncategorized'
  const semanticType =
    typeof o.semanticType === 'string' && o.semanticType.trim()
      ? o.semanticType.trim()
      : id
  const source = typeof o.source === 'string' && o.source.trim() ? o.source.trim() : 'unknown'

  return {
    id,
    source,
    path,
    format,
    category,
    semanticType,
    tags: stringArray(o.tags),
    kits: stringArray(o.kits),
    targetScale: typeof o.targetScale === 'number' ? o.targetScale : undefined,
    scaleHint: tripleNumber(o.scaleHint),
    footprint: doubleNumber(o.footprint),
    orientation: isOrientation(o.orientation) ? o.orientation : undefined,
    anchor: isAnchor(o.anchor) ? o.anchor : undefined,
    interactionType: isInteraction(o.interactionType) ? o.interactionType : undefined,
    collisionType: isCollision(o.collisionType) ? o.collisionType : undefined,
    lodHint: isLOD(o.lodHint) ? o.lodHint : undefined,
    materialTags: stringArray(o.materialTags),
    environmentTags: stringArray(o.environmentTags),
    available: o.available === true,
  }
}

// ---------------------------------------------------------------------------
// Basic queries
// ---------------------------------------------------------------------------

export function getAll(): AssetRegistryEntry[] {
  return registry.assets
}

export function getById(id: string): AssetRegistryEntry | undefined {
  const lower = id.toLowerCase()
  return registry.assets.find((a) => a.id.toLowerCase() === lower)
}

export function getByCategory(category: string): AssetRegistryEntry[] {
  const lower = category.toLowerCase()
  return registry.assets.filter((a) => a.category.toLowerCase() === lower)
}

export function getBySemanticType(type: string): AssetRegistryEntry[] {
  const lower = type.toLowerCase()
  return registry.assets.filter((a) => a.semanticType.toLowerCase() === lower)
}

export function getByTag(tag: string): AssetRegistryEntry[] {
  const lower = tag.toLowerCase()
  return registry.assets.filter((a) => a.tags.some((t) => t.toLowerCase() === lower))
}

export function getByKit(kit: string): AssetRegistryEntry[] {
  const lower = kit.toLowerCase()
  return registry.assets.filter((a) => a.kits.some((k) => k.toLowerCase() === lower))
}

export function getBySource(source: string): AssetRegistryEntry[] {
  const lower = source.toLowerCase()
  return registry.assets.filter((a) => a.source.toLowerCase() === lower)
}

export function isEmpty(): boolean {
  return registry.assets.length === 0
}

// ---------------------------------------------------------------------------
// Semantic resolution — reuses semanticAssetMatcher synonym knowledge
// ---------------------------------------------------------------------------

/**
 * Resolve a free-text semantic concept to matching registry entries.
 *
 * Uses the synonym groups from semanticAssetMatcher so "office chair" /
 * "desk chair" / "seat" can resolve to a "chair" entry without duplicating
 * the synonym table here. Returns [] (no match) when nothing qualifies —
 * the caller uses procedural fallback.
 *
 * @param semantic   free-text concept, e.g. "office chair"
 * @param options    optional kit / source filters
 */
export function resolveSemantic(
  semantic: string,
  options?: { kit?: string; source?: string }
): AssetRegistryEntry[] {
  const term = semantic.toLowerCase().trim()
  if (!term) return []

  const synonyms = getSynonyms(term)
  const synSet = new Set(synonyms)

  return registry.assets.filter((entry) => {
    if (options?.source && entry.source.toLowerCase() !== options.source.toLowerCase()) return false
    if (options?.kit && !entry.kits.some((k) => k.toLowerCase() === options.kit!.toLowerCase())) return false
    // Match semanticType or any tag against the synonym set.
    if (synSet.has(entry.semanticType.toLowerCase())) return true
    return entry.tags.some((t) => synSet.has(t.toLowerCase()))
  })
}

// ---------------------------------------------------------------------------
// Legacy compatibility adapters
// ---------------------------------------------------------------------------

/**
 * Convert a legacy ENVIRONMENT_ASSET_MANIFEST descriptor into the normalized
 * shape. The resulting entry is always `available: false` because the legacy
 * descriptor's file is not guaranteed to exist (today none do). The loader/
 * report probe remains the authority.
 */
export function entryFromLegacyDescriptor(desc: AssetDescriptor): AssetRegistryEntry {
  const tags: string[] = desc.semantic ? [desc.semantic] : []
  return {
    id: desc.semantic,
    source: 'legacy',
    path: desc.url,
    format: 'glb',
    category: desc.category,
    semanticType: desc.semantic,
    tags,
    kits: [],
    targetScale: desc.targetScale,
    footprint: desc.footprintRadius
      ? [desc.footprintRadius, desc.footprintRadius]
      : undefined,
    orientation: 'upright',
    anchor: 'ground',
    interactionType: 'none',
    collisionType: 'solid',
    available: false,
  }
}

/**
 * Convert an AssetManifestEntry (sceneGraphTypes.ts) into the normalized shape.
 * Returns null when the entry lacks the mandatory id/path. Always
 * `available: false` — the probe decides.
 */
export function entryFromManifestEntry(entry: AssetManifestEntry): AssetRegistryEntry | null {
  if (!entry.id || !entry.path) return null
  const format: AssetFormat = entry.type === 'gltf' ? 'gltf' : 'glb'
  return {
    id: entry.id,
    source: 'manifest',
    path: entry.path,
    format,
    category: 'uncategorized',
    semanticType: entry.id,
    tags: [...entry.tags],
    kits: [],
    scaleHint: entry.scaleHint,
    footprint: entry.footprint,
    orientation: entry.orientation,
    materialTags: entry.materialTags,
    environmentTags: entry.environmentTags,
    available: false,
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function tripleNumber(v: unknown): [number, number, number] | undefined {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
    ? [v[0], v[1], v[2]]
    : undefined
}

function doubleNumber(v: unknown): [number, number] | undefined {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')
    ? [v[0], v[1]]
    : undefined
}

function isOrientation(v: unknown): v is AssetOrientation {
  return v === 'face_camera' || v === 'upright' || v === 'flat' || v === 'random'
}
function isAnchor(v: unknown): v is AssetAnchor {
  return v === 'ground' || v === 'wall' || v === 'ceiling' || v === 'surface'
}
function isInteraction(v: unknown): v is AssetInteractionType {
  return v === 'sit' || v === 'approach' || v === 'open' || v === 'none'
}
function isCollision(v: unknown): v is AssetCollisionType {
  return v === 'solid' || v === 'trigger' || v === 'none'
}
function isLOD(v: unknown): v is AssetLOD {
  return v === 'hero' || v === 'supporting' || v === 'dressing'
}

// Re-export for consumers that only know the legacy id type.
export type { EnvironmentAssetCategory, SemanticAssetId }