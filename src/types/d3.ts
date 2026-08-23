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

export interface D3Project {
  id: string
  name: string
  version: string
  createdAt: string
  updatedAt: string
  series: D3Series
}

export interface D3Series {
  id: string
  title: string
  bible: D3SeriesBible
  episodes: D3Episode[]
}

export interface D3SeriesBible {
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

/** Runtime engine still has two VRM slots; library maps characters onto them. */
export type RuntimeActorSlot = 1 | 2

export interface D3AnimationProfile {
  idleIntensity: number
  gestureBias: D3Gesture[]
  defaultEmotion: D3Emotion
}

export interface D3Character {
  id: string
  name: string
  /** Legacy labels kept for export / Host-Guest scripts */
  role: 'host' | 'guest' | 'actor1' | 'actor2' | 'lead' | 'supporting' | 'extra'
  description: string
  personality?: string
  appearance?: string
  vrmAssetUrl: string
  customization: D3CharacterCustomization
  voiceProfile: D3VoiceProfile
  animationProfile?: D3AnimationProfile
  /** Preferred runtime slot when cast is larger than 2 (1 = primary, 2 = secondary) */
  preferredSlot?: RuntimeActorSlot
}

/**
 * Maps abstract character IDs onto the current dual-VRM engine slots.
 * Slot 1 = primary / former Host, Slot 2 = secondary / former Guest.
 */
export interface CastSlotAssignment {
  characterId: string
  slot: RuntimeActorSlot
  displayName: string
}

export interface CharacterLibraryState {
  characters: D3Character[]
  /** Active assignment for the current episode/scene (max 2 on current engine) */
  activeCast: CastSlotAssignment[]
}

export interface D3LightingPreset {
  keyColor: string
  rimColor: string
  ambientIntensity: number
}

export interface D3Location {
  id: string
  name: string
  description?: string
  presetStageId: D3StagePresetId
  lightingPreset: D3LightingPreset
}

export interface D3Episode {
  id: string
  seriesId: string
  episodeNumber: number
  title: string
  synopsis: string
  estimatedDuration: number
  scenes: D3Scene[]
  /** Episode-level cast snapshot (subset of Series Bible characters) */
  characters?: D3Character[]
  /** Resolved slot map for the dual-actor runtime */
  castSlots?: CastSlotAssignment[]
}

export interface D3Scene {
  id: string
  sceneNumber: number
  title?: string
  locationId: string
  castIds: string[]
  narrativeGoal: string
  emotionalTone: string
  shots: D3Shot[]
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
}

export interface D3TimelineCompilation {
  cameraTrack: SceneCameraKeyframe[]
  dialogueTimeline: SceneDialogueEvent[]
  emoteTimeline: SceneEmoteEvent[]
  durationSeconds: number
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

