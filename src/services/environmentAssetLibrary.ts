/**
 * Environment Asset Library — SEMANTIC MANIFEST.
 *
 * Pure data: maps a semantic asset name → local URL under /assets/environments/...
 *
 * The EnvironmentAssetLoader (environmentAssetLoader.ts) uses this manifest to:
 *   - prefer .glb whenever it exists
 *   - accept .gltf as a fallback (same base filename, different extension)
 *   - report missing assets instead of crashing
 * The environmentStage procedural builder requests assets by SEMANTIC NAME only,
 * never by hard-coded URL — App.tsx does NOT know about these mappings.
 *
 * FOLDER CONVENTION (do not rename files — what the manifest says is canonical):
 *
 *   public/assets/environments/<category>/<semantic>.glb   (preferred)
 *   public/assets/environments/<category>/<semantic>.gltf (acceptable)
 *
 * LOW-POLY CC0 assets recommended — see ENVIRONMENT_ASSETS.md.
 */

import type { EnvironmentLocationKind, PropType } from './environmentResolver'

// ---------------------------------------------------------------------------
// Category + semantic names (the only filenames you should download)
// ---------------------------------------------------------------------------

export type EnvironmentAssetCategory =
  | 'warehouse'
  | 'railway'
  | 'apartment'
  | 'forest'
  | 'studio'
  | 'city'
  | 'living_room'

export type SemanticAssetId =
  // warehouse
  | 'crate'
  | 'barrel'
  | 'shelf'
  | 'pallet'
  | 'pillar'
  // railway
  | 'bench'
  | 'platform'
  | 'rail'
  | 'lamp'
  | 'station_sign'
  // apartment
  | 'sofa'
  | 'table'
  | 'chair'
  | 'cabinet'
  | 'shelf'
  // forest
  | 'tree_01'
  | 'tree_02'
  | 'rock'
  | 'bush'
  // studio
  | 'desk'
  | 'screen'
  | 'panel'
  | 'light_stand'
  // city
  | 'building'
  | 'sidewalk'
  | 'lamp'
  | 'bench'
  // living_room
  | 'plant'

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

export interface AssetDescriptor {
  /** Semantic id used by the environment builder (never a URL). */
  semantic: SemanticAssetId
  /** Category folder under public/assets/environments. */
  category: EnvironmentAssetCategory
  /** Preferred local URL — .glb (Vite-served from /public). */
  url: string
  /** Fallback URL of the same asset as .gltf (same base filename). */
  gltfUrl: string
  /** Human-readable purpose — what the composer uses it for. */
  purpose: string
  /** Target largest-axis size in meters after normalization. */
  targetScale: number
  /** Approximate footprint radius (meters) for seeded layout occupancy. */
  footprintRadius: number
}

// ---------------------------------------------------------------------------
// MANIFEST — the canonical set of asset files to download
// ---------------------------------------------------------------------------

export const ENVIRONMENT_ASSET_MANIFEST: Readonly<
  Record<EnvironmentAssetCategory, readonly AssetDescriptor[]>
> = {
  warehouse: [
    {
      semantic: 'crate',
      category: 'warehouse',
      url: '/assets/environments/warehouse/crate.glb',
      gltfUrl: '/assets/environments/warehouse/crate.gltf',
      purpose: 'Stacked shipping/storage crates along aisles, frame edges and back walls.',
      targetScale: 0.8,
      footprintRadius: 0.6,
    },
    {
      semantic: 'barrel',
      category: 'warehouse',
      url: '/assets/environments/warehouse/barrel.glb',
      gltfUrl: '/assets/environments/warehouse/barrel.gltf',
      purpose: 'Industrial barrels near the frame edges.',
      targetScale: 0.9,
      footprintRadius: 0.45,
    },
    {
      semantic: 'shelf',
      category: 'warehouse',
      url: '/assets/environments/warehouse/shelf.glb',
      gltfUrl: '/assets/environments/warehouse/shelf.gltf',
      purpose: 'Heavy metal rack / shelf unit against the warehouse side walls.',
      targetScale: 2.0,
      footprintRadius: 0.95,
    },
    {
      semantic: 'pallet',
      category: 'warehouse',
      url: '/assets/environments/warehouse/pallet.glb',
      gltfUrl: '/assets/environments/warehouse/pallet.gltf',
      purpose: 'Wooden shipping pallet — flat floor props near storage aisles.',
      targetScale: 1.2,
      footprintRadius: 1.0,
    },
    {
      semantic: 'pillar',
      category: 'warehouse',
      url: '/assets/environments/warehouse/pillar.glb',
      gltfUrl: '/assets/environments/warehouse/pillar.gltf',
      purpose: 'Structural support/concrete pillar (hero silhouette row).',
      targetScale: 4.6,
      footprintRadius: 0.5,
    },
  ],
  railway: [
    {
      semantic: 'bench',
      category: 'railway',
      url: '/assets/environments/railway/bench.glb',
      gltfUrl: '/assets/environments/railway/bench.gltf',
      purpose: 'Platform bench — placed on the platform edge, facing the tracks.',
      targetScale: 1.7,
      footprintRadius: 0.9,
    },
    {
      semantic: 'platform',
      category: 'railway',
      url: '/assets/environments/railway/platform.glb',
      gltfUrl: '/assets/environments/railway/platform.gltf',
      purpose: 'Station platform slab (walkable surface mid-scene).',
      targetScale: 7.0,
      footprintRadius: 4.5,
    },
    {
      semantic: 'rail',
      category: 'railway',
      url: '/assets/environments/railway/rail.glb',
      gltfUrl: '/assets/environments/railway/rail.gltf',
      purpose: 'Metal rail track segment (pair) running along Z.',
      targetScale: 6.0,
      footprintRadius: 1.4,
    },
    {
      semantic: 'lamp',
      category: 'railway',
      url: '/assets/environments/railway/lamp.glb',
      gltfUrl: '/assets/environments/railway/lamp.gltf',
      purpose: 'Overhead platform light fixture.',
      targetScale: 0.6,
      footprintRadius: 0.5,
    },
    {
      semantic: 'station_sign',
      category: 'railway',
      url: '/assets/environments/railway/station_sign.glb',
      gltfUrl: '/assets/environments/railway/station_sign.gltf',
      purpose: 'Station name sign above the platform.',
      targetScale: 4.0,
      footprintRadius: 2.2,
    },
  ],
  apartment: [
    {
      semantic: 'sofa',
      category: 'apartment',
      url: '/assets/environments/apartment/sofa.glb',
      gltfUrl: '/assets/environments/apartment/sofa.gltf',
      purpose: 'Living-room sofa (visible midground, clear of the actor area).',
      targetScale: 2.1,
      footprintRadius: 1.2,
    },
    {
      semantic: 'table',
      category: 'apartment',
      url: '/assets/environments/apartment/table.glb',
      gltfUrl: '/assets/environments/apartment/table.gltf',
      purpose: 'Coffee/side table — small furniture prop.',
      targetScale: 1.15,
      footprintRadius: 0.7,
    },
    {
      semantic: 'chair',
      category: 'apartment',
      url: '/assets/environments/apartment/chair.glb',
      gltfUrl: '/assets/environments/apartment/chair.gltf',
      purpose: 'Living-room chair — visible midground.',
      targetScale: 0.9,
      footprintRadius: 0.55,
    },
    {
      semantic: 'cabinet',
      category: 'apartment',
      url: '/assets/environments/apartment/cabinet.glb',
      gltfUrl: '/assets/environments/apartment/cabinet.gltf',
      purpose: 'Storage cabinet — placed against the back wall.',
      targetScale: 1.6,
      footprintRadius: 0.7,
    },
    {
      semantic: 'shelf',
      category: 'apartment',
      url: '/assets/environments/apartment/shelf.glb',
      gltfUrl: '/assets/environments/apartment/shelf.gltf',
      purpose: 'Wall shelf unit — back wall, left of the doorway.',
      targetScale: 1.6,
      footprintRadius: 0.8,
    },
  ],
  forest: [
    {
      semantic: 'tree_01',
      category: 'forest',
      url: '/assets/environments/forest/tree_01.glb',
      gltfUrl: '/assets/environments/forest/tree_01.gltf',
      purpose: 'Tall forest tree (variant A) — frame edges, midground, deep rows.',
      targetScale: 3.6,
      footprintRadius: 1.3,
    },
    {
      semantic: 'tree_02',
      category: 'forest',
      url: '/assets/environments/forest/tree_02.glb',
      gltfUrl: '/assets/environments/forest/tree_02.gltf',
      purpose: 'Tall forest tree (variant B) — alternates with tree_01.',
      targetScale: 3.4,
      footprintRadius: 1.25,
    },
    {
      semantic: 'rock',
      category: 'forest',
      url: '/assets/environments/forest/rock.glb',
      gltfUrl: '/assets/environments/forest/rock.gltf',
      purpose: 'Scattered mossy rock — foreground and midground detail.',
      targetScale: 0.7,
      footprintRadius: 0.45,
    },
    {
      semantic: 'bush',
      category: 'forest',
      url: '/assets/environments/forest/bush.glb',
      gltfUrl: '/assets/environments/forest/bush.gltf',
      purpose: 'Low undergrowth bush along the foreground frame edge.',
      targetScale: 0.55,
      footprintRadius: 0.35,
    },
  ],
  studio: [
    {
      semantic: 'desk',
      category: 'studio',
      url: '/assets/environments/studio/desk.glb',
      gltfUrl: '/assets/environments/studio/desk.gltf',
      purpose: 'Presenters/news desk behind the actor area.',
      targetScale: 3.4,
      footprintRadius: 2.0,
    },
    {
      semantic: 'screen',
      category: 'studio',
      url: '/assets/environments/studio/screen.glb',
      gltfUrl: '/assets/environments/studio/screen.gltf',
      purpose: 'Large studio display wall / backdrop screen.',
      targetScale: 10.0,
      footprintRadius: 5.0,
    },
    {
      semantic: 'panel',
      category: 'studio',
      url: '/assets/environments/studio/panel.glb',
      gltfUrl: '/assets/environments/studio/panel.gltf',
      purpose: 'Flanking studio panel (lit-edge paneling).',
      targetScale: 3.0,
      footprintRadius: 0.6,
    },
    {
      semantic: 'light_stand',
      category: 'studio',
      url: '/assets/environments/studio/light_stand.glb',
      gltfUrl: '/assets/environments/studio/light_stand.gltf',
      purpose: 'Studio softbox / light stand accent.',
      targetScale: 2.2,
      footprintRadius: 0.6,
    },
  ],
  city: [
    {
      semantic: 'building',
      category: 'city',
      url: '/assets/environments/city/building.glb',
      gltfUrl: '/assets/environments/city/building.gltf',
      purpose: 'City building — street canyon walls (both sides).',
      targetScale: 9.0,
      footprintRadius: 1.9,
    },
    {
      semantic: 'sidewalk',
      category: 'city',
      url: '/assets/environments/city/sidewalk.glb',
      gltfUrl: '/assets/environments/city/sidewalk.gltf',
      purpose: 'Sidewalk strip beside the road.',
      targetScale: 10.0,
      footprintRadius: 1.7,
    },
    {
      semantic: 'lamp',
      category: 'city',
      url: '/assets/environments/city/lamp.glb',
      gltfUrl: '/assets/environments/city/lamp.gltf',
      purpose: 'Street lamp along the sidewalks.',
      targetScale: 3.6,
      footprintRadius: 0.4,
    },
    {
      semantic: 'bench',
      category: 'city',
      url: '/assets/environments/city/bench.glb',
      gltfUrl: '/assets/environments/city/bench.gltf',
      purpose: 'Public street bench on the sidewalk.',
      targetScale: 1.7,
      footprintRadius: 0.9,
    },
  ],
  living_room: [
    {
      semantic: 'sofa',
      category: 'living_room',
      url: '/assets/quaternius/furniture/living_room/sofa_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/sofa_01.gltf',
      purpose: 'Quaternius living-room sofa (CC0).',
      targetScale: 2.5,
      footprintRadius: 1.2,
    },
    {
      semantic: 'chair',
      category: 'living_room',
      url: '/assets/quaternius/furniture/living_room/chair_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/chair_01.gltf',
      purpose: 'Quaternius living-room chair (CC0).',
      targetScale: 1.1,
      footprintRadius: 0.55,
    },
    {
      semantic: 'table',
      category: 'living_room',
      url: '/assets/quaternius/furniture/living_room/coffee_table_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/coffee_table_01.gltf',
      purpose: 'Quaternius coffee table (CC0).',
      targetScale: 1.5,
      footprintRadius: 0.7,
    },
    {
      semantic: 'lamp',
      category: 'living_room',
      url: '/assets/quaternius/furniture/living_room/lamp_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/lamp_01.gltf',
      purpose: 'Quaternius living-room lamp (CC0).',
      targetScale: 2.2,
      footprintRadius: 0.45,
    },
    {
      semantic: 'cabinet',
      category: 'living_room',
      url: '/assets/quaternius/furniture/living_room/cabinet_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/cabinet_01.gltf',
      purpose: 'Quaternius living-room cabinet (CC0).',
      targetScale: 1.6,
      footprintRadius: 0.7,
    },
    {
      semantic: 'plant',
      category: 'living_room',
      url: '/assets/quaternius/furniture/living_room/plant_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/plant_01.gltf',
      purpose: 'Quaternius indoor plant (CC0).',
      targetScale: 1.3,
      footprintRadius: 0.5,
    },
  ],
}

// ---------------------------------------------------------------------------
// Aggregated helpers
// ---------------------------------------------------------------------------

export const ALL_ASSET_DESCRIPTORS: readonly AssetDescriptor[] = (
  Object.values(ENVIRONMENT_ASSET_MANIFEST) as readonly (readonly AssetDescriptor[])[]
).flat()

export function getAssetDescriptor(
  category: EnvironmentAssetCategory,
  semantic: SemanticAssetId
): AssetDescriptor | undefined {
  return ENVIRONMENT_ASSET_MANIFEST[category]?.find((d) => d.semantic === semantic)
}

/**
 * Resolver's location kind → manifest category.
 * 'stage' / 'alley' have no bespoke manifest → builders fall straight back
 * to procedural geometry for those (classic stage look).
 */
export function assetCategoryForLocation(
  kind: EnvironmentLocationKind
): EnvironmentAssetCategory | null {
  switch (kind) {
    case 'warehouse':
      return 'warehouse'
    case 'railway':
      return 'railway'
    case 'apartment':
    case 'interior':
      return 'apartment'
    case 'forest':
      return 'forest'
    case 'broadcast':
    case 'office':
      return 'studio'
    case 'street':
      return 'city'
    default:
      return null // stage / alley → classic base stage, no 3D asset library
  }
}

/**
 * Blueprint PropType → best semantic asset (if any) for the category.
 * Returns null for props that have no manifest entry (e.g. wall, floor, pipe).
 */
export function semanticForPropType(
  propType: PropType,
  category: EnvironmentAssetCategory
): SemanticAssetId | null {
  switch (propType) {
    case 'crate':
      return 'crate'
    case 'barrel':
      return 'barrel'
    case 'rack':
    case 'shelf':
      return 'shelf'
    case 'pillar':
      return 'pillar'
    case 'bench':
      return 'bench'
    case 'platform':
      return 'platform'
    case 'track':
      return 'rail'
    case 'stationLight':
    case 'lampPost':
      return 'lamp'
    case 'sofa':
      return 'sofa'
    case 'table':
      return 'table'
    case 'chair':
      return 'chair'
    case 'tree':
      return 'tree_01' // forest composer alternates by index; see environmentStage
    case 'rock':
      return 'rock'
    // 'bush' is not a blueprint PropType — the forest composer generates
    // bushes from the tree count (buildBush), so there is no mapping here.
    case 'desk':
      return 'desk'
    case 'screen':
      return 'screen'
    case 'building':
      return 'building'
    case 'sidewalk':
      return 'sidewalk'
    default:
      return null
  }
}

/** Enumerate every local URL in the manifest (for the download report). */
export function listAllAssetUrls(): string[] {
  return ALL_ASSET_DESCRIPTORS.map((d) => d.url)
}