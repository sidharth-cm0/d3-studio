/**
 * D3 Studio — Canonical data model
 * Optimized for series / multi-episode continuity while remaining
 * compatible with the dual-VRM runtime (slot 1 / slot 2).
 */

import {
  SceneCameraKeyframe,
  SceneDialogueEvent,
  SceneEmoteEvent,
} from '../lib/sceneExport'

export type D3Emotion =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'suspicious'
  | 'sad'
  | 'surprised'
  | 'focused'

export type D3Gesture =
  | 'wave'
  | 'bow'
  | 'thumbs'
  | 'none'
  | 'look_around'
  | 'turn_head'
  | 'point'
  | 'shrug'
  | 'nod'

export type D3CameraShotKey =
  | 'two_shot_wide'
  | 'close_up'
  | 'actor2_close'
  | 'low_angle'
  | 'dutch_angle'
  | 'over_shoulder'

export type D3StagePresetId = 'cyberpunk' | 'broadcast' | 'minimal'

export type D3TimeOfDay =
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'dusk'
  | 'night'
  | 'midnight'
  | 'interior'

export type RuntimeActorSlot = 1 | 2

export interface D3Project {
  id: string
  stableId?: string
  name: string
  version: string
  createdAt: string
  updatedAt: string
  series: D3Series
  visualStyle?: 'cyberpunk' | 'broadcast' | 'minimal' | 'cinematic_pbr'
  toneRules?: string[]
}

export interface D3Series {
  id: string
  stableId?: string
  title: string
  version?: string
  bible: D3SeriesBible
  episodes: D3Episode[]
  createdAt?: string
  updatedAt?: string
}

export interface D3SeriesBible {
  stableId?: string
  version?: string
  logline: string
  visualStyle: 'cyberpunk' | 'broadcast' | 'minimal' | 'cinematic_pbr'
  characters: D3Character[]
  locations: D3Location[]
  toneRules: string[]
}

export interface D3CharacterCustomization {
  skinColor: string
  hairColor: string
  shirtColor: string
  hairStyle: 'short' | 'long'
  jawScale: number
  shoulderWidth: number
}

export interface D3VoiceProfile {
  pitch: number
  rate: number
  preferredVoiceName?: string
}

export interface D3AnimationProfile {
  idleIntensity: number
  gestureBias: D3Gesture[]
  defaultEmotion: D3Emotion
}

/**
 * Character is a first-class identity.
 * `name` is required for UI, dialogue assignment, and cast display.
 * `continuityKey` ties the same person across scenes/episodes.
 */
export interface D3Character {
  id: string
  /** Display name — REQUIRED (UI, cast labels, speaker matching) */
  name: string
  stableId?: string
  continuityKey: string
  tags: string[]
  role: 'host' | 'guest' | 'actor1' | 'actor2' | 'lead' | 'supporting' | 'extra'
  description: string
  personality?: string
  appearance?: string
  vrmAssetUrl: string
  customization: D3CharacterCustomization
  voiceProfile: D3VoiceProfile
  animationProfile?: D3AnimationProfile
  preferredSlot?: RuntimeActorSlot
}

export interface CastSlotAssignment {
  characterId: string
  slot: RuntimeActorSlot
  displayName: string
}

export interface CharacterLibraryState {
  characters: D3Character[]
  activeCast: CastSlotAssignment[]
}

export interface D3LightingPreset {
  keyColor: string
  rimColor: string
  ambientIntensity: number
}

export interface D3Location {
  id: string
  stableId?: string
  name: string
  description?: string
  presetStageId: D3StagePresetId
  lightingPreset: D3LightingPreset
  timeOfDay?: D3TimeOfDay
}

export interface D3Episode {
  id: string
  stableId?: string
  seriesId: string
  episodeNumber: number
  title: string
  synopsis: string
  estimatedDuration: number
  scenes: D3Scene[]
  characters?: D3Character[]
  /**
   * Episode-level location registry. Scenes reference entries by `locationId`
   * (stable IDs) so the same physical location is reused across scenes instead
   * of duplicated per scene.
   */
  locations?: D3Location[]
  castSlots?: CastSlotAssignment[]
  narrativeGoals?: string[]
  audioCues?: Array<{ time: number; effectName: string }>
  continuesFrom?: string
}

export interface D3Scene {
  id: string
  sceneNumber: number
  title?: string
  locationId: string
  stableId?: string
  castIds: string[]
  narrativeGoal: string
  emotionalTone: string
  shots: D3Shot[]
  timeOfDay?: D3TimeOfDay
  transition?: {
    type: 'location' | 'emotion' | 'time' | 'shot'
    trigger: string
    durationMs: number
  }
}

export interface D3ActionDirective {
  actorId: string
  type: string
  description: string
  duration?: number
}

export interface D3CameraDirective {
  shotKey: D3CameraShotKey | string
  anchor: string
  transitionDurationMs: number
  rollZ?: number
}

export interface D3AudioDirective {
  ambientTrack?: string
  soundEffects?: Array<{ time: number; effectName: string }>
  dialogueAudioUrl?: string
  musicCue?: string
}

export interface D3DialogueLine {
  speakerId: string
  text: string
  estimatedDuration?: number
}

export interface D3Performance {
  source: 'AI' | 'USER'
  emotion: D3Emotion
  gesture?: D3Gesture
  blendshapeTrack?: Array<{ time: number; blendshapes: Record<string, number> }>
  headRotationTrack?: Array<{ time: number; quaternion: [number, number, number, number] }>
  performanceClipId?: string
}

export interface D3Shot {
  id: string
  shotNumber: number
  narrativeBeat?: string
  camera: D3CameraDirective
  duration: number
  dialogue?: D3DialogueLine
  actions?: D3ActionDirective[]
  performances: Record<string, D3Performance>
  audio?: D3AudioDirective
  transition?: 'cut' | 'dissolve' | 'fade'
}

export interface D3TimelineCompilation {
  cameraTrack: SceneCameraKeyframe[]
  dialogueTimeline: SceneDialogueEvent[]
  emoteTimeline: SceneEmoteEvent[]
  durationSeconds: number
}

/** Scene duration = sum of its shot durations (shots are the smallest timing unit). */
export function getSceneDuration(scene: D3Scene): number {
  return scene.shots.reduce((sum, shot) => sum + (shot.duration || 0), 0)
}

/** Episode duration = sum of scene durations (never stored independently). */
export function getEpisodeDuration(episode: Pick<D3Episode, 'scenes'>): number {
  return episode.scenes.reduce((sum, scene) => sum + getSceneDuration(scene), 0)
}

export interface StoryBeatAnalysis {
  beat: string
  speaker?: string
  dialogue?: string
  action?: string
  emotion?: D3Emotion
  gesture?: D3Gesture
  cameraShot?: D3CameraShotKey
  stageId?: D3StagePresetId
}

export interface StoryAnalysisResult {
  genre: string
  premise: string
  characters: string[]
  keyLocations: string[]
  beats: StoryBeatAnalysis[]
}

export function validateStoryAnalysis(analysis: unknown): string[] {
  const errors: string[] = []
  if (!analysis || typeof analysis !== 'object') {
    return ['Story analysis must be a valid non-null object']
  }
  const a = analysis as Partial<StoryAnalysisResult>
  if (!a.genre) errors.push('Missing genre in analysis')
  if (!a.premise) errors.push('Missing premise in analysis')
  if (!Array.isArray(a.beats) || a.beats.length === 0) {
    errors.push('Story analysis must contain at least one beat')
  }
  return errors
}

export function validateD3Episode(episode: unknown): string[] {
  const errors: string[] = []
  if (!episode || typeof episode !== 'object') {
    errors.push('Episode must be a non-null object')
    return errors
  }

  const ep = episode as Partial<D3Episode>
  if (!ep.id) errors.push('Missing episode id')
  if (!ep.title) errors.push('Missing episode title')
  if (!Array.isArray(ep.scenes) || ep.scenes.length === 0) {
    errors.push('Episode must contain at least one scene')
  } else {
    ep.scenes.forEach((scene, sIdx) => {
      if (!scene.id) errors.push(`Scene at index ${sIdx} is missing an id`)
      if (!Array.isArray(scene.shots) || scene.shots.length === 0) {
        errors.push(`Scene ${scene.id || sIdx} must contain at least one shot`)
      } else {
        scene.shots.forEach((shot, shIdx) => {
          if (!shot.id) errors.push(`Shot at index ${shIdx} in scene ${scene.id} is missing an id`)
          if (typeof shot.duration !== 'number' || shot.duration <= 0) {
            errors.push(`Shot ${shot.id || shIdx} has invalid duration (must be > 0)`)
          }
          if (!shot.camera || !shot.camera.shotKey) {
            errors.push(`Shot ${shot.id || shIdx} is missing camera directive`)
          }
        })
      }
    })
  }

  return errors
}

export function validateD3Project(project: unknown): string[] {
  const errors: string[] = []
  if (!project || typeof project !== 'object') {
    return ['Project must be a non-null object']
  }
  const p = project as Partial<D3Project>
  if (!p.id) errors.push('Missing project id')
  if (!p.series) errors.push('Missing series in project')
  return errors
}

/** Ensure character has continuityKey + tags + name */
export function normalizeCharacter(
  c: Partial<D3Character> & { id: string; name: string }
): D3Character {
  return {
    id: c.id,
    name: c.name,
    stableId: c.stableId,
    continuityKey: c.continuityKey || c.id,
    tags: c.tags || [],
    role: c.role || 'lead',
    description: c.description || c.name,
    personality: c.personality,
    appearance: c.appearance,
    vrmAssetUrl: c.vrmAssetUrl || '/avatar.vrm',
    customization: c.customization || {
      skinColor: '#6e473b',
      hairColor: '#140f0c',
      shirtColor: '#2563eb',
      hairStyle: 'short',
      jawScale: 1.08,
      shoulderWidth: 1.12,
    },
    voiceProfile: c.voiceProfile || { pitch: 1, rate: 0.98 },
    animationProfile: c.animationProfile,
    preferredSlot: c.preferredSlot,
  }
}
