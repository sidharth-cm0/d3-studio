/**
 * Semantic Dimensions — PHASE 3 generalization layer (deterministic, local).
 *
 * Instead of selecting one monolithic environment category, story text is
 * projected onto INDEPENDENT reusable dimensions:
 *
 *   terrain       — snow | grass | sand | rock | concrete | metal | water_edge
 *   architecture  — village | city | shop | factory | temple | laboratory | cavern | ruins
 *   condition     — abandoned | ruined | damaged | industrial
 *   weather       — snow | rain | fog | storm
 *   style         — futuristic | cyberpunk | ancient | tropical | industrial | natural
 *   heroProps     — boat | streetlight | machinery | pillars | houses | crystals |
 *                   spaceship | counter | altar | campfire
 *   glowFlora     — glowing vegetation request (emissive plants)
 *
 * DESIGN RULES:
 *  - Every rule matches a generic CATEGORY WORD, never a full prompt. Any
 *    unseen script composes dimensions like "abandoned frozen village during
 *    a snowstorm" → terrain=snow + architecture=village + condition=abandoned
 *    + weather=snow without any prompt-specific branch.
 *  - Pure data in, pure data out: no THREE.js, no renderer values, no RNG.
 *  - Single-value dimensions use FIRST-MATCH-WINS with a deliberate rule
 *    order (more specific surfaces before generic ones).
 */

// ---------------------------------------------------------------------------
// Dimension types
// ---------------------------------------------------------------------------

export type TerrainDim = 'snow' | 'grass' | 'sand' | 'rock' | 'concrete' | 'metal' | 'water_edge'
export type ArchitectureDim =
  | 'village'
  | 'city'
  | 'shop'
  | 'factory'
  | 'temple'
  | 'laboratory'
  | 'cavern'
  | 'ruins'
export type ConditionDim = 'abandoned' | 'ruined' | 'damaged' | 'industrial'
export type WeatherDim = 'snow' | 'rain' | 'fog' | 'storm'
export type StyleDim = 'futuristic' | 'cyberpunk' | 'ancient' | 'tropical' | 'industrial' | 'natural'
export type HeroPropDim =
  | 'boat'
  | 'streetlight'
  | 'machinery'
  | 'pillars'
  | 'houses'
  | 'crystals'
  | 'spaceship'
  | 'counter'
  | 'altar'
  | 'campfire'

export interface SemanticDimensions {
  terrain: TerrainDim | null
  architecture: ArchitectureDim | null
  condition: ConditionDim[]
  weather: WeatherDim | null
  style: StyleDim | null
  heroProps: HeroPropDim[]
  /** Story explicitly asks for glowing vegetation (emissive flora). */
  glowFlora: boolean
}

// ---------------------------------------------------------------------------
// Rule tables — ordered, first match wins for single-value dimensions
// ---------------------------------------------------------------------------

interface DimRule<T extends string> {
  value: T
  keys: RegExp
}

/**
 * TERRAIN — surface material the story stands on.
 * Order: snow (frozen…) → sand (beach/desert…) → water_edge (shore…) →
 * grass → concrete (urban floors) → metal → rock (generic rough ground).
 */
const TERRAIN_RULES: Array<DimRule<TerrainDim>> = [
  { value: 'snow', keys: /\b(snow|snowy|frozen|icy|\bice\b|winter|blizzard|snowfall|glacier|arctic|frigid)\b/ },
  { value: 'sand', keys: /\b(sand|sandy|desert|dune|beach|oasis|sahara)\b/ },
  { value: 'water_edge', keys: /\b(shore|coast|seaside|riverbank|harbor|harbour|dockside|waterside|quay|pier|swamp|marsh|lakeside|riverside)\b/ },
  { value: 'grass', keys: /\b(grass|grassy|meadow|field\b|lawn|prairie|pasture|moor)\b/ },
  { value: 'concrete', keys: /\b(concrete|pavement|sidewalk|plaza|courtyard|parking|tarmac)\b/ },
  { value: 'metal', keys: /\b(metallic\s?floor|steel\s?deck|metal\s?deck|gangway|grating)\b/ },
  { value: 'rock', keys: /\b(rocky|rocks\b|boulder|cliff|cave|cavern|mountain|crag|scree)\b/ },
]

/**
 * ARCHITECTURE — built structure identity.
 * Order: named settlements/structures before generic enclosure words, so
 * "underground factory" resolves to factory (not cavern) and "ancient ruined
 * temple" resolves to temple (not ruins).
 */
const ARCHITECTURE_RULES: Array<DimRule<ArchitectureDim>> = [
  { value: 'village', keys: /\b(village|hamlet|town|settlement|farmstead)\b/ },
  { value: 'city', keys: /\b(city|metropolis|downtown|urban|skyline|megacity)\b/ },
  { value: 'factory', keys: /\b(factory|refinery|foundry|industrial\s?plant|power\s?plant|mill|workshop|forge|shipyard)\b/ },
  { value: 'shop', keys: /\b(shop|store|cafe|café|bakery|diner|tavern|boutique|barbershop|canteen)\b/ },
  { value: 'temple', keys: /\b(temple|shrine|monastery|cathedral|church|pagoda|sanctum)\b/ },
  { value: 'laboratory', keys: /\b(laboratory|lab\b|research\s?facility|containment\s?lab)\b/ },
  { value: 'ruins', keys: /\b(ruins?|remains|collapsed\s?(city|building|structure))\b/ },
  { value: 'cavern', keys: /\b(cave|cavern|grotto|mine|catacomb|sewer|underground|grotto)\b/ },
]

/** CONDITION — state of the place (multi-label; a scene can be abandoned AND ruined). */
const CONDITION_RULES: Array<DimRule<ConditionDim>> = [
  { value: 'ruined', keys: /\b(ruined|ruins|collapsed|crumbling|crumbled|destroyed|razed)\b/ },
  { value: 'abandoned', keys: /\b(abandoned|derelict|deserted|desolate|forgotten|disused|unattended)\b/ },
  { value: 'damaged', keys: /\b(damaged|scarred|burnt|scorched|burned|war-?torn|shattered)\b/ },
  { value: 'industrial', keys: /\b(industrial|machinery|pipework|mechanized|factory-?like)\b/ },
]

/** WEATHER — strongest weather word wins (storm-level words before rain). */
const WEATHER_RULES: Array<DimRule<WeatherDim>> = [
  { value: 'snow', keys: /\b(snowstorm|snowfall|blizzard|snowing|snow\s?(storm|drift)|flurries|\bsnow\b)\b/ },
  { value: 'storm', keys: /\b(storm|stormy|thunder|lightning|gale|tempest|cyclone|hurricane)\b/ },
  { value: 'rain', keys: /\b(rain|rainy|rainstorm|downpour|drizzle|monsoon|pouring)\b/ },
  { value: 'fog', keys: /\b(fog|foggy|mist|misty|haze|hazy)\b/ },
]

/** STYLE — aesthetic era/genre bias (palette + prop flavor). */
const STYLE_RULES: Array<DimRule<StyleDim>> = [
  { value: 'cyberpunk', keys: /\b(cyberpunk|neon[-\s]?lit|dystopian|blade\s?runner)\b/ },
  { value: 'futuristic', keys: /\b(futuristic|future|sci-?fi|high-?tech|holographic|space\s?age|tomorrow)\b/ },
  { value: 'ancient', keys: /\b(ancient|antique|prehistoric|medieval|byzantine|primeval|age-?old)\b/ },
  { value: 'tropical', keys: /\b(tropical|palm[-\s]?tree|jungle|island|exotic|lagoon|paradise)\b/ },
  { value: 'industrial', keys: /\b(industrial|steampunk|mechanical|factory)\b/ },
  { value: 'natural', keys: /\b(natural|wilderness|untouched|organic|verdant)\b/ },
]

/** HERO PROPS — named focal objects (multi-label; every match becomes a hero). */
const HERO_PROP_RULES: Array<DimRule<HeroPropDim>> = [
  { value: 'spaceship', keys: /\b(spaceship|spacecraft|starship|shuttle|rocket|space\s?capsule)\b/ },
  { value: 'boat', keys: /\b(boat|rowboat|canoe|sailboat|skiff|dinghy|fishing\s?boat|\bship\b|wrecked\s?vessel)\b/ },
  { value: 'streetlight', keys: /\b(streetlight|street\s?light|street\s?lamp|lamp\s?post|light\s?pole|gas\s?lamp)\b/ },
  { value: 'machinery', keys: /\b(machinery|machines?\b|engine\b|pump|compressor|turbine|generator|reactor|apparatus)\b/ },
  { value: 'pillars', keys: /\b(pillars?|columns?|obelisk|monolith|colonnade)\b/ },
  { value: 'houses', keys: /\b(houses?|cottages?|huts?|cabins?|farmhouse|buildings?)\b/ },
  { value: 'crystals', keys: /\b(crystals?|gemstones?|\bgems?\b)\b/ },
  { value: 'counter', keys: /\b(counter|reception\s?desk|\bbar\b)\b/ },
  { value: 'altar', keys: /\b(altar|dais|sacrificial\s?stone)\b/ },
  { value: 'campfire', keys: /\b(campfire|bonfire|firepit)\b/ },
]

/** Glowing vegetation — "glowing plants", "bioluminescent moss", etc. */
const GLOW_FLORA_RE =
  /\b(glowing?|bioluminescent|luminous|emissive|glow)\s?(plants?|flora|fungus|fungi|mushrooms?|moss|vegetation|vines|ferns)\b/

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function firstMatch<T extends string>(lower: string, rules: Array<DimRule<T>>): T | null {
  for (const rule of rules) {
    if (rule.keys.test(lower)) return rule.value
  }
  return null

}

function allMatches<T extends string>(lower: string, rules: Array<DimRule<T>>): T[] {
  const out: T[] = []
  for (const rule of rules) {
    if (rule.keys.test(lower)) out.push(rule.value)
  }
  return out
}

/**
 * Project story text onto the reusable semantic dimensions.
 * Deterministic: identical text always yields identical dimensions.
 */
export function extractSemanticDimensions(lower: string): SemanticDimensions {
  const text = (lower || '').toLowerCase()
  return {
    terrain: firstMatch(text, TERRAIN_RULES),
    architecture: firstMatch(text, ARCHITECTURE_RULES),
    condition: allMatches(text, CONDITION_RULES),
    weather: firstMatch(text, WEATHER_RULES),
    style: firstMatch(text, STYLE_RULES),
    heroProps: allMatches(text, HERO_PROP_RULES),
    glowFlora: GLOW_FLORA_RE.test(text),
  }
}

/** Compact trace label for diagnostics. */
export function describeDimensions(d: SemanticDimensions): string {
  const parts: string[] = []
  if (d.terrain) parts.push(`terrain=${d.terrain}`)
  if (d.architecture) parts.push(`arch=${d.architecture}`)
  if (d.condition.length) parts.push(`cond=${d.condition.join('+')}`)
  if (d.weather) parts.push(`weather=${d.weather}`)
  if (d.style) parts.push(`style=${d.style}`)
  if (d.heroProps.length) parts.push(`hero=${d.heroProps.join('+')}`)
  if (d.glowFlora) parts.push('glowFlora')
  return parts.length ? parts.join(',') : 'none'
}