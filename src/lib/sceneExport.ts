// src/lib/sceneExport.ts
//
// Pillar C: Cloud Production Render & Scene Exporter
//
// Defines the ".scene.json" interchange format produced by the D3 web engine
// and consumed by the headless Blender render pipeline (blender/render_scene.py).
// The format is intentionally engine-agnostic: positions/rotations are plain
// numbers (radians, Three.js right-handed Y-up convention), colors are hex
// strings, and time is always seconds from the start of the take (t=0).

export const SCENE_FORMAT_VERSION = '1.0.0'

export type ActorId = 1 | 2
export type ActorRole = 'host' | 'guest'

export interface Vec3Tuple {
  x: number
  y: number
  z: number
}

export interface SceneLightSnapshot {
  type: 'ambient' | 'directional'
  color: string
  intensity: number
  position?: Vec3Tuple
}

export interface SceneStageSnapshot {
  id: string
  name: string
  floorColor: string
  gridColor: string
  keyColor: string
  rimColor: string
}

export interface SceneActorCustomization {
  skinColor: string
  hairColor: string
  shirtColor: string
  hairStyle: 'short' | 'long'
  jawScale: number
  shoulderWidth: number
}

export interface SceneActorBonePose {
  bone: string
  // Euler angles in radians, applied on top of the VRM's rest pose.
  rotation: Vec3Tuple
}

export interface SceneActorSnapshot {
  id: ActorId
  role: ActorRole
  vrmSourceUrl: string
  position: Vec3Tuple
  rotationY: number
  customization: SceneActorCustomization
  // A shallow snapshot of the current procedural idle/gesture pose at
  // export time. The Blender importer uses these as the rig's rest offset;
  // the emote/dialogue timeline below is what actually animates the rig.
  restPose: SceneActorBonePose[]
}

export interface SceneCameraKeyframe {
  time: number // seconds, relative to take start
  shotKey: string
  anchor: string
  radius: number
  phi: number
  theta: number
  fov: number
  rollZ: number
  durationMs: number
  easing: 'cubic_out'
}

export interface SceneDialogueEvent {
  actor: ActorId
  actorRole: ActorRole
  text: string
  startTime: number // seconds
  duration: number // seconds, estimated from word count (Web Speech has no waveform)
}

export interface SceneEmoteEvent {
  actor: ActorId
  name: string
  time: number // seconds
  durationEstimate: number
}

export interface SceneGraphExport {
  formatVersion: string
  generatedAt: string
  fps: number
  durationSeconds: number
  stage: SceneStageSnapshot
  lighting: SceneLightSnapshot[]
  actors: SceneActorSnapshot[]
  cameraTrack: SceneCameraKeyframe[]
  dialogueTimeline: SceneDialogueEvent[]
  emoteTimeline: SceneEmoteEvent[]
}

/** Serializes and triggers a browser download of the given scene graph. */
export function downloadSceneJSON(scene: SceneGraphExport, filename = 'd3-scene.scene.json') {
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Basic structural validation used before export and importable by the Blender script's tests. */
export function validateSceneGraph(scene: SceneGraphExport): string[] {
  const errors: string[] = []
  if (!scene.formatVersion) errors.push('missing formatVersion')
  if (!Array.isArray(scene.actors) || scene.actors.length === 0) errors.push('no actors in scene')
  if (!Array.isArray(scene.cameraTrack)) errors.push('cameraTrack must be an array')
  scene.cameraTrack.forEach((kf, i) => {
    if (kf.time < 0) errors.push(`cameraTrack[${i}].time is negative`)
  })
  scene.dialogueTimeline.forEach((d, i) => {
    if (d.duration <= 0) errors.push(`dialogueTimeline[${i}].duration must be > 0`)
  })
  return errors
}

