/**
 * Environment Kits — PHASE 4C. Semantic scene classification.
 *
 * An Environment Kit describes WHAT a scene needs (required/optional entities,
 * density, lighting, interaction categories). It does NOT render geometry,
 * download assets, or modify character/camera behavior.
 *
 * Kits are pure semantic data. With zero real GLB/GLTF assets, every kit
 * resolves to NO real asset match and the existing procedural composers stay
 * authoritative. Kits classify; they do not replace the renderer.
 */

import type { EnvironmentLocationKind, EnvironmentMood } from './environmentResolver'

// ---------------------------------------------------------------------------
// Kit types
// ---------------------------------------------------------------------------

export type EnvironmentKitId =
  | 'living_room'
  | 'modern_office'
  | 'city_street'
  | 'forest'
  | 'sci_fi_room'

export interface EnvironmentKitDefinition {
  id: EnvironmentKitId
  /** Human-readable aliases for semantic matching. */
  aliases: string[]
  /** Existing procedural composer to fall back to. */
  fallbackEnvironment: EnvironmentLocationKind
  /** Semantic categories that should always appear. */
  required: string[]
  /** Semantic categories that may appear. */
  optional: string[]
  /** Coarse density hint. */
  density: 'sparse' | 'medium' | 'dense'
  /** Suggested lighting mood + time of day. */
  lightingDefaults: { mood: EnvironmentMood; timeOfDay: 'day' | 'dawn' | 'dusk' | 'night' }
  /** Semantic material roles (color names, not hex — resolved by the composer). */
  materialDefaults: { primary: string; secondary: string; accent: string }
  /** Semantic spawn regions (composer maps these to layout zones). */
  spawnRegions: string[]
  /** Categories that can later host character interactions. */
  interactionCategories: string[]
  /** Camera-safe region hint (half-extents around origin). */
  cameraSafeRegions: { halfX: number; halfZ: number }
  /** Conservative semantic asset-count budget. */
  assetBudget: {
    required: { min: number; max: number }
    optional: { min: number; max: number }
  }
}

// ---------------------------------------------------------------------------
// Kit definitions
// ---------------------------------------------------------------------------

export const ENVIRONMENT_KITS: Readonly<Record<EnvironmentKitId, EnvironmentKitDefinition>> = {
  living_room: {
    id: 'living_room',
    aliases: ['living room', 'lounge', 'sitting room', 'family room'],
    fallbackEnvironment: 'apartment',
    required: ['room_shell', 'floor', 'sofa', 'table'],
    optional: ['chair', 'lamp', 'shelf', 'window', 'rug', 'plant', 'cabinet'],
    density: 'medium',
    lightingDefaults: { mood: 'soft', timeOfDay: 'day' },
    materialDefaults: { primary: 'warm_beige', secondary: 'wood_brown', accent: 'soft_white' },
    spawnRegions: ['midground', 'background'],
    interactionCategories: ['sofa', 'chair', 'table', 'door'],
    cameraSafeRegions: { halfX: 2.5, halfZ: 1.5 },
    assetBudget: { required: { min: 3, max: 5 }, optional: { min: 2, max: 6 } },
  },
  modern_office: {
    id: 'modern_office',
    aliases: ['office', 'modern office', 'workspace', 'workplace'],
    fallbackEnvironment: 'office',
    required: ['room_shell', 'floor', 'desk', 'chair'],
    optional: ['shelf', 'cabinet', 'lamp', 'computer', 'monitor', 'papers', 'boxes', 'window'],
    density: 'medium',
    lightingDefaults: { mood: 'neutral', timeOfDay: 'day' },
    materialDefaults: { primary: 'cool_gray', secondary: 'desk_white', accent: 'screen_blue' },
    spawnRegions: ['midground', 'background'],
    interactionCategories: ['chair', 'desk', 'door'],
    cameraSafeRegions: { halfX: 2.5, halfZ: 1.5 },
    assetBudget: { required: { min: 3, max: 5 }, optional: { min: 2, max: 7 } },
  },
  city_street: {
    id: 'city_street',
    aliases: ['street', 'city street', 'urban street', 'downtown'],
    fallbackEnvironment: 'street',
    required: ['road', 'sidewalk', 'building'],
    optional: ['street_lamp', 'bench', 'sign', 'fence', 'tree', 'crate'],
    density: 'dense',
    lightingDefaults: { mood: 'night', timeOfDay: 'night' },
    materialDefaults: { primary: 'asphalt_dark', secondary: 'concrete_gray', accent: 'neon_warm' },
    spawnRegions: ['foreground', 'midground', 'background'],
    interactionCategories: ['door', 'bench'],
    cameraSafeRegions: { halfX: 3.0, halfZ: 2.0 },
    assetBudget: { required: { min: 2, max: 4 }, optional: { min: 3, max: 8 } },
  },
  forest: {
    id: 'forest',
    aliases: ['forest', 'woods', 'woodland'],
    fallbackEnvironment: 'forest',
    required: ['terrain', 'tree', 'rock'],
    optional: ['bush', 'fallen_log', 'path', 'grass', 'flowers'],
    density: 'dense',
    lightingDefaults: { mood: 'dawn', timeOfDay: 'dawn' },
    materialDefaults: { primary: 'forest_green', secondary: 'bark_brown', accent: 'moss' },
    spawnRegions: ['foreground', 'midground', 'background', 'far'],
    interactionCategories: ['rock', 'fallen_log'],
    cameraSafeRegions: { halfX: 3.0, halfZ: 2.5 },
    assetBudget: { required: { min: 2, max: 4 }, optional: { min: 4, max: 10 } },
  },
  sci_fi_room: {
    id: 'sci_fi_room',
    aliases: [
      'sci-fi room',
      'science fiction room',
      'spaceship interior',
      'futuristic room',
      'laboratory interior',
    ],
    fallbackEnvironment: 'interior',
    required: ['room_shell', 'floor', 'console'],
    optional: ['monitor', 'door', 'machinery', 'crate', 'light_panel'],
    density: 'medium',
    lightingDefaults: { mood: 'tension', timeOfDay: 'night' },
    materialDefaults: { primary: 'hull_metal', secondary: 'panel_dark', accent: 'console_cyan' },
    spawnRegions: ['midground', 'background'],
    interactionCategories: ['console', 'door', 'machinery'],
    cameraSafeRegions: { halfX: 2.5, halfZ: 1.5 },
    assetBudget: { required: { min: 2, max: 4 }, optional: { min: 2, max: 6 } },
  },
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/** All registered kit IDs. */
export const ALL_KIT_IDS: readonly EnvironmentKitId[] = Object.keys(
  ENVIRONMENT_KITS
) as EnvironmentKitId[]

/** Look up a kit by exact ID. */
export function getEnvironmentKit(id: string): EnvironmentKitDefinition | undefined {
  return ENVIRONMENT_KITS[id as EnvironmentKitId]
}

/** List all kit definitions. */
export function listEnvironmentKits(): readonly EnvironmentKitDefinition[] {
  return Object.values(ENVIRONMENT_KITS)
}

/**
 * Resolve a free-text prompt to a kit using alias matching.
 * Uses whole-word/phrase matching to avoid substring bugs.
 * Returns undefined when no kit matches (caller keeps existing behavior).
 */
export function resolveEnvironmentKit(text: string): EnvironmentKitDefinition | undefined {
  const lower = text.toLowerCase().trim()
  if (!lower) return undefined

  // Longer aliases matched first so "modern office" beats "office".
  const sorted = Object.values(ENVIRONMENT_KITS).sort(
    (a, b) => maxAliasLength(b) - maxAliasLength(a)
  )
  for (const kit of sorted) {
    for (const alias of kit.aliases) {
      if (alias.length < 2) continue
      // Whole-phrase match: the alias appears as a contiguous substring bounded
      // by string start/end or non-word characters.
      const idx = lower.indexOf(alias)
      if (idx === -1) continue
      const before = idx === 0 || !isWordChar(lower[idx - 1])
      const after = idx + alias.length >= lower.length || !isWordChar(lower[idx + alias.length])
      if (before && after) return kit
    }
  }
  return undefined
}

/** Required categories for a kit (empty if kit unknown). */
export function getRequiredCategories(kit: EnvironmentKitDefinition | string | undefined): string[] {
  if (!kit) return []
  if (typeof kit === 'string') return ENVIRONMENT_KITS[kit as EnvironmentKitId]?.required ?? []
  return kit.required
}

/** Optional categories for a kit (empty if kit unknown). */
export function getOptionalCategories(kit: EnvironmentKitDefinition | string | undefined): string[] {
  if (!kit) return []
  if (typeof kit === 'string') return ENVIRONMENT_KITS[kit as EnvironmentKitId]?.optional ?? []
  return kit.optional
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maxAliasLength(kit: EnvironmentKitDefinition): number {
  return kit.aliases.reduce((m, a) => Math.max(m, a.length), 0)
}

function isWordChar(ch: string): boolean {
  return /[a-z0-9-]/.test(ch)
}