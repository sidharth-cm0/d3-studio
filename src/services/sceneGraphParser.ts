/**
 * Scene Graph Parser — PHASE 3 semantic story analysis (deterministic, local).
 *
 *   Story text
 *     → tokenize + concept extraction (keyword/concept tables, NOT a category
 *       switch of complete environments)
 *     → environment family inference (WHERE / WHEN / WHAT)
 *     → semantic object requirements (hero / supporting / dressing)
 *     → palette + ground + atmosphere + lighting intent
 *     → ParsedScene { template?, sceneGraph, trace }
 *
 * Design rules:
 *  - DETERMINISTIC: same text ⇒ same graph (seed derived from text hash).
 *  - GENERALIZING: concept tables describe PROPERTIES (indoor/outdoor,
 *    materials, object nouns, light intent) — never complete environments.
 *    "pirate on Mars beside a crashed spaceship" composes: planet surface +
 *    wreck + rocks + dust, none of which exist as a hardcoded category.
 *  - LLM SEAM: parseSceneGraph() accepts optional pre-validated LLM JSON via
 *    validateSceneGraph() (sceneGraphValidator.ts). Phase 3 ships local-only;
 *    a future provider can call validateSceneGraph(rawJson) and hand the
 *    normalized graph to the same pipeline.
 *  - The parser NEVER produces renderer values — only semantic intent that
 *    the validator clamps and the builder converts.
 */

import type {
  ParsedScene,
  SceneDetails,
  SceneGraph,
  SceneLightSpec,
  SceneObjectSpec,
  SceneTimeOfDay,
  TemplateCandidate,
  LightIntent,
  IntensityHint,
} from './sceneGraphTypes'
import { SCENE_GRAPH_VERSION } from './sceneGraphTypes'
import { validateSceneGraph } from './sceneGraphValidator'

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

export function hashString(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return h
}

// ---------------------------------------------------------------------------
// Concept tables — properties, not environments
// ---------------------------------------------------------------------------

/** A concept contributes properties to the environment under construction. */
interface ConceptRule {
  /** Concept id (also used in the trace). */
  id: string
  keys: RegExp
  /** Environment family this concept votes for (highest score wins). */
  family?: string
  /** indoor/outdoor vote. */
  space?: 'indoor' | 'outdoor' | 'mixed'
  /** Object nouns this concept implies (semanticType:importance). */
  objects?: Array<[string, 'hero' | 'supporting' | 'dressing']>
  /** Material/ground tags. */
  ground?: string
  /** Palette hue votes (hex strings). */
  palette?: Partial<{ primary: string; secondary: string; accent: string; ground: string }>
  /** Light intent votes. */
  light?: { intent: LightIntent; hint: IntensityHint; color?: string }
  /** Mood words. */
  mood?: string[]
}

const CONCEPTS: ConceptRule[] = [
  // --- celestial / planetary -------------------------------------------------
  {
    id: 'mars',
    keys: /\b(mars|martian|red\s?planet|alien\s?planet|extraterrestrial)\b/,
    family: 'mars',
    space: 'outdoor',
    ground: 'rocky_red_terrain',
    palette: { primary: '#8a4a32', secondary: '#a35c3c', accent: '#c97b52', ground: '#7a3f2c' },
    light: { intent: 'sun', hint: 'moderate', color: '#ffd9b0' },
    mood: ['isolated', 'cinematic'],
  },
  {
    id: 'moon_planet',
    keys: /\b(moon|lunar|crater)\b/,
    family: 'moon',
    space: 'outdoor',
    ground: 'rocky_terrain',
    palette: { primary: '#6b6f78', secondary: '#8a8f99', accent: '#a8adb8', ground: '#565a63' },
    light: { intent: 'sun', hint: 'harsh', color: '#eef2ff' },
    mood: ['isolated', 'silent'],
  },
  {
    id: 'space_scifi',
    keys: /\b(spaceship|spacecraft|starship|shuttle|rocket|crashed|wreck(age)?|cockpit|spaceport|galactic|interstellar)\b/,
    family: 'scifi_wreck',
    space: 'outdoor',
    objects: [
      ['spaceship_wreck', 'hero'],
      ['debris_field', 'supporting'],
      ['engine_cylinder', 'dressing'],
    ],
    mood: ['cinematic', 'adventure'],
  },
  {
    id: 'desert',
    keys: /\b(desert|dune|sahara|sand\s?storm|oasis|wasteland|badlands)\b/,
    family: 'desert',
    space: 'outdoor',
    ground: 'sand',
    palette: { primary: '#c9a06a', secondary: '#b8895a', accent: '#8a6a44', ground: '#c9a06a' },
    light: { intent: 'sun', hint: 'strong', color: '#ffd9a0' },
    mood: ['vast', 'harsh'],
  },
  // --- natural ---------------------------------------------------------------
  {
    id: 'forest',
    keys: /\b(forest|woods|woodland|jungle|grove|thicket|rainforest)\b/,
    family: 'forest',
    space: 'outdoor',
    ground: 'forest_floor',
    palette: { primary: '#27603a', secondary: '#1d3a24', accent: '#4a3c2e', ground: '#21402c' },
    mood: ['natural', 'quiet'],
  },
  {
    id: 'mountain',
    keys: /\b(mountain|cliff|canyon|valley|peak|ridge|gorge)\b/,
    family: 'mountains',
    space: 'outdoor',
    ground: 'rocky_terrain',
    palette: { primary: '#5a5f6b', secondary: '#737a88', accent: '#8a8f9a', ground: '#4a4e58' },
    mood: ['vast', 'cinematic'],
  },
  {
    id: 'beach',
    keys: /\b(beach|shore|coast|seaside|harbor|harbour|dockside|pier)\b/,
    family: 'beach',
    space: 'outdoor',
    ground: 'sand',
    palette: { primary: '#c9b48a', secondary: '#8aa0b8', accent: '#6a7a8a', ground: '#c2ad84' },
    mood: ['open', 'calm'],
  },
  // --- urban / interior ------------------------------------------------------
  {
    id: 'cyberpunk',
    keys: /\b(cyberpunk|neon|hologram|futuristic|dystopian|high-?tech|sci-?fi)\b/,
    family: 'cyberpunk',
    palette: { primary: '#1a1f3a', secondary: '#2a2f52', accent: '#22d3ee' },
    light: { intent: 'neon', hint: 'moderate', color: '#22d3ee' },
    mood: ['futuristic', 'electric'],
  },
  {
    id: 'shop',
    keys: /\b(shop|store|cafe|café|coffee\s?shop|tea\s?shop|bakery|barbershop|boutique|diner|tavern|canteen)\b/,
    family: 'shop',
    space: 'indoor',
    objects: [
      ['counter', 'hero'],
      ['table', 'supporting'],
      ['chair', 'supporting'],
      ['shelf', 'supporting'],
      ['signage', 'supporting'],
    ],
    mood: ['commercial', 'lived-in'],
  },
  {
    id: 'laboratory',
    keys: /\b(laboratory|lab\b|research\s?facility|experiment|specimen|containment)\b/,
    family: 'laboratory',
    space: 'indoor',
    objects: [
      ['lab_machine', 'hero'],
      ['console', 'supporting'],
      ['workbench', 'supporting'],
      ['cabinet', 'dressing'],
    ],
    palette: { primary: '#2b3a4a', secondary: '#3a4a5c', accent: '#4fd1c5' },
    light: { intent: 'studio', hint: 'moderate', color: '#dcecff' },
    mood: ['clinical', 'tense'],
  },
  {
    id: 'temple',
    keys: /\b(temple|shrine|monastery|cathedral|church|ruins?|ancient\s?city)\b/,
    family: 'temple',
    space: 'mixed',
    objects: [
      ['stone_column', 'hero'],
      ['altar', 'supporting'],
      ['rubble', 'dressing'],
    ],
    ground: 'stone_floor',
    palette: { primary: '#7a7264', secondary: '#8f8676', accent: '#a89a80', ground: '#6b6355' },
    mood: ['ancient', 'reverent'],
  },
  {
    id: 'castle',
    keys: /\b(castle|fortress|keep|palace|throne\s?room|dungeon)\b/,
    family: 'castle',
    space: 'indoor',
    objects: [
      ['throne', 'hero'],
      ['stone_column', 'supporting'],
      ['banner', 'dressing'],
      ['torch_sconce', 'dressing'],
    ],
    ground: 'stone_floor',
    palette: { primary: '#4a4038', secondary: '#5c5248', accent: '#8a6a3a', ground: '#3a332c' },
    light: { intent: 'fire', hint: 'moderate', color: '#ffb36b' },
    mood: ['grand', 'medieval'],
  },
  {
    id: 'hospital',
    keys: /\b(hospital|clinic|infirmary|ward|medical)\b/,
    family: 'hospital',
    space: 'indoor',
    objects: [
      ['hospital_bed', 'hero'],
      ['cabinet', 'supporting'],
      ['console', 'dressing'],
    ],
    palette: { primary: '#8fa8b8', secondary: '#a8bcc8', accent: '#7dd3fc', ground: '#6b7a88' },
    light: { intent: 'studio', hint: 'strong', color: '#eaf4ff' },
    mood: ['clinical', 'sterile'],
  },
  {
    id: 'school',
    keys: /\b(school|classroom|university|college|library|lecture\s?hall)\b/,
    family: 'school',
    space: 'indoor',
    objects: [
      ['desk', 'hero'],
      ['chair', 'supporting'],
      ['shelf', 'supporting'],
      ['board', 'supporting'],
    ],
    palette: { primary: '#5c6b52', secondary: '#6e7d64', accent: '#8a7a5c', ground: '#4a4438' },
    mood: ['institutional', 'quiet'],
  },
  {
    id: 'garden',
    keys: /\b(garden|courtyard|greenhouse|conservatory|rooftop\s?garden)\b/,
    family: 'garden',
    space: 'mixed',
    objects: [
      ['plant', 'supporting'],
      ['bench', 'supporting'],
      ['hedge', 'dressing'],
    ],
    ground: 'grass',
    palette: { primary: '#3a6b3a', secondary: '#4a7d4a', accent: '#5c4531', ground: '#2e522e' },
    mood: ['peaceful', 'natural'],
  },
  {
    id: 'cave',
    keys: /\b(cave|cavern|grotto|mine|underground|catacomb|sewer)\b/,
    family: 'cave',
    space: 'indoor',
    ground: 'rocky_terrain',
    objects: [
      ['rock', 'supporting'],
      ['stalagmite', 'dressing'],
      ['crystal', 'dressing'],
    ],
    palette: { primary: '#3a3630', secondary: '#4a453e', accent: '#5c564c', ground: '#2e2b26' },
    light: { intent: 'practical', hint: 'dim', color: '#ffd9a0' },
    mood: ['enclosed', 'mysterious'],
  },
  {
    id: 'camp',
    keys: /\b(camp|campfire|tent|bonfire|wilderness)\b/,
    family: 'camp',
    space: 'outdoor',
    ground: 'forest_floor',
    objects: [
      ['campfire', 'hero'],
      ['tent', 'supporting'],
      ['log_seat', 'dressing'],
    ],
    light: { intent: 'fire', hint: 'moderate', color: '#ffb36b' },
    mood: ['warm', 'rustic'],
  },
  {
    id: 'vehicle',
    keys: /\b(car|truck|bus|train|tram|motorcycle|vehicle)\b/,
    family: 'vehicle_scene',
    objects: [['vehicle_body', 'supporting']],
  },
  {
    id: 'water',
    keys: /\b(river|lake|pond|waterfall|fountain|swamp|marsh)\b/,
    family: 'waterside',
    space: 'outdoor',
    ground: 'water_edge',
    palette: { primary: '#3a5a6b', secondary: '#4a6a7d', accent: '#5c7d8a', ground: '#3a4a44' },
    mood: ['flowing', 'calm'],
  },
  // --- generic object nouns (compose into any family) ------------------------
  {
    id: 'obj_table',
    keys: /\b(tables?|dining|worktable)\b/,
    objects: [['table', 'supporting']],
  },
  {
    id: 'obj_chair',
    keys: /\b(chairs?|stool|bench)\b/,
    objects: [['chair', 'supporting']],
  },
  {
    id: 'obj_crate',
    keys: /\b(crates?|boxes|cargo|containers?)\b/,
    objects: [['crate', 'dressing']],
  },
  {
    id: 'obj_lamp',
    keys: /\b(lamps?|lantern|light\s?post|street\s?lamp)\b/,
    objects: [['lamp_post', 'dressing']],
  },
  {
    id: 'obj_plant',
    keys: /\b(plants?|flowers?|tree|potted)\b/,
    objects: [['plant', 'dressing']],
  },
  {
    id: 'obj_screen',
    keys: /\b(screens?|monitor|television|display|hologram)\b/,
    objects: [['screen_panel', 'supporting']],
  },
  {
    id: 'obj_machine',
    keys: /\b(machine|machinery|generator|reactor|device|apparatus)\b/,
    objects: [['lab_machine', 'hero']],
  },
  {
    id: 'obj_bookshelf',
    keys: /\b(bookshelf|bookcase|shelves|shelf)\b/,
    objects: [['shelf', 'dressing']],
  },
  {
    id: 'obj_bed',
    keys: /\b(beds?|cot|bunk)\b/,
    objects: [['bed', 'supporting']],
  },
  {
    id: 'obj_counter',
    keys: /\b(counter|bar\b|barista|reception)\b/,
    objects: [['counter', 'hero']],
  },
]

// ---------------------------------------------------------------------------
// Time-of-day detection
// ---------------------------------------------------------------------------

const TIME_RULES: Array<{ keys: RegExp; time: SceneTimeOfDay }> = [
  { keys: /\bmidnight\b/, time: 'midnight' },
  { keys: /\b(night|nighttime|nightfall|after\s?dark)\b/, time: 'night' },
  { keys: /\b(sunset|dusk|twilight|golden\s?hour|evening)\b/, time: 'sunset' },
  { keys: /\b(dawn|sunrise|daybreak|first\s?light)\b/, time: 'dawn' },
  { keys: /\b(morning)\b/, time: 'morning' },
  { keys: /\b(noon|midday|daytime|afternoon)\b/, time: 'afternoon' },
]

function detectTimeOfDay(lower: string): SceneTimeOfDay {
  for (const r of TIME_RULES) if (r.keys.test(lower)) return r.time
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Detail flags (mirrors the resolver's generic keyword rules)
// ---------------------------------------------------------------------------

function detectDetails(lower: string): SceneDetails {
  return {
    abandoned: /(abandon|derelict|deserted|desolate|ruined?\b|wreck)/.test(lower),
    rain: /(\brain\b|rainy|downpour|\bwet\b|\bstorm\b|drizzle|heavy\s?rain)/.test(lower),
    luxury: /(luxur|penthouse|grand\b|mansion|elegant|opulent|villa)/.test(lower),
    crowded: /(crowd|busy|packed|bustling|teeming|filled with)/.test(lower),
    empty: /(\bempty\b|\bbare\b|vacant|deserted|hollow|alone|solitary)/.test(lower),
    old: /(\bold\b|aged|weathered|ancient|dilapidated|faded|rusty)/.test(lower),
  }
}

// ---------------------------------------------------------------------------
// Environment family → defaults (properties, not complete environments)
// ---------------------------------------------------------------------------

interface FamilyDefaults {
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed'
  ground: string
  palette: { primary: string; secondary: string; accent: string; ground: string }
  /** Background dressing family (silhouettes / walls / formations). */
  backdrop: 'formations' | 'walls' | 'skyline' | 'trees' | 'dunes' | 'panels'
  /** Default object nouns when the story names none. */
  baseObjects: Array<[string, 'hero' | 'supporting' | 'dressing']>
}

const FAMILY_DEFAULTS: Record<string, FamilyDefaults> = {
  mars: {
    indoorOutdoor: 'outdoor',
    ground: 'rocky_red_terrain',
    palette: { primary: '#8a4a32', secondary: '#a35c3c', accent: '#c97b52', ground: '#7a3f2c' },
    backdrop: 'formations',
    baseObjects: [
      ['rock', 'supporting'],
      ['rock_formation', 'supporting'],
      ['debris_field', 'dressing'],
    ],
  },
  moon: {
    indoorOutdoor: 'outdoor',
    ground: 'rocky_terrain',
    palette: { primary: '#6b6f78', secondary: '#8a8f99', accent: '#a8adb8', ground: '#565a63' },
    backdrop: 'formations',
    baseObjects: [
      ['rock', 'supporting'],
      ['crater_rim', 'dressing'],
    ],
  },
  desert: {
    indoorOutdoor: 'outdoor',
    ground: 'sand',
    palette: { primary: '#c9a06a', secondary: '#b8895a', accent: '#8a6a44', ground: '#c9a06a' },
    backdrop: 'dunes',
    baseObjects: [
      ['dune', 'supporting'],
      ['rock', 'dressing'],
    ],
  },
  mountains: {
    indoorOutdoor: 'outdoor',
    ground: 'rocky_terrain',
    palette: { primary: '#5a5f6b', secondary: '#737a88', accent: '#8a8f9a', ground: '#4a4e58' },
    backdrop: 'formations',
    baseObjects: [
      ['rock', 'supporting'],
      ['rock_formation', 'supporting'],
    ],
  },
  beach: {
    indoorOutdoor: 'outdoor',
    ground: 'sand',
    palette: { primary: '#c9b48a', secondary: '#8aa0b8', accent: '#6a7a8a', ground: '#c2ad84' },
    backdrop: 'formations',
    baseObjects: [
      ['rock', 'dressing'],
      ['palm_tree', 'supporting'],
    ],
  },
  forest: {
    indoorOutdoor: 'outdoor',
    ground: 'forest_floor',
    palette: { primary: '#27603a', secondary: '#1d3a24', accent: '#4a3c2e', ground: '#21402c' },
    backdrop: 'trees',
    baseObjects: [
      ['tree', 'supporting'],
      ['rock', 'dressing'],
      ['bush', 'dressing'],
    ],
  },
  waterside: {
    indoorOutdoor: 'outdoor',
    ground: 'water_edge',
    palette: { primary: '#3a5a6b', secondary: '#4a6a7d', accent: '#5c7d8a', ground: '#3a4a44' },
    backdrop: 'formations',
    baseObjects: [
      ['rock', 'dressing'],
      ['plant', 'dressing'],
    ],
  },
  camp: {
    indoorOutdoor: 'outdoor',
    ground: 'forest_floor',
    palette: { primary: '#3a4a34', secondary: '#4a5a44', accent: '#5c4531', ground: '#2e3a2a' },
    backdrop: 'trees',
    baseObjects: [
      ['tree', 'dressing'],
      ['rock', 'dressing'],
    ],
  },
  garden: {
    indoorOutdoor: 'mixed',
    ground: 'grass',
    palette: { primary: '#3a6b3a', secondary: '#4a7d4a', accent: '#5c4531', ground: '#2e522e' },
    backdrop: 'walls',
    baseObjects: [
      ['plant', 'supporting'],
      ['bench', 'supporting'],
    ],
  },
  temple: {
    indoorOutdoor: 'mixed',
    ground: 'stone_floor',
    palette: { primary: '#7a7264', secondary: '#8f8676', accent: '#a89a80', ground: '#6b6355' },
    backdrop: 'walls',
    baseObjects: [
      ['stone_column', 'supporting'],
      ['rubble', 'dressing'],
    ],
  },
  castle: {
    indoorOutdoor: 'indoor',
    ground: 'stone_floor',
    palette: { primary: '#4a4038', secondary: '#5c5248', accent: '#8a6a3a', ground: '#3a332c' },
    backdrop: 'walls',
    baseObjects: [
      ['stone_column', 'supporting'],
      ['torch_sconce', 'dressing'],
    ],
  },
  laboratory: {
    indoorOutdoor: 'indoor',
    ground: 'floor',
    palette: { primary: '#2b3a4a', secondary: '#3a4a5c', accent: '#4fd1c5', ground: '#232c36' },
    backdrop: 'panels',
    baseObjects: [
      ['console', 'supporting'],
      ['workbench', 'supporting'],
      ['cabinet', 'dressing'],
    ],
  },
  hospital: {
    indoorOutdoor: 'indoor',
    ground: 'floor',
    palette: { primary: '#8fa8b8', secondary: '#a8bcc8', accent: '#7dd3fc', ground: '#6b7a88' },
    backdrop: 'panels',
    baseObjects: [
      ['cabinet', 'dressing'],
      ['console', 'dressing'],
    ],
  },
  school: {
    indoorOutdoor: 'indoor',
    ground: 'floor',
    palette: { primary: '#5c6b52', secondary: '#6e7d64', accent: '#8a7a5c', ground: '#4a4438' },
    backdrop: 'walls',
    baseObjects: [
      ['desk', 'supporting'],
      ['chair', 'dressing'],
      ['shelf', 'dressing'],
    ],
  },
  shop: {
    indoorOutdoor: 'indoor',
    ground: 'floor',
    palette: { primary: '#4a3a30', secondary: '#5c4a3e', accent: '#c9a06a', ground: '#3a2e26' },
    backdrop: 'walls',
    baseObjects: [
      ['shelf', 'supporting'],
      ['plant', 'dressing'],
      ['signage', 'dressing'],
    ],
  },
  cyberpunk: {
    indoorOutdoor: 'indoor',
    ground: 'floor',
    palette: { primary: '#1a1f3a', secondary: '#2a2f52', accent: '#22d3ee', ground: '#141830' },
    backdrop: 'panels',
    baseObjects: [
      ['screen_panel', 'supporting'],
      ['signage', 'supporting'],
      ['console', 'dressing'],
    ],
  },
  vehicle_scene: {
    indoorOutdoor: 'outdoor',
    ground: 'road',
    palette: { primary: '#3a3f47', secondary: '#4a505a', accent: '#8a6a44', ground: '#2a2d33' },
    backdrop: 'skyline',
    baseObjects: [
      ['vehicle_body', 'supporting'],
      ['lamp_post', 'dressing'],
    ],
  },
  scifi_wreck: {
    indoorOutdoor: 'outdoor',
    ground: 'rocky_terrain',
    palette: { primary: '#5a5f6b', secondary: '#6b7280', accent: '#8a95a3', ground: '#4a4e58' },
    backdrop: 'formations',
    baseObjects: [
      ['debris_field', 'supporting'],
      ['rock', 'dressing'],
    ],
  },
  /** Universal fallback — a generic open ground with dressing. */
  generic: {
    indoorOutdoor: 'outdoor',
    ground: 'rocky_terrain',
    palette: { primary: '#4a505a', secondary: '#5c6470', accent: '#6b7280', ground: '#3a3f47' },
    backdrop: 'formations',
    baseObjects: [
      ['rock', 'dressing'],
      ['crate', 'dressing'],
    ],
  },
}

// ---------------------------------------------------------------------------
// Time-of-day → lighting intent + atmosphere
// ---------------------------------------------------------------------------

interface TimeLight {
  intent: LightIntent
  hint: IntensityHint
  color: string
  fill: string
  bg: string
  fog: string
  fogNear: number
  fogFar: number
}

const TIME_LIGHTING: Record<SceneTimeOfDay, TimeLight> = {
  dawn: { intent: 'sun', hint: 'moderate', color: '#ffd9a8', fill: '#cdd8f0', bg: '#3a3040', fog: '#4a3a48', fogNear: 9, fogFar: 26 },
  morning: { intent: 'sun', hint: 'moderate', color: '#fff0d8', fill: '#dbeafe', bg: '#2a3448', fog: '#3a4458', fogNear: 12, fogFar: 30 },
  day: { intent: 'sun', hint: 'strong', color: '#ffffff', fill: '#e0f2fe', bg: '#2a3a54', fog: '#3a4a64', fogNear: 14, fogFar: 34 },
  afternoon: { intent: 'sun', hint: 'moderate', color: '#ffe8c8', fill: '#dbe4f0', bg: '#2e3648', fog: '#3e4658', fogNear: 12, fogFar: 30 },
  sunset: { intent: 'sun', hint: 'moderate', color: '#ffb36b', fill: '#c97b52', bg: '#3a2030', fog: '#4a2a38', fogNear: 8, fogFar: 24 },
  evening: { intent: 'moon', hint: 'dim', color: '#d8c8ff', fill: '#8fa8cc', bg: '#141126', fog: '#1e1830', fogNear: 7, fogFar: 22 },
  night: { intent: 'moon', hint: 'dim', color: '#cfe0ff', fill: '#8fa8cc', bg: '#0a0e18', fog: '#12182a', fogNear: 6, fogFar: 22 },
  midnight: { intent: 'moon', hint: 'faint', color: '#bfd4ff', fill: '#7d94bb', bg: '#05070e', fog: '#0a0e1a', fogNear: 5, fogFar: 18 },
  unknown: { intent: 'sun', hint: 'moderate', color: '#fff7ed', fill: '#dbeafe', bg: '#1a2030', fog: '#242c40', fogNear: 10, fogFar: 28 },
}

// ---------------------------------------------------------------------------
// Semantic scale hints (human scale — Section 26)
// ---------------------------------------------------------------------------

/** Approximate real-world size per semantic type (w, h, d in meters). */
const SEMANTIC_SCALE: Record<string, [number, number, number]> = {
  spaceship_wreck: [5.5, 2.6, 7],
  engine_cylinder: [1.2, 1.2, 3],
  debris_field: [0.5, 0.4, 0.5],
  rock: [0.8, 0.6, 0.8],
  rock_formation: [2.4, 3.2, 2],
  crater_rim: [2.6, 0.5, 2.6],
  dune: [4, 1.2, 3],
  tree: [1.6, 4.2, 1.6],
  palm_tree: [1.8, 4.5, 1.8],
  bush: [0.8, 0.6, 0.8],
  plant: [0.5, 1.0, 0.5],
  hedge: [1.4, 0.9, 0.6],
  campfire: [0.9, 0.5, 0.9],
  tent: [2.2, 1.6, 2.2],
  log_seat: [1.4, 0.4, 0.5],
  table: [1.2, 0.75, 0.7],
  chair: [0.5, 0.9, 0.5],
  counter: [2.6, 1.05, 0.7],
  shelf: [1.6, 1.9, 0.4],
  signage: [1.6, 0.9, 0.15],
  screen_panel: [1.4, 0.9, 0.1],
  console: [1.4, 1.1, 0.6],
  workbench: [2.0, 0.95, 0.7],
  lab_machine: [2.2, 2.4, 1.4],
  cabinet: [1.2, 1.0, 0.5],
  bed: [1.0, 0.6, 2.0],
  hospital_bed: [1.0, 0.7, 2.1],
  desk: [1.6, 0.78, 0.8],
  board: [2.0, 1.2, 0.08],
  stone_column: [0.9, 4.2, 0.9],
  altar: [1.6, 1.0, 1.0],
  throne: [1.2, 2.2, 1.0],
  banner: [0.8, 2.4, 0.06],
  torch_sconce: [0.3, 0.9, 0.3],
  rubble: [0.6, 0.35, 0.6],
  crystal: [0.5, 1.1, 0.5],
  stalagmite: [0.7, 1.6, 0.7],
  lamp_post: [0.4, 3.4, 0.4],
  crate: [0.8, 0.8, 0.8],
  bench: [1.7, 0.8, 0.55],
  vehicle_body: [2.0, 1.5, 4.4],
}

// ---------------------------------------------------------------------------
// Template confidence (Phase 2 specialized composers)
// ---------------------------------------------------------------------------

const TEMPLATE_RULES: Array<{ keys: RegExp; kind: TemplateCandidate['kind']; weight: number }> = [
  { keys: /\b(forest|woods|woodland|jungle|grove)\b/, kind: 'forest', weight: 0.9 },
  { keys: /\b(warehouse|depot|storage|factory|industrial|hangar|freight)\b/, kind: 'warehouse', weight: 0.9 },
  { keys: /\b(railway|train\s?station|\bstation\b|platform|subway|metro|tram)\b/, kind: 'railway', weight: 0.9 },
  { keys: /\b(apartment|living\s?room|bedroom|kitchen|\bhome\b|house|loft|condo|flat\b)\b/, kind: 'apartment', weight: 0.85 },
  { keys: /\b(news|broadcast|newsroom|anchor|television|\btv\b|press\s?room)\b/, kind: 'broadcast', weight: 0.9 },
  { keys: /\b(office|cubicle|boardroom|meeting\s?room|server\s?room)\b/, kind: 'office', weight: 0.85 },
  { keys: /\b(street|road\b|avenue|boulevard|downtown|\bcity\b|sidewalk|urban|crosswalk)\b/, kind: 'street', weight: 0.85 },
  { keys: /\b(alley|backstreet|neon\s?alley|rooftop)\b/, kind: 'alley', weight: 0.8 },
]

/**
 * Decide whether an optimized Phase 2 template should be used. A template is
 * chosen only when its keywords hit AND no stronger exotic family signal
 * exists (e.g. "abandoned railway station on Mars" must NOT become railway).
 */
function pickTemplate(lower: string, family: string): TemplateCandidate | null {
  // Exotic families always win over generic urban/nature templates.
  const exotic = ['mars', 'moon', 'desert', 'mountains', 'beach', 'temple', 'castle', 'cave', 'camp', 'waterside', 'garden', 'laboratory', 'hospital', 'school', 'shop', 'cyberpunk', 'scifi_wreck']
  if (exotic.includes(family)) return null

  let best: TemplateCandidate | null = null
  for (const rule of TEMPLATE_RULES) {
    if (rule.keys.test(lower)) {
      if (!best || rule.weight > best.confidence) {
        best = { kind: rule.kind, confidence: rule.weight }
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Object assembly
// ---------------------------------------------------------------------------

let objectIdCounter = 0

function makeObjectId(prefix: string): string {
  objectIdCounter = (objectIdCounter + 1) % 100000
  return `${prefix}_${objectIdCounter}`
}

/** Primitive fallback per semantic type (compound for recognizable silhouettes). */
const TYPE_PRIMITIVE: Record<string, SceneObjectSpec['primitiveFallback']> = {
  spaceship_wreck: 'compound',
  engine_cylinder: 'cylinder',
  debris_field: 'compound',
  rock: 'compound',
  rock_formation: 'compound',
  crater_rim: 'compound',
  dune: 'extrusion',
  tree: 'compound',
  palm_tree: 'compound',
  bush: 'sphere',
  plant: 'compound',
  hedge: 'box',
  campfire: 'compound',
  tent: 'compound',
  log_seat: 'cylinder',
  table: 'compound',
  chair: 'compound',
  counter: 'compound',
  shelf: 'compound',
  signage: 'box',
  screen_panel: 'box',
  console: 'compound',
  workbench: 'compound',
  lab_machine: 'compound',
  cabinet: 'box',
  bed: 'compound',
  hospital_bed: 'compound',
  desk: 'compound',
  board: 'plane',
  stone_column: 'cylinder',
  altar: 'compound',
  throne: 'compound',
  banner: 'plane',
  torch_sconce: 'compound',
  rubble: 'compound',
  crystal: 'compound',
  stalagmite: 'cone',
  lamp_post: 'compound',
  crate: 'box',
  bench: 'compound',
  vehicle_body: 'compound',
}

/** Zone assignment by importance + suggested depth. */
function pickZone(importance: SceneObjectSpec['importance'], z: number): SceneObjectSpec['zone'] {
  if (importance === 'hero') return 'midground'
  if (z < -5) return 'background'
  if (z > -1.5) return 'foreground'
  return 'midground'
}

function buildObjects(
  lower: string,
  family: string,
  details: SceneDetails,
  seed: number
): SceneObjectSpec[] {
  const objects: SceneObjectSpec[] = []
  const seen = new Map<string, number>()

  const push = (
    semanticType: string,
    importance: SceneObjectSpec['importance'],
    tags: string[]
  ): void => {
    const key = semanticType
    const count = seen.get(key) ?? 0
    // Cap duplicates: heroes 1, supporting 3, dressing 6.
    const cap = importance === 'hero' ? 1 : importance === 'supporting' ? 3 : 6
    if (count >= cap) return
    seen.set(key, count + 1)

    const scale = SEMANTIC_SCALE[semanticType] ?? [1, 1, 1]
    // Seeded depth band per importance: heroes −2…−4, supporting −2.5…−6,
    // dressing −1…−7 (all behind the actor line, layout engine refines).
    const rng = mulberryLocal(seed + count * 7919 + semanticType.length * 131)
    const zBase =
      importance === 'hero'
        ? -2.2 - rng() * 1.8
        : importance === 'supporting'
          ? -2.4 - rng() * 3.2
          : -1.2 - rng() * 5.6
    const xBase = (rng() - 0.5) * (importance === 'hero' ? 3.2 : 7.5)

    objects.push({
      id: makeObjectId(semanticType),
      semanticType,
      tags: [semanticType, ...tags],
      importance,
      primitiveFallback: TYPE_PRIMITIVE[semanticType] ?? 'box',
      position: [xBase, 0, zBase],
      rotation: [0, rng() * Math.PI * 2, 0],
      scale: [0.9 + rng() * 0.3, 0.9 + rng() * 0.3, 0.9 + rng() * 0.3],
      zone: pickZone(importance, zBase),
      avoidActors: true,
      cameraImportant: importance !== 'dressing',
    })
  }

  // 1) Concept-declared objects (story-specific nouns).
  for (const concept of CONCEPTS) {
    if (!concept.keys.test(lower)) continue
    for (const [type, importance] of concept.objects ?? []) {
      push(type, importance, [concept.id])
    }
  }

  // 2) Family base objects (fill semantic gaps — every family has dressing).
  const fam = FAMILY_DEFAULTS[family] ?? FAMILY_DEFAULTS.generic
  for (const [type, importance] of fam.baseObjects) {
    push(type, importance, [family])
  }

  // 3) Abandoned stories add scattered debris.
  if (details.abandoned) {
    push('rubble', 'dressing', ['abandoned'])
    push('crate', 'dressing', ['abandoned'])
  }

  // 4) Guarantee at least one hero object so the composition has a focus.
  if (!objects.some((o) => o.importance === 'hero')) {
    const heroType = fam.backdrop === 'formations' ? 'rock_formation' : 'console'
    push(heroType, 'hero', ['auto'])
  }

  return objects
}

/** Tiny local PRNG (same algorithm as mulberry32, kept local to stay pure-data). */
function mulberryLocal(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze arbitrary story text into a ParsedScene.
 *
 * @param text      Story/scene text (title + location + narrative…)
 * @param seedKey   Stable identity for deterministic layout (optional)
 * @param llmGraph  OPTIONAL pre-fetched LLM SceneGraph JSON — when provided it
 *                  is validated/clamped (sceneGraphValidator) and used instead
 *                  of local inference. Invalid LLM output falls back to local.
 */
export function parseSceneGraph(
  text: string,
  seedKey?: string,
  llmGraph?: unknown
): ParsedScene {
  const rawText = text || ''
  const lower = rawText.toLowerCase().replace(/\bstudio stage\b/g, ' ')
  const trace: string[] = []

  // --- LLM path (optional, validated) --------------------------------------
  if (llmGraph !== undefined) {
    const validated = validateSceneGraph(llmGraph)
    if (validated) {
      trace.push('source=llm(validated)')
      return { template: null, sceneGraph: validated, trace }
    }
    trace.push('source=llm(INVALID → local fallback)')
  }

  // --- local deterministic analysis ----------------------------------------
  const details = detectDetails(lower)
  const timeOfDay = detectTimeOfDay(lower)

  // Concept scoring → family.
  const familyScores = new Map<string, number>()
  const activeConcepts: ConceptRule[] = []
  for (const concept of CONCEPTS) {
    if (concept.keys.test(lower)) {
      activeConcepts.push(concept)
      if (concept.family) {
        familyScores.set(concept.family, (familyScores.get(concept.family) ?? 0) + 1)
      }
    }
  }
  // Strongest family signal wins; ties resolved by first-seen order.
  let family = 'generic'
  let bestScore = 0
  for (const [f, s] of familyScores) {
    if (s > bestScore) {
      family = f
      bestScore = s
    }
  }
  trace.push(`concepts=[${activeConcepts.map((c) => c.id).join(',')}]`)
  trace.push(`family=${family}`)

  // Template decision (hybrid strategy).
  const template = pickTemplate(lower, family)
  trace.push(template ? `template=${template.kind}(${template.confidence})` : 'template=none(dynamic)')

  // --- assemble the graph ---------------------------------------------------
  const fam = FAMILY_DEFAULTS[family] ?? FAMILY_DEFAULTS.generic
  const seed = hashString(seedKey || rawText || family)

  // Palette: family base, overridden by concept votes.
  const palette = { ...fam.palette }
  for (const concept of activeConcepts) {
    if (concept.palette) Object.assign(palette, concept.palette)
  }

  // Ground.
  let groundType = fam.ground
  for (const concept of activeConcepts) {
    if (concept.ground) groundType = concept.ground
  }

  // Indoor/outdoor: family default, overridden by explicit concept votes.
  let indoorOutdoor: SceneGraph['environment']['indoorOutdoor'] = fam.indoorOutdoor
  for (const concept of activeConcepts) {
    if (concept.space) indoorOutdoor = concept.space
  }

  // Lighting: time-of-day base, overridden by concept light votes.
  const tl = TIME_LIGHTING[timeOfDay]
  let primaryIntent = tl.intent
  let primaryHint = tl.hint
  let primaryColor = tl.color
  let fillColor = tl.fill
  for (const concept of activeConcepts) {
    if (concept.light) {
      primaryIntent = concept.light.intent
      primaryHint = concept.light.hint
      if (concept.light.color) primaryColor = concept.light.color
    }
  }
  // Cyberpunk/neon stories keep a cool base even at night.
  if (family === 'cyberpunk' && (timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'evening')) {
    primaryColor = '#8ab4ff'
    fillColor = '#22d3ee'
  }

  const lighting: SceneLightSpec[] = [
    {
      id: 'primary',
      role: 'primary',
      intent: primaryIntent,
      color: primaryColor,
      intensityHint: primaryHint,
      castShadows: true,
    },
    {
      id: 'fill',
      role: 'fill',
      intent: 'sky',
      color: fillColor,
      intensityHint: timeOfDay === 'night' || timeOfDay === 'midnight' ? 'faint' : 'dim',
      castShadows: false,
    },
  ]
  // One accent for practicals/neons/fire — represented by emissive props +
  // at most one real light (builder decides).
  if (family === 'cyberpunk' || family === 'shop' || family === 'castle' || family === 'camp' || family === 'cave' || family === 'laboratory') {
    lighting.push({
      id: 'accent',
      role: 'accent',
      intent: family === 'cyberpunk' ? 'neon' : family === 'castle' || family === 'camp' ? 'fire' : 'practical',
      color: palette.accent,
      intensityHint: 'dim',
      castShadows: false,
    })
  }

  // Atmosphere — family-tinted fog/background.
  const atmosphere = {
    backgroundColor: tl.bg,
    fogColor: tl.fog,
    fogNear: tl.fogNear,
    fogFar: tl.fogFar,
    skyType: 'solid' as const,
  }
  // Mars/desert: warm dusty horizon.
  if (family === 'mars' || family === 'desert') {
    atmosphere.backgroundColor = timeOfDay === 'sunset' ? '#4a2418' : '#3a1e14'
    atmosphere.fogColor = timeOfDay === 'sunset' ? '#5c2e1c' : '#4a2818'
    atmosphere.fogNear = 7
    atmosphere.fogFar = 24
  }

  const sceneGraph: SceneGraph = {
    version: SCENE_GRAPH_VERSION,
    environment: {
      type: family,
      indoorOutdoor,
      locationDescription: rawText.slice(0, 120),
    },
    timeOfDay,
    mood: activeConcepts.flatMap((c) => c.mood ?? []),
    palette: { ...palette, background: atmosphere.backgroundColor },
    ground: {
      type: groundType,
      color: palette.ground,
      roughness: 0.95,
      metalness: 0.02,
      relief: groundType === 'sand' || groundType === 'rocky_red_terrain' ? 0.5 : 0.3,
    },
    atmosphere,
    lighting,
    objects: buildObjects(lower, family, details, seed),
    composition: {
      actorSafeRadius: 1.2,
      cameraSafeRadius: 2.55,
      preferredDepth: 8,
      density: details.empty ? 'sparse' : details.crowded ? 'dense' : 'medium',
    },
    details,
    seed,
    source: 'local',
  }

  trace.push(`objects=${sceneGraph.objects.length}`)
  return { template, sceneGraph, trace }
}