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
 */

import { ENVIRONMENT_ASSET_MANIFEST, ALL_ASSET_DESCRIPTORS } from './environmentAssetLibrary'
import type { EnvironmentAssetCategory } from './environmentAssetLibrary'

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
    for (const entry of entries) {
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
