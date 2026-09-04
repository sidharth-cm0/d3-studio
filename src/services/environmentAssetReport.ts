/**
 * Environment Asset Report — MISSING-ASSET CHECKLIST.
 *
 * Generates the exact list of manifest asset files that are missing from
 * public/assets/environments/<category>/. Intended for the Download Report
 * view and the ENVIRONMENT_ASSETS.md doc — never invents filenames outside
 * the manifest.
 *
 * .glb is the preferred format; .gltf with the same base name is the
 * acceptable fallback (an asset counts as PRESENT if either exists).
 *
 * Also provides registry-aware reporting (REGISTERED / AVAILABLE / MISSING)
 * backed by the unified assetRegistry.
 */

import { ENVIRONMENT_ASSET_MANIFEST, ALL_ASSET_DESCRIPTORS } from './environmentAssetLibrary'
import type { EnvironmentAssetCategory } from './environmentAssetLibrary'
import { getRegistry } from './assetRegistry'
import type { AssetRegistryEntry } from './assetRegistry'

export type AssetFileStatus = 'present' | 'missing'

export interface AssetFileEntry {
  /** Category folder name, e.g. "warehouse". */
  category: EnvironmentAssetCategory
  /** Semantic asset name, e.g. "crate". */
  semantic: string
  /** Canonical .glb URL per the manifest. */
  glbUrl: string
  /** Fallback .gltf URL (same base name). */
  gltfUrl: string
  /** Whether the .glb or .gltf currently exists. */
  status: AssetFileStatus
  /** Human-readable purpose (manifest truth). */
  purpose: string
}

/**
 * Produce the full manifest report. Never throws; any probe failure is
 * recorded as "missing" so the checklist stays safe.
 */
export async function createAssetReport(): Promise<AssetFileEntry[]> {
  const entries = await Promise.all(
    ALL_ASSET_DESCRIPTORS.map(async (d) => {
      const status: AssetFileStatus =
        (await probeFile(d.url)) || (await probeFile(d.gltfUrl)) ? 'present' : 'missing'
      return {
        category: d.category,
        semantic: d.semantic,
        glbUrl: d.url,
        gltfUrl: d.gltfUrl,
        status,
        purpose: d.purpose,
      } satisfies AssetFileEntry
    })
  )
  return entries
}

/**
 * Convenience: just the missing entries, grouped by category in manifest
 * order — exactly the checklist a user can copy-paste into their download
 * tracker.
 */
export async function listMissingAssets(): Promise<AssetFileEntry[]> {
  const report = await createAssetReport()
  return report.filter((e) => e.status === 'missing')
}

/** Human-readable checklist: "MISSING ASSETS:\n\nWAREHOUSE:\n[ ] public/..." */
export async function formatAssetChecklist(): Promise<string> {
  const missing = await listMissingAssets()
  if (missing.length === 0) return 'MISSING ASSETS:\n(none — all manifest assets present)'

  const lines: string[] = ['MISSING ASSETS:']
  const byCategory = new Map<EnvironmentAssetCategory, AssetFileEntry[]>()
  for (const entry of missing) {
    const arr = byCategory.get(entry.category)
    if (arr) arr.push(entry)
    else byCategory.set(entry.category, [entry])
  }

  for (const category of Object.keys(ENVIRONMENT_ASSET_MANIFEST) as EnvironmentAssetCategory[]) {
    const entries = byCategory.get(category)
    if (!entries) continue
    lines.push('', category.toUpperCase() + ':')
    for (const entry of missing) {
      lines.push(`[ ] public${entry.glbUrl}`)
    }
  }
  return lines.join('\n')
}

/**
 * Human "what is each file used for" section for ENVIRONMENT_ASSETS.md.
 */
export function formatAssetReadmeDescriptions(): string {
  const lines: string[] = []
  for (const category of Object.keys(ENVIRONMENT_ASSET_MANIFEST) as EnvironmentAssetCategory[]) {
    lines.push('', `${category.toUpperCase()}:`)
    for (const d of ENVIRONMENT_ASSET_MANIFEST[category]) {
      lines.push(`  ${d.semantic.padEnd(14)} — ${d.purpose}`)
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Registry-aware report — distinguishes REGISTERED / AVAILABLE / MISSING
// ---------------------------------------------------------------------------

/**
 * Three-state status for a registry entry:
 *   - available : entry exists AND the file is confirmed present by probe
 *   - missing   : entry exists but the file probe failed (procedural fallback)
 *
 * An entry is "available" ONLY when the file probe confirms it — never merely
 * because the registry entry exists or declares itself available.
 */
export type RegistryFileStatus = 'available' | 'missing'

export interface RegistryFileEntry {
  id: string
  category: string
  semanticType: string
  path: string
  format: string
  kits: string[]
  declaredAvailable: boolean
  status: RegistryFileStatus
}

/**
 * Produce a registry-aware report from the live asset registry. Safe, never
 * throws. With an empty registry this returns [].
 */
export async function createRegistryReport(): Promise<RegistryFileEntry[]> {
  const registry = getRegistry()
  return Promise.all(
    registry.assets.map(async (entry: AssetRegistryEntry) => {
      const status: RegistryFileStatus = (await probeFile(entry.path)) ? 'available' : 'missing'
      return {
        id: entry.id,
        category: entry.category,
        semanticType: entry.semanticType,
        path: entry.path,
        format: entry.format,
        kits: [...entry.kits],
        declaredAvailable: entry.available,
        status,
      }
    })
  )
}

/** Registry entries whose file probe failed — the procedural-fallback set. */
export async function listRegistryMissing(): Promise<RegistryFileEntry[]> {
  const report = await createRegistryReport()
  return report.filter((e) => e.status === 'missing')
}

/** Human-readable registry status, grouped by category. */
export async function formatRegistryReport(): Promise<string> {
  const report = await createRegistryReport()
  if (report.length === 0) {
    return 'REGISTRY REPORT:\n(no assets registered — all environments use procedural fallback)'
  }
  const lines: string[] = ['REGISTRY REPORT:']
  const byCategory = new Map<string, RegistryFileEntry[]>()
  for (const entry of report) {
    const arr = byCategory.get(entry.category)
    if (arr) arr.push(entry)
    else byCategory.set(entry.category, [entry])
  }
  for (const [category, entries] of byCategory) {
    lines.push('', `${category.toUpperCase()}:`)
    for (const e of entries) {
      const mark = e.status === 'available' ? '[x]' : '[ ]'
      lines.push(`  ${mark} ${e.id} (${e.semanticType}) — ${e.path}`)
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Existence probe (same Vite index.html guard as the loader)
// ---------------------------------------------------------------------------

const probeCache = new Map<string, Promise<boolean>>()

function probeFile(url: string): Promise<boolean> {
  const cached = probeCache.get(url)
  if (cached) return cached
  const probe = fetch(url, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) return false
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('text/html')) return false
      return true
    })
    .catch(() => false)
  probeCache.set(url, probe)
  return probe
}