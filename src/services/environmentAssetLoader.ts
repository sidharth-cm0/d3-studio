/**
 * Environment Asset Loader — reusable GLTF/GLB loader for environment props.
 *
 * Responsibilities:
 *   - Load a source GLTF/GLB ONCE per URL and cache the parsed scene.
 *     Subsequent requests clone the cached scene via SkeletonUtils.clone —
 *     they never re-fetch or re-parse (cache is process-wide, so scene
 *     switches reuse the same parse).
 *   - Prefer .glb (per ENVIRONMENT_ASSETS.md); falls back to .gltf (same base
 *     filename) automatically when the .glb is missing.
 *   - Normalize scale: each clone is resized so its largest axis matches the
 *     manifest `targetScale` (meters) before it is handed to the composer.
 *   - Handle failures SAFELY: missing files are logged as
 *     "Missing environment asset: <category>/<semantic>.glb" and the caller
 *     receives `null`, which the procedural builder treats as "use the
 *     existing procedural primitive fallback".
 *   - Vite probe: Vite serves index.html (text/html) for missing files under
 *     /, so we HEAD-probe a URL before parsing it as GLTF/GLB.
 *
 * The builder in environmentStage.ts consumes this module — App.tsx NEVER
 * touches it directly (no hard-coded URLs in App).
 */

import * as THREE from 'three'
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SkeletonUtils } from 'three-stdlib'
import { getAssetDescriptor } from './environmentAssetLibrary'
import type { EnvironmentAssetCategory, SemanticAssetId } from './environmentAssetLibrary'

// ---------------------------------------------------------------------------
// Process-wide source caches — no repeat downloads per URL, ever
// ---------------------------------------------------------------------------

/** Source scene cache: raw GLTF scene, parsed once, cloned for every instance. */
const SOURCE_CACHE = new Map<string, Promise<THREE.Group | null>>()

/** URL existence probes (Vite index.html fallback guard). */
const PROBE_CACHE = new Map<string, Promise<boolean>>()

// THREE.FileLoader cache is enabled in App.tsx; keep it on here too so the
// same URL can never be downloaded twice even if our Map were bypassed.
THREE.Cache.enabled = true

const loader = new GLTFLoader()

// ---------------------------------------------------------------------------
// Vite-aware existence probe
// ---------------------------------------------------------------------------

function probeLocalUrl(url: string): Promise<boolean> {
  const cached = PROBE_CACHE.get(url)
  if (cached) return cached
  const probe = fetch(url, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) return false
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      // Vite returns index.html (text/html) for missing public/ files.
      if (ct.includes('text/html')) return false
      return true
    })
    .catch(() => false)
  PROBE_CACHE.set(url, probe)
  return probe
}

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (error) => reject(error)
    )
  })
}

// ---------------------------------------------------------------------------
// Source loading — GLB first, GLTF fallback, safe failure
// ---------------------------------------------------------------------------

/**
 * Resolve + cache the SOURCE scene for a semantic asset.
 * Returns a Group (or null when the asset is missing / fails to load).
 * Never throws.
 */
function loadSource(
  category: EnvironmentAssetCategory,
  semantic: SemanticAssetId
): Promise<THREE.Group | null> {
  const key = `${category}/${semantic}`
  const cached = SOURCE_CACHE.get(key)
  if (cached) return cached

  const descriptor = getAssetDescriptor(category, semantic)
  const entry: Promise<THREE.Group | null> = (async (): Promise<THREE.Group | null> => {
    if (!descriptor) {
      console.warn(`Missing environment asset: ${category}/${semantic}`)
      return null
    }

    // Prefer .glb; .gltf (same base name) is the acceptable fallback.
    const glbExists = await probeLocalUrl(descriptor.url)
    const gltfExists = !glbExists ? await probeLocalUrl(descriptor.gltfUrl) : false
    const url = glbExists ? descriptor.url : gltfExists ? descriptor.gltfUrl : null

    if (!url) {
      console.warn(
        `Missing environment asset: ${descriptor.url.replace('/assets/environments/', '')}`
      )
      return null
    }

    try {
      const gltf = await loadGltf(url)
      if (gltf.scene) return gltf.scene
      console.warn(`Missing environment asset: ${url} (no scene in GLTF)`)
      return null
    } catch (err) {
      console.warn(`Missing environment asset: ${url}`, err)
      return null
    }
  })()

  SOURCE_CACHE.set(key, entry)
  return entry
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AssetInstanceRequest {
  category: EnvironmentAssetCategory
  semantic: SemanticAssetId
  /** Optional display name for the instance (debugging). */
  name?: string
}

/**
 * Load (cache) + clone + normalize ONE instanced asset.
 *
 * Returns a THREE.Group-sized Object3D or null when the asset is missing.
 * The caller owns the returned object and disposes it when the environment
 * is replaced (see disposeObjectDeep in environmentStage.ts).
 */
export async function instanciateAsset(
  request: AssetInstanceRequest
): Promise<THREE.Object3D | null> {
  const source = await loadSource(request.category, request.semantic)
  if (!source) return null

  const clone = SkeletonUtils.clone(source)
  clone.name = request.name || `asset:${request.semantic}`
  const descriptor = getAssetDescriptor(request.category, request.semantic)
  if (descriptor) {
    const size = boundingSize(source)
    if (size > 1e-4) {
      const s = descriptor.targetScale / size
      clone.scale.set(s, s, s)
    }
  }
  return clone
}

/**
 * Load (cache) + clone + normalize `count` instances of one asset.
 * Returns an array with null entries for any failures (never throws).
 */
export async function instanciateAssets(
  request: AssetInstanceRequest,
  count: number
): Promise<Array<THREE.Object3D | null>> {
  const source = await loadSource(request.category, request.semantic)
  if (!source) return Array(count).fill(null)

  const descriptor = getAssetDescriptor(request.category, request.semantic)
  const size = boundingSize(source)
  const scale = descriptor && size > 1e-4 ? descriptor.targetScale / size : null

  return Array.from({ length: count }, () => {
    const clone = SkeletonUtils.clone(source)
    clone.name = `asset:${request.semantic}`
    if (scale !== null) clone.scale.set(scale, scale, scale)
    return clone
  })
}

/** Largest-axis world size of an object subtree. */
function boundingSize(root: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  return Math.max(size.x, size.y, size.z)
}

/** Module-level convenience handle. */
export const environmentAssetLoader = {
  instanciateAsset,
  instanciateAssets,
  clearCache: () => {
    SOURCE_CACHE.clear()
    PROBE_CACHE.clear()
  },
}