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
  | 'office'
  | 'scifi'

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
  | 'tree_03'
  | 'tree_04'
  | 'tree_small'
  | 'tree_pine'
  | 'tree_pine_round'
  | 'tree_default'
  | 'rock'
  | 'rock_small'
  | 'rock_tall'
  | 'bush'
  | 'log'
  | 'stump'
  | 'grass'
  | 'mushroom'
  // studio
  | 'desk'
  | 'screen'
  | 'panel'
  | 'light_stand'
  // city
  | 'building'
  | 'building_a'
  | 'building_b'
  | 'building_c'
  | 'building_d'
  | 'building_e'
  | 'skyscraper_a'
  | 'skyscraper_b'
  | 'skyscraper_c'
  | 'sidewalk'
  | 'lamp'
  | 'streetlight'
  | 'traffic_light'
  | 'road_sign'
  | 'stop_sign'
  | 'cone'
  | 'barrier'
  | 'road_tile'
  | 'crossing'
  | 'fence_kit'
  | 'bin'
  | 'bench'
  | 'living_room'
  | 'plant'
  // office
  | 'meeting_chair'
  | 'office_desk_alt'
  | 'monitor'
  | 'keyboard'
  | 'bookshelf'
  | 'bookshelf_open'
  | 'file_cabinet'
  | 'office_sofa'
  | 'boxes'
  | 'trashcan'
  | 'round_table'
  | 'stool'
  | 'office_plant'
  // sci-fi
  | 'scifi_wall_panel'
  | 'scifi_window'
  | 'scifi_door'
  | 'scifi_console'
  | 'scifi_screen'
  | 'scifi_machine'
  | 'scifi_machine_large'
  | 'scifi_terminal'
  | 'scifi_crate'
  | 'scifi_barrel'
  | 'scifi_pipe'
  | 'scifi_pipe_corner'
  | 'scifi_platform'
  | 'scifi_pillar'
  | 'scifi_stairs'
  | 'scifi_crystal'
  | 'scifi_dish'

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
      url: '/assets/kenney/nature/tree_tall.glb',
      gltfUrl: '/assets/kenney/nature/tree_tall.glb',
      purpose: 'Tall forest tree (variant A) — frame edges, midground, deep rows.',
      targetScale: 5.0,
      footprintRadius: 1.3,
    },
    {
      semantic: 'tree_02',
      category: 'forest',
      url: '/assets/kenney/nature/tree_oak.glb',
      gltfUrl: '/assets/kenney/nature/tree_oak.glb',
      purpose: 'Oak forest tree (variant B) — alternates with tree_01.',
      targetScale: 5.2,
      footprintRadius: 1.35,
    },
    {
      semantic: 'tree_03',
      category: 'forest',
      url: '/assets/kenney/nature/tree_thin.glb',
      gltfUrl: '/assets/kenney/nature/tree_thin.glb',
      purpose: 'Thin birch-like tree (variant C).',
      targetScale: 5.5,
      footprintRadius: 1.0,
    },
    {
      semantic: 'tree_04',
      category: 'forest',
      url: '/assets/kenney/nature/tree_cone.glb',
      gltfUrl: '/assets/kenney/nature/tree_cone.glb',
      purpose: 'Conifer tree (variant D).',
      targetScale: 5.4,
      footprintRadius: 1.2,
    },
    {
      semantic: 'tree_small',
      category: 'forest',
      url: '/assets/kenney/nature/tree_small.glb',
      gltfUrl: '/assets/kenney/nature/tree_small.glb',
      purpose: 'Small understory tree / sapling.',
      targetScale: 2.4,
      footprintRadius: 0.7,
    },
    {
      semantic: 'tree_pine',
      category: 'forest',
      url: '/assets/kenney/nature/tree_pineTallA.glb',
      gltfUrl: '/assets/kenney/nature/tree_pineTallA.glb',
      purpose: 'Tall pine — deep forest rows.',
      targetScale: 6.5,
      footprintRadius: 1.3,
    },
    {
      semantic: 'tree_pine_round',
      category: 'forest',
      url: '/assets/kenney/nature/tree_pineRoundA.glb',
      gltfUrl: '/assets/kenney/nature/tree_pineRoundA.glb',
      purpose: 'Round pine — deep forest rows.',
      targetScale: 5.5,
      footprintRadius: 1.3,
    },
    {
      semantic: 'tree_default',
      category: 'forest',
      url: '/assets/kenney/nature/tree_default.glb',
      gltfUrl: '/assets/kenney/nature/tree_default.glb',
      purpose: 'Generic forest tree — filler variety.',
      targetScale: 5.0,
      footprintRadius: 1.3,
    },
    {
      semantic: 'rock',
      category: 'forest',
      url: '/assets/kenney/nature/rock_largeA.glb',
      gltfUrl: '/assets/kenney/nature/rock_largeA.glb',
      purpose: 'Large boulder — foreground and midground detail.',
      targetScale: 1.0,
      footprintRadius: 0.55,
    },
    {
      semantic: 'rock_small',
      category: 'forest',
      url: '/assets/kenney/nature/rock_smallA.glb',
      gltfUrl: '/assets/kenney/nature/rock_smallA.glb',
      purpose: 'Small rock scatter detail.',
      targetScale: 0.5,
      footprintRadius: 0.3,
    },
    {
      semantic: 'rock_tall',
      category: 'forest',
      url: '/assets/kenney/nature/rock_tallA.glb',
      gltfUrl: '/assets/kenney/nature/rock_tallA.glb',
      purpose: 'Tall rock spire — midground silhouette detail.',
      targetScale: 1.8,
      footprintRadius: 0.5,
    },
    {
      semantic: 'bush',
      category: 'forest',
      url: '/assets/kenney/nature/plant_bush.glb',
      gltfUrl: '/assets/kenney/nature/plant_bush.glb',
      purpose: 'Low undergrowth bush along the foreground frame edge.',
      targetScale: 0.8,
      footprintRadius: 0.45,
    },
    {
      semantic: 'log',
      category: 'forest',
      url: '/assets/kenney/nature/log_large.glb',
      gltfUrl: '/assets/kenney/nature/log_large.glb',
      purpose: 'Fallen log — ground detail / interaction prop.',
      targetScale: 2.6,
      footprintRadius: 0.7,
    },
    {
      semantic: 'stump',
      category: 'forest',
      url: '/assets/kenney/nature/stump_round.glb',
      gltfUrl: '/assets/kenney/nature/stump_round.glb',
      purpose: 'Tree stump — ground detail.',
      targetScale: 0.9,
      footprintRadius: 0.4,
    },
    {
      semantic: 'grass',
      category: 'forest',
      url: '/assets/kenney/nature/grass.glb',
      gltfUrl: '/assets/kenney/nature/grass.glb',
      purpose: 'Grass clump — near-ground dressing.',
      targetScale: 0.5,
      footprintRadius: 0.25,
    },
    {
      semantic: 'mushroom',
      category: 'forest',
      url: '/assets/kenney/nature/mushroom_red.glb',
      gltfUrl: '/assets/kenney/nature/mushroom_red.glb',
      purpose: 'Mushroom — micro ground detail.',
      targetScale: 0.35,
      footprintRadius: 0.15,
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
      url: '/assets/kenney/city/building-b.glb',
      gltfUrl: '/assets/kenney/city/building-b.glb',
      purpose: 'City storefront building (default canyon filler).',
      targetScale: 7.0,
      footprintRadius: 1.9,
    },
    {
      semantic: 'building_a',
      category: 'city',
      url: '/assets/kenney/city/building-a.glb',
      gltfUrl: '/assets/kenney/city/building-a.glb',
      purpose: 'City building variant A — street canyon.',
      targetScale: 7.0,
      footprintRadius: 1.9,
    },
    {
      semantic: 'building_b',
      category: 'city',
      url: '/assets/kenney/city/building-b.glb',
      gltfUrl: '/assets/kenney/city/building-b.glb',
      purpose: 'City building variant B — street canyon.',
      targetScale: 7.2,
      footprintRadius: 1.9,
    },
    {
      semantic: 'building_c',
      category: 'city',
      url: '/assets/kenney/city/building-c.glb',
      gltfUrl: '/assets/kenney/city/building-c.glb',
      purpose: 'City building variant C — street canyon.',
      targetScale: 6.8,
      footprintRadius: 1.9,
    },
    {
      semantic: 'building_d',
      category: 'city',
      url: '/assets/kenney/city/building-d.glb',
      gltfUrl: '/assets/kenney/city/building-d.glb',
      purpose: 'City building variant D — street canyon.',
      targetScale: 7.4,
      footprintRadius: 1.9,
    },
    {
      semantic: 'building_e',
      category: 'city',
      url: '/assets/kenney/city/building-e.glb',
      gltfUrl: '/assets/kenney/city/building-e.glb',
      purpose: 'City building variant E — street canyon.',
      targetScale: 7.0,
      footprintRadius: 1.9,
    },
    {
      semantic: 'skyscraper_a',
      category: 'city',
      url: '/assets/kenney/city/building-skyscraper-a.glb',
      gltfUrl: '/assets/kenney/city/building-skyscraper-a.glb',
      purpose: 'Skyscraper tower variant A — far canyon silhouettes.',
      targetScale: 12.0,
      footprintRadius: 2.0,
    },
    {
      semantic: 'skyscraper_b',
      category: 'city',
      url: '/assets/kenney/city/building-skyscraper-b.glb',
      gltfUrl: '/assets/kenney/city/building-skyscraper-b.glb',
      purpose: 'Skyscraper tower variant B.',
      targetScale: 13.0,
      footprintRadius: 2.0,
    },
    {
      semantic: 'skyscraper_c',
      category: 'city',
      url: '/assets/kenney/city/building-skyscraper-c.glb',
      gltfUrl: '/assets/kenney/city/building-skyscraper-c.glb',
      purpose: 'Skyscraper tower variant C.',
      targetScale: 12.5,
      footprintRadius: 2.0,
    },
    {
      semantic: 'sidewalk',
      category: 'city',
      url: '/assets/kenney/city/road-side.glb',
      gltfUrl: '/assets/kenney/city/road-side.glb',
      purpose: 'Sidewalk/curb tile (library reference — production sidewalks stay procedural strips).',
      targetScale: 4.0,
      footprintRadius: 1.7,
    },
    {
      semantic: 'lamp',
      category: 'city',
      url: '/assets/kenney/city/light-curved.glb',
      gltfUrl: '/assets/kenney/city/light-curved.glb',
      purpose: 'Curved street lamp along the sidewalks.',
      targetScale: 4.2,
      footprintRadius: 0.4,
    },
    {
      semantic: 'streetlight',
      category: 'city',
      url: '/assets/kenney/city/light-square.glb',
      gltfUrl: '/assets/kenney/city/light-square.glb',
      purpose: 'Square street lamp — alias variety for lamp posts.',
      targetScale: 4.0,
      footprintRadius: 0.4,
    },
    {
      semantic: 'traffic_light',
      category: 'city',
      url: '/assets/kenney/city/traffic-light.glb',
      gltfUrl: '/assets/kenney/city/traffic-light.glb',
      purpose: 'Traffic light on a pole at crossings.',
      targetScale: 3.2,
      footprintRadius: 0.35,
    },
    {
      semantic: 'road_sign',
      category: 'city',
      url: '/assets/kenney/city/road-sign-street.glb',
      gltfUrl: '/assets/kenney/city/road-sign-street.glb',
      purpose: 'Street name sign.',
      targetScale: 2.0,
      footprintRadius: 0.3,
    },
    {
      semantic: 'stop_sign',
      category: 'city',
      url: '/assets/kenney/city/road-sign-stop.glb',
      gltfUrl: '/assets/kenney/city/road-sign-stop.glb',
      purpose: 'Stop sign on a pole.',
      targetScale: 1.8,
      footprintRadius: 0.3,
    },
    {
      semantic: 'cone',
      category: 'city',
      url: '/assets/kenney/city/construction-cone.glb',
      gltfUrl: '/assets/kenney/city/construction-cone.glb',
      purpose: 'Traffic cone — roadwork / roadblock dressing.',
      targetScale: 0.5,
      footprintRadius: 0.2,
    },
    {
      semantic: 'barrier',
      category: 'city',
      url: '/assets/kenney/city/construction-barrier.glb',
      gltfUrl: '/assets/kenney/city/construction-barrier.glb',
      purpose: 'Construction barrier — sidewalk dressing.',
      targetScale: 1.2,
      footprintRadius: 0.6,
    },
    {
      semantic: 'fence_kit',
      category: 'city',
      url: '/assets/kenney/city/construction-fence.glb',
      gltfUrl: '/assets/kenney/city/construction-fence.glb',
      purpose: 'Construction fence panel — sidewalk canyon dressing.',
      targetScale: 2.2,
      footprintRadius: 1.0,
    },
    {
      semantic: 'bin',
      category: 'city',
      url: '/assets/kenney/city/dumpster.glb',
      gltfUrl: '/assets/kenney/city/dumpster.glb',
      purpose: 'Dumpster / trash container at the frame edges.',
      targetScale: 1.6,
      footprintRadius: 0.7,
    },
    {
      semantic: 'road_tile',
      category: 'city',
      url: '/assets/kenney/city/road-straight.glb',
      gltfUrl: '/assets/kenney/city/road-straight.glb',
      purpose: 'Straight road tile (library reference — production road stays procedural).',
      targetScale: 4.0,
      footprintRadius: 1.8,
    },
    {
      semantic: 'crossing',
      category: 'city',
      url: '/assets/kenney/city/road-crossing.glb',
      gltfUrl: '/assets/kenney/city/road-crossing.glb',
      purpose: 'Pedestrian crossing tile (library reference).',
      targetScale: 4.0,
      footprintRadius: 1.8,
    },
    {
      semantic: 'bench',
      category: 'city',
      url: '/assets/kenney/city/bench.glb',
      gltfUrl: '/assets/kenney/city/bench.glb',
      purpose: 'Public street bench on the sidewalk (Kenney furniture kit, CC0).',
      targetScale: 1.8,
      footprintRadius: 0.9,
    },
  ],
  scifi: [
    {
      semantic: 'scifi_wall_panel',
      category: 'scifi',
      url: '/assets/kenney/scifi/corridor_wall.glb',
      gltfUrl: '/assets/kenney/scifi/corridor_wall.glb',
      purpose: 'Sci-fi wall panel — hull wall dressing between procedural wall slabs.',
      targetScale: 3.0,
      footprintRadius: 0.3,
    },
    {
      semantic: 'scifi_window',
      category: 'scifi',
      url: '/assets/kenney/scifi/corridor_window.glb',
      gltfUrl: '/assets/kenney/scifi/corridor_window.glb',
      purpose: 'Spaceship window panel — wall variation.',
      targetScale: 3.0,
      footprintRadius: 0.3,
    },
    {
      semantic: 'scifi_door',
      category: 'scifi',
      url: '/assets/kenney/scifi/gate_simple.glb',
      gltfUrl: '/assets/kenney/scifi/gate_simple.glb',
      purpose: 'Sci-fi door / hatch on the rear wall.',
      targetScale: 2.6,
      footprintRadius: 0.4,
    },
    {
      semantic: 'scifi_console',
      category: 'scifi',
      url: '/assets/kenney/scifi/desk_computer.glb',
      gltfUrl: '/assets/kenney/scifi/desk_computer.glb',
      purpose: 'Control console / workstation.',
      targetScale: 1.4,
      footprintRadius: 0.6,
    },
    {
      semantic: 'scifi_screen',
      category: 'scifi',
      url: '/assets/kenney/scifi/desk_computerScreen.glb',
      gltfUrl: '/assets/kenney/scifi/desk_computerScreen.glb',
      purpose: 'Display terminal — screen cluster.',
      targetScale: 1.2,
      footprintRadius: 0.5,
    },
    {
      semantic: 'scifi_terminal',
      category: 'scifi',
      url: '/assets/kenney/scifi/desk_computerCorner.glb',
      gltfUrl: '/assets/kenney/scifi/desk_computerCorner.glb',
      purpose: 'Corner terminal — console-zone variety.',
      targetScale: 1.3,
      footprintRadius: 0.55,
    },
    {
      semantic: 'scifi_machine',
      category: 'scifi',
      url: '/assets/kenney/scifi/machine_generator.glb',
      gltfUrl: '/assets/kenney/scifi/machine_generator.glb',
      purpose: 'Generator / machinery unit.',
      targetScale: 1.6,
      footprintRadius: 0.7,
    },
    {
      semantic: 'scifi_machine_large',
      category: 'scifi',
      url: '/assets/kenney/scifi/machine_generatorLarge.glb',
      gltfUrl: '/assets/kenney/scifi/machine_generatorLarge.glb',
      purpose: 'Large generator — rear machinery row.',
      targetScale: 2.4,
      footprintRadius: 0.9,
    },
    {
      semantic: 'scifi_crate',
      category: 'scifi',
      url: '/assets/kenney/scifi/barrels.glb',
      gltfUrl: '/assets/kenney/scifi/barrels.glb',
      purpose: 'Container cluster — storage zone.',
      targetScale: 1.1,
      footprintRadius: 0.6,
    },
    {
      semantic: 'scifi_barrel',
      category: 'scifi',
      url: '/assets/kenney/scifi/barrel.glb',
      gltfUrl: '/assets/kenney/scifi/barrel.glb',
      purpose: 'Single sci-fi barrel / container.',
      targetScale: 0.9,
      footprintRadius: 0.4,
    },
    {
      semantic: 'scifi_pipe',
      category: 'scifi',
      url: '/assets/kenney/scifi/pipe_straight.glb',
      gltfUrl: '/assets/kenney/scifi/pipe_straight.glb',
      purpose: 'Straight technical pipe — wall dressing.',
      targetScale: 1.8,
      footprintRadius: 0.25,
    },
    {
      semantic: 'scifi_pipe_corner',
      category: 'scifi',
      url: '/assets/kenney/scifi/pipe_corner.glb',
      gltfUrl: '/assets/kenney/scifi/pipe_corner.glb',
      purpose: 'Pipe corner — technical wall runs.',
      targetScale: 1.5,
      footprintRadius: 0.25,
    },
    {
      semantic: 'scifi_platform',
      category: 'scifi',
      url: '/assets/kenney/scifi/platform_center.glb',
      gltfUrl: '/assets/kenney/scifi/platform_center.glb',
      purpose: 'Floor / platform panel — raised dais dressing.',
      targetScale: 2.4,
      footprintRadius: 1.2,
    },
    {
      semantic: 'scifi_pillar',
      category: 'scifi',
      url: '/assets/kenney/scifi/structure_detailed.glb',
      gltfUrl: '/assets/kenney/scifi/structure_detailed.glb',
      purpose: 'Detailed technical pillar / support structure.',
      targetScale: 3.2,
      footprintRadius: 0.5,
    },
    {
      semantic: 'scifi_stairs',
      category: 'scifi',
      url: '/assets/kenney/scifi/stairs.glb',
      gltfUrl: '/assets/kenney/scifi/stairs.glb',
      purpose: 'Short stair unit — level-change dressing.',
      targetScale: 2.0,
      footprintRadius: 1.0,
    },
    {
      semantic: 'scifi_crystal',
      category: 'scifi',
      url: '/assets/kenney/scifi/rock_crystals.glb',
      gltfUrl: '/assets/kenney/scifi/rock_crystals.glb',
      purpose: 'Alien crystal cluster — decorative accent.',
      targetScale: 0.9,
      footprintRadius: 0.4,
    },
    {
      semantic: 'scifi_dish',
      category: 'scifi',
      url: '/assets/kenney/scifi/satelliteDish.glb',
      gltfUrl: '/assets/kenney/scifi/satelliteDish.glb',
      purpose: 'Comms dish — background technical prop.',
      targetScale: 2.2,
      footprintRadius: 0.8,
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
  office: [
    {
      semantic: 'desk',
      category: 'office',
      url: '/assets/quaternius/furniture/office/office_desk_01.glb',
      gltfUrl: '/assets/quaternius/furniture/office/office_desk_01.gltf',
      purpose: 'Quaternius office desk (CC0).',
      targetScale: 2.0,
      footprintRadius: 1.0,
    },
    {
      semantic: 'chair',
      category: 'office',
      url: '/assets/quaternius/furniture/office/office_chair_01.glb',
      gltfUrl: '/assets/quaternius/furniture/office/office_chair_01.gltf',
      purpose: 'Quaternius office chair (CC0).',
      targetScale: 1.1,
      footprintRadius: 0.55,
    },
    {
      semantic: 'cabinet',
      category: 'office',
      url: '/assets/quaternius/furniture/office/cabinet_01.glb',
      gltfUrl: '/assets/quaternius/furniture/office/cabinet_01.gltf',
      purpose: 'Quaternius office cabinet (CC0).',
      targetScale: 1.6,
      footprintRadius: 0.7,
    },
    {
      semantic: 'table',
      category: 'office',
      url: '/assets/quaternius/furniture/office/meeting_table_01.glb',
      gltfUrl: '/assets/quaternius/furniture/office/meeting_table_01.gltf',
      purpose: 'Quaternius meeting table (CC0).',
      targetScale: 2.0,
      footprintRadius: 1.2,
    },
    {
      semantic: 'meeting_chair',
      category: 'office',
      url: '/assets/quaternius/furniture/office/meeting_chair_01.glb',
      gltfUrl: '/assets/quaternius/furniture/office/meeting_chair_01.gltf',
      purpose: 'Quaternius meeting chair (CC0).',
      targetScale: 1.0,
      footprintRadius: 0.5,
    },
    {
      semantic: 'plant',
      category: 'office',
      url: '/assets/quaternius/furniture/living_room/plant_01.glb',
      gltfUrl: '/assets/quaternius/furniture/living_room/plant_01.gltf',
      purpose: 'Quaternius indoor plant (CC0) — reused in office.',
      targetScale: 1.3,
      footprintRadius: 0.5,
    },
    {
      semantic: 'office_desk_alt',
      category: 'office',
      url: '/assets/kenney/office/desk.glb',
      gltfUrl: '/assets/kenney/office/desk.glb',
      purpose: 'Second desk variation (Kenney furniture kit, CC0).',
      targetScale: 1.9,
      footprintRadius: 1.0,
    },
    {
      semantic: 'monitor',
      category: 'office',
      url: '/assets/kenney/office/computerScreen.glb',
      gltfUrl: '/assets/kenney/office/computerScreen.glb',
      purpose: 'Desktop monitor — desk dressing.',
      targetScale: 0.6,
      footprintRadius: 0.25,
    },
    {
      semantic: 'keyboard',
      category: 'office',
      url: '/assets/kenney/office/computerKeyboard.glb',
      gltfUrl: '/assets/kenney/office/computerKeyboard.glb',
      purpose: 'Keyboard — desk dressing.',
      targetScale: 0.45,
      footprintRadius: 0.2,
    },
    {
      semantic: 'bookshelf',
      category: 'office',
      url: '/assets/kenney/office/bookcaseClosed.glb',
      gltfUrl: '/assets/kenney/office/bookcaseClosed.glb',
      purpose: 'Closed bookshelf against the back wall.',
      targetScale: 2.1,
      footprintRadius: 0.6,
    },
    {
      semantic: 'bookshelf_open',
      category: 'office',
      url: '/assets/kenney/office/bookcaseOpen.glb',
      gltfUrl: '/assets/kenney/office/bookcaseOpen.glb',
      purpose: 'Open bookshelf — second shelf variation.',
      targetScale: 2.1,
      footprintRadius: 0.6,
    },
    {
      semantic: 'file_cabinet',
      category: 'office',
      url: '/assets/kenney/office/sideTableDrawers.glb',
      gltfUrl: '/assets/kenney/office/sideTableDrawers.glb',
      purpose: 'Drawer cabinet / file cabinet.',
      targetScale: 0.9,
      footprintRadius: 0.4,
    },
    {
      semantic: 'office_sofa',
      category: 'office',
      url: '/assets/kenney/office/loungeSofa.glb',
      gltfUrl: '/assets/kenney/office/loungeSofa.glb',
      purpose: 'Lounge sofa — office waiting corner.',
      targetScale: 2.2,
      footprintRadius: 1.1,
    },
    {
      semantic: 'boxes',
      category: 'office',
      url: '/assets/kenney/office/cardboardBoxClosed.glb',
      gltfUrl: '/assets/kenney/office/cardboardBoxClosed.glb',
      purpose: 'Cardboard box — storage corner dressing.',
      targetScale: 0.6,
      footprintRadius: 0.35,
    },
    {
      semantic: 'trashcan',
      category: 'office',
      url: '/assets/kenney/office/trashcan.glb',
      gltfUrl: '/assets/kenney/office/trashcan.glb',
      purpose: 'Office waste bin — desk-side dressing.',
      targetScale: 0.5,
      footprintRadius: 0.25,
    },
    {
      semantic: 'round_table',
      category: 'office',
      url: '/assets/kenney/office/tableRound.glb',
      gltfUrl: '/assets/kenney/office/tableRound.glb',
      purpose: 'Small round table — meeting corner.',
      targetScale: 1.2,
      footprintRadius: 0.6,
    },
    {
      semantic: 'stool',
      category: 'office',
      url: '/assets/kenney/office/stoolBar.glb',
      gltfUrl: '/assets/kenney/office/stoolBar.glb',
      purpose: 'Bar stool — informal seat variation.',
      targetScale: 0.8,
      footprintRadius: 0.3,
    },
    {
      semantic: 'office_plant',
      category: 'office',
      url: '/assets/kenney/office/pottedPlant.glb',
      gltfUrl: '/assets/kenney/office/pottedPlant.glb',
      purpose: 'Potted plant — second plant variation.',
      targetScale: 1.4,
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
      // Living-room kit assets live in the 'living_room' category (Quaternius
      // CC0 furniture). The 'apartment' category files do not exist locally.
      return 'living_room'
    case 'forest':
      return 'forest'
    case 'broadcast':
      return 'studio'
    case 'office':
      // Modern-office kit assets live in the 'office' category (Quaternius
      // CC0 office furniture). The 'studio' category files do not exist locally.
      return 'office'
    case 'street':
      return 'city'
    case 'scifi':
      // Sci-fi kit assets (Kenney space-kit GLBs) live in the 'scifi' category.
      return 'scifi'
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