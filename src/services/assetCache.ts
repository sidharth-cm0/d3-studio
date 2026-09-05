/**
 * Asset Cache — PHASE 4B. Environment asset cache + resource management.
 *
 * Sits ABOVE environmentAssetLoader (does not replace it). The loader owns
 * the parsed-GLTF source cache; this module owns the *asset-level* metadata,
 * per-scene placement tracking, budgets, and safe instance lifecycle.
 *
 * RESOURCE OWNERSHIP CONTRACT
 * ==========================
 *   SOURCE GLTF     — parsed scene owned by environmentAssetLoader.SOURCE_CACHE.
 *                     Survives scene switches. Never disposed here.
 *   SHARED GEOMETRY — SkeletonUtils.clone() shares geometry references with
 *                     the source (Mesh.copy assigns this.geometry = source.geometry).
 *                     Owned by the source cache. Never disposed here.
 *   SHARED MATERIAL — same sharing as geometry. Owned by source cache.
 *   SHARED TEXTURE  — textures live inside materials + THREE.Cache. Shared.
 *   SKELETON        — cloned per skinned mesh by SkeletonUtils. Owned by clone.
 *   OBJECT3D TREE   — cloned (new Object3D/Mesh instances). Owned by placed
 *                     instance. Detached (not disposed) on release.
 *
 *   => Releasing a placed instance detaches the Object3D hierarchy only.
 *     Shared GPU resources (geometry/material/texture) are NOT disposed —
 *     they are owned by the source cache and freed when IT clears.
 *
 * This module is NOT wired into the live renderer yet (Phase 4B is offline).
 *
 * FAILURE CONTRACT: every failure returns a safe "no real asset" result.
 * Caller uses procedural fallback. No uncaught exceptions.
 */

import * as THREE from 'three'
import { environmentAssetLoader } from './environmentAssetLoader'
import type { AssetRegistryEntry } from './assetRegistry'
import type { EnvironmentAssetCategory, SemanticAssetId } from './environmentAssetLibrary'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetLoadState = 'pending' | 'loaded' | 'failed'

/** Cached metadata for one known asset (source lives in the loader). */
export interface AssetCacheEntry {
  assetId: string
  source: string
  path: string
  format: string
  loadState: AssetLoadState
  /** True when the asset structure is simple/static enough for instancing. */
  instancingEligible: boolean
  /** Number of placed instances referencing this asset (for diagnostics). */
  refCount: number
}

/** One placed instance of an asset in a scene. */
export interface PlacedInstance {
  instanceId: string
  assetId: string
  sceneId: string
  object: THREE.Object3D
  meshCount: number
  materialCount: number
}

/** Per-scene placement inventory. */
export interface SceneInventory {
  sceneId: string
  instances: Map<string, PlacedInstance>
}

/** Conservative defaults for an older Intel Mac. */
export interface CacheBudget {
  maxPlacedAssets: number
  maxUniqueAssets: number
  maxMeshes: number
  maxMaterials: number
}

export interface CacheStats {
  placedCount: number
  uniqueLoaded: number
  uniquePending: number
  uniqueFailed: number
  estimatedMeshes: number
  estimatedMaterials: number
  sourceCacheSize: number
  sceneCount: number
}

/** Result of a placement attempt. */
export interface PlaceResult {
  success: boolean
  instance: PlacedInstance | null
  reason?: 'ok' | 'unavailable' | 'budget_exceeded' | 'load_failed' | 'malformed'
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const assetMetadata = new Map<string, AssetCacheEntry>()
const sceneInventories = new Map<string, SceneInventory>()
let instanceCounter = 0

const DEFAULT_BUDGET: CacheBudget = {
  maxPlacedAssets: 64,
  maxUniqueAssets: 24,
  maxMeshes: 200,
  maxMaterials: 80,
}

let budget: CacheBudget = { ...DEFAULT_BUDGET }

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function setBudget(partial: Partial<CacheBudget>): void {
  budget = { ...budget, ...partial }
}

export function getBudget(): CacheBudget {
  return { ...budget }
}

export function resetBudget(): void {
  budget = { ...DEFAULT_BUDGET }
}

// ---------------------------------------------------------------------------
// Source asset requests (delegates to existing loader)
// ---------------------------------------------------------------------------

/**
 * Request an asset's source through the existing loader. Caches metadata.
 * Returns the parsed source object, or null when unavailable (safe: no throw).
 */
export async function getAsset(entry: AssetRegistryEntry): Promise<THREE.Object3D | null> {
  const existing = assetMetadata.get(entry.id)

  // Record/update metadata.
  const meta: AssetCacheEntry = existing ?? {
    assetId: entry.id,
    source: entry.source,
    path: entry.path,
    format: entry.format,
    loadState: 'pending',
    instancingEligible: false,
    refCount: 0,
  }
  meta.loadState = 'pending'
  assetMetadata.set(entry.id, meta)

  try {
    // Delegate to the existing loader (GLB/GLTF fallback, HEAD probe, SOURCE_CACHE).
    // Cast registry strings to the loader's literal union types.
    const scene = await environmentAssetLoader.instanciateAsset({
      category: entry.category as EnvironmentAssetCategory,
      semantic: entry.semanticType as SemanticAssetId,
      name: entry.id,
    })

    if (!scene) {
      meta.loadState = 'failed'
      return null
    }

    meta.loadState = 'loaded'
    meta.instancingEligible = isInstancingEligible(scene)
    return scene
  } catch {
    meta.loadState = 'failed'
    return null
  }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Place one instance of an asset into a scene. Enforces budgets.
 * Returns a safe result (never throws). On failure, instance is null and the
 * caller uses procedural fallback.
 */
export async function placeAsset(
  entry: AssetRegistryEntry,
  sceneId: string
): Promise<PlaceResult> {
  // Ensure source is loaded.
  const source = await getAsset(entry)
  if (!source) {
    return { success: false, instance: null, reason: 'unavailable' }
  }

  // Budget check BEFORE creating the clone.
  const current = computeStats()
  if (current.placedCount >= budget.maxPlacedAssets) {
    return { success: false, instance: null, reason: 'budget_exceeded' }
  }

  try {
    // Clone via the loader's proven path (re-request = SOURCE_CACHE hit).
    const object = await environmentAssetLoader.instanciateAsset({
      category: entry.category as EnvironmentAssetCategory,
      semantic: entry.semanticType as SemanticAssetId,
      name: entry.id,
    })
    if (!object) {
      return { success: false, instance: null, reason: 'load_failed' }
    }

    const meshCount = countMeshes(object)
    const materialCount = countMaterials(object)

    // Post-clone mesh budget check.
    if (current.estimatedMeshes + meshCount > budget.maxMeshes) {
      // Budget exceeded. The clone shares geometry/material with the source,
      // so we must NOT dispose them. Just let the unparented clone be GC'd.
      return { success: false, instance: null, reason: 'budget_exceeded' }
    }

    const instanceId = `inst_${++instanceCounter}`
    const instance: PlacedInstance = {
      instanceId,
      assetId: entry.id,
      sceneId,
      object,
      meshCount,
      materialCount,
    }

    // Track in scene inventory.
    let inv = sceneInventories.get(sceneId)
    if (!inv) {
      inv = { sceneId, instances: new Map() }
      sceneInventories.set(sceneId, inv)
    }
    inv.instances.set(instanceId, instance)

    // Update refcount.
    const meta = assetMetadata.get(entry.id)
    if (meta) meta.refCount++

    return { success: true, instance, reason: 'ok' }
  } catch {
    return { success: false, instance: null, reason: 'malformed' }
  }
}

// ---------------------------------------------------------------------------
// Release / disposal
// ---------------------------------------------------------------------------
//
// SAFETY: SkeletonUtils.clone() shares geometry/material/texture references
// with the source (Mesh.copy assigns this.geometry = source.geometry).
// Disposing them would corrupt SOURCE_CACHE and other clones.
// We only detach the Object3D hierarchy; shared GPU resources stay alive
// until the source cache clears.

/**
 * Detach an Object3D from its parent without disposing shared
 * geometry/material/texture. Only removes the lightweight scene-graph node.
 */
function detachObject(object: THREE.Object3D): void {
  if (object.parent) {
    object.parent.remove(object)
  }
}

/** Release one placed instance. Safe to call twice. Source cache preserved. */
export function releaseInstance(instanceId: string): boolean {
  for (const inv of sceneInventories.values()) {
    const inst = inv.instances.get(instanceId)
    if (!inst) continue
    detachObject(inst.object)
    inv.instances.delete(instanceId)
    const meta = assetMetadata.get(inst.assetId)
    if (meta) meta.refCount = Math.max(0, meta.refCount - 1)
    return true
  }
  return false
}

/** Release all instances for a scene. Source cache preserved. */
export function releaseSceneInstances(sceneId: string): number {
  const inv = sceneInventories.get(sceneId)
  if (!inv) return 0
  let count = 0
  for (const inst of inv.instances.values()) {
    detachObject(inst.object)
    const meta = assetMetadata.get(inst.assetId)
    if (meta) meta.refCount = Math.max(0, meta.refCount - 1)
    count++
  }
  inv.instances.clear()
  sceneInventories.delete(sceneId)
  return count
}

// ---------------------------------------------------------------------------
// Instancing eligibility (API only -- no conversion yet)
// ---------------------------------------------------------------------------

/**
 * Whether an asset's scene structure is simple enough for InstancedMesh.
 * Requires: a single mesh, no complex hierarchy, a single material.
 * Returns false for unknown/complex assets. Reliability > optimization.
 */
export function isInstancingEligible(scene: THREE.Object3D): boolean {
  let meshCount = 0
  let hasComplexHierarchy = false
  scene.traverse((child) => {
    if ((child as unknown as { isMesh?: boolean }).isMesh) {
      meshCount++
    }
    if (child.children.length > 1) hasComplexHierarchy = true
  })
  if (meshCount !== 1) return false
  if (hasComplexHierarchy) return false
  const firstMesh = findFirstMesh(scene)
  if (!firstMesh) return false
  const mat = firstMesh.material
  if (Array.isArray(mat) && mat.length > 1) return false
  return true
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export function getAssetCacheStats(): CacheStats {
  return computeStats()
}

function computeStats(): CacheStats {
  let placedCount = 0
  let estimatedMeshes = 0
  for (const inv of sceneInventories.values()) {
    for (const inst of inv.instances.values()) {
      placedCount++
      estimatedMeshes += inst.meshCount
    }
  }
  let uniqueLoaded = 0
  let uniquePending = 0
  let uniqueFailed = 0
  for (const meta of assetMetadata.values()) {
    if (meta.loadState === 'loaded') uniqueLoaded++
    else if (meta.loadState === 'pending') uniquePending++
    else if (meta.loadState === 'failed') uniqueFailed++
  }
  return {
    placedCount,
    uniqueLoaded,
    uniquePending,
    uniqueFailed,
    estimatedMeshes,
    estimatedMaterials: 0,
    sourceCacheSize: assetMetadata.size,
    sceneCount: sceneInventories.size,
  }
}

/** Reset per-scene tracking (does not touch source cache). */
export function resetSceneInventory(sceneId: string): void {
  releaseSceneInstances(sceneId)
}

/** Full reset: release all scenes + metadata. Source cache in loader survives. */
export function resetCache(): void {
  for (const sceneId of Array.from(sceneInventories.keys())) {
    releaseSceneInstances(sceneId)
  }
  assetMetadata.clear()
  instanceCounter = 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countMeshes(root: THREE.Object3D): number {
  let n = 0
  root.traverse((child) => {
    if ((child as unknown as { isMesh?: boolean }).isMesh) n++
  })
  return n
}

function countMaterials(root: THREE.Object3D): number {
  const seen = new Set<THREE.Material>()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((m) => seen.add(m))
    else if (mat) seen.add(mat)
  })
  return seen.size
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((child) => {
    if (!found && (child as unknown as { isMesh?: boolean }).isMesh) {
      found = child as THREE.Mesh
    }
  })
  return found
}