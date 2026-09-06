import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import * as TWEEN from '@tweenjs/tween.js'
import {
  SCENE_FORMAT_VERSION,
  SceneGraphExport,
  SceneCameraKeyframe,
  SceneDialogueEvent,
  SceneEmoteEvent,
  ActorId,
  downloadSceneJSON,
  validateSceneGraph,
} from './lib/sceneExport'
import { D3Episode, D3Scene, D3Shot, D3StagePresetId, D3TimelineCompilation } from './types/d3'
import { AIDirectorService } from './services/aiDirector'
import {
  EnvironmentResolverService,
  type ResolvedEnvironment,
} from './services/environmentResolver'
import { disposeObjectDeep, buildEnvironmentGroup } from './services/environmentStage'
import { runEnvironmentSelfTest, logRuntimeEnvTrace } from './services/environmentSelfTest'
import { parseSceneGraph } from './services/sceneGraphParser'
import { matchAssetsSync } from './services/semanticAssetMatcher'
import { planLayout } from './services/spatialLayoutEngine'
import { buildDynamicEnvironment } from './services/dynamicEnvironment'
import type { SceneGraph } from './services/sceneGraphTypes'
import { CharacterLibraryService } from './services/characterLibrary'
import { resolveCharacterPresence, presenceToVisibility, type CharacterPresence } from './services/characterPresence'
import { TimelineEditor } from './components/TimelineEditor'
import { PerformanceRecorder } from './services/performanceRecorder'
import type { VisualStyle } from './services/visualStyle'
import { getVisualStylePreset, VISUAL_STYLE_OPTIONS } from './services/visualStyle'
import { VisualStyleController, SteppedAnimationClock } from './services/visualStyleController'
import type { D3Performance } from './types/d3'
import './styles/design-system.css'
import './App.css'
import { Button } from './components/ui/Button'
import { D3CinematicIntro, type D3IntroMode } from './components/D3CinematicIntro'

// Reuse the browser HTTP/memory cache across VRM loads so React StrictMode's
// double initial mount (and any repeat load of the same URL) never triggers a
// duplicate network download + GLTF parse of the same model.
THREE.Cache.enabled = true

export type LockAnchor =
  | 'actor1_head'
  | 'actor1_chest'
  | 'actor2_head'
  | 'actor2_chest'
  | 'stage_center'

export interface CameraShotConfig {
  name: string
  anchor: LockAnchor
  radius: number
  phi: number
  theta: number
  fov: number
  rollZ?: number
}

export interface StageConfig {
  id: string
  name: string
  floorColor: number
  gridColor: number
  keyColor: string
  rimColor: string
}

interface DynamicStageOverride {
  group: THREE.Group
  sceneGraph: SceneGraph
  signature: string
}

/** Public sample VRM used when /avatar.vrm is missing from public/ */
const DEFAULT_VRM_URL =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@v3.1.4/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

/** Quaternius plain glTF character models (no VRM metadata — loaded via gltf.scene). */
const MALE_GLTF_URL = '/characters/quaternius/Superhero_Male_FullBody.gltf'
const FEMALE_GLTF_URL = '/characters/quaternius/Superhero_Female_FullBody.gltf'

/** Quaternius Universal Animation Library (43 clips, identical 65-joint rig). */
const ANIM_LIBRARY_URL = '/animations/quaternius/UAL1_Standard.glb'
/** Clip bound + auto-played on every successfully loaded Quaternius actor. */
const IDLE_CLIP_NAME = 'Idle_Loop'

/** Locomotion clips (Quaternius Universal Animation Library). */
const CLIP_WALK = 'Walk_Loop'
const CLIP_JOG = 'Jog_Fwd_Loop'
const CLIP_SPRINT = 'Sprint_Loop'

/** Destination-action clips (Quaternius Universal Animation Library). */
const CLIP_SITTING_ENTER = 'Sitting_Enter'
const CLIP_SITTING_IDLE = 'Sitting_Idle_Loop'
const CLIP_SITTING_EXIT = 'Sitting_Exit'
const CLIP_INTERACT = 'Interact'
const CLIP_IDLE_TALKING = 'Idle_Talking_Loop'
/** How long the talk action loops before returning to Idle_Loop (ms). */
const TALK_DURATION_MS = 3000
/**
 * Approx. hip height of the Quaternius sitting pose above the model root —
 * lowers the model root so the character's hips rest ON the seat surface
 * (heuristic, tunable; grounded models have no other Y offset to preserve).
 */
const SIT_HIP_OFFSET = 0.4

/** Conservative locomotion presets: speed (units/sec) + travel distance. */
const LOCOMOTION_PRESETS: Record<string, { speed: number; distance: number }> = {
  [CLIP_WALK]: { speed: 0.7, distance: 2.0 },
  [CLIP_JOG]: { speed: 1.2, distance: 2.5 },
  [CLIP_SPRINT]: { speed: 2.0, distance: 3.0 },
}
/** Locomotion never translates an actor past this Z — stays visible on stage. */
const LOCOMOTION_Z_MAX = 2.0

/**
 * Scene-aware locomotion targets (whitelist for this first task) + safe
 * stopping radii — the actor stops this far BEFORE the target, never in it.
 */
const LOCOMOTION_TARGET_RADII: Record<string, number> = {
  door: 0.9,
  table: 1.2,
  chair: 0.9,
  sofa: 1.2,
  lamp: 0.8,
  crate: 0.9,
  machinery: 1.3,
}
/** Arrival threshold — within this distance of the destination, stop. */
const LOCOMOTION_ARRIVE_EPSILON = 0.05
/** Deterministic side offsets so both actors never overlap at one target. */
const LOCOMOTION_SIDE_OFFSET_ACTOR1 = -0.45
const LOCOMOTION_SIDE_OFFSET_ACTOR2 = 0.45

const STAGE_PRESETS: Record<string, StageConfig> = {
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk Stage',
    floorColor: 0x090a0f,
    gridColor: 0x4a4a4a,
    keyColor: '#f2f2f2',
    rimColor: '#a0a0a0',
  },
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast Newsroom',
    floorColor: 0x1e293b,
    gridColor: 0x4a4a4a,
    keyColor: '#f2f2f2',
    rimColor: '#a0a0a0',
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal Clean',
    floorColor: 0x0f172a,
    gridColor: 0x4a4a4a,
    keyColor: '#f2f2f2',
    rimColor: '#a0a0a0',
  },
}

const CINEMATIC_SHOTS: Record<string, CameraShotConfig> = {
  // Framing safety pass: radii/FOV chosen so heads keep hair margin inside
  // frame, and the wide shot holds BOTH actors anywhere in the safe zone.
  two_shot_wide: { name: 'Stage Two-Shot (Wide)', anchor: 'stage_center', radius: 3.4, phi: Math.PI / 2.15, theta: 0, fov: 46 },
  close_up: { name: 'Lead Close Up', anchor: 'actor1_head', radius: 0.86, phi: Math.PI / 2.05, theta: 0, fov: 30 },
  actor2_close: { name: 'Supporting Close Up', anchor: 'actor2_head', radius: 0.88, phi: Math.PI / 2.05, theta: -0.15, fov: 30 },
  low_angle: { name: 'Hero Low Angle', anchor: 'actor1_chest', radius: 1.1, phi: Math.PI / 1.65, theta: 0.08, fov: 34 },
  dutch_angle: { name: 'Dutch Angle', anchor: 'actor1_head', radius: 0.9, phi: Math.PI / 2.05, theta: -0.25, fov: 31, rollZ: 0.18 },
  over_shoulder: { name: 'Over Shoulder (OTS)', anchor: 'actor1_chest', radius: 1.0, phi: Math.PI / 2.2, theta: Math.PI * 0.7, fov: 32 },
}

// ---------------------------------------------------------------------------
// Story motion — visible primitive movement driven by shot action directives.
// Root translation + yaw only (no IK); consumed by the existing render loop.
// ---------------------------------------------------------------------------

/** Actor safe zone — root motion and staging never leave this rectangle. */
const STAGE_SAFE_X = 2.5
const STAGE_SAFE_Z_MIN = -1.5
const STAGE_SAFE_Z_MAX = 2.5

type StoryMotionKind = 'walk' | 'step_back' | 'turn' | 'face_other'

interface ActorMotionState {
  kind: StoryMotionKind
  startedAt: number
  duration: number
  startPos: THREE.Vector3
  targetPos: THREE.Vector3
  startYaw: number
  targetYaw: number
}

/** One chained action executed after an actor reaches its destination. */
type PostArrivalAction = 'sit' | 'interact' | 'talk'

/** Locomotion request parked while a seated actor plays Sitting_Exit. */
interface PendingPostExitLocomotion {
  clipName: string
  targetType: string | null
  sideOffset: number
  postAction: PostArrivalAction | null
}

/**
 * Deterministic locomotion state for one Quaternius actor (manual root
 * translation, optional scene target, optional ONE post-arrival action).
 */
interface QuaterniusLocomotionState {
  active: boolean
  speed: number
  remainingDistance: number
  currentClipName: string
  /** Scene-aware destination (actor-parent space); null → fixed forward distance. */
  targetPosition: THREE.Vector3 | null
  targetName: string | null
  /** Chained action executed once the destination is reached. */
  postArrivalAction: PostArrivalAction | null
  /** Talk-action return-to-idle timer (cancelled if superseded). */
  actionTimeoutId: number | null
  /** Locomotion requested by Generate before the model finished loading. */
  pendingClip: string | null
  pendingTargetType: string | null
  pendingSideOffset: number
  pendingPostArrivalAction: PostArrivalAction | null
  /** Explicit seated state (set only after Sitting_Enter → Sitting_Idle_Loop). */
  isSeated: boolean
  seatTarget: THREE.Object3D | null
  seatType: string | null
  /** Safe pre-seat standing position + yaw, restored after Sitting_Exit. */
  preSeatPosition: THREE.Vector3 | null
  preSeatYaw: number | null
  /** Sitting_Exit in flight; the latest post-exit locomotion request wins. */
  isStandingUp: boolean
  pendingPostExitLoco: PendingPostExitLocomotion | null
}

function createLocomotionState(): QuaterniusLocomotionState {
  return {
    active: false,
    speed: 0,
    remainingDistance: 0,
    currentClipName: IDLE_CLIP_NAME,
    targetPosition: null,
    targetName: null,
    postArrivalAction: null,
    actionTimeoutId: null,
    pendingClip: null,
    pendingTargetType: null,
    pendingSideOffset: 0,
    pendingPostArrivalAction: null,
    isSeated: false,
    seatTarget: null,
    seatType: null,
    preSeatPosition: null,
    preSeatYaw: null,
    isStandingUp: false,
    pendingPostExitLoco: null,
  }
}

/**
 * Basic story-verb → locomotion clip resolution (Quaternius actors only).
 * Ordered fastest → slowest so "runs into the room" wins over walk mentions.
 */
function resolveLocomotionClip(text: string): string | null {
  if (!text) return null
  const d = text.toLowerCase()
  if (/\b(run|runs|running|sprint|sprints)\b/.test(d)) return CLIP_SPRINT
  if (/\b(jog|jogs|jogging)\b/.test(d)) return CLIP_JOG
  if (/\b(walk|walks|walking|enter|enters)\b/.test(d)) return CLIP_WALK
  return null
}

/**
 * Deterministic locomotion TARGET parser ("walks to the door" → 'door').
 * Only the whitelisted target types are supported; anything else returns null
 * and the existing fixed-distance locomotion is preserved.
 */
function resolveLocomotionTarget(text: string): string | null {
  if (!text) return null
  const d = text.toLowerCase()
  for (const t of Object.keys(LOCOMOTION_TARGET_RADII)) {
    // "to the door" / "toward the table" / "over to the sofa" / "into the crate"
    if (new RegExp(`\\b(?:to|toward|towards|into)\\s+(?:the|a|an)\\s+${t}s?\\b`, 'i').test(d)) {
      return t
    }
  }
  return null
}

/**
 * Deterministic post-arrival action parser ("walks to the chair and sits" →
 * 'sit'). One action max, word-boundary matched, no LLM.
 */
function resolvePostArrivalAction(text: string): PostArrivalAction | null {
  if (!text) return null
  const d = text.toLowerCase()
  if (/\b(sit|sits|sitting)\b/.test(d)) return 'sit'
  if (/\b(interact|interacts|use|uses|touch|touches)\b/.test(d)) return 'interact'
  if (/\b(talk|talks|talking|speak|speaks)\b/.test(d)) return 'talk'
  return null
}

/** Human actor target types for actor-to-actor locomotion (lookup only). */
type ActorTargetType = 'man' | 'woman'

/**
 * Actor-to-actor target detection ("walks to the woman" → 'woman').
 * Matches ONLY after a direction phrase (to / toward / towards / over to), so
 * the sentence subject ("A man walks…") is never mistaken for the target.
 * 'male' normalizes to 'man' and 'female' to 'woman'. Prop targets
 * (door/table/chair/sofa/lamp/crate/machinery) are classified separately by
 * resolveLocomotionTarget and remain unchanged.
 */
function resolveLocomotionActorTarget(text: string): ActorTargetType | null {
  if (!text) return null
  const d = text.toLowerCase()
  const re =
    /\b(?:to|toward|towards|over\s+to)\s+(?:the|a|an)\s+(men|man|male|males|woman|women|female|females)\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(d)) !== null) {
    const word = match[1]
    if (word === 'man' || word === 'men' || word === 'male' || word === 'males') return 'man'
    if (word === 'woman' || word === 'women' || word === 'female' || word === 'females') {
      return 'woman'
    }
  }
  return null
}

/**
 * Map a free-form action description onto a visible primitive motion.
 * Ordered so specific intents win over generic verbs ("turns toward her"
 * → face_other, not turn).
 */
function classifyStoryAction(desc: string): StoryMotionKind | null {
  const d = desc.toLowerCase()
  if (/\b(steps?|stepping)\s+(back|backward)\b|\brecoils?\b|\bretreats?\b|\bbacks?\s+away\b/.test(d)) return 'step_back'
  if (/\bturns?\s+toward\b|\bturned\s+toward\b|\bturns?\s+to\b|\bfaces?\b|\blooks?\s+toward\b/.test(d)) return 'face_other'
  if (/\bturns?\b|\bturned\b|\bspins?\s+around\b|\bwhirls?\b/.test(d)) return 'turn'
  if (/\bwalks?\b|\bwalking\b|\benters?\b|\bapproaches?\b|\bmoves?\s+forward\b|\badvances?\b|\bcrosses?\b|\bsteps?\s+forward\b|\bprowls?\b|\bcreeps?\b/.test(d)) return 'walk'
  return null
}

const STORY_PRESETS: { label: string; prompt: string }[] = [
  { label: 'Noir Mystery', prompt: "A detective enters an abandoned warehouse at midnight. He slowly walks forward, looks around suspiciously, hears a noise behind him, turns around and says, 'Who's there?'" },
  { label: 'Cyber Infiltration', prompt: 'A netrunner jacks into a secure corporate core, discovers illegal telemetry data, and warns their operative to disconnect immediately.' },
  { label: 'Live Breaking News', prompt: 'A news anchor presents breaking satellite data while the remote correspondent delivers live verification from the field.' },
]

const EXPORTED_POSE_BONES: VRMHumanBoneName[] = [
  'head',
  'spine',
  'chest',
  'leftUpperArm',
  'rightUpperArm',
  'leftLowerArm',
  'rightLowerArm',
]

declare global {
  interface Window {
    __currentUtterance?: SpeechSynthesisUtterance | null
  }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef1 = useRef<HTMLInputElement>(null)
  const fileInputRef2 = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<'story' | 'script' | 'mocap'>('story')
  const [selectedShot, setSelectedShot] = useState<string>('two_shot_wide')
  const [currentStage, setCurrentStage] = useState<string>('cyberpunk')
  const [status, setStatus] = useState<string>('D3 Studio Ready')
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [showCustomizer, setShowCustomizer] = useState<boolean>(false)
  const [showCinematicIntro, setShowCinematicIntro] = useState<boolean>(true)

  // --- D3 Visual Style Engine (Phase 1) -------------------------------------
  // 'default' preserves the pre-style-engine look exactly (identity op).
  // Motion cadence 'auto' follows the active preset's steppedFps
  // (Noir Deco ⇒ 24); Native/12/24 explicitly override it.
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('default')
  const [motionCadence, setMotionCadence] = useState<'auto' | 12 | 24>('auto')

  const [skinColor, setSkinColor] = useState<string>('#6e473b')
  const [hairColor, setHairColor] = useState<string>('#140f0c')
  const [shirtColor, setShirtColor] = useState<string>('#2563eb')
  const [hairStyle, setHairStyle] = useState<'short' | 'long'>('short')
  const [jawScale, setJawScale] = useState<number>(1.08)
  const [shoulderWidth, setShoulderWidth] = useState<number>(1.12)

  // AI Story Prompts
  const [storyPrompt, setStoryPrompt] = useState<string>(
    "A detective enters an abandoned warehouse at midnight. He slowly walks forward, looks around suspiciously, hears a noise behind him, turns around and says, 'Who's there?'"
  )
  const [currentEpisode, setCurrentEpisode] = useState<D3Episode | null>(null)
  const [currentSceneIndex, setCurrentSceneIndex] = useState<number>(0)
  const [selectedTimelineShot, setSelectedTimelineShot] = useState<number>(0)
  const [showTimeline, setShowTimeline] = useState<boolean>(true)
  const [isRecordingPerf, setIsRecordingPerf] = useState<boolean>(false)
  const episodeUndoRef = useRef<D3Episode | null>(null)
  const perfRecorderRef = useRef(new PerformanceRecorder())
  const isRecordingPerfRef = useRef(false)
  const activeUserPerf1Ref = useRef<D3Performance | null>(null)
  const activeUserPerf2Ref = useRef<D3Performance | null>(null)
  const userPerfStart1Ref = useRef(0)
  const userPerfStart2Ref = useRef(0)
  const playStartedAtRef = useRef(0)

  // Legacy Script Mode
  const [multiActorPrompt, setMultiActorPrompt] = useState<string>(
    `Host: Welcome to our virtual set!\nGuest: The stage lighting and cinematic camera are active.\nHost: Let us wave to the audience and begin!`
  )

  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const isPlayingRef = useRef<boolean>(false)
  const activeTimeoutsRef = useRef<number[]>([])

  // Mirrors `mode` for the mount-only Three.js RAF loop (no effect restarts).
  const modeRef = useRef<'story' | 'script' | 'mocap'>(mode)
  // Camera stream acquired once by the mount-only MediaPipe init; bound to the
  // MoCap <video> element whenever it mounts without re-initializing vision.
  const activeVideoStreamRef = useRef<MediaStream | null>(null)
  // Key of the last compiled scene timeline ("episodeId:sceneId") — prevents
  // redundant timeline compilations on unrelated renders.
  const compiledSceneKeyRef = useRef<string>('')
  // Signature of the environment currently applied to the Three.js stage.
  // Equal signature ⇒ same preset/location/mood ⇒ zero rebuilds on scene switches.
  const appliedEnvKeyRef = useRef<string>('')

  const actor1VrmRef = useRef<VRM | null>(null)
  const actor2VrmRef = useRef<VRM | null>(null)
  const actor1SourceUrlRef = useRef<string>(DEFAULT_VRM_URL)
  const actor2SourceUrlRef = useRef<string>(DEFAULT_VRM_URL)
  /** Plain glTF (non-VRM) actor models, e.g. Quaternius characters. */
  const actor1GltfSceneRef = useRef<THREE.Object3D | null>(null)
  const actor2GltfSceneRef = useRef<THREE.Object3D | null>(null)
  /** Monotonic per-slot load tokens — a stale in-flight load never replaces a newer model. */
  const actor1LoadTokenRef = useRef(0)
  const actor2LoadTokenRef = useRef(0)
  /** Effective slot visibility derived from the last character presence. */
  const characterVisibilityRef = useRef<{ leadVisible: boolean; supportingVisible: boolean }>({
    leadVisible: true,
    supportingVisible: true,
  })
  /** Quaternius animation library clips — loaded ONCE, reused by every actor. */
  const quaterniusClipsRef = useRef<THREE.AnimationClip[] | null>(null)
  const animLibraryPromiseRef = useRef<Promise<THREE.AnimationClip[] | null> | null>(null)
  /** Per-actor AnimationMixers for plain glTF (Quaternius) characters. */
  const actor1MixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actor2MixerRef = useRef<THREE.AnimationMixer | null>(null)
  /** Basic verb-driven locomotion state per Quaternius actor. */
  const locomotion1Ref = useRef<QuaterniusLocomotionState>(createLocomotionState())
  const locomotion2Ref = useRef<QuaterniusLocomotionState>(createLocomotionState())
  /** Lightweight chair occupancy: seat Object3D → sitting actor slot. */
  const occupiedSeatsRef = useRef<Map<THREE.Object3D, 1 | 2>>(new Map())
  /** Cached character presence from the last story/script prompt. */
  const characterPresenceRef = useRef<CharacterPresence>('default')
  const stageGroupRef = useRef<THREE.Group | null>(null)
  const propsGroupRef = useRef<THREE.Group | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null)
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null)
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null)
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  // Visual Style engine handles — created ONCE in the mount effect; the
  // controller wraps the existing lights (never creates new ones).
  const visualStyleControllerRef = useRef<VisualStyleController | null>(null)
  const steppedClockRef = useRef<SteppedAnimationClock>(new SteppedAnimationClock())
  // Mirrors `visualStyle` for buildStageEnvironment (called from handlers and
  // the mount-only effect without depending on fresh effect closures).
  const visualStyleRef = useRef<VisualStyle>('default')
  // Character time (stepped or native) published for handlers that must
  // anchor durations to the same clock the render loop consumes.
  const charTimeRef = useRef<number>(0)
  // Suppresses the one-time style announcement on initial mount.
  const styleEffectRanRef = useRef(false)

  const activeAnchorRef = useRef<LockAnchor>('stage_center')
  const currentPivot = useRef(new THREE.Vector3(0, 1.35, 0))
  const targetPivot = useRef(new THREE.Vector3(0, 1.35, 0))
  const currentSpherical = useRef(new THREE.Spherical(2.8, Math.PI / 2.1, 0))
  const targetSpherical = useRef(new THREE.Spherical(2.8, Math.PI / 2.1, 0))
  const targetRollZ = useRef<number>(0)

  const activeEmoteActor1 = useRef<string | null>(null)
  const emoteTimerActor1 = useRef<number>(0)
  const activeEmoteActor2 = useRef<string | null>(null)
  const emoteTimerActor2 = useRef<number>(0)
  /** Per-emote durations so timeline gestures end cleanly at their own length. */
  const emoteDuration1 = useRef<number>(3.2)
  const emoteDuration2 = useRef<number>(3.0)
  /** Active story motion (root translation / yaw) per actor. */
  const motionActor1 = useRef<ActorMotionState | null>(null)
  const motionActor2 = useRef<ActorMotionState | null>(null)
  const gaitPhase1 = useRef<number>(0)
  const gaitPhase2 = useRef<number>(0)

  const speakingActorRef = useRef<1 | 2 | null>(null)
  const actor1Viseme = useRef<number>(0)
  const actor2Viseme = useRef<number>(0)

  const targetHeadQuat = useRef(new THREE.Quaternion())
  const currentHeadQuat = useRef(new THREE.Quaternion())
  const targetBlinkL = useRef<number>(0)
  const targetBlinkR = useRef<number>(0)
  const targetSmile = useRef<number>(0)
  const currentBlinkL = useRef<number>(0)
  const currentBlinkR = useRef<number>(0)
  const currentSmile = useRef<number>(0)

  const lastTimelineRef = useRef<{
    cameraTrack: SceneCameraKeyframe[]
    dialogueTimeline: SceneDialogueEvent[]
    emoteTimeline: SceneEmoteEvent[]
    durationSeconds: number
  } | null>(null)

  /**
   * Single stage/environment entry point (upgraded, not replaced).
   *
   * stageKey selects the base preset — the existing STAGE_PRESETS colors and
   * classic disc/ring/pillar/grid geometry are reused verbatim. An optional
   * envOverride (from the Environment Resolver) upgrades it into a full
   * story-appropriate environment: sky + fog + lighting mood + procedural
   * props, while still anchoring to one of the existing presets.
   *
   * Without an override this reproduces the previous behavior exactly
   * (same geometry, same per-preset key/rim colors).
   */
  const buildStageEnvironment = (
    stageKey: string,
    envOverride?: ResolvedEnvironment,
    dynamicOverride?: DynamicStageOverride,
    routeReason = 'legacy stage request'
  ) => {
    const scene = sceneRef.current
    if (!scene) return
    const env =
      envOverride ?? EnvironmentResolverService.resolveForPreset(stageKey as D3StagePresetId)
    if (import.meta.env.DEV) {
      console.info(
        `[D3 ENV ROUTE]\nselected=${dynamicOverride ? 'dynamic' : 'legacy'}`
      )
    }
    appliedEnvKeyRef.current = dynamicOverride?.signature ?? env.signature
    const config = STAGE_PRESETS[env.preset] || STAGE_PRESETS.cyberpunk

    // Dispose the previous environment FULLY before replacing, so switching
    // scenes/environments never leaks GPU resources. The procedural props
    // group is disposed explicitly first; the whole-stage deep sweep after it
    // is idempotent (three.js dispose is safe to call twice).
    if (import.meta.env.DEV) {
      const prevEntities = propsGroupRef.current
        ? Array.from(propsGroupRef.current.children).filter((c) => c.name.startsWith('entity:')).map((c) => c.name)
        : []
      console.log(`[D3 LIFECYCLE] DISPOSE prev propsGroupRef entities=[${prevEntities.join(', ') || 'none'}]`)
    }
    if (propsGroupRef.current) {
      disposeObjectDeep(propsGroupRef.current)
      propsGroupRef.current = null
    }
    if (stageGroupRef.current) {
      scene.remove(stageGroupRef.current)
      disposeObjectDeep(stageGroupRef.current)
      stageGroupRef.current = null
    }

    const stageGroup = new THREE.Group()
    stageGroupRef.current = stageGroup

    if (!dynamicOverride && env.useBaseStage) {
      // --- existing base stage geometry (classic look, unchanged) ---
      const floorGeo = new THREE.CylinderGeometry(4.5, 4.8, 0.25, 32)
      const floorMat = new THREE.MeshStandardMaterial({
        color: config.floorColor,
        roughness: 0.15,
        metalness: 0.6,
      })
      const floor = new THREE.Mesh(floorGeo, floorMat)
      floor.position.y = -0.125
      stageGroup.add(floor)

      const ringGeo = new THREE.TorusGeometry(4.55, 0.04, 16, 64)
      const ringMat = new THREE.MeshBasicMaterial({ color: config.gridColor })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.01
      stageGroup.add(ring)

      for (let i = -2; i <= 2; i++) {
        const pillarGeo = new THREE.BoxGeometry(0.12, 3.5, 0.12)
        const pillarMat = new THREE.MeshBasicMaterial({ color: config.gridColor })
        const pillar = new THREE.Mesh(pillarGeo, pillarMat)
        pillar.position.set(i * 1.8, 1.75, -3.2)
        stageGroup.add(pillar)
      }

      const grid = new THREE.GridHelper(10, 20, config.gridColor, 0x1e293b)
      grid.position.y = 0.005
      stageGroup.add(grid)
    }

    // --- blueprint-driven composed environment (prop library + seeded layout) ---
    if (dynamicOverride) {
      propsGroupRef.current = dynamicOverride.group
      stageGroup.add(dynamicOverride.group)
      if (import.meta.env.DEV) {
        const dynObjects = dynamicOverride.group.children.find((c) => c.name === 'dyn:objects')
        const entities = dynObjects
          ? Array.from(dynObjects.children).filter((c) => c.name.startsWith('entity:')).map((c) => c.name)
          : []
        console.log(`[D3 LIFECYCLE] ATTACH group=${dynamicOverride.group.name} dynObjectsChildren=${dynObjects?.children.length ?? 0} entities=[${entities.join(', ') || 'none'}]`)
      }
    } else if (!env.useBaseStage) {
      const envGroup = buildEnvironmentGroup(env)
      propsGroupRef.current = envGroup
      stageGroup.add(envGroup)
      // DEV-only trace: logs the live environment state (kind / meshes /
      // bounds / camera) so missing-geometry bugs are visible immediately.
      logRuntimeEnvTrace(env, envGroup, cameraRef.current)
    }

    scene.add(stageGroup)
    if (import.meta.env.DEV) {
      console.log(`[D3 STAGE] stageGroup added to scene. scene.children: ${scene.children.map((c) => c.name || c.type).join(', ')}`)
    }

    // DEV-only entity visibility diagnostics — runs AFTER live-scene attachment
    // with world matrices fully updated. Read-only: no transforms are changed.
    if (import.meta.env.DEV && dynamicOverride && cameraRef.current) {
      const cam = cameraRef.current
      stageGroup.updateMatrixWorld(true)
      const fwd = new THREE.Vector3()
      cam.getWorldDirection(fwd)
      const dynGroup = dynamicOverride.group
      const dynObjects = dynGroup.children.find((c) => c.name === 'dyn:objects')
      console.log(
        `[D3 ENTITY DIAG] camera pos=[${cam.position.x.toFixed(2)},${cam.position.y.toFixed(2)},${cam.position.z.toFixed(2)}] ` +
        `forward=[${fwd.x.toFixed(2)},${fwd.y.toFixed(2)},${fwd.z.toFixed(2)}] near=${cam.near} far=${cam.far} fov=${cam.fov}`
      )
      console.log(
        `[D3 ENTITY DIAG] visibility: stageGroup=${stageGroup.visible} dynGroup=${dynGroup.visible} ` +
        `dyn:objects=${dynObjects?.visible ?? 'N/A'} stageGroupInScene=${scene.children.includes(stageGroup)} ` +
        `dynGroupInStage=${stageGroup.children.includes(dynGroup)}`
      )
      const frustum = new THREE.Frustum()
      frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
      const box = new THREE.Box3()
      const size = new THREE.Vector3()
      const wpos = new THREE.Vector3()
      const rows: Array<{
        name: string; visible: boolean; parentChain: string
        localX: number; localY: number; localZ: number
        worldX: number; worldY: number; worldZ: number
        scaleX: number; scaleY: number; scaleZ: number
        width: number; height: number; depth: number
        distanceFromCamera: number; inFrustum: boolean
        attachedToStage: boolean
      }> = []
      dynGroup.traverse((obj) => {
        if (!obj.name.startsWith('entity:')) return
        obj.updateMatrixWorld(true)
        obj.getWorldPosition(wpos)
        box.setFromObject(obj)
        box.getSize(size)
        const chain: string[] = []
        let p: THREE.Object3D | null = obj.parent
        while (p) { chain.unshift(p.name || p.type); p = p.parent }
        rows.push({
          name: obj.name,
          visible: obj.visible,
          parentChain: chain.join(' > '),
          localX: Number(obj.position.x.toFixed(2)),
          localY: Number(obj.position.y.toFixed(2)),
          localZ: Number(obj.position.z.toFixed(2)),
          worldX: Number(wpos.x.toFixed(2)),
          worldY: Number(wpos.y.toFixed(2)),
          worldZ: Number(wpos.z.toFixed(2)),
          scaleX: Number(obj.scale.x.toFixed(2)),
          scaleY: Number(obj.scale.y.toFixed(2)),
          scaleZ: Number(obj.scale.z.toFixed(2)),
          width: Number(size.x.toFixed(2)),
          height: Number(size.y.toFixed(2)),
          depth: Number(size.z.toFixed(2)),
          distanceFromCamera: Number(cam.position.distanceTo(wpos).toFixed(2)),
          inFrustum: frustum.intersectsBox(box),
          attachedToStage: stageGroup.children.includes(dynGroup),
        })
      })
      console.table(rows)

      // Survival check: does this entity set survive the NEXT rebuild?
      // Log again one frame later AND after a short delay to catch any
      // lifecycle replacement that happens after this attach.
      const snapshotNames = rows.map((r) => r.name)
      const checkSurvival = (label: string) => {
        const stillThere = dynGroup.children
          .find((c) => c.name === 'dyn:objects')
          ?.children.filter((c) => c.name.startsWith('entity:')).map((c) => c.name) ?? []
        const lost = snapshotNames.filter((n) => !stillThere.includes(n))
        console.log(`[D3 ENTITY DIAG] ${label}: entitiesStillAttached=${stillThere.length} lost=[${lost.join(', ') || 'none'}]`)
      }
      requestAnimationFrame(() => checkSurvival('after-1-frame'))
      window.setTimeout(() => checkSurvival('after-2s'), 2000)
    }

    // --- atmosphere: sky background + depth fog ---
    const atmosphere = dynamicOverride?.sceneGraph.atmosphere
    const backgroundColor = atmosphere?.backgroundColor ?? env.skyColor
    const fogColor = atmosphere?.fogColor ?? env.fogColor
    const fogNear = atmosphere?.fogNear ?? env.fogNear
    const fogFar = atmosphere?.fogFar ?? env.fogFar
    scene.background = new THREE.Color(backgroundColor)
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar)

    // --- lighting mood (existing lights, re-graded by the resolver) ---
    if (keyLightRef.current) {
      keyLightRef.current.color.set(env.keyLightColor)
      keyLightRef.current.intensity = env.keyLightIntensity
    }
    if (fillLightRef.current) {
      fillLightRef.current.color.set(env.fillLightColor)
      fillLightRef.current.intensity = env.fillLightIntensity
    }
    if (rimLightRef.current) {
      rimLightRef.current.color.set(env.rimLightColor)
      rimLightRef.current.intensity = env.rimLightIntensity
    }
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = env.ambientIntensity
    }

    // --- Visual Style layer -------------------------------------------------
    // Record the resolver's grade (this is what 'default' restores to), then
    // re-apply the active non-default style on top so the chosen look
    // survives environment/stage switches. Pure mutation — no new objects.
    // Phase 1.1: the freshly built stage group is registered as the
    // environment root so non-default styles can GRADE its materials
    // (darken/desaturate/tame emissive — never VRM characters). New builds
    // carry pristine materials, so baseline capture stays exact and every
    // re-grade derives from those pristine values (no cumulative drift).
    const styleCtrl = visualStyleControllerRef.current
    if (styleCtrl) {
      styleCtrl.recordEnvironmentGrade(
        {
          backgroundColor,
          fogColor,
          fogNear,
          fogFar,
          ambientIntensity: env.ambientIntensity,
          keyLightIntensity: env.keyLightIntensity,
          keyLightColor: env.keyLightColor,
          rimLightIntensity: env.rimLightIntensity,
          rimLightColor: env.rimLightColor,
          fillLightIntensity: env.fillLightIntensity,
          fillLightColor: env.fillLightColor,
        },
        [stageGroup]
      )
      if (visualStyleRef.current !== 'default') {
        styleCtrl.applyStyle(getVisualStylePreset(visualStyleRef.current))
      }
    }
  }

  /** Route optimized templates to the existing builder; all other scenes use Phase 3. */
  const applyEnvironmentRoute = (searchText: string, env: ResolvedEnvironment) => {
    if (import.meta.env.DEV) {
      console.log(`[D3 LIFECYCLE] ROUTE searchText="${searchText.substring(0, 80)}"`)
    }
    try {
      const parsed = parseSceneGraph(searchText)
      if (import.meta.env.DEV) {
        console.group('[D3 ROUTE] applyEnvironmentRoute')
        console.log(`  searchText: "${searchText}"`)
        console.log(`  template: ${parsed.template ? parsed.template.kind : 'null (dynamic)'}`)
        console.log('  parsed sceneGraph objects:')
        for (const o of parsed.sceneGraph.objects) {
          console.log(`    - ${o.id} (${o.semanticType}) importance=${o.importance}`)
        }
      }
      if (parsed.template === null) {
        const sceneGraph = parsed.sceneGraph
        const signature = `dynamic:${sceneGraph.seed}:${sceneGraph.environment.type}`
        if (signature === appliedEnvKeyRef.current) {
          if (import.meta.env.DEV) console.log('  SKIP: signature unchanged', signature)
          if (import.meta.env.DEV) console.groupEnd()
          return
        }
        const assetMatches = matchAssetsSync(
          sceneGraph.objects,
          undefined,
          sceneGraph.environment.type
        )
        const layout = planLayout({
          sceneGraph,
          objects: sceneGraph.objects,
          seed: sceneGraph.seed,
        })
    if (import.meta.env.DEV) {
      const prevEntities = propsGroupRef.current
        ? Array.from(propsGroupRef.current.children).filter((c) => c.name.startsWith('entity:')).map((c) => c.name)
        : []
      console.log(`[D3 LIFECYCLE] DISPOSE prev propsGroupRef entities=[${prevEntities.join(', ') || 'none'}]`)
    }
        const dynamic = buildDynamicEnvironment({
          sceneGraph,
          resolvedObjects: layout.objects,
          assetMatches,
          seed: sceneGraph.seed,
          layoutStats: layout.stats,
        })
        if (import.meta.env.DEV) {
          console.log(`  dynamic.group.children: ${dynamic.group.children.length}`)
          console.log(`  dynamic.stats.entityVisualCount: ${dynamic.stats.proceduralCount}`)
          const dynObjects = dynamic.group.children.find((c) => c.name === 'dyn:objects')
          console.log(`  dyn:objects children: ${dynObjects?.children.length ?? 0}`)
        }
        if (dynamic.group.children.length === 0) {
          disposeObjectDeep(dynamic.group)
          throw new Error('Phase 3 returned an empty environment group')
        }
        // Spatial visibility diagnostics
        if (import.meta.env.DEV && cameraRef.current) {
          const cam = cameraRef.current
          console.log(`[D3 SPATIAL] camera pos=[${cam.position.x.toFixed(2)},${cam.position.y.toFixed(2)},${cam.position.z.toFixed(2)}] fov=${cam.fov} near=${cam.near} far=${cam.far} aspect=${cam.aspect.toFixed(2)}`)
          const frustum = new THREE.Frustum()
          const projMatrix = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
          frustum.setFromProjectionMatrix(projMatrix)
          const worldBox = new THREE.Box3()
          const worldPos = new THREE.Vector3()
          const rows: Array<{ id: string; type: string; worldX: number; worldY: number; worldZ: number; width: number; height: number; depth: number; distance: number; inFrustum: boolean; visible: boolean }> = []
          dynamic.group.traverse((obj) => {
            if (!obj.name.startsWith('entity:')) return
            obj.updateMatrixWorld(true)
            obj.getWorldPosition(worldPos)
            worldBox.setFromObject(obj)
            const size = new THREE.Vector3()
            worldBox.getSize(size)
            const parts = obj.name.split(':')
            rows.push({
              id: parts[1] ?? '',
              type: parts[2] ?? '',
              worldX: Number(worldPos.x.toFixed(2)),
              worldY: Number(worldPos.y.toFixed(2)),
              worldZ: Number(worldPos.z.toFixed(2)),
              width: Number(size.x.toFixed(2)),
              height: Number(size.y.toFixed(2)),
              depth: Number(size.z.toFixed(2)),
              distance: Number(cam.position.distanceTo(worldPos).toFixed(2)),
              inFrustum: frustum.intersectsBox(worldBox),
              visible: obj.visible,
            })
          })
          console.table(rows)
        }
        if (import.meta.env.DEV) console.log('  → calling buildStageEnvironment with dynamicOverride')
        if (import.meta.env.DEV) console.groupEnd()
        buildStageEnvironment(env.preset, env, {
          group: dynamic.group,
          sceneGraph,
          signature,
        }, `no optimized template for ${sceneGraph.environment.type}`)
        return
      }

      if (env.signature === appliedEnvKeyRef.current) {
        if (import.meta.env.DEV) console.log('  SKIP: env signature unchanged', env.signature)
        if (import.meta.env.DEV) console.groupEnd()
        return
      }
      if (import.meta.env.DEV) console.log('  → calling buildStageEnvironment (legacy, optimized template)')
      if (import.meta.env.DEV) console.groupEnd()
      buildStageEnvironment(
        env.preset,
        env,
        undefined,
        `optimized template ${parsed.template.kind}`
      )
    } catch (error) {
      console.warn('Phase 3 environment route failed; using legacy environment:', error)
      if (env.signature === appliedEnvKeyRef.current) return
      if (import.meta.env.DEV) console.log('  → legacy fallback after error')
      if (import.meta.env.DEV) console.groupEnd()
      buildStageEnvironment(env.preset, env, undefined, 'Phase 3 failed; legacy fallback')
    }
  }

  const getSubjectWorldPosition = (anchor: LockAnchor): THREE.Vector3 => {
    const actor1 = actor1VrmRef.current
    const actor2 = actor2VrmRef.current

    if (anchor === 'actor1_head' && actor1) {
      const node = actor1.humanoid?.getNormalizedBoneNode('head')
      if (node) return node.getWorldPosition(new THREE.Vector3())
      return new THREE.Vector3(-0.75, 1.35, 0)
    }
    if (anchor === 'actor2_head' && actor2) {
      const node = actor2.humanoid?.getNormalizedBoneNode('head')
      if (node) return node.getWorldPosition(new THREE.Vector3())
      return new THREE.Vector3(0.75, 1.35, 0)
    }
    if (anchor === 'actor1_chest' && actor1) {
      const node = actor1.humanoid?.getNormalizedBoneNode('chest')
      if (node) return node.getWorldPosition(new THREE.Vector3())
      return new THREE.Vector3(-0.75, 1.1, 0)
    }
    if (anchor === 'actor2_chest' && actor2) {
      const node = actor2.humanoid?.getNormalizedBoneNode('chest')
      if (node) return node.getWorldPosition(new THREE.Vector3())
      return new THREE.Vector3(0.75, 1.1, 0)
    }
    return new THREE.Vector3(0, 1.25, 0)
  }

  const createColorTexture = (hexColor: string) => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = hexColor
    ctx.fillRect(0, 0, 16, 16)
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  const applyCustomAvatarFeatures = (vrmInstance: VRM | null = actor1VrmRef.current) => {
    if (!vrmInstance) return

    const skinThreeColor = new THREE.Color(skinColor)
    const hairThreeColor = new THREE.Color(hairColor)
    const shirtThreeColor = new THREE.Color(shirtColor)

    const skinTex = createColorTexture(skinColor)
    const hairTex = createColorTexture(hairColor)
    const shirtTex = createColorTexture(shirtColor)

    vrmInstance.scene.traverse((node: any) => {
      if (node.isMesh && node.material) {
        const matList = Array.isArray(node.material) ? node.material : [node.material]

        matList.forEach((m: any) => {
          const name = ((m.name || '') + ' ' + (node.name || '')).toLowerCase()

          if (name.includes('skin') || name.includes('face') || name.includes('body') || name.includes('head') || name.includes('arm')) {
            if (m.color) m.color.copy(skinThreeColor)
            if (m.shadeColor) m.shadeColor.copy(skinThreeColor.clone().multiplyScalar(0.75))
            m.map = skinTex
            m.needsUpdate = true
          }

          if (name.includes('hair') || name.includes('bangs') || name.includes('tail') || name.includes('braid') || name.includes('fringe')) {
            if (m.color) m.color.copy(hairThreeColor)
            if (m.shadeColor) m.shadeColor.copy(hairThreeColor.clone().multiplyScalar(0.65))
            m.map = hairTex
            m.needsUpdate = true

            if (hairStyle === 'short' && (name.includes('back') || name.includes('tail') || name.includes('pigtail') || name.includes('long') || name.includes('side'))) {
              node.visible = false
            } else {
              node.visible = true
            }
          }

          if (name.includes('cloth') || name.includes('shirt') || name.includes('top') || name.includes('wear') || name.includes('jacket')) {
            if (m.color) m.color.copy(shirtThreeColor)
            m.map = shirtTex
            m.needsUpdate = true
          }
        })
      }
    })

    const humanoid = vrmInstance.humanoid
    if (humanoid) {
      const headBone = humanoid.getNormalizedBoneNode('head')
      const chestBone = humanoid.getNormalizedBoneNode('chest')
      const spineBone = humanoid.getNormalizedBoneNode('spine')

      if (headBone) headBone.scale.set(jawScale, 1.0, jawScale)
      if (chestBone) chestBone.scale.set(shoulderWidth, 1.0, shoulderWidth)
      if (spineBone) spineBone.scale.set(shoulderWidth * 0.95, 1.0, shoulderWidth * 0.95)
    }
  }

  /**
   * Vite serves index.html (content-type text/html) for missing files under /,
   * which GLTFLoader would try to parse as JSON ("Unexpected token '<'" error).
   * Probe local VRM paths once and cache the result so a missing file is never
   * re-requested and its HTML response is never handed to GLTFLoader.
   */
  const localVrmProbeRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const probeLocalVrmUrl = (url: string): Promise<boolean> => {
    const cached = localVrmProbeRef.current.get(url)
    if (cached) return cached
    const probe = fetch(url, { method: 'HEAD' })
      .then(
        (res) =>
          res.ok && !(res.headers.get('content-type') || '').includes('text/html')
      )
      .catch(() => false)
    localVrmProbeRef.current.set(url, probe)
    return probe
  }

  /**
   * Load the Quaternius Universal Animation Library ONCE and cache its clips
   * for reuse by every Quaternius actor. Resolves null on failure (character
   * stays visible in T-pose — never crashes).
   */
  const loadQuaterniusAnimationLibrary = (): Promise<THREE.AnimationClip[] | null> => {
    if (animLibraryPromiseRef.current) return animLibraryPromiseRef.current
    const promise = new Promise<THREE.AnimationClip[] | null>((resolve) => {
      const loader = new GLTFLoader()
      loader.load(
        ANIM_LIBRARY_URL,
        (gltf) => {
          const clips = gltf.animations || []
          quaterniusClipsRef.current = clips
          if (import.meta.env.DEV) {
            console.log(`[D3 ANIM LIBRARY] loaded ${clips.length} clips`)
          }
          resolve(clips)
        },
        undefined,
        (err) => {
          console.warn('[D3 ANIM LIBRARY] load failed — Quaternius actors stay in T-pose:', err)
          quaterniusClipsRef.current = null
          resolve(null)
        }
      )
    })
    animLibraryPromiseRef.current = promise
    return promise
  }

  /** Stop + uncache the current mixer for an actor slot and clear its reference. */
  const stopActorMixer = (actorNum: 1 | 2) => {
    const mixer = actorNum === 1 ? actor1MixerRef.current : actor2MixerRef.current
    if (mixer) {
      mixer.stopAllAction()
      mixer.uncacheRoot(mixer.getRoot())
    }
    if (actorNum === 1) actor1MixerRef.current = null
    else actor2MixerRef.current = null
    // Locomotion is invalid once the slot's model is replaced.
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    loco.active = false
    loco.speed = 0
    loco.remainingDistance = 0
    loco.currentClipName = ''
    loco.targetPosition = null
    loco.targetName = null
    loco.postArrivalAction = null
    if (loco.actionTimeoutId != null) {
      clearTimeout(loco.actionTimeoutId)
      loco.actionTimeoutId = null
    }
    // Model replacement: clear seated state safely (no Sitting_Exit is played).
    loco.isSeated = false
    loco.seatTarget = null
    loco.seatType = null
    loco.preSeatPosition = null
    loco.preSeatYaw = null
    loco.isStandingUp = false
    loco.pendingPostExitLoco = null
    // The slot's model is gone — release any chair it occupied.
    occupiedSeatsRef.current.forEach((occupant, seat) => {
      if (occupant === actorNum) occupiedSeatsRef.current.delete(seat)
    })
  }

  /**
   * Find a live environment entity by semantic type in the CURRENT stage
   * (e.g. 'door' → entity:door_1:door). Searches the existing stage group
   * recursively by name segments / userData — never rebuilds the scene graph
   * and never uses hardcoded world positions.
   */
  const findLiveSceneTarget = (targetType: string): THREE.Object3D | null => {
    const root = stageGroupRef.current ?? propsGroupRef.current
    if (!root) return null
    let found: THREE.Object3D | null = null
    root.traverse((obj) => {
      if (found) return
      const name = obj.name || ''
      if (!name.startsWith('entity:')) return
      const parts = name.split(':')
      const idPart = (parts[1] || '').toLowerCase()
      const typePart = (parts[2] || '').toLowerCase()
      const udType = String(
        (obj.userData as { resolved?: { semanticType?: string } }).resolved?.semanticType || ''
      ).toLowerCase()
      if (
        typePart === targetType ||
        typePart.includes(targetType) ||
        idPart.includes(targetType) ||
        udType === targetType
      ) {
        found = obj
      }
    })
    return found
  }

  /**
   * Find the OTHER live Quaternius actor matching an actor target type.
   * 'man' → the slot whose source URL is MALE_GLTF_URL; 'woman' →
   * FEMALE_GLTF_URL. Never returns the moving actor itself, VRM actors
   * (plain glTF scene refs only exist for Quaternius actors), missing
   * objects, or invisible actors. Returns null when no valid target exists.
   */
  const findLiveActorTarget = (
    targetType: ActorTargetType,
    movingActorNum: 1 | 2
  ): { actorNum: 1 | 2; object: THREE.Object3D } | null => {
    const wantedUrl = targetType === 'man' ? MALE_GLTF_URL : FEMALE_GLTF_URL
    const candidates: Array<{
      actorNum: 1 | 2
      sourceUrl: string
      object: THREE.Object3D | null
    }> = [
      { actorNum: 1, sourceUrl: actor1SourceUrlRef.current, object: actor1GltfSceneRef.current },
      { actorNum: 2, sourceUrl: actor2SourceUrlRef.current, object: actor2GltfSceneRef.current },
    ]
    for (const candidate of candidates) {
      // Never target the moving actor itself.
      if (candidate.actorNum === movingActorNum) continue
      // Source URL must match the requested gender (VRM URLs never match).
      if (candidate.sourceUrl !== wantedUrl) continue
      // Only live Quaternius glTF scene refs (VRM slots keep this null).
      if (!candidate.object) continue
      // Only visible/live actors.
      if (!candidate.object.visible) continue
      return { actorNum: candidate.actorNum, object: candidate.object }
    }
    return null
  }

  /**
   * Compute a seat anchor (world-space position + facing yaw) from the live
   * furniture's world bounding box. Heuristics only — no hardcoded world
   * coordinates, and the target object is never modified.
   */
  const getSeatAnchor = (
    target: THREE.Object3D,
    targetType: string,
    sideOffset = 0
  ): {
    position: THREE.Vector3
    yaw: number
    hasMeaningfulYaw: boolean
    center: THREE.Vector3
  } | null => {
    const box = new THREE.Box3().setFromObject(target)
    if (box.isEmpty()) return null
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    // Seat surface height heuristics (initial values only).
    const seatHeightFactor = targetType === 'sofa' ? 0.48 : 0.55
    const seatY = box.min.y + size.y * seatHeightFactor

    // Facing: derive from the furniture's world orientation when meaningful.
    const quat = target.getWorldQuaternion(new THREE.Quaternion())
    const yaw = new THREE.Euler().setFromQuaternion(quat, 'YXZ').y
    const hasMeaningfulYaw = Math.abs(yaw) > 0.05

    // Deterministic side offset applied along the furniture's local X axis
    // (sofa two-actor support; chairs use offset 0 — centered).
    const offsetX = Math.cos(yaw) * sideOffset
    const offsetZ = -Math.sin(yaw) * sideOffset
    const position = new THREE.Vector3(center.x + offsetX, seatY, center.z + offsetZ)
    return { position, yaw, hasMeaningfulYaw, center }
  }

  /**
   * Crossfade a Quaternius actor to a clip by exact name (~0.25s fade).
   * No-op when the clip is already current — animation only changes when the
   * actor's action state changes (never restarts per frame).
   */
  const playActorClip = (
    actorNum: 1 | 2,
    clipName: string,
    fadeSeconds = 0.25,
    loopMode: THREE.AnimationActionLoopStyles = THREE.LoopRepeat,
    logTag: 'LOCOMOTION' | 'ACTION' | 'SEAT' | 'SEAT EXIT' = 'LOCOMOTION'
  ): THREE.AnimationAction | null => {
    const mixer = actorNum === 1 ? actor1MixerRef.current : actor2MixerRef.current
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    if (!mixer || loco.currentClipName === clipName) return null
    const clips = quaterniusClipsRef.current
    if (!clips || clips.length === 0) return null
    const nextClip = clips.find((c) => c.name === clipName)
    if (!nextClip) {
      console.warn(`[D3 ${logTag}] actor=${actorNum} clip "${clipName}" not found`)
      return null
    }
    const prevClip = loco.currentClipName
      ? clips.find((c) => c.name === loco.currentClipName)
      : null
    const prevAction = prevClip ? mixer.existingAction(prevClip) : null
    const nextAction = mixer.clipAction(nextClip).reset()
    // Looping clips repeat; one-shots play exactly once and clamp on the
    // final frame until the next crossfade.
    nextAction.setLoop(loopMode, loopMode === THREE.LoopOnce ? 1 : Infinity)
    nextAction.clampWhenFinished = loopMode === THREE.LoopOnce
    nextAction.play()
    if (prevAction && prevAction !== nextAction) {
      nextAction.crossFadeFrom(prevAction, fadeSeconds, false)
    }
    loco.currentClipName = clipName
    if (import.meta.env.DEV && clipName !== IDLE_CLIP_NAME) {
      console.log(`[D3 ${logTag}] actor=${actorNum} clip=${clipName}`)
    }
    if (import.meta.env.DEV && LOCOMOTION_PRESETS[clipName]) {
      console.log(
        `[D3 WALK CLIP] actor=${actorNum} requested=${clipName} resolved=${nextClip.name} mixerExists=true actionStarted=true`
      )
    }
    return nextAction
  }

  /** Begin locomotion: scene target when available, else fixed forward distance. */
  const startActorLocomotion = (
    actorNum: 1 | 2,
    clipName: string,
    targetType: string | null = null,
    sideOffset = 0,
    postAction: PostArrivalAction | null = null
  ) => {
    const preset = LOCOMOTION_PRESETS[clipName]
    const model = actorNum === 1 ? actor1GltfSceneRef.current : actor2GltfSceneRef.current
    if (!preset || !model) return
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    loco.targetPosition = null
    loco.targetName = null
    loco.postArrivalAction = postAction
    // A new locomotion supersedes any pending destination-action timer.
    if (loco.actionTimeoutId != null) {
      clearTimeout(loco.actionTimeoutId)
      loco.actionTimeoutId = null
    }

    if (targetType) {
      const target = findLiveSceneTarget(targetType)
      if (target) {
        // World-space target position → the actor parent's coordinate system
        // (never assume the target position is already actor-local).
        const targetWorld = target.getWorldPosition(new THREE.Vector3())
        const parent = model.parent
        const targetLocal = parent ? parent.worldToLocal(targetWorld.clone()) : targetWorld
        const stopRadius = LOCOMOTION_TARGET_RADII[targetType] ?? 1.0
        const dx = targetLocal.x - model.position.x
        const dz = targetLocal.z - model.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (import.meta.env.DEV) {
          console.log(`[D3 NAV TARGET] actor=${actorNum} target=${targetType} found=true`)
        }
        if (dist >= 0.0001) {
          // Destination stops BEFORE the target (safe stopping radius) plus a
          // deterministic side offset so paired actors never overlap.
          const travel = Math.max(0, dist - stopRadius)
          const destX = model.position.x + dx * (travel / dist) + sideOffset
          const destZ = model.position.z + dz * (travel / dist)
          if (import.meta.env.DEV) {
            console.log(
              `[D3 NAV TARGET] actor=${actorNum} destination=(${destX.toFixed(2)},${model.position.y.toFixed(2)},${destZ.toFixed(2)})`
            )
          }
          if (travel > LOCOMOTION_ARRIVE_EPSILON) {
            loco.targetPosition = new THREE.Vector3(destX, model.position.y, destZ)
            loco.targetName = targetType
            // Face the destination instantly (no turn animation yet).
            model.rotation.y = Math.atan2(destX - model.position.x, destZ - model.position.z)
            loco.active = true
            loco.speed = preset.speed
            loco.remainingDistance = travel
            if (import.meta.env.DEV) {
              console.log(`[D3 WALK START] actor=${actorNum} clip=${clipName} target=${targetType}`)
            }
            playActorClip(actorNum, clipName)
            return
          }
          // Already within the stopping radius — stay idle, no movement.
          return
        }
        return
      }
      if (import.meta.env.DEV) {
        console.log(`[D3 NAV TARGET] target=${targetType} not found -> fallback distance`)
      }
    }

    // Fixed-distance fallback (existing behavior).
    const distance = Math.min(preset.distance, Math.max(0, LOCOMOTION_Z_MAX - model.position.z))
    if (distance <= 0) return
    loco.active = true
    loco.speed = preset.speed
    loco.remainingDistance = distance
    if (import.meta.env.DEV) {
      console.log(`[D3 WALK START] actor=${actorNum} clip=${clipName} target=fixed-distance`)
    }
    playActorClip(actorNum, clipName)
  }

  /** End locomotion: run the post-arrival action if any, else Idle_Loop. */
  const stopActorLocomotion = (actorNum: 1 | 2) => {
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    if (!loco.active) return
    loco.active = false
    loco.speed = 0
    loco.remainingDistance = 0
    if (import.meta.env.DEV) {
      if (loco.targetName) {
        console.log(`[D3 NAV TARGET] actor=${actorNum} reached=${loco.targetName} -> ${IDLE_CLIP_NAME}`)
      } else {
        console.log(`[D3 LOCOMOTION] actor=${actorNum} complete -> ${IDLE_CLIP_NAME}`)
      }
    }
    const reachedTarget = loco.targetName
    const postAction = loco.postArrivalAction
    loco.targetPosition = null
    loco.targetName = null
    loco.postArrivalAction = null
    if (postAction) {
      executePostArrivalAction(actorNum, postAction, reachedTarget)
    } else {
      playActorClip(actorNum, IDLE_CLIP_NAME)
    }
  }

  /**
   * Run a follow-up when a one-shot clip finishes (mixer 'finished' event).
   * Guarded so a superseded action (new Generate/locomotion) never fires.
   */
  const onOneShotFollowUp = (
    actorNum: 1 | 2,
    oneShotAction: THREE.AnimationAction,
    oneShotClipName: string,
    followUp: () => void
  ) => {
    const mixer = actorNum === 1 ? actor1MixerRef.current : actor2MixerRef.current
    if (!mixer) return
    const handler = (e: any) => {
      if (!e || e.action !== oneShotAction) return
      mixer.removeEventListener('finished', handler)
      const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
      if (loco.currentClipName !== oneShotClipName) return // superseded
      followUp()
    }
    mixer.addEventListener('finished', handler)
  }

  /**
   * Execute ONE chained post-arrival action (no further chaining):
   *   sit      → Sitting_Enter (one-shot) → Sitting_Idle_Loop (looping);
   *              only on chair/sofa targets, else fallback to Idle_Loop.
   *   interact → Interact (one-shot) → Idle_Loop.
   *   talk     → Idle_Talking_Loop (~3s) → Idle_Loop.
   * No physical snapping onto furniture — the safe stopping position is kept.
   */
  const executePostArrivalAction = (
    actorNum: 1 | 2,
    action: PostArrivalAction,
    targetType: string | null
  ) => {
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    const mixer = actorNum === 1 ? actor1MixerRef.current : actor2MixerRef.current
    if (!mixer) return
    if (import.meta.env.DEV) {
      console.log(`[D3 ACTION] actor=${actorNum} action=${action}`)
    }

    if (action === 'sit') {
      if (targetType === 'chair' || targetType === 'sofa') {
        const model = actorNum === 1 ? actor1GltfSceneRef.current : actor2GltfSceneRef.current
        const target = model ? findLiveSceneTarget(targetType) : null
        const preSnapX = model ? model.position.x : 0
        const preSnapZ = model ? model.position.z : 0
        // Preserve the safe pre-seat standing position + yaw — this exact spot
        // is restored after Sitting_Exit (no arbitrary exit point is computed).
        if (model) {
          loco.preSeatPosition = model.position.clone()
          loco.preSeatYaw = model.rotation.y
        }
        let aligned = false
        if (model && target) {
          // Lightweight chair occupancy: one actor per chair. A second actor
          // stays at its safe stopping point and falls back to Idle_Loop.
          if (targetType === 'chair') {
            const occupant = occupiedSeatsRef.current.get(target)
            if (occupant != null && occupant !== actorNum) {
              if (import.meta.env.DEV) {
                console.log(`[D3 SEAT] chair occupied actor=${actorNum} -> Idle_Loop`)
              }
              playActorClip(actorNum, IDLE_CLIP_NAME)
              return
            }
          }
          // Sofa two-actor support: deterministic side offsets around the
          // seat; chairs always center a single sitter.
          const sideOffset =
            targetType === 'sofa'
              ? actorNum === 1
                ? LOCOMOTION_SIDE_OFFSET_ACTOR1
                : LOCOMOTION_SIDE_OFFSET_ACTOR2
              : 0
          const anchor = getSeatAnchor(target, targetType, sideOffset)
          if (anchor) {
            if (import.meta.env.DEV) {
              console.log(
                `[D3 SEAT] actor=${actorNum} target=${targetType} anchor=(${anchor.position.x.toFixed(2)},${anchor.position.y.toFixed(2)},${anchor.position.z.toFixed(2)})`
              )
              if (targetType === 'sofa') {
                console.log(`[D3 SEAT] actor=${actorNum} target=sofa offset=${sideOffset}`)
              }
            }
            // World-space anchor → the actor parent's coordinate system before
            // assigning (never assume the anchor is already actor-local).
            const parent = model.parent
            const localPos = parent
              ? parent.worldToLocal(anchor.position.clone())
              : anchor.position.clone()
            // Lower the model root by the sitting-pose hip height so the
            // character's hips rest ON the seat surface (grounded Quaternius
            // models carry no other Y offset — smallest change necessary).
            localPos.y = Math.max(0, localPos.y - SIT_HIP_OFFSET)
            model.position.copy(localPos)
            if (anchor.hasMeaningfulYaw) {
              // Face the same way the furniture's world orientation faces.
              model.rotation.y = anchor.yaw
            } else {
              // Fallback: face away from the target center relative to the
              // approach direction (pre-snap position → outward facing).
              model.rotation.y = Math.atan2(
                preSnapX - anchor.center.x,
                preSnapZ - anchor.center.z
              )
            }
            aligned = true
            if (targetType === 'chair') occupiedSeatsRef.current.set(target, actorNum)
          }
          if (import.meta.env.DEV) {
            console.log(`[D3 SEAT] actor=${actorNum} aligned=${aligned}`)
          }
        }
        // Anchor failure keeps the actor at the safe stop position and still
        // plays the existing sitting animation (no crash).
        const sitEnter = playActorClip(actorNum, CLIP_SITTING_ENTER, 0.25, THREE.LoopOnce, 'SEAT')
        if (sitEnter) {
          onOneShotFollowUp(actorNum, sitEnter, CLIP_SITTING_ENTER, () => {
            playActorClip(actorNum, CLIP_SITTING_IDLE, 0.25, THREE.LoopRepeat, 'SEAT')
            // Seated only once Sitting_Enter has fully transitioned into
            // Sitting_Idle_Loop — never inferred from the clip name alone.
            loco.isSeated = true
            loco.seatTarget = target
            loco.seatType = targetType
          })
        }
        return
      }
      if (import.meta.env.DEV) {
        console.log(
          `[D3 ACTION] actor=${actorNum} sit unsupported on target=${targetType ?? 'none'} -> Idle_Loop`
        )
      }
      playActorClip(actorNum, IDLE_CLIP_NAME)
      return
    }

    if (action === 'interact') {
      const interactAction = playActorClip(actorNum, CLIP_INTERACT, 0.25, THREE.LoopOnce, 'ACTION')
      if (interactAction) {
        onOneShotFollowUp(actorNum, interactAction, CLIP_INTERACT, () => {
          if (import.meta.env.DEV) {
            console.log(`[D3 ACTION] actor=${actorNum} complete -> ${IDLE_CLIP_NAME}`)
          }
          playActorClip(actorNum, IDLE_CLIP_NAME)
        })
      }
      return
    }

    if (action === 'talk') {
      playActorClip(actorNum, CLIP_IDLE_TALKING, 0.25, THREE.LoopRepeat, 'ACTION')
      if (loco.actionTimeoutId != null) clearTimeout(loco.actionTimeoutId)
      loco.actionTimeoutId = window.setTimeout(() => {
        loco.actionTimeoutId = null
        if (loco.currentClipName !== CLIP_IDLE_TALKING) return // superseded
        if (import.meta.env.DEV) {
          console.log(`[D3 ACTION] actor=${actorNum} complete -> ${IDLE_CLIP_NAME}`)
        }
        playActorClip(actorNum, IDLE_CLIP_NAME)
      }, TALK_DURATION_MS)
    }
  }

  /**
   * Restore the stored pre-seat standing position/yaw, clear seated state and
   * release chair occupancy, then return to Idle_Loop.
   */
  const finishStandUp = (actorNum: 1 | 2) => {
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    const model = actorNum === 1 ? actor1GltfSceneRef.current : actor2GltfSceneRef.current
    if (model && loco.preSeatPosition) {
      // Return to the stored safe pre-seat standing point (captured in the
      // same parent space) with a sensible standing Y — no arbitrary exit point.
      model.position.copy(loco.preSeatPosition)
      model.position.y = 0
      if (loco.preSeatYaw != null) model.rotation.y = loco.preSeatYaw
    }
    loco.isSeated = false
    loco.seatTarget = null
    loco.seatType = null
    loco.preSeatPosition = null
    loco.preSeatYaw = null
    let releasedChair = false
    occupiedSeatsRef.current.forEach((occupant, seat) => {
      if (occupant === actorNum) {
        occupiedSeatsRef.current.delete(seat)
        releasedChair = true
      }
    })
    if (import.meta.env.DEV) {
      console.log(`[D3 SEAT EXIT] actor=${actorNum} restored standing position`)
      if (releasedChair) console.log(`[D3 SEAT EXIT] actor=${actorNum} chair released`)
    }
    playActorClip(actorNum, IDLE_CLIP_NAME)
    if (import.meta.env.DEV) {
      console.log(`[D3 SEAT EXIT] actor=${actorNum} complete -> ${IDLE_CLIP_NAME}`)
    }
  }

  /**
   * Stand a seated actor up: Sitting_Exit (one-shot, clamped) → restore the
   * pre-seat standing position → release chair occupancy → Idle_Loop →
   * onComplete. New locomotion must WAIT for Sitting_Exit to complete.
   */
  const standActorUp = (actorNum: 1 | 2, onComplete?: () => void) => {
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    const mixer = actorNum === 1 ? actor1MixerRef.current : actor2MixerRef.current
    if (!mixer || !loco.isSeated) {
      // Nothing to stand up from — continue deterministically.
      onComplete?.()
      return
    }
    if (import.meta.env.DEV) {
      console.log(`[D3 SEAT EXIT] actor=${actorNum} start`)
    }
    const exitAction = playActorClip(actorNum, CLIP_SITTING_EXIT, 0.25, THREE.LoopOnce, 'SEAT EXIT')
    if (!exitAction) {
      // Clip unavailable — finish deterministically instead of hanging.
      finishStandUp(actorNum)
      onComplete?.()
      return
    }
    onOneShotFollowUp(actorNum, exitAction, CLIP_SITTING_EXIT, () => {
      finishStandUp(actorNum)
      onComplete?.()
    })
  }

  /**
   * Advance one actor's basic locomotion: manual root translation along the
   * actor's forward axis (+Z). The small ±0.25 staging yaw is deliberately NOT
   * converted into X drift, so paired actors preserve their horizontal
   * separation and never converge into each other. The top-level scene object
   * is moved directly — no root-motion data, no navigation targets yet.
   */
  const updateActorLocomotion = (actorNum: 1 | 2, deltaSeconds: number) => {
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    if (!loco.active || deltaSeconds <= 0) return
    const model = actorNum === 1 ? actor1GltfSceneRef.current : actor2GltfSceneRef.current
    if (!model) {
      loco.active = false
      return
    }

    if (loco.targetPosition) {
      // Scene-aware: move toward the destination, never overshoot it.
      const dx = loco.targetPosition.x - model.position.x
      const dz = loco.targetPosition.z - model.position.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      const step = loco.speed * deltaSeconds
      if (dist <= LOCOMOTION_ARRIVE_EPSILON || step >= dist) {
        model.position.x = loco.targetPosition.x
        model.position.z = loco.targetPosition.z
        loco.remainingDistance = 0
        stopActorLocomotion(actorNum)
        return
      }
      model.position.x += (dx / dist) * step
      model.position.z += (dz / dist) * step
      loco.remainingDistance = dist - step
      return
    }

    // Fixed-distance fallback: translate along the forward axis (+Z).
    const step = Math.min(loco.speed * deltaSeconds, loco.remainingDistance)
    model.position.z += step
    loco.remainingDistance -= step
    if (loco.remainingDistance <= 0) {
      stopActorLocomotion(actorNum)
    }
  }

  /**
   * Route a locomotion request to a Quaternius actor: start immediately when
   * its mixer is ready, otherwise park it until the model finishes loading
   * (consumed by attachQuaterniusIdle). VRM actors are never affected.
   */
  const queueActorLocomotion = (
    actorNum: 1 | 2,
    clipName: string,
    targetType: string | null = null,
    sideOffset = 0,
    postAction: PostArrivalAction | null = null
  ) => {
    const mixer = actorNum === 1 ? actor1MixerRef.current : actor2MixerRef.current
    if (!mixer) {
      const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
      loco.pendingClip = clipName
      loco.pendingTargetType = targetType
      loco.pendingSideOffset = sideOffset
      loco.pendingPostArrivalAction = postAction
      return
    }
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    if (loco.isSeated) {
      // Seated: DO NOT start locomotion yet — stand up first, then start the
      // requested locomotion (the latest request wins if Generate is pressed
      // again while Sitting_Exit is still playing).
      loco.pendingPostExitLoco = { clipName, targetType, sideOffset, postAction }
      if (!loco.isStandingUp) {
        loco.isStandingUp = true
        standActorUp(actorNum, () => {
          loco.isStandingUp = false
          const pending = loco.pendingPostExitLoco
          loco.pendingPostExitLoco = null
          if (pending) {
            startActorLocomotion(
              actorNum,
              pending.clipName,
              pending.targetType,
              pending.sideOffset,
              pending.postAction
            )
          }
        })
      }
      return
    }
    startActorLocomotion(actorNum, clipName, targetType, sideOffset, postAction)
  }

  /**
   * Bind + auto-play Idle_Loop on a freshly loaded Quaternius actor.
   * Rigs already match 65/65 — no retargeting. On any failure the character
   * stays visible in T-pose (warning logged, never crashes).
   */
  const attachQuaterniusIdle = (actorNum: 1 | 2, model: THREE.Object3D) => {
    // Stop/uncache the previous mixer for this slot before attaching the new one.
    stopActorMixer(actorNum)

    const clips = quaterniusClipsRef.current
    if (!clips || clips.length === 0) {
      console.warn(`[D3 ACTOR ANIMATION] actor=${actorNum} no animation clips available — T-pose fallback`)
      return
    }
    const idleClip = clips.find((c) => c.name === IDLE_CLIP_NAME)
    if (!idleClip) {
      console.warn(`[D3 ACTOR ANIMATION] actor=${actorNum} clip "${IDLE_CLIP_NAME}" not found — T-pose fallback`)
      return
    }
    const mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(idleClip).reset().play()
    if (actorNum === 1) actor1MixerRef.current = mixer
    else actor2MixerRef.current = mixer
    if (import.meta.env.DEV) {
      console.log(
        `[D3 ACTOR ATTACHED] actor=${actorNum} clip=${idleClip.name} mixerRootMatchesModel=${(mixer.getRoot() as THREE.Object3D) === model} actionStarted=true`
      )
    }

    // A fresh model always defaults to Idle_Loop; consume any locomotion
    // request that was queued while this model was still loading.
    const loco = actorNum === 1 ? locomotion1Ref.current : locomotion2Ref.current
    loco.active = false
    loco.speed = 0
    loco.remainingDistance = 0
    loco.currentClipName = IDLE_CLIP_NAME
    const pendingClip = loco.pendingClip
    const pendingTarget = loco.pendingTargetType
    const pendingOffset = loco.pendingSideOffset
    const pendingPostAction = loco.pendingPostArrivalAction
    loco.pendingClip = null
    loco.pendingTargetType = null
    loco.pendingSideOffset = 0
    loco.pendingPostArrivalAction = null
    if (pendingClip && LOCOMOTION_PRESETS[pendingClip]) {
      startActorLocomotion(actorNum, pendingClip, pendingTarget, pendingOffset, pendingPostAction)
    }
  }

  /** Remove the slot's current model (VRM scene and/or glTF scene) from the live scene — logged. */
  const removeActorScene = (actorNum: 1 | 2) => {
    const vrm = actorNum === 1 ? actor1VrmRef.current : actor2VrmRef.current
    const gltf = actorNum === 1 ? actor1GltfSceneRef.current : actor2GltfSceneRef.current
    if (vrm) {
      sceneRef.current?.remove(vrm.scene)
      if (actorNum === 1) actor1VrmRef.current = null
      else actor2VrmRef.current = null
    }
    if (gltf) {
      if (import.meta.env.DEV) {
        const removedUrl = actorNum === 1 ? actor1SourceUrlRef.current : actor2SourceUrlRef.current
        console.log(`[D3 ACTOR REMOVED] actor=${actorNum} url=${removedUrl}`)
      }
      sceneRef.current?.remove(gltf)
      if (actorNum === 1) actor1GltfSceneRef.current = null
      else actor2GltfSceneRef.current = null
    }
  }

  const loadActorModel = (actorNum: 1 | 2, url: string, skipProbe = false) => {
    if (!sceneRef.current) return
    setStatus(`Loading Actor ${actorNum}...`)

    // Monotonic per-slot load token: an older in-flight load (e.g. the mount
    // /avatar.vrm) must never remove or replace a model that started loading
    // AFTER it — the newest request for a slot always wins.
    const loadToken = (actorNum === 1 ? actor1LoadTokenRef.current : actor2LoadTokenRef.current) + 1
    if (actorNum === 1) actor1LoadTokenRef.current = loadToken
    else actor2LoadTokenRef.current = loadToken
    const isStaleLoad = () =>
      (actorNum === 1 ? actor1LoadTokenRef.current : actor2LoadTokenRef.current) !== loadToken

    // Local path: verify it really serves a VRM before loading; otherwise go
    // straight to the sample VRM (uploaded blob:/https: URLs skip this check).
    // CRITICAL: both retry paths pass skipProbe=true. Re-entering this branch
    // with the same arguments made the probe recurse forever (infinite
    // microtask chain → Chrome "Page Unresponsive").
    if (!skipProbe && url.startsWith('/')) {
      probeLocalVrmUrl(url).then((exists) => {
        if (exists) loadActorModel(actorNum, url, true)
        else loadActorModel(actorNum, DEFAULT_VRM_URL, true)
      })
      return
    }

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    loader.load(
      url,
      (gltf) => {
        // A newer load for this slot superseded this response — discard it.
        if (isStaleLoad()) return
        const vrm = gltf.userData.vrm as VRM | undefined
        if (vrm) {
          VRMUtils.removeUnnecessaryVertices(gltf.scene)
          VRMUtils.combineSkeletons(gltf.scene)
          VRMUtils.rotateVRM0(vrm)

          const posX = actorNum === 1 ? -0.75 : 0.75
          vrm.scene.position.set(posX, 0, 0)
          vrm.scene.rotation.y = actorNum === 1 ? 0.25 : -0.25

          // A VRM is replacing this slot — stop/uncache any previous Quaternius mixer.
          stopActorMixer(actorNum)

          if (actorNum === 1) {
            removeActorScene(1)
            actor1VrmRef.current = vrm
            actor1SourceUrlRef.current = url
            applyCustomAvatarFeatures(vrm)
          } else {
            removeActorScene(2)
            actor2VrmRef.current = vrm
            actor2SourceUrlRef.current = url
          }

          sceneRef.current?.add(vrm.scene)

          // Apply stored character presence visibility to the newly loaded VRM
          // (preserves transforms/animations — only toggles .visible).
          const { leadVisible, supportingVisible } = characterVisibilityRef.current
          vrm.scene.visible = actorNum === 1 ? leadVisible : supportingVisible

          setStatus(
            url === DEFAULT_VRM_URL
              ? `🎯 Actor ${actorNum} ready (sample VRM) — upload your own anytime`
              : `🎯 Actor ${actorNum} Ready on Stage`
          )
          return
        }

        // Plain glTF/GLB (e.g. Quaternius characters) — no VRM metadata required.
        // Use gltf.scene directly with the same actor slot transforms/visibility
        // as the VRM path. The old actor (VRM or glTF) is only removed AFTER
        // this replacement has loaded successfully.
        const model = gltf.scene
        const posX = actorNum === 1 ? -0.75 : 0.75
        model.position.set(posX, 0, 0)
        model.rotation.y = actorNum === 1 ? 0.25 : -0.25

        if (actorNum === 1) {
          removeActorScene(1)
          actor1GltfSceneRef.current = model
          actor1SourceUrlRef.current = url
        } else {
          removeActorScene(2)
          actor2GltfSceneRef.current = model
          actor2SourceUrlRef.current = url
        }

        sceneRef.current?.add(model)

        // Same presence-driven slot visibility as the VRM path.
        const { leadVisible, supportingVisible } = characterVisibilityRef.current
        model.visible = actorNum === 1 ? leadVisible : supportingVisible

        // One-shot DEV diagnostic (event-based, never per frame): transform,
        // mesh visibility and Box3 sanity for the freshly loaded model.
        if (import.meta.env.DEV) {
          const box = new THREE.Box3().setFromObject(model)
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          let meshCount = 0
          let visibleMeshCount = 0
          model.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              meshCount++
              if (o.visible) visibleMeshCount++
            }
          })
          const finiteTransforms =
            Number.isFinite(model.position.x) && Number.isFinite(model.position.y) && Number.isFinite(model.position.z) &&
            Number.isFinite(model.scale.x) && Number.isFinite(model.scale.y) && Number.isFinite(model.scale.z) &&
            Number.isFinite(model.quaternion.x) && Number.isFinite(model.quaternion.y) &&
            Number.isFinite(model.quaternion.z) && Number.isFinite(model.quaternion.w)
          const gender = url === MALE_GLTF_URL ? 'male' : url === FEMALE_GLTF_URL ? 'female' : 'other'
          console.log(
            `[D3 ACTOR LOADED]\nactor=${actorNum} gender=${gender}\nsource=${url}\nrootAttached=${model.parent === sceneRef.current}\nmeshCount=${meshCount} visibleMeshCount=${visibleMeshCount}\nposition=(${model.position.x.toFixed(2)},${model.position.y.toFixed(2)},${model.position.z.toFixed(2)}) scale=(${model.scale.x.toFixed(2)},${model.scale.y.toFixed(2)},${model.scale.z.toFixed(2)})\nfineTransforms=${finiteTransforms}\nboxCenter=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}) boxSize=(${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)})`
          )
        }

        setStatus(`🎯 Actor ${actorNum} Ready on Stage`)

        // Quaternius actor animation: bind + auto-play Idle_Loop once the
        // animation library is available (loaded once, cached). If this actor
        // was replaced while the library loaded, skip — the newer model
        // attaches its own mixer.
        loadQuaterniusAnimationLibrary()
          .then(() => {
            const current = actorNum === 1 ? actor1GltfSceneRef.current : actor2GltfSceneRef.current
            if (current !== model) return
            attachQuaterniusIdle(actorNum, model)
          })
          .catch(() => {
            console.warn(`[D3 ACTOR ANIMATION] actor=${actorNum} library unavailable — T-pose fallback`)
          })
      },
      undefined,
      (err) => {
        // A newer load for this slot superseded this failed request.
        if (isStaleLoad()) return
        // Vite returns index.html for missing /avatar.vrm → GLTF sees "<!doctype"
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`Actor ${actorNum} load failed (${url}):`, msg)
        // A local project VRM that fails to load/parse falls back to the
        // bundled sample exactly once (DEFAULT_VRM_URL itself is never retried).
        if (url.startsWith('/') && url !== DEFAULT_VRM_URL) {
          setStatus(`Local VRM missing — loading sample for Actor ${actorNum}...`)
          loadActorModel(actorNum, DEFAULT_VRM_URL, true)
          return
        }
        setStatus(`⚠️ Could not load Actor ${actorNum} VRM — use Upload button`)
      }
    )
  }

  const applyCameraShot = (shotKey: string, duration: number = 1800) => {
    const shot = CINEMATIC_SHOTS[shotKey] || CINEMATIC_SHOTS.two_shot_wide
    if (!shot || !cameraRef.current) return

    setSelectedShot(shotKey)
    activeAnchorRef.current = shot.anchor
    targetRollZ.current = shot.rollZ || 0

    new TWEEN.Tween(targetSpherical.current)
      .to({ radius: shot.radius, phi: shot.phi, theta: shot.theta }, duration)
      .easing(TWEEN.Easing.Cubic.Out)
      .start()

    new TWEEN.Tween({ fov: cameraRef.current.fov })
      .to({ fov: shot.fov }, duration)
      .easing(TWEEN.Easing.Cubic.Out)
      .onUpdate((obj) => {
        if (cameraRef.current) {
          cameraRef.current.fov = obj.fov
          cameraRef.current.updateProjectionMatrix()
        }
      })
      .start()
  }

  const speakDialogue = (actorNum: 1 | 2, text: string) => {
    if (!('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()
    window.speechSynthesis.resume()

    const utterance = new SpeechSynthesisUtterance(text)
    window.__currentUtterance = utterance

    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) {
      if (actorNum === 1) {
        utterance.voice = (voices.find((v) => v.name.includes('Guy') || v.name.includes('Daniel') || v.name.includes('David')) ?? voices[0]) ?? null
        utterance.pitch = 0.95
      } else {
        utterance.voice = (voices.find((v) => v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Google')) ?? voices[voices.length - 1]) ?? null
        utterance.pitch = 1.08
      }
    }

    utterance.volume = 1.0
    utterance.rate = 0.98

    utterance.onstart = () => {
      speakingActorRef.current = actorNum
      setStatus(`🗣 Actor ${actorNum} Speaking: "${text.substring(0, 34)}..."`)
    }

    utterance.onboundary = (event) => {
      const char = text[event.charIndex]?.toLowerCase() || ''
      const visemeVal = ['a', 'e', 'i', 'o', 'u'].includes(char) ? 0.85 : 0.45
      if (actorNum === 1) actor1Viseme.current = visemeVal
      else actor2Viseme.current = visemeVal
    }

    utterance.onend = () => {
      speakingActorRef.current = null
      actor1Viseme.current = 0
      actor2Viseme.current = 0
    }

    window.speechSynthesis.speak(utterance)
  }

  /**
   * PURE timeline resolution — computes an episode plan from the current prompt
   * and compiles ONLY the selected scene into a timeline plan.
   *
   * MUST NOT call setState, rebuild the Three.js stage, or touch the DOM.
   * State updates and stage rebuilds are owned exclusively by event handlers
   * and the single scene-selection effect below.
   */
  const resolveCurrentTimelinePlan = (
    sceneIndexOverride?: number
  ): { episode: D3Episode; plan: D3TimelineCompilation } => {
    const stageKey = (currentStage as 'cyberpunk' | 'broadcast' | 'minimal') || 'cyberpunk'

    const episode =
      mode === 'story'
        ? AIDirectorService.createEpisodePlan(storyPrompt, stageKey)
        : AIDirectorService.parseLegacyScriptToEpisode(multiActorPrompt, stageKey)

    // Compile ONLY the requested scene (defaults to the currently selected one)
    const sceneIndex = Math.min(sceneIndexOverride ?? currentSceneIndex, episode.scenes.length - 1)
    const scene = episode.scenes[sceneIndex] || episode.scenes[0]
    const plan = AIDirectorService.compileSceneToTimeline(scene, episode, CINEMATIC_SHOTS)
    return { episode, plan }
  }

  /** Recompile canonical tracks from the currently selected scene (timeline editor path). */
  const recompileFromEpisode = (episode: D3Episode) => {
    const sceneIndex = Math.min(currentSceneIndex, episode.scenes.length - 1)
    const scene = episode.scenes[sceneIndex] || episode.scenes[0]
    const plan = AIDirectorService.compileSceneToTimeline(scene, episode, CINEMATIC_SHOTS)
    lastTimelineRef.current = plan
    const total = episode.scenes.reduce(
      (sum, sc) => sum + sc.shots.reduce((s, sh) => s + sh.duration, 0),
      0
    )
    return { ...episode, estimatedDuration: total }
  }

  /**
   * Select a scene by index — SINGLE CONTROLLED FLOW.
   *
   * Only advances currentSceneIndex (guarded against redundant selects).
   * The one scene-selection effect below reacts to the derived currentScene,
   * syncs the stage ONLY if it actually changed, compiles the selected-scene
   * timeline once, resets the shot cursor, and stops. No stage rebuilds or
   * timeline compilations happen here.
   */
  const selectScene = (sceneIndex: number) => {
    if (!currentEpisode) return
    const idx = Math.max(0, Math.min(sceneIndex, currentEpisode.scenes.length - 1))
    if (idx === currentSceneIndex) return // guard: no redundant selection/re-render
    setCurrentSceneIndex(idx)
    setShowTimeline(true)
    setStatus(`🎬 Scene ${idx + 1} selected — ready to Play`)
  }

  /** Derived current scene — the single value the selection effect reacts to. */
  const currentScene = currentEpisode
    ? currentEpisode.scenes[Math.min(currentSceneIndex, currentEpisode.scenes.length - 1)] ||
      currentEpisode.scenes[0]
    : undefined

  /**
   * Resolve + apply the story-appropriate environment for a scene.
   *
   * Path: scene metadata (title · location name · narrativeGoal · emotionalTone
   * · timeOfDay) → EnvironmentResolverService → buildStageEnvironment(env).
   *
   * Guarded by the resolved environment's signature: identical
   * preset/location/mood ⇒ no rebuild at all. Falls back to the location's
   * existing presetStageId (or the current stage) when nothing is recognized.
   */
  const applySceneEnvironment = (scene: D3Scene, episode: D3Episode) => {
    const location = episode.locations?.find((l) => l.id === scene.locationId)
    const sceneMetadataText = [
      scene.title,
      location?.name,
      location?.description,
      scene.narrativeGoal,
      scene.emotionalTone,
      episode.title,
    ]
      .filter(Boolean)
      .join(' · ')
    // The story prompt is the authoritative source of entity keywords for the
    // dynamic environment. Scene metadata alone (title, location name, mood)
    // does not contain the concrete objects the user asked for, so always
    // prepend the raw prompt to the search text.
    const selectedSearchText = mode === 'story' && storyPrompt
      ? `${storyPrompt} · ${sceneMetadataText}`
      : sceneMetadataText
    if (import.meta.env.DEV) {
      console.log('[D3 PROMPT SOURCE]')
      console.log(`  storyInput=${storyPrompt.substring(0, 80)}...`)
      console.log(`  shotText=${sceneMetadataText.substring(0, 80)}...`)
      console.log(`  selectedSearchText=${selectedSearchText.substring(0, 120)}...`)
    }
    const env = EnvironmentResolverService.resolve({
      searchText: selectedSearchText,
      timeOfDay: scene.timeOfDay,
      emotionalTone: scene.emotionalTone,
      fallbackPreset: (location?.presetStageId ?? currentStage) as D3StagePresetId,
      // Deterministic layout identity: same location ⇒ same layout across its
      // scenes; different locations ⇒ different layouts.
      seedKey: location?.id ?? scene.id,
    })
    if (env.preset !== currentStage) setCurrentStage(env.preset)
    if (import.meta.env.DEV) {
      console.log(`[D3 LIFECYCLE] SCENE_ENV scene=${scene.id} episode=${episode.id}`)
    }
    applyEnvironmentRoute(selectedSearchText, env)
  }

  /**
   * THE scene-navigation/timeline-compilation effect (exactly one).
   *
   * currentSceneIndex changes → currentScene derives → this effect:
   *   1. syncs the stage ONLY if the scene's location preset actually differs
   *   2. compiles the selected-scene timeline ONCE per actual scene change
   *   3. resets the timeline shot cursor
   * …then stops. Guarded so unrelated renders do nothing.
   */
  useEffect(() => {
    if (!currentEpisode || !currentScene) return

    // 1) Environment sync — resolver-driven (location + mood + time-of-day),
    //    guarded by env signature so identical environments never rebuild.
    applySceneEnvironment(currentScene, currentEpisode)

    // 2) Compile ONLY the selected scene — once per actual scene/episode change.
    const key = `${currentEpisode.id}:${currentScene.id}`
    if (compiledSceneKeyRef.current !== key) {
      compiledSceneKeyRef.current = key
      lastTimelineRef.current = AIDirectorService.compileSceneToTimeline(
        currentScene,
        currentEpisode,
        CINEMATIC_SHOTS
      )
      setSelectedTimelineShot(0)
    }
  }, [currentEpisode, currentScene, currentStage])

  /** Navigate to the previous scene. */
  const goToPreviousScene = () => {
    if (!currentEpisode || currentSceneIndex <= 0) return
    selectScene(currentSceneIndex - 1)
  }

  /** Navigate to the next scene. */
  const goToNextScene = () => {
    if (!currentEpisode || currentSceneIndex >= currentEpisode.scenes.length - 1) return
    selectScene(currentSceneIndex + 1)
  }

  /**
   * Begin a visible primitive motion for one actor (root translation / yaw),
   * clamped to the actor safe zone. Consumed by the render loop each frame.
   */
  const startActorMotion = (actor: 1 | 2, kind: StoryMotionKind, duration: number) => {
    const vrm = actor === 1 ? actor1VrmRef.current : actor2VrmRef.current
    if (!vrm) return
    const pos = vrm.scene.position.clone()
    pos.y = 0
    const yaw = vrm.scene.rotation.y
    const targetPos = pos.clone()
    let targetYaw = yaw

    const clampTarget = () => {
      targetPos.x = THREE.MathUtils.clamp(targetPos.x, -STAGE_SAFE_X, STAGE_SAFE_X)
      targetPos.z = THREE.MathUtils.clamp(targetPos.z, STAGE_SAFE_Z_MIN, STAGE_SAFE_Z_MAX)
    }

    if (kind === 'walk') {
      // Walk in the current facing direction; stay short of the camera apron.
      targetPos.x += Math.sin(yaw) * 1.6
      targetPos.z = Math.min(targetPos.z + Math.cos(yaw) * 1.6, 1.2)
      clampTarget()
    } else if (kind === 'step_back') {
      targetPos.x -= Math.sin(yaw) * 0.45
      targetPos.z -= Math.cos(yaw) * 0.45
      clampTarget()
    } else if (kind === 'turn') {
      targetYaw = yaw + Math.PI * 0.85
    } else if (kind === 'face_other') {
      const other = actor === 1 ? actor2VrmRef.current : actor1VrmRef.current
      if (other) {
        targetYaw = Math.atan2(other.scene.position.x - pos.x, other.scene.position.z - pos.z)
      }
    }

    const state: ActorMotionState = {
      kind,
      // Anchored in CHARACTER time (stepped clock) so root motion holds its
      // pose on non-sample frames exactly like limb/gesture animation.
      startedAt: charTimeRef.current,
      duration: Math.max(0.8, duration),
      startPos: pos,
      targetPos,
      startYaw: yaw,
      targetYaw,
    }
    if (actor === 1) motionActor1.current = state
    else motionActor2.current = state

    // Mutual gaze: when one actor turns to face the other, the other meets
    // their gaze shortly after (only if idle) — "faces Arjun" reads naturally.
    if (kind === 'face_other') {
      const recipId = window.setTimeout(() => {
        if (!isPlayingRef.current) return
        const other: 1 | 2 = actor === 1 ? 2 : 1
        const otherMotion = other === 1 ? motionActor1.current : motionActor2.current
        if (!otherMotion) startActorMotion(other, 'face_other', 1.2)
      }, 500)
      activeTimeoutsRef.current.push(recipId)
    }
  }

  const schedulePlanPlayback = (plan: {
    cameraTrack: SceneCameraKeyframe[]
    dialogueTimeline: SceneDialogueEvent[]
    emoteTimeline: SceneEmoteEvent[]
    durationSeconds: number
  }) => {
    activeTimeoutsRef.current.forEach((id) => clearTimeout(id))
    activeTimeoutsRef.current = []

    isPlayingRef.current = true
    setIsPlaying(true)
    setStatus('🎬 Directing Animated Scene...')
    playStartedAtRef.current = performance.now()
    activeUserPerf1Ref.current = null
    activeUserPerf2Ref.current = null

    // Schedule USER performance tracks from the currently selected scene
    const selectedScene = currentEpisode?.scenes[currentSceneIndex]
    if (selectedScene) {
      let tAcc = 0
      for (const shot of selectedScene.shots) {
        const startT = tAcc
        for (const [pid, perf] of Object.entries(shot.performances || {})) {
          if (perf.source !== 'USER') continue
          if (!perf.blendshapeTrack?.length && !perf.headRotationTrack?.length) continue
          const slot = CharacterLibraryService.slotForCharacterId(pid, currentEpisode.castSlots)
          const id = window.setTimeout(() => {
            if (!isPlayingRef.current) return
            if (slot === 1) {
              activeUserPerf1Ref.current = perf
              userPerfStart1Ref.current = performance.now()
            } else {
              activeUserPerf2Ref.current = perf
              userPerfStart2Ref.current = performance.now()
            }
          }, startT * 1000)
          activeTimeoutsRef.current.push(id)
          const clearId = window.setTimeout(() => {
            if (slot === 1) activeUserPerf1Ref.current = null
            else activeUserPerf2Ref.current = null
          }, (startT + shot.duration) * 1000)
          activeTimeoutsRef.current.push(clearId)
        }
        tAcc += shot.duration
      }
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.resume()
    }

    plan.cameraTrack.forEach((kf) => {
      if (kf.time <= 0) {
        applyCameraShot(kf.shotKey, kf.durationMs)
        return
      }
      const id = window.setTimeout(() => {
        if (!isPlayingRef.current) return
        applyCameraShot(kf.shotKey, kf.durationMs)
      }, kf.time * 1000)
      activeTimeoutsRef.current.push(id)
    })

    plan.dialogueTimeline.forEach((d) => {
      const id = window.setTimeout(() => {
        if (!isPlayingRef.current) return
        speakDialogue(d.actor, d.text)
      }, d.startTime * 1000)
      activeTimeoutsRef.current.push(id)
    })

    plan.emoteTimeline.forEach((e) => {
      const id = window.setTimeout(() => {
        if (!isPlayingRef.current) return
        if (e.actor === 1) {
          activeEmoteActor1.current = e.name
          emoteTimerActor1.current = 0
          emoteDuration1.current = e.durationEstimate ?? 3.2
        } else {
          activeEmoteActor2.current = e.name
          emoteTimerActor2.current = 0
          emoteDuration2.current = e.durationEstimate ?? 3.0
        }
      }, e.time * 1000)
      activeTimeoutsRef.current.push(id)
    })

    // Schedule VISIBLE STORY MOTION (walk / turn / face-other / step-back)
    // from each shot's primary action directive — same accumulation as the
    // USER performance tracks above.
    if (selectedScene) {
      let motAcc = 0
      for (const shot of selectedScene.shots) {
        const action = shot.actions?.[0]
        if (action?.description) {
          const kind = classifyStoryAction(action.description)
          if (kind) {
            const slot = CharacterLibraryService.slotForCharacterId(
              action.actorId,
              currentEpisode?.castSlots
            )
            const actDur = Math.max(
              0.9,
              Math.min(shot.duration * 0.92, action.duration ?? shot.duration)
            )
            const mid = window.setTimeout(() => {
              if (!isPlayingRef.current) return
              startActorMotion(slot === 2 ? 2 : 1, kind, actDur)
            }, motAcc * 1000)
            activeTimeoutsRef.current.push(mid)
          }
        }
        motAcc += shot.duration
      }
    }

    const finishTimeoutId = window.setTimeout(() => {
      isPlayingRef.current = false
      setIsPlaying(false)
      setStatus('🎬 Cut! Scene Complete — Ready to Export or Re-direct')
    }, plan.durationSeconds * 1000)
    activeTimeoutsRef.current.push(finishTimeoutId)
  }

  /**
   * Prompt-driven character presence — show/hide characters based on the
   * story/script text. Resolves gendered terms and pronouns to determine which
   * of the two slots (lead/male, supporting/female) should be visible.
   *
   * Also switches the actor MODEL: male/female/both prompts load the matching
   * Quaternius plain glTF character; 'default' keeps the existing /avatar.vrm
   * behavior. Visibility applies to both VRM and plain glTF actors without
   * touching their transforms/animations.
   */
  const applyCharacterPresence = (text: string) => {
    const presence = resolveCharacterPresence(text)
    characterPresenceRef.current = presence
    // A 'female' prompt loads the female model into the LEAD slot (actor 1),
    // so the lead slot stays visible and only 'both' also shows the supporting
    // slot. All other presences keep the existing mapping.
    const visibility =
      presence === 'female'
        ? { leadVisible: true, supportingVisible: false }
        : presenceToVisibility(presence)
    characterVisibilityRef.current = visibility
    const { leadVisible, supportingVisible } = visibility

    // Prompt-driven character MODEL switch (plain glTF Quaternius models).
    // 'default'/'ambiguous' keeps the existing /avatar.vrm behavior — no switch.
    if (import.meta.env.DEV) {
      if (presence === 'male') {
        console.log(`[D3 CHARACTER MODEL] male | actor=1 | url=${MALE_GLTF_URL}`)
      } else if (presence === 'female') {
        console.log(`[D3 CHARACTER MODEL] female | actor=1 | url=${FEMALE_GLTF_URL}`)
      } else if (presence === 'both') {
        console.log(`[D3 CHARACTER MODEL] male | actor=1 | url=${MALE_GLTF_URL}`)
        console.log(`[D3 CHARACTER MODEL] female | actor=2 | url=${FEMALE_GLTF_URL}`)
      } else {
        console.log('[D3 CHARACTER MODEL] default | url=/avatar.vrm (existing VRM behavior kept)')
      }
    }
    if (presence === 'male') {
      if (actor1SourceUrlRef.current !== MALE_GLTF_URL) loadActorModel(1, MALE_GLTF_URL)
    } else if (presence === 'female') {
      if (actor1SourceUrlRef.current !== FEMALE_GLTF_URL) loadActorModel(1, FEMALE_GLTF_URL)
    } else if (presence === 'both') {
      if (actor1SourceUrlRef.current !== MALE_GLTF_URL) loadActorModel(1, MALE_GLTF_URL)
      if (actor2SourceUrlRef.current !== FEMALE_GLTF_URL) loadActorModel(2, FEMALE_GLTF_URL)
    }

    // Fresh plan → clear the lightweight chair occupancy map.
    occupiedSeatsRef.current.clear()

    // Basic Quaternius locomotion from story verbs (walk/jog/sprint → move).
    // 'default' presence means VRM actors — never locomoted (unchanged).
    const locoClip = resolveLocomotionClip(text)
    if (locoClip && presence !== 'default') {
      const locoTarget = resolveLocomotionTarget(text)
      const postAction = resolvePostArrivalAction(text)
      queueActorLocomotion(1, locoClip, locoTarget, LOCOMOTION_SIDE_OFFSET_ACTOR1, postAction)
      if (presence === 'both') {
        queueActorLocomotion(2, locoClip, locoTarget, LOCOMOTION_SIDE_OFFSET_ACTOR2, postAction)
      }
    } else if (!locoClip) {
      locomotion1Ref.current.pendingClip = null
      locomotion1Ref.current.pendingTargetType = null
      locomotion1Ref.current.pendingPostArrivalAction = null
      locomotion1Ref.current.pendingPostExitLoco = null
      locomotion2Ref.current.pendingClip = null
      locomotion2Ref.current.pendingTargetType = null
      locomotion2Ref.current.pendingPostArrivalAction = null
      locomotion2Ref.current.pendingPostExitLoco = null
    }

    if (actor1VrmRef.current) {
      actor1VrmRef.current.scene.visible = leadVisible
    }
    if (actor2VrmRef.current) {
      actor2VrmRef.current.scene.visible = supportingVisible
    }
    if (actor1GltfSceneRef.current) {
      actor1GltfSceneRef.current.visible = leadVisible
    }
    if (actor2GltfSceneRef.current) {
      actor2GltfSceneRef.current.visible = supportingVisible
    }

    if (import.meta.env.DEV) {
      console.log(
        `[D3 CHARACTER PRESENCE]\ntext="${text}"\nresolved=${presence}\nleadVisible=${leadVisible}\nsupportingVisible=${supportingVisible}`
      )
    }
  }

  /** Generate from story/script prompt (AI Director). */
  const playStageDialogue = () => {
    // PURE compute — no setState / stage rebuilds inside resolution.
    // Generate always starts from Scene 1 of the NEW episode (never a stale index).
    const { episode, plan } = resolveCurrentTimelinePlan(0)

    // Story mode may imply a different stage — applied HERE (handler-owned),
    // guarded so an unchanged stage never triggers a rebuild.
    if (mode === 'story') {
      // Full environment resolution straight from the raw story prompt
      // (location kind + time/mood keywords), superseding the old
      // preset-only detection. Signature-guarded against redundant rebuilds;
      // the scene-selection effect below keeps later scenes in sync.
      const env = EnvironmentResolverService.resolve({
        searchText: storyPrompt,
        fallbackPreset: currentStage as D3StagePresetId,
        // Same prompt ⇒ same generated layout; edit the prompt ⇒ new layout.
        seedKey: storyPrompt,
      })
      if (env.preset !== currentStage) setCurrentStage(env.preset)
      applyEnvironmentRoute(storyPrompt, env)
    }

    setCurrentEpisode(episode)
    setCurrentSceneIndex(0)
    setSelectedTimelineShot(0)
    setShowTimeline(true)

    // Apply prompt-driven character presence to the VRM slots.
    const promptText = mode === 'story' ? storyPrompt : multiActorPrompt
    applyCharacterPresence(promptText)

    schedulePlanPlayback(plan)
  }

  /** Play the already-edited episode without regenerating from the prompt. */
  const playEditedEpisode = () => {
    if (!currentEpisode) {
      playStageDialogue()
      return
    }
    // ALWAYS compile the CURRENTLY SELECTED scene at click time — never a
    // stale/cached plan, never scene 1 permanently, never an old closure.
    // Path: currentEpisode → scenes[currentSceneIndex] → compileSceneToTimeline → playback.
    const idx = Math.min(currentSceneIndex, currentEpisode.scenes.length - 1)
    const scene = currentEpisode.scenes[idx] || currentEpisode.scenes[0]
    const plan = AIDirectorService.compileSceneToTimeline(scene, currentEpisode, CINEMATIC_SHOTS)
    lastTimelineRef.current = plan
    const total = currentEpisode.scenes.reduce(
      (sum, sc) => sum + sc.shots.reduce((s, sh) => s + sh.duration, 0),
      0
    )
    setCurrentEpisode({ ...currentEpisode, estimatedDuration: total })

    // Apply prompt-driven character presence to the VRM slots.
    const promptText = mode === 'story' ? storyPrompt : multiActorPrompt
    applyCharacterPresence(promptText)

    schedulePlanPlayback(plan)
  }

  const pushEpisodeUndo = (ep: D3Episode) => {
    episodeUndoRef.current = structuredClone(ep)
  }

  const undoEpisodeEdit = () => {
    if (!episodeUndoRef.current) {
      setStatus('Nothing to undo')
      return
    }
    const restored = recompileFromEpisode(episodeUndoRef.current)
    setCurrentEpisode(restored)
    episodeUndoRef.current = null
    setStatus('↩ Timeline edit undone')
  }

  /**
   * Timeline edit handlers — `index` is LOCAL to the CURRENTLY SELECTED scene
   * (same convention as selectedTimelineShot, Record Performance and AI⇄USER).
   * Only the selected scene's shots array is ever touched; other scenes are
   * returned by reference and never mutated or copied.
   */
  const updateShotInEpisode = (index: number, patch: Partial<D3Shot>) => {
    if (!currentEpisode) return
    const scene = currentEpisode.scenes[currentSceneIndex]
    if (!scene) return
    pushEpisodeUndo(currentEpisode)
    const shots = scene.shots.map((sh, i) => (i === index ? { ...sh, ...patch } : sh))
    const scenes = currentEpisode.scenes.map((sc, si) =>
      si === currentSceneIndex ? { ...sc, shots } : sc
    )
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setStatus('Timeline updated — Play Edit to preview')
  }

  const deleteShotInEpisode = (index: number) => {
    if (!currentEpisode) return
    const scene = currentEpisode.scenes[currentSceneIndex]
    if (!scene || scene.shots.length <= 1) return
    pushEpisodeUndo(currentEpisode)
    const shots = scene.shots
      .filter((_, i) => i !== index)
      .map((sh, i) => ({ ...sh, shotNumber: i + 1 }))
    const scenes = currentEpisode.scenes.map((sc, si) =>
      si === currentSceneIndex ? { ...sc, shots } : sc
    )
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setSelectedTimelineShot(Math.max(0, index - 1))
    setStatus('Shot deleted')
  }

  const duplicateShotInEpisode = (index: number) => {
    if (!currentEpisode) return
    const scene = currentEpisode.scenes[currentSceneIndex]
    if (!scene) return
    const src = scene.shots[index]
    if (!src) return
    pushEpisodeUndo(currentEpisode)
    const copy: D3Shot = {
      ...structuredClone(src),
      id: `${src.id}_copy_${Date.now().toString(36)}`,
      shotNumber: index + 2,
    }
    const shots = [...scene.shots]
    shots.splice(index + 1, 0, copy)
    const renumbered = shots.map((sh, i) => ({ ...sh, shotNumber: i + 1 }))
    const scenes = currentEpisode.scenes.map((sc, si) =>
      si === currentSceneIndex ? { ...sc, shots: renumbered } : sc
    )
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setSelectedTimelineShot(index + 1)
    setStatus('Shot duplicated')
  }

  const stopStageDialogue = () => {
    isPlayingRef.current = false
    activeTimeoutsRef.current.forEach((id) => clearTimeout(id))
    activeTimeoutsRef.current = []
    window.speechSynthesis?.cancel()
    setIsPlaying(false)
    activeEmoteActor1.current = null
    activeEmoteActor2.current = null
    speakingActorRef.current = null
    activeUserPerf1Ref.current = null
    activeUserPerf2Ref.current = null
    motionActor1.current = null
    motionActor2.current = null
    setStatus('Stage Stopped')
  }

  const startPerformanceRecording = () => {
    if (!currentEpisode?.scenes[currentSceneIndex]?.shots[selectedTimelineShot]) {
      setStatus('⚠️ Select a shot in the timeline first')
      return
    }
    if (isPlayingRef.current) stopStageDialogue()
    perfRecorderRef.current.start()
    isRecordingPerfRef.current = true
    setIsRecordingPerf(true)
    setMode('mocap')
    setStatus('🔴 Recording performance… act for the selected shot, then press Stop Record')
  }

  const stopPerformanceRecording = () => {
    isRecordingPerfRef.current = false
    setIsRecordingPerf(false)
    const recording = perfRecorderRef.current.stop()
    if (!recording || !currentEpisode?.scenes[currentSceneIndex]) {
      setStatus('⚠️ Recording too short — hold still and try again')
      return
    }
    pushEpisodeUndo(currentEpisode)
    const shot = currentEpisode.scenes[currentSceneIndex].shots[selectedTimelineShot]
    const speakerId =
      shot.dialogue?.speakerId ||
      Object.keys(shot.performances || {})[0] ||
      'char_host'
    const aiPerf = shot.performances?.[speakerId]
    const userPerf = PerformanceRecorder.toD3Performance(
      recording,
      aiPerf?.emotion || 'neutral',
      aiPerf?.gesture
    )
    const performances = {
      ...shot.performances,
      [speakerId]: userPerf,
      ...(aiPerf && aiPerf.source === 'AI' ? { [`${speakerId}__ai`]: aiPerf } : {}),
    }
    const scenes = currentEpisode.scenes.map((sc, si) => {
      if (si !== currentSceneIndex) return sc
      const shots = sc.shots.map((sh, i) =>
        i === selectedTimelineShot
          ? { ...sh, performances, duration: Math.max(sh.duration, recording.duration + 0.3) }
          : sh
      )
      return { ...sc, shots }
    })
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setStatus(`✅ USER performance saved (${recording.samples.length} samples, ${recording.duration.toFixed(1)}s)`)
  }

  const togglePerformanceSource = (index: number) => {
    if (!currentEpisode?.scenes[currentSceneIndex]) return
    const shot = currentEpisode.scenes[currentSceneIndex].shots[index]
    const keys = Object.keys(shot.performances || {}).filter((k) => !k.endsWith('__ai'))
    if (!keys.length) return
    const key = keys[0]
    const perf = shot.performances[key]
    const aiKey = `${key}__ai`
    if (perf.source === 'AI' && !(perf.blendshapeTrack?.length || perf.headRotationTrack?.length)) {
      setStatus('⚠️ No USER recording on this shot — Record Performance first')
      return
    }
    pushEpisodeUndo(currentEpisode)
    const performances = { ...shot.performances }
    if (perf.source === 'USER') {
      if (performances[aiKey]) {
        performances[key] = { ...performances[aiKey], source: 'AI' as const }
      } else {
        performances[key] = {
          ...perf,
          source: 'AI' as const,
          blendshapeTrack: undefined,
          headRotationTrack: undefined,
        }
      }
    } else {
      performances[key] = { ...perf, source: 'USER' as const }
    }
    const scenes = currentEpisode.scenes.map((sc, si) => {
      if (si !== currentSceneIndex) return sc
      const shots = sc.shots.map((sh, i) => (i === index ? { ...sh, performances } : sh))
      return { ...sc, shots }
    })
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setStatus(`Performance source → ${performances[key].source}`)
  }


  const triggerEmote = (emoteName: string, actor: 1 | 2 = 1) => {
    if (actor === 1) {
      activeEmoteActor1.current = emoteName
      emoteTimerActor1.current = 0
      emoteDuration1.current = 3.2
    } else {
      activeEmoteActor2.current = emoteName
      emoteTimerActor2.current = 0
      emoteDuration2.current = 3.0
    }
  }

  const readBonePose = (vrm: VRM | null) => {
    if (!vrm) return []
    return EXPORTED_POSE_BONES.map((bone) => {
      const node = vrm.humanoid?.getNormalizedBoneNode(bone)
      const e = node ? new THREE.Euler().setFromQuaternion(node.quaternion) : new THREE.Euler()
      return { bone, rotation: { x: e.x, y: e.y, z: e.z } }
    })
  }

  const exportSceneGraph = () => {
    if (!sceneRef.current || !cameraRef.current) {
      setStatus('⚠️ Cannot export — stage not initialized yet')
      return
    }
    setIsExporting(true)
    setStatus('📦 Packaging scene graph for Blender...')

    const stageConfig = STAGE_PRESETS[currentStage] || STAGE_PRESETS.cyberpunk
    const timeline = lastTimelineRef.current ?? resolveCurrentTimelinePlan().plan

    const toHex = (n: number) => '#' + n.toString(16).padStart(6, '0')

    const scene: SceneGraphExport = {
      formatVersion: SCENE_FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
      fps: 30,
      durationSeconds: timeline.durationSeconds,
      stage: {
        id: stageConfig.id,
        name: stageConfig.name,
        floorColor: toHex(stageConfig.floorColor),
        gridColor: toHex(stageConfig.gridColor),
        keyColor: stageConfig.keyColor,
        rimColor: stageConfig.rimColor,
      },
      lighting: [
        ambientLightRef.current && {
          type: 'ambient' as const,
          color: '#' + ambientLightRef.current.color.getHexString(),
          intensity: ambientLightRef.current.intensity,
        },
        keyLightRef.current && {
          type: 'directional' as const,
          color: '#' + keyLightRef.current.color.getHexString(),
          intensity: keyLightRef.current.intensity,
          position: { x: keyLightRef.current.position.x, y: keyLightRef.current.position.y, z: keyLightRef.current.position.z },
        },
        fillLightRef.current && {
          type: 'directional' as const,
          color: '#' + fillLightRef.current.color.getHexString(),
          intensity: fillLightRef.current.intensity,
          position: { x: fillLightRef.current.position.x, y: fillLightRef.current.position.y, z: fillLightRef.current.position.z },
        },
        rimLightRef.current && {
          type: 'directional' as const,
          color: '#' + rimLightRef.current.color.getHexString(),
          intensity: rimLightRef.current.intensity,
          position: { x: rimLightRef.current.position.x, y: rimLightRef.current.position.y, z: rimLightRef.current.position.z },
        },
      ].filter(Boolean) as SceneGraphExport['lighting'],
      actors: [
        actor1VrmRef.current && {
          id: 1 as ActorId,
          role: 'host' as const,
          vrmSourceUrl: actor1SourceUrlRef.current,
          position: {
            x: actor1VrmRef.current.scene.position.x,
            y: actor1VrmRef.current.scene.position.y,
            z: actor1VrmRef.current.scene.position.z,
          },
          rotationY: actor1VrmRef.current.scene.rotation.y,
          customization: { skinColor, hairColor, shirtColor, hairStyle, jawScale, shoulderWidth },
          restPose: readBonePose(actor1VrmRef.current),
        },
        actor2VrmRef.current && {
          id: 2 as ActorId,
          role: 'guest' as const,
          vrmSourceUrl: actor2SourceUrlRef.current,
          position: {
            x: actor2VrmRef.current.scene.position.x,
            y: actor2VrmRef.current.scene.position.y,
            z: actor2VrmRef.current.scene.position.z,
          },
          rotationY: actor2VrmRef.current.scene.rotation.y,
          customization: { skinColor, hairColor, shirtColor, hairStyle, jawScale, shoulderWidth },
          restPose: readBonePose(actor2VrmRef.current),
        },
      ].filter(Boolean) as SceneGraphExport['actors'],
      cameraTrack: timeline.cameraTrack,
      dialogueTimeline: timeline.dialogueTimeline,
      emoteTimeline: timeline.emoteTimeline,
    }

    const errors = validateSceneGraph(scene)
    if (errors.length > 0) {
      console.warn('Scene export validation warnings:', errors)
    }

    downloadSceneJSON(scene, `d3-scene-${Date.now()}.scene.json`)
    setIsExporting(false)
    setStatus('📦 Scene exported — ready for Blender rendering')
  }

  const exportCameraAnimation = () => {
    const timeline = lastTimelineRef.current ?? resolveCurrentTimelinePlan().plan
    if (!timeline.cameraTrack || timeline.cameraTrack.length === 0) {
      setStatus('⚠️ No camera animation to export — compile an episode first')
      return
    }

    const payload = {
      formatVersion: SCENE_FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
      fps: 30,
      durationSeconds: timeline.durationSeconds,
      cameraTrack: timeline.cameraTrack,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `d3-camera-animation-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setStatus('📸 Camera animation exported')
  }

  useEffect(() => {
    const currentMount = mountRef.current
    if (!currentMount) return

    let disposed = false // set true by cleanup; async init checks it after each await
    let faceLandmarker: FaceLandmarker | null = null
    let animationFrameId: number
    let videoStream: MediaStream | null = null
    let lastVideoTime = -1

    if ('speechSynthesis' in window) {
      // Self-clearing handler: some Chrome builds re-fire voiceschanged when
      // getVoices() is called inside the handler, spinning an event loop.
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null
        window.speechSynthesis.getVoices()
      }
      window.speechSynthesis.getVoices()
    }

    const scene = new THREE.Scene()
    sceneRef.current = scene
    scene.background = new THREE.Color('#090909')

    // 42° vertical FOV (from 30°) — composed environments sit well inside the
// visible frustum; the cinematic shot system is unchanged.
const camera = new THREE.PerspectiveCamera(42, currentMount.clientWidth / currentMount.clientHeight, 0.1, 25)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    currentMount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4)
    scene.add(ambientLight)
    ambientLightRef.current = ambientLight

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.5)
    keyLight.position.set(0, 2.5, 3.0)
    scene.add(keyLight)
    keyLightRef.current = keyLight

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.1)
    fillLight.position.set(-2, 2.0, 2.0)
    scene.add(fillLight)
    fillLightRef.current = fillLight

    const rimLight = new THREE.DirectionalLight(0xa0a0a0, 1.8)
    rimLight.position.set(0, 3.0, -2.5)
    scene.add(rimLight)
    rimLightRef.current = rimLight

    // Visual Style engine wraps the EXISTING lights/renderer/mutable fog —
    // no additional lights, no post-processing passes, no pixel-ratio change.
    visualStyleControllerRef.current = new VisualStyleController({
      scene,
      renderer,
      ambientLight,
      keyLight,
      fillLight,
      rimLight,
    })

    buildStageEnvironment('cyberpunk')

    // DEV-only: verify every procedural location builds real meshes with sane
    // bounds, is deterministic, and disposes cleanly. No-op in production.
    runEnvironmentSelfTest()

    loadActorModel(1, '/avatar.vrm')
    loadActorModel(2, '/avatar.vrm')

    // Quaternius animation library — fetched once, cached for all actors.
    loadQuaterniusAnimationLibrary()

    async function initVisionAndCamera() {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        )
        if (disposed) return // unmounted while loading WASM — do not continue

        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        })
        if (disposed) {
          faceLandmarker.close()
          faceLandmarker = null
          return // unmounted while creating landmarker — release GPU resources
        }

        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, facingMode: 'user' },
          audio: false,
        })
        if (disposed) {
          videoStream.getTracks().forEach((t) => t.stop())
          videoStream = null
          activeVideoStreamRef.current = null
          return // unmounted while requesting camera — release the stream
        }
        activeVideoStreamRef.current = videoStream

        if (videoRef.current) {
          videoRef.current.srcObject = videoStream
          videoRef.current.onloadedmetadata = () => videoRef.current?.play()
        }
      } catch (err) {
        console.warn('Vision bypassed:', err)
      }
    }

    initVisionAndCamera()

    const setBoneEuler = (vrm: VRM | null, boneName: VRMHumanBoneName, x: number, y: number, z: number, weight: number = 0.3) => {
      const node = vrm?.humanoid?.getNormalizedBoneNode(boneName)
      if (node) {
        const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
        node.quaternion.slerp(targetQ, weight)
      }
    }

    const timer = new THREE.Timer()
    const tempEuler = new THREE.Euler()
    const offsetVector = new THREE.Vector3()
    // Accumulated CHARACTER time (equals wall time in native mode; advances
    // only on sample frames when a stepped cadence is active).
    let charTimeAccum = 0

    const animate = (time: number) => {
      animationFrameId = requestAnimationFrame(animate)
      timer.update()
      const delta = timer.getDelta()

      TWEEN.update(time)

      // --- Visual Style: stepped motion sampling -----------------------------
      // charDelta is the CHARACTER-time delta for THIS rendered frame: equal
      // to `delta` in native mode, or a quantized step on 12/24 fps sample
      // frames (0 on held frames). Rendering stays at browser refresh rate.
      // Camera tweens (TWEEN), timeline scheduling, MediaPipe input and UI
      // remain on NATIVE time — only the character pose updates below consume
      // charDelta/charT. Steps sum to real elapsed time, so shot durations,
      // episode timing and motion SPEED are unchanged (classic 12/24 fps
      // television-animation cadence, nothing slows down).
      const charDelta = steppedClockRef.current.advance(delta)
      charTimeAccum += charDelta
      const charT = charTimeAccum
      charTimeRef.current = charT

      if (
        (modeRef.current === 'mocap' || isRecordingPerfRef.current) &&
        videoRef.current &&
        faceLandmarker &&
        videoRef.current.readyState >= 2 &&
        videoRef.current.currentTime !== lastVideoTime
      ) {
        lastVideoTime = videoRef.current.currentTime
        const results = faceLandmarker.detectForVideo(videoRef.current, performance.now())

        const blendshapeMap: Record<string, number> = {}
        if (results.faceBlendshapes?.[0]) {
          const shapes = results.faceBlendshapes[0].categories
          targetBlinkL.current = shapes.find((s) => s.categoryName === 'eyeBlinkLeft')?.score || 0
          targetBlinkR.current = shapes.find((s) => s.categoryName === 'eyeBlinkRight')?.score || 0
          const smileL = shapes.find((s) => s.categoryName === 'mouthSmileLeft')?.score || 0
          const smileR = shapes.find((s) => s.categoryName === 'mouthSmileRight')?.score || 0
          targetSmile.current = (smileL + smileR) / 2
          for (const s of shapes) {
            blendshapeMap[s.categoryName] = s.score
          }
        }

        if (results.facialTransformationMatrixes?.[0]) {
          const matrix = new THREE.Matrix4().fromArray(results.facialTransformationMatrixes[0].data)
          tempEuler.setFromRotationMatrix(matrix)
          targetHeadQuat.current.setFromEuler(
            new THREE.Euler(-tempEuler.x * 0.75, -tempEuler.y * 0.75, tempEuler.z * 0.75)
          )
        }

        if (isRecordingPerfRef.current) {
          perfRecorderRef.current.sample(blendshapeMap, targetHeadQuat.current)
        }
      }

      // Apply USER-recorded performance tracks during playback
      if (isPlayingRef.current && activeUserPerf1Ref.current) {
        const elapsed = (performance.now() - userPerfStart1Ref.current) / 1000
        const bs = PerformanceRecorder.sampleBlendshapesAt(
          activeUserPerf1Ref.current.blendshapeTrack,
          elapsed
        )
        if (bs && actor1VrmRef.current?.expressionManager) {
          const exp = actor1VrmRef.current.expressionManager
          if (bs['eyeBlinkLeft'] != null) exp.setValue('blinkLeft', bs['eyeBlinkLeft'])
          if (bs['eyeBlinkRight'] != null) exp.setValue('blinkRight', bs['eyeBlinkRight'])
          const sm =
            ((bs['mouthSmileLeft'] || 0) + (bs['mouthSmileRight'] || 0)) / 2
          exp.setValue('happy', sm)
          exp.update()
        }
        const hq = PerformanceRecorder.sampleHeadAt(
          activeUserPerf1Ref.current.headRotationTrack,
          elapsed
        )
        if (hq && actor1VrmRef.current) {
          const headNode = actor1VrmRef.current.humanoid?.getNormalizedBoneNode('head')
          if (headNode) {
            headNode.quaternion.set(hq[0], hq[1], hq[2], hq[3])
          }
        }
      }

      if (actor1VrmRef.current) {
        const exp = actor1VrmRef.current.expressionManager
        if (exp) {
          const isActor1Speaking = speakingActorRef.current === 1
          if (isActor1Speaking) {
            exp.setValue('aa', actor1Viseme.current)
            exp.setValue('happy', 0.4)
          } else if (modeRef.current === 'mocap' || isRecordingPerfRef.current) {
            currentBlinkL.current = THREE.MathUtils.lerp(currentBlinkL.current, targetBlinkL.current, 0.35)
            currentBlinkR.current = THREE.MathUtils.lerp(currentBlinkR.current, targetBlinkR.current, 0.35)
            currentSmile.current = THREE.MathUtils.lerp(currentSmile.current, targetSmile.current, 0.2)
            exp.setValue('blinkLeft', currentBlinkL.current)
            exp.setValue('blinkRight', currentBlinkR.current)
            exp.setValue('happy', currentSmile.current)
          } else {
            exp.setValue('aa', 0)
            exp.setValue('blink', 0)
          }
          exp.update()
        }

        // --- STORY MOTION: root translation / yaw + walk gait (visible) ---
        const m1 = motionActor1.current
        let gaitSwing1 = 0
        let gaitAmp1 = 0
        if (m1 && !activeUserPerf1Ref.current) {
          const vrmRoot = actor1VrmRef.current.scene
          const mt = charT - m1.startedAt
          const p = Math.min(mt / m1.duration, 1)
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
          if (m1.kind === 'walk' || m1.kind === 'step_back') {
            vrmRoot.position.lerpVectors(m1.startPos, m1.targetPos, ease)
            if (m1.kind === 'walk') {
              vrmRoot.position.y =
                Math.abs(Math.sin(gaitPhase1.current * 2)) * 0.025 * Math.min(1, mt * 2.5)
            }
          }
          let dyaw = m1.targetYaw - m1.startYaw
          dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
          vrmRoot.rotation.y = m1.startYaw + dyaw * ease
          if (m1.kind === 'walk') {
            gaitPhase1.current += charDelta * 7.2
            gaitAmp1 = Math.min(1, mt * 2.2) * (p > 0.9 ? (1 - p) / 0.1 : 1)
            gaitSwing1 = Math.sin(gaitPhase1.current)
            const s = gaitSwing1 * gaitAmp1
            setBoneEuler(actor1VrmRef.current, 'leftUpperLeg', -s * 0.52, 0, 0, 0.4)
            setBoneEuler(actor1VrmRef.current, 'rightUpperLeg', s * 0.52, 0, 0, 0.4)
            setBoneEuler(actor1VrmRef.current, 'leftLowerLeg', Math.max(0, s) * 0.5, 0, 0, 0.4)
            setBoneEuler(actor1VrmRef.current, 'rightLowerLeg', Math.max(0, -s) * 0.5, 0, 0, 0.4)
          }
          if (p >= 1) {
            vrmRoot.position.y = 0
            motionActor1.current = null
          }
        }

        // --- idle breathing + subtle posture variation (character time) ---
        const breath1 = Math.sin(charT * 1.8) * 0.018
        const swayZ1 = Math.sin(charT * 0.47) * 0.02
        const swayY1 = Math.sin(charT * 0.31 + 1.7) * 0.025
        if ((modeRef.current === 'mocap' || isRecordingPerfRef.current) && !activeUserPerf1Ref.current) {
          currentHeadQuat.current.slerp(targetHeadQuat.current, 0.2)
          const headNode = actor1VrmRef.current.humanoid?.getNormalizedBoneNode('head')
          if (headNode && !activeEmoteActor1.current) {
            headNode.quaternion.copy(currentHeadQuat.current)
          }
        } else if (!activeUserPerf1Ref.current) {
          const speaking1 = speakingActorRef.current === 1
          const nodX1 = speaking1 ? Math.sin(charT * 4.2) * 0.038 : Math.sin(charT * 0.83) * 0.02
          const idleYaw1 = speaking1 ? 0 : Math.sin(charT * 0.5) * 0.05
          setBoneEuler(actor1VrmRef.current, 'head', nodX1, idleYaw1, 0, 0.12)
        }

        // --- gestures: run their own duration, then blend back to neutral ---
        const e1 = activeEmoteActor1.current
        if (e1) {
          emoteTimerActor1.current += charDelta
          const t = emoteTimerActor1.current
          if (e1 === 'wave') {
            const waveOsc = Math.sin(t * 8.0) * 0.45
            setBoneEuler(actor1VrmRef.current, 'rightUpperArm', -0.45, -0.35, -0.28, 0.18)
            setBoneEuler(actor1VrmRef.current, 'rightLowerArm', 0, 0, -1.75, 0.18)
            setBoneEuler(actor1VrmRef.current, 'rightHand', waveOsc * 0.25, 0, waveOsc, 0.25)
          } else if (e1 === 'bow') {
            const bowEnv = Math.sin(Math.min(t / 2.8, 1.0) * Math.PI)
            setBoneEuler(actor1VrmRef.current, 'spine', bowEnv * 0.55, 0, 0, 0.2)
            setBoneEuler(actor1VrmRef.current, 'head', bowEnv * 0.2, 0, 0, 0.2)
          } else if (e1 === 'look_around') {
            const lookOsc = Math.sin(t * 2.8) * 0.35
            setBoneEuler(actor1VrmRef.current, 'head', 0.1, lookOsc, 0, 0.15)
            setBoneEuler(actor1VrmRef.current, 'spine', 0, lookOsc * 0.5, 0, 0.1)
          } else if (e1 === 'turn_head') {
            const turnEnv = Math.sin(Math.min(t / 2.4, 1.0) * Math.PI) * 0.45
            setBoneEuler(actor1VrmRef.current, 'head', 0, turnEnv, 0, 0.18)
          } else if (e1 === 'thumbs') {
            setBoneEuler(actor1VrmRef.current, 'rightUpperArm', -0.4, 0, -0.3, 0.18)
            setBoneEuler(actor1VrmRef.current, 'rightLowerArm', 0, 0, -1.5, 0.18)
          }
          if (t > emoteDuration1.current) activeEmoteActor1.current = null
        } else {
          setBoneEuler(actor1VrmRef.current, 'spine', breath1, swayY1, swayZ1, 0.06)
        }

        // --- arms: relaxed neutral A-pose unless an arm-driven emote owns them.
        // VRM normalized rest is T-pose, so POSITIVE z lowers the right arm and
        // NEGATIVE z lowers the left arm. Slight elbow bend via lower-arm y.
        if (e1 !== 'wave' && e1 !== 'thumbs') {
          const sw1 = gaitSwing1 * gaitAmp1 * 0.38
          setBoneEuler(actor1VrmRef.current, 'rightUpperArm', -sw1, 0, 1.16, 0.14)
          setBoneEuler(actor1VrmRef.current, 'leftUpperArm', sw1, 0, -1.16, 0.14)
          setBoneEuler(actor1VrmRef.current, 'rightLowerArm', 0, 0.24, 0.06, 0.1)
          setBoneEuler(actor1VrmRef.current, 'leftLowerArm', 0, -0.24, -0.06, 0.1)
        }

        actor1VrmRef.current.update(charDelta)
      }

      if (actor2VrmRef.current) {
        const exp = actor2VrmRef.current.expressionManager
        if (exp) {
          const isActor2Speaking = speakingActorRef.current === 2
          exp.setValue('aa', isActor2Speaking ? actor2Viseme.current : 0)
          exp.setValue('happy', isActor2Speaking ? 0.4 : 0.1)
          exp.setValue('blink', 0)
          exp.update()
        }

        // --- STORY MOTION (actor 2): root translation / yaw + walk gait ---
        const m2 = motionActor2.current
        let gaitSwing2 = 0
        let gaitAmp2 = 0
        if (m2 && !activeUserPerf2Ref.current) {
          const vrmRoot2 = actor2VrmRef.current.scene
          const mt2 = charT - m2.startedAt
          const p2 = Math.min(mt2 / m2.duration, 1)
          const ease2 = p2 < 0.5 ? 2 * p2 * p2 : 1 - Math.pow(-2 * p2 + 2, 2) / 2
          if (m2.kind === 'walk' || m2.kind === 'step_back') {
            vrmRoot2.position.lerpVectors(m2.startPos, m2.targetPos, ease2)
            if (m2.kind === 'walk') {
              vrmRoot2.position.y =
                Math.abs(Math.sin(gaitPhase2.current * 2)) * 0.025 * Math.min(1, mt2 * 2.5)
            }
          }
          let dyaw2 = m2.targetYaw - m2.startYaw
          dyaw2 = Math.atan2(Math.sin(dyaw2), Math.cos(dyaw2))
          vrmRoot2.rotation.y = m2.startYaw + dyaw2 * ease2
          if (m2.kind === 'walk') {
            gaitPhase2.current += charDelta * 7.2
            gaitAmp2 = Math.min(1, mt2 * 2.2) * (p2 > 0.9 ? (1 - p2) / 0.1 : 1)
            gaitSwing2 = Math.sin(gaitPhase2.current)
            const s2 = gaitSwing2 * gaitAmp2
            setBoneEuler(actor2VrmRef.current, 'leftUpperLeg', -s2 * 0.52, 0, 0, 0.4)
            setBoneEuler(actor2VrmRef.current, 'rightUpperLeg', s2 * 0.52, 0, 0, 0.4)
            setBoneEuler(actor2VrmRef.current, 'leftLowerLeg', Math.max(0, s2) * 0.5, 0, 0, 0.4)
            setBoneEuler(actor2VrmRef.current, 'rightLowerLeg', Math.max(0, -s2) * 0.5, 0, 0, 0.4)
          }
          if (p2 >= 1) {
            vrmRoot2.position.y = 0
            motionActor2.current = null
          }
        }

        // --- idle breathing + subtle posture variation (character time) ---
        const breath2 = Math.sin(charT * 1.8 + 1.2) * 0.018
        const swayZ2 = Math.sin(charT * 0.43 + 0.9) * 0.02
        const swayY2 = Math.sin(charT * 0.29 + 3.1) * 0.025
        const speaking2 = speakingActorRef.current === 2
        const nodX2 = speaking2 ? Math.sin(charT * 4.2) * 0.038 : Math.sin(charT * 0.77 + 0.9) * 0.02
        const idleYaw2 = speaking2 ? 0 : Math.sin(charT * 0.44 + 2.1) * 0.05
        setBoneEuler(actor2VrmRef.current, 'head', nodX2, idleYaw2, 0, 0.12)

        // --- gestures: run their own duration, then blend back to neutral ---
        const e2 = activeEmoteActor2.current
        if (e2) {
          emoteTimerActor2.current += charDelta
          const t2 = emoteTimerActor2.current
          if (e2 === 'wave') {
            const waveOsc2 = Math.sin(t2 * 8.0) * 0.45
            setBoneEuler(actor2VrmRef.current, 'rightUpperArm', -0.45, -0.35, -0.28, 0.18)
            setBoneEuler(actor2VrmRef.current, 'rightLowerArm', 0, 0, -1.75, 0.18)
            setBoneEuler(actor2VrmRef.current, 'rightHand', waveOsc2 * 0.25, 0, waveOsc2, 0.25)
          } else if (e2 === 'bow') {
            const bowEnv2 = Math.sin(Math.min(t2 / 2.8, 1.0) * Math.PI)
            setBoneEuler(actor2VrmRef.current, 'spine', bowEnv2 * 0.55, 0, 0, 0.2)
            setBoneEuler(actor2VrmRef.current, 'head', bowEnv2 * 0.2, 0, 0, 0.2)
          } else if (e2 === 'look_around') {
            const lookOsc = Math.sin(t2 * 2.8) * 0.35
            setBoneEuler(actor2VrmRef.current, 'head', 0.1, -lookOsc, 0, 0.15)
          } else if (e2 === 'turn_head') {
            const turnEnv = Math.sin(Math.min(t2 / 2.4, 1.0) * Math.PI) * -0.45
            setBoneEuler(actor2VrmRef.current, 'head', 0, turnEnv, 0, 0.18)
          } else if (e2 === 'thumbs') {
            setBoneEuler(actor2VrmRef.current, 'rightUpperArm', -0.4, 0, -0.3, 0.18)
            setBoneEuler(actor2VrmRef.current, 'rightLowerArm', 0, 0, -1.5, 0.18)
          }
          if (t2 > emoteDuration2.current) activeEmoteActor2.current = null
        } else {
          setBoneEuler(actor2VrmRef.current, 'spine', breath2, swayY2, swayZ2, 0.06)
        }

        // --- arms: relaxed neutral A-pose unless an arm-driven emote owns them ---
        if (e2 !== 'wave' && e2 !== 'thumbs') {
          const sw2 = gaitSwing2 * gaitAmp2 * 0.38
          setBoneEuler(actor2VrmRef.current, 'rightUpperArm', -sw2, 0, 1.16, 0.14)
          setBoneEuler(actor2VrmRef.current, 'leftUpperArm', sw2, 0, -1.16, 0.14)
          setBoneEuler(actor2VrmRef.current, 'rightLowerArm', 0, 0.24, 0.06, 0.1)
          setBoneEuler(actor2VrmRef.current, 'leftLowerArm', 0, -0.24, -0.06, 0.1)
        }

        actor2VrmRef.current.update(charDelta)
      }

      // --- Quaternius plain glTF actor animation (same loop, character time) ---
      if (actor1MixerRef.current) actor1MixerRef.current.update(charDelta)
      if (actor2MixerRef.current) actor2MixerRef.current.update(charDelta)

      // --- Quaternius basic locomotion: manual root translation + clip fades ---
      updateActorLocomotion(1, charDelta)
      updateActorLocomotion(2, charDelta)

      const liveTarget = getSubjectWorldPosition(activeAnchorRef.current)
      targetPivot.current.copy(liveTarget)
      currentPivot.current.lerp(targetPivot.current, 0.08)

      currentSpherical.current.radius = THREE.MathUtils.lerp(currentSpherical.current.radius, targetSpherical.current.radius, 0.06)
      currentSpherical.current.phi = THREE.MathUtils.lerp(currentSpherical.current.phi, targetSpherical.current.phi, 0.06)
      currentSpherical.current.theta = THREE.MathUtils.lerp(currentSpherical.current.theta, targetSpherical.current.theta, 0.06)

      offsetVector.setFromSpherical(currentSpherical.current)

      if (cameraRef.current) {
        cameraRef.current.position.set(
          currentPivot.current.x + offsetVector.x,
          currentPivot.current.y + offsetVector.y,
          currentPivot.current.z + offsetVector.z
        )
        cameraRef.current.lookAt(currentPivot.current)

        if (targetRollZ.current !== 0) {
          cameraRef.current.rotation.z = targetRollZ.current
        }
      }

      renderer.render(scene, camera)
    }

    animate(0)

    const handleResize = () => {
      if (!currentMount) return
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
      window.speechSynthesis?.cancel()
      if (videoStream) videoStream.getTracks().forEach((t) => t.stop())
      activeVideoStreamRef.current = null
      if (faceLandmarker) {
        faceLandmarker.close()
        faceLandmarker = null
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (currentMount.contains(renderer.domElement)) currentMount.removeChild(renderer.domElement)
      renderer.dispose()
      visualStyleControllerRef.current?.dispose()
      visualStyleControllerRef.current = null
    }
    // Mount-only lifecycle: renderer, stage, VRM actors, MediaPipe and the RAF
    // loop are created exactly once per page load. Mode changes are observed
    // via modeRef; Episode/Scene state can never restart this effect.
  }, [])

  // Keep modeRef in sync for the mount-only render loop (no effect restarts).
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  /**
   * Visual Style application — mutates the EXISTING scene/lights/fog/renderer
   * through the controller (no reallocation, no page reload). 'default'
   * restores the Environment Resolver's grade, preserving the original look
   * bit-for-bit. Cadence 'auto' follows the preset's steppedFps; 12/24
   * explicitly override it. Runs AFTER the mount effect, so the controller
   * always exists here.
   */
  useEffect(() => {
    visualStyleRef.current = visualStyle
    const preset = getVisualStylePreset(visualStyle)
    visualStyleControllerRef.current?.applyStyle(preset)
    steppedClockRef.current.setFps(
      motionCadence === 'auto' ? preset.steppedFps : motionCadence
    )
    if (styleEffectRanRef.current) {
      setStatus(`🎨 Visual Style: ${preset.label}`)
    } else {
      styleEffectRanRef.current = true
    }
  }, [visualStyle, motionCadence])

  // Bind the already-acquired camera stream when the MoCap <video> mounts.
  // MediaPipe / renderer are NOT re-initialized — only the <video> binding.
  useEffect(() => {
    if (mode === 'mocap' && videoRef.current && activeVideoStreamRef.current) {
      videoRef.current.srcObject = activeVideoStreamRef.current
      videoRef.current.onloadedmetadata = () => videoRef.current?.play()
    }
  }, [mode])

  useEffect(() => {
    applyCustomAvatarFeatures(actor1VrmRef.current)
  }, [skinColor, hairColor, shirtColor, hairStyle, jawScale, shoulderWidth])

  const enterFromCinematicIntro = (introMode: D3IntroMode) => {
    setShowCinematicIntro(false)
    setShowCustomizer(false)

    if (introMode === 'ai') {
      setMode('story')
      setShowTimeline(true)
      setStatus('🧠 AI Mode armed — generate a story to direct the stage')
      return
    }

    setMode('script')
    setShowTimeline(true)
    setStatus('🎬 Director Mode armed — script and block the scene manually')
  }

  return (
    <div className="d3-app">
      {showCinematicIntro && (
        <D3CinematicIntro
          onSelectMode={enterFromCinematicIntro}
          onSkip={() => enterFromCinematicIntro('ai')}
        />
      )}

      {/* Top Bar */}
      <div className="d3-app__topbar">
        <div className="d3-app__topbar-left">
          <div className="d3-logo">D3 STUDIO</div>
          <div className="d3-nav">
            <button
              className="d3-nav-item"
              onClick={() => setShowCinematicIntro(true)}
            >
              Intro
            </button>
            <button
              className={`d3-nav-item ${mode === 'story' ? 'd3-nav-item--active' : ''}`}
              onClick={() => setMode('story')}
            >
              Story
            </button>
            <button
              className={`d3-nav-item ${mode === 'script' ? 'd3-nav-item--active' : ''}`}
              onClick={() => setMode('script')}
            >
              Script
            </button>
            <button
              className={`d3-nav-item ${mode === 'mocap' ? 'd3-nav-item--active' : ''}`}
              onClick={() => setMode('mocap')}
            >
              MoCap
            </button>
            <button
              className={`d3-nav-item ${showCustomizer ? 'd3-nav-item--active' : ''}`}
              onClick={() => setShowCustomizer(!showCustomizer)}
            >
              Customize
            </button>
            <button
              className={`d3-nav-item ${showTimeline ? 'd3-nav-item--active' : ''}`}
              onClick={() => setShowTimeline(!showTimeline)}
            >
              Timeline
            </button>
          </div>
        </div>
        <div className="d3-app__topbar-right">
          {/* D3 Visual Style Engine — Phase 1 compact selector */}
          <div className="d3-style-controls">
            <span className="d3-style-controls__label">VISUAL STYLE</span>
            <select
              className="d3-select d3-style-controls__select"
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value as VisualStyle)}
              title="Cinematic look layered on the current environment"
            >
              {VISUAL_STYLE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div
              className="d3-segmented"
              title="Character motion cadence — visual sampling only (timing unchanged)"
            >
              {(['auto', 24, 12] as const).map((cad) => (
                <button
                  key={String(cad)}
                  type="button"
                  className={`d3-segmented-option ${motionCadence === cad ? 'd3-segmented-option--active' : ''}`}
                  onClick={() => setMotionCadence(cad)}
                >
                  {cad === 'auto' ? 'Auto' : `${cad}fps`}
                </button>
              ))}
            </div>
          </div>
          <Button variant="tertiary" size="sm" onClick={undoEpisodeEdit}>
            Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportSceneGraph}
            disabled={isExporting}
            title="Export the complete scene graph to Blender"
          >
            {isExporting ? 'Packaging...' : 'Export'}
          </Button>
        </div>
      </div>

      {/* Left Panel — Story / Script / Customize */}
      <div className="d3-app__sidebar">
        {/* Story Mode */}
        {mode === 'story' && !showCustomizer && (
          <div className="d3-panel d3-panel--compact">
            <div className="d3-panel-header">
              <span className="d3-panel-title">STORY</span>
            </div>

            <textarea
              value={storyPrompt}
              onChange={(e) => setStoryPrompt(e.target.value)}
              placeholder="Describe your scene..."
              className="d3-textarea"
              style={{ height: '85px', resize: 'none' }}
            />

            <div className="d3-story-presets">
              {STORY_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => setStoryPrompt(p.prompt)}
                  className="d3-chip"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="d3-panel__actions">
              <Button
                variant="primary"
                onClick={playStageDialogue}
                disabled={isPlaying}
              >
                {isPlaying ? 'Directing...' : 'Generate'}
              </Button>
              <Button
                variant="secondary"
                onClick={playEditedEpisode}
                disabled={isPlaying || !currentEpisode}
              >
                Play
              </Button>
              <Button
                variant="danger"
                onClick={stopStageDialogue}
              >
                Stop
              </Button>
            </div>

            {/* Episode info */}
            {currentEpisode && (
              <div className="d3-episode-info">
                <div>🎬 <strong>Episode:</strong> {currentEpisode.title}</div>
                <div>⏱ <strong>Estimated Duration:</strong> {currentEpisode.estimatedDuration.toFixed(1)}s</div>
                <div>🎞 <strong>Scenes:</strong> {currentEpisode.scenes.length} · <strong>Shots:</strong> {currentEpisode.scenes.reduce((n, sc) => n + sc.shots.length, 0)} camera cuts</div>
                <div>
                  🎭 <strong>Cast:</strong>{' '}
                  {(currentEpisode.castSlots || [])
                    .map((s) => `${s.displayName} (slot ${s.slot})`)
                    .join(' · ') ||
                    (currentEpisode.characters || []).map((c) => c.name).join(' · ') ||
                    'Lead · Supporting'}
                </div>
              </div>
            )}

            {/* Scene Navigator */}
            {currentEpisode && currentEpisode.scenes.length > 1 && (
              <div className="d3-scene-navigator">
                <div className="d3-scene-navigator__title">Scene Navigator</div>
                <div className="d3-scene-navigator__list">
                  {currentEpisode.scenes.map((scene, idx) => {
                    const isSelected = idx === currentSceneIndex
                    const sceneDuration = scene.shots.reduce((s, sh) => s + sh.duration, 0)
                    return (
                      <button
                        key={scene.id}
                        onClick={() => selectScene(idx)}
                        className={`d3-chip ${isSelected ? 'd3-chip--selected' : ''}`}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>
                          {isSelected ? '▶ ' : ''}[Scene {scene.sceneNumber}] — {scene.title || `Scene ${scene.sceneNumber}`}
                        </div>
                        <div style={{ opacity: 0.7, display: 'flex', gap: '8px', fontSize: '10px' }}>
                          <span>⏱ {sceneDuration.toFixed(1)}s</span>
                          <span>🎥 {scene.shots.length} shots</span>
                          <span>🎭 {scene.castIds.length} cast</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="d3-scene-navigator__controls">
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={goToPreviousScene}
                    disabled={currentSceneIndex <= 0}
                  >
                    ◀ Previous
                  </Button>
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={goToNextScene}
                    disabled={currentSceneIndex >= (currentEpisode?.scenes.length || 0) - 1}
                  >
                    Next ▶
                  </Button>
                </div>
              </div>
            )}

            {/* Stage presets */}
            <div className="d3-stage-presets">
              <span className="d3-stage-presets__label">STAGE:</span>
              {Object.entries(STAGE_PRESETS).map(([key, config]) => (
                <button
                  key={key}
                  onClick={() => {
                    if (key === currentStage) return
                    setCurrentStage(key)
                    buildStageEnvironment(key)
                  }}
                  className={`d3-chip ${currentStage === key ? 'd3-chip--selected' : ''}`}
                >
                  {config.name.split(' ')[0]}
                </button>
              ))}
            </div>

            {/* Record Performance / AI⇄USER */}
            {currentEpisode && (
              <div style={{ display: 'flex', gap: 'var(--d3-space-1)', marginTop: 'var(--d3-space-2)' }}>
                <Button
                  variant={isRecordingPerf ? 'danger' : 'tertiary'}
                  size="sm"
                  onClick={isRecordingPerf ? stopPerformanceRecording : startPerformanceRecording}
                  disabled={!currentEpisode}
                >
                  {isRecordingPerf ? '⏹ Stop Record' : '🔴 Record Performance'}
                </Button>
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => togglePerformanceSource(selectedTimelineShot)}
                  disabled={!currentEpisode}
                >
                  AI ⇄ USER
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Script Mode */}
        {mode === 'script' && !showCustomizer && (
          <div className="d3-panel d3-panel--compact">
            <div className="d3-panel-header">
              <span className="d3-panel-title">SCRIPT</span>
            </div>
            <textarea
              value={multiActorPrompt}
              onChange={(e) => setMultiActorPrompt(e.target.value)}
              placeholder="Host: dialogue...
Guest: dialogue..."
              className="d3-textarea"
              style={{ height: '90px', resize: 'none', fontFamily: 'monospace' }}
            />
            <div className="d3-panel__actions">
              <Button
                variant="secondary"
                onClick={playStageDialogue}
                disabled={isPlaying}
              >
                {isPlaying ? 'Directing...' : '▶ Play'}
              </Button>
              <Button variant="danger" onClick={stopStageDialogue}>
                Stop
              </Button>
            </div>
          </div>
        )}

        {/* Customize */}
        {showCustomizer && (
          <div className="d3-panel d3-panel--compact">
            <div className="d3-panel-header">
              <span className="d3-panel-title">CUSTOMIZE</span>
            </div>

            <div className="d3-customize-section">
              <div className="d3-customize-section__label">Skin Tone:</div>
              <div className="d3-customize-swatches">
                {[
                  { name: 'Deep', hex: '#523425' },
                  { name: 'Rich Brown', hex: '#6e473b' },
                  { name: 'Warm Tan', hex: '#96634e' },
                  { name: 'Golden Olive', hex: '#ba8565' },
                  { name: 'Fair', hex: '#ffd5c0' },
                ].map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => setSkinColor(c.hex)}
                    className="d3-swatch d3-swatch--circle"
                    style={{
                      background: c.hex,
                      border: skinColor === c.hex ? '2px solid var(--d3-border-hover)' : '1px solid var(--d3-border)',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={skinColor}
                  onChange={(e) => setSkinColor(e.target.value)}
                  style={{ width: '28px', height: '28px', border: 'none', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }}
                />
              </div>
            </div>

            <div className="d3-customize-section">
              <div className="d3-customize-section__label">Hair Style & Color:</div>
              <div className="d3-customize-hair-style">
                <Button
                  variant={hairStyle === 'short' ? 'secondary' : 'tertiary'}
                  size="sm"
                  onClick={() => setHairStyle('short')}
                >
                  Short Crop
                </Button>
                <Button
                  variant={hairStyle === 'long' ? 'secondary' : 'tertiary'}
                  size="sm"
                  onClick={() => setHairStyle('long')}
                >
                  Long Hair
                </Button>
              </div>
              <div className="d3-customize-swatches">
                {['#140f0c', '#2c1810', '#4a2e1b', '#855430', '#c29d62'].map((hex) => (
                  <button
                    key={hex}
                    onClick={() => setHairColor(hex)}
                    className="d3-swatch d3-swatch--circle"
                    style={{
                      background: hex,
                      border: hairColor === hex ? '2px solid var(--d3-border-hover)' : '1px solid var(--d3-border)',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={hairColor}
                  onChange={(e) => setHairColor(e.target.value)}
                  style={{ width: '26px', height: '26px', border: 'none', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }}
                />
              </div>
            </div>

            <div className="d3-customize-section">
              <div className="d3-customize-section__label">Outfit Color:</div>
              <div className="d3-customize-swatches">
                {['#2563eb', '#0f172a', '#15803d', '#dc2626', '#f8fafc'].map((hex) => (
                  <button
                    key={hex}
                    onClick={() => setShirtColor(hex)}
                    className="d3-swatch"
                    style={{
                      background: hex,
                      border: shirtColor === hex ? '2px solid var(--d3-border-hover)' : '1px solid var(--d3-border)',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={shirtColor}
                  onChange={(e) => setShirtColor(e.target.value)}
                  style={{ width: '26px', height: '26px', border: 'none', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }}
                />
              </div>
            </div>

            <div className="d3-customize-section">
              <div className="d3-customize-range">
                <label>Jaw Scale: {jawScale.toFixed(2)}</label>
                <input
                  type="range"
                  min="0.8"
                  max="1.3"
                  step="0.01"
                  value={jawScale}
                  onChange={(e) => setJawScale(parseFloat(e.target.value))}
                  className="d3-range"
                />
              </div>
            </div>

            <div className="d3-customize-section">
              <div className="d3-customize-range">
                <label>Shoulder Width: {shoulderWidth.toFixed(2)}</label>
                <input
                  type="range"
                  min="0.8"
                  max="1.4"
                  step="0.01"
                  value={shoulderWidth}
                  onChange={(e) => setShoulderWidth(parseFloat(e.target.value))}
                  className="d3-range"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Viewport — the dominant area */}
      <div className="d3-app__viewport">
        <div ref={mountRef} className="d3-viewport__canvas-container" />

        {/* Visual Style post look — pure CSS vignette + grain (composited GPU
            layers, zero extra WebGL passes). Opacity comes from the active
            preset; both are fully transparent in Default. Sits ABOVE the
            canvas but BELOW all floating viewport controls (z-index 5 < 10). */}
        <div className="d3-style-overlay" aria-hidden="true">
          <div
            className="d3-style-overlay__vignette"
            style={{ opacity: getVisualStylePreset(visualStyle).vignetteStrength }}
          />
          <div
            className="d3-style-overlay__grain"
            style={{ opacity: getVisualStylePreset(visualStyle).grainStrength }}
          />
        </div>

        {/* Status bar */}
        <div className="d3-status-bar">
          <span className="d3-status">
            <span className="d3-status-dot d3-status-dot--idle"></span>
            {status}
          </span>
        </div>

        {/* Performance bar (compact secondary) */}
        <div className="d3-performance-bar">
          <Button variant="tertiary" size="sm" onClick={() => triggerEmote('wave', 1)}>Wave</Button>
          <Button variant="tertiary" size="sm" onClick={() => triggerEmote('look_around', 1)}>Look Around</Button>
          <Button variant="tertiary" size="sm" onClick={() => triggerEmote('turn_head', 2)}>Turn Head</Button>
          <Button variant="tertiary" size="sm" onClick={() => triggerEmote('bow', 2)}>Bow</Button>
        </div>

        {/* Actor upload controls */}
        <div className="d3-actor-upload">
          <input
            type="file"
            ref={fileInputRef1}
            accept=".vrm"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadActorModel(1, URL.createObjectURL(file))
            }}
            style={{ display: 'none' }}
          />
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => fileInputRef1.current?.click()}
            title="Runtime slot 1 (Lead)"
          >
            📁 {CharacterLibraryService.displayNameForSlot(1, currentEpisode?.castSlots)} VRM
          </Button>

          <input
            type="file"
            ref={fileInputRef2}
            accept=".vrm"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadActorModel(2, URL.createObjectURL(file))
            }}
            style={{ display: 'none' }}
          />
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => fileInputRef2.current?.click()}
            title="Runtime slot 2 (Supporting)"
          >
            📁 {CharacterLibraryService.displayNameForSlot(2, currentEpisode?.castSlots)} VRM
          </Button>
        </div>

        {/* MoCap video monitor */}
        {mode === 'mocap' && (
          <div className="d3-mocap-monitor">
            <video ref={videoRef} autoPlay playsInline muted />
          </div>
        )}
      </div>

      {/* Right Panel — Camera */}
      <div className="d3-app__right-panel">
        <div className="d3-panel-title">CAMERA</div>
        {Object.entries(CINEMATIC_SHOTS).map(([key, config]) => (
          <button
            key={key}
            onClick={() => applyCameraShot(key)}
            className={`d3-camera-shot ${selectedShot === key ? 'd3-camera-shot--selected' : ''}`}
          >
            {config.name}
          </button>
        ))}

        <Button
          variant="tertiary"
          size="sm"
          onClick={exportCameraAnimation}
          style={{ marginTop: 'var(--d3-space-2)' }}
        >
          Export Camera Animation
        </Button>
      </div>

      {/* Timeline */}
      <div className="d3-app__timeline">
        {showTimeline && currentEpisode && !showCustomizer && (
          <TimelineEditor
            episode={currentEpisode}
            activeSceneIndex={currentSceneIndex}
            selectedShotIndex={selectedTimelineShot}
            onSelectShot={setSelectedTimelineShot}
            onUpdateShot={updateShotInEpisode}
            onDeleteShot={deleteShotInEpisode}
            onDuplicateShot={duplicateShotInEpisode}
            onPlayFromShot={() => playEditedEpisode()}
            disabled={isPlaying}
          />
        )}
      </div>
    </div>
  )
}
