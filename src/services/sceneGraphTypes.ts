/**
 * D3 Studio — Phase 3
 * Scene Graph Type Definitions
 *
 * Strongly-typed representation of a semantic environment scene graph.
 * All AI/LLM output must be validated and normalized into these types
 * before it can influence Three.js rendering.
 */

/** Schema version for the scene graph format. */
export const SCENE_GRAPH_VERSION = 1

export type IndoorOutdoor = "indoor" | "outdoor" | "mixed" | "unknown"

export type SceneTimeOfDay =
  | "dawn"
  | "morning"
  | "day"
  | "afternoon"
  | "sunset"
  | "evening"
  | "night"
  | "midnight"
  | "unknown"

export type SkyType = "solid" | "gradient" | "procedural" | "hdri"

export type SceneImportance = "hero" | "supporting" | "dressing"

export type PrimitiveFallback =
  | "box"
  | "cylinder"
  | "cone"
  | "sphere"
  | "plane"
  | "extrusion"
  | "compound"

export type SceneZone = "foreground" | "midground" | "background"

export type SceneDensity = "sparse" | "medium" | "dense"

/** Semantic light intent — what kind of lighting the scene wants. */
export type LightIntent =
  | "sun"
  | "moon"
  | "sky"
  | "practical"
  | "neon"
  | "fire"
  | "studio"
  | "screen"

/** Coarse intensity band for a light (clamped to render range by the builder). */
export type IntensityHint = "faint" | "dim" | "moderate" | "strong" | "harsh"

/** Role in the lighting rig — at most one light per role (≤3 active). */
export type LightRole = "primary" | "fill" | "accent"

export interface SceneLightSpec {
  id: string
  role: LightRole
  intent: LightIntent
  color: string
  intensityHint: IntensityHint
  castShadows: boolean
  position?: [number, number, number]
  target?: [number, number, number]
  shadowMapSize?: number
  shadowCameraBounds?: {
    left: number
    right: number
    top: number
    bottom: number
    near: number
    far: number
  }
  range?: number
  angle?: number
  penumbra?: number
  decay?: number
}

export interface SceneObjectSpec {
  id: string
  semanticType: string
  tags: string[]
  importance: SceneImportance
  preferredAsset?: string
  primitiveFallback: PrimitiveFallback
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  color?: string
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
  zone: SceneZone
  avoidActors: boolean
  cameraImportant: boolean
  /** Optional semantic hint for compound procedural builders */
  compoundHint?: string
}

/**
 * Typed spatial relation between two scene entities.
 *
 * A relation references entity IDs (SceneObjectSpec.id). The subject is the
 * entity being described; the object is the reference entity. Relations are
 * preserved as structured data so the spatial layout engine can resolve them
 * geometrically instead of losing the relationship during XYZ placement.
 */
export type SceneRelationType =
  | 'near'
  | 'far'
  | 'leftOf'
  | 'rightOf'
  | 'inFrontOf'
  | 'behind'
  | 'onTopOf'
  | 'inside'
  | 'around'
  | 'facing'
  | 'alignedWith'

export interface SceneRelation {
  type: SceneRelationType
  /** Entity ID of the subject (the entity being described). */
  subject: string
  /** Entity ID of the object (the reference entity). */
  object: string
}

/** Story-aware detail flags extracted from generic keywords. */
export interface SceneDetails {
  abandoned: boolean
  rain: boolean
  luxury: boolean
  crowded: boolean
  empty: boolean
  old: boolean
}

export interface SceneGraph {
  version: number
  environment: {
    type: string
    subtype?: string
    indoorOutdoor: IndoorOutdoor
    locationDescription: string
  }
  timeOfDay: SceneTimeOfDay
  mood: string[]
  palette: {
    primary: string
    secondary: string
    accent: string
    ground: string
    background: string
  }
  ground: {
    type: string
    color: string
    roughness: number
    metalness: number
    relief?: number
  }
  atmosphere: {
    backgroundColor: string
    fogColor: string
    fogNear: number
    fogFar: number
    skyType: SkyType
    hdriTag?: string
  }
  lighting: SceneLightSpec[]
  objects: SceneObjectSpec[]
  /** Typed spatial relations between entities (subject → object). */
  relations: SceneRelation[]
  composition: {
    actorSafeRadius: number
    cameraSafeRadius: number
    preferredDepth: number
    density: SceneDensity
  }
  /** Story-aware detail flags (abandoned, rain, luxury, crowded, empty, old). */
  details: SceneDetails
  /** Deterministic seed for reproducible generation */
  seed: number
  /** Source text that produced this graph */
  sourceText?: string
  /** Whether this came from LLM or local fallback */
  source: "llm" | "local" | "template"
  /** Template confidence if a specialized template matched */
  templateConfidence?: number
  /** Matched template name if applicable */
  templateName?: string
}

/** Validated + normalized scene graph ready for rendering */
export type ValidatedSceneGraph = SceneGraph

/** Result of semantic asset matching */
export interface AssetMatchResult {
  assetId: string | null
  assetPath: string | null
  assetType: "glb" | "gltf" | "procedural" | null
  score: number
  matchedTags: string[]
  fallbackPrimitive: PrimitiveFallback
  fallbackCompoundHint?: string
}

/** Asset manifest entry */
export interface AssetManifestEntry {
  id: string
  path: string
  type: "glb" | "gltf" | "procedural"
  tags: string[]
  scaleHint?: [number, number, number]
  footprint?: [number, number]
  orientation?: "face_camera" | "upright" | "flat" | "random"
  environmentTags?: string[]
  materialTags?: string[]
}

export interface AssetManifest {
  assets: AssetManifestEntry[]
}

/** Environment generation diagnostics */
export interface EnvironmentDiagnostics {
  generator: "dynamic" | "template"
  sceneGraphVersion: number
  seed: number
  environmentType: string
  objectCount: number
  heroObjectCount: number
  meshCount: number
  instanceCount: number
  drawCallEstimate: number
  frustumVisibleRatio: number
  collisionViolations: number
  occlusionViolations: number
  assetMatchStats: {
    total: number
    matched: number
    procedural: number
    failed: number
  }
  generationTimeMs: number
}

/** Seeded PRNG interface */
export interface SeededRandom {
  (): number
  seed: number
}

/** A template candidate from Phase 2 specialized composers. */
export interface TemplateCandidate {
  kind: string
  confidence: number
}

/** Result of parsing story text into a scene graph. */
export interface ParsedScene {
  template: TemplateCandidate | null
  sceneGraph: SceneGraph
  trace: string[]
}

/** Semantic concept detection result from local fallback */
export interface LocalConceptResult {
  environmentType: string
  indoorOutdoor: IndoorOutdoor
  timeOfDay: SceneTimeOfDay
  mood: string[]
  groundType: string
  groundColor: string
  palette: SceneGraph["palette"]
  objectRequirements: Array<{
    semanticType: string
    tags: string[]
    importance: SceneImportance
    zone: SceneZone
    compoundHint?: string
  }>
  lightingIntent: {
    primary: "sun" | "moon" | "studio" | "warm" | "cool" | "neon"
    fill: "ambient" | "hemisphere" | "none"
    accent: "none" | "practical" | "neon" | "window"
  }
  skyType: SkyType
  fogDensity: "none" | "light" | "medium" | "heavy"
  density: SceneDensity
}
