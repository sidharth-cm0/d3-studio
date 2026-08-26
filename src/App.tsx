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
import { CharacterLibraryService } from './services/characterLibrary'
import { TimelineEditor } from './components/TimelineEditor'
import { PerformanceRecorder } from './services/performanceRecorder'
import type { D3Performance } from './types/d3'
import './styles/design-system.css'
import './App.css'
import { Button } from './components/ui/Button'

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

/** Public sample VRM used when /avatar.vrm is missing from public/ */
const DEFAULT_VRM_URL =
  'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@v3.1.4/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

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
  const buildStageEnvironment = (stageKey: string, envOverride?: ResolvedEnvironment) => {
    const scene = sceneRef.current
    if (!scene) return
    const env =
      envOverride ?? EnvironmentResolverService.resolveForPreset(stageKey as D3StagePresetId)
    appliedEnvKeyRef.current = env.signature
    const config = STAGE_PRESETS[env.preset] || STAGE_PRESETS.cyberpunk

    // Dispose the previous environment FULLY before replacing, so switching
    // scenes/environments never leaks GPU resources. The procedural props
    // group is disposed explicitly first; the whole-stage deep sweep after it
    // is idempotent (three.js dispose is safe to call twice).
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

    if (env.useBaseStage) {
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
    if (!env.useBaseStage) {
      const envGroup = buildEnvironmentGroup(env)
      propsGroupRef.current = envGroup
      stageGroup.add(envGroup)
      // DEV-only trace: logs the live environment state (kind / meshes /
      // bounds / camera) so missing-geometry bugs are visible immediately.
      logRuntimeEnvTrace(env, envGroup, cameraRef.current)
    }

    scene.add(stageGroup)

    // --- atmosphere: sky background + depth fog ---
    scene.background = new THREE.Color(env.skyColor)
    scene.fog = new THREE.Fog(env.fogColor, env.fogNear, env.fogFar)

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

  const loadActorModel = (actorNum: 1 | 2, url: string, skipProbe = false) => {
    if (!sceneRef.current) return
    setStatus(`Loading Actor ${actorNum}...`)

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
        const vrm = gltf.userData.vrm as VRM
        if (!vrm) {
          console.error(`No VRM data in loaded file for Actor ${actorNum}`)
          setStatus(`⚠️ Actor ${actorNum}: file is not a valid VRM`)
          return
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.combineSkeletons(gltf.scene)
        VRMUtils.rotateVRM0(vrm)

        const posX = actorNum === 1 ? -0.75 : 0.75
        vrm.scene.position.set(posX, 0, 0)
        vrm.scene.rotation.y = actorNum === 1 ? 0.25 : -0.25

        if (actorNum === 1) {
          if (actor1VrmRef.current && sceneRef.current) {
            sceneRef.current.remove(actor1VrmRef.current.scene)
          }
          actor1VrmRef.current = vrm
          actor1SourceUrlRef.current = url
          applyCustomAvatarFeatures(vrm)
        } else {
          if (actor2VrmRef.current && sceneRef.current) {
            sceneRef.current.remove(actor2VrmRef.current.scene)
          }
          actor2VrmRef.current = vrm
          actor2SourceUrlRef.current = url
        }

        sceneRef.current?.add(vrm.scene)
        setStatus(
          url === DEFAULT_VRM_URL
            ? `🎯 Actor ${actorNum} ready (sample VRM) — upload your own anytime`
            : `🎯 Actor ${actorNum} Ready on Stage`
        )
      },
      undefined,
      (err) => {
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
    const env = EnvironmentResolverService.resolve({
      searchText: [
        scene.title,
        location?.name,
        location?.description,
        scene.narrativeGoal,
        scene.emotionalTone,
        episode.title,
      ]
        .filter(Boolean)
        .join(' · '),
      timeOfDay: scene.timeOfDay,
      emotionalTone: scene.emotionalTone,
      fallbackPreset: (location?.presetStageId ?? currentStage) as D3StagePresetId,
      // Deterministic layout identity: same location ⇒ same layout across its
      // scenes; different locations ⇒ different layouts.
      seedKey: location?.id ?? scene.id,
    })
    if (env.signature === appliedEnvKeyRef.current) return // same environment — skip
    if (env.preset !== currentStage) setCurrentStage(env.preset)
    buildStageEnvironment(env.preset, env)
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
      startedAt: performance.now(),
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
      if (env.signature !== appliedEnvKeyRef.current) {
        if (env.preset !== currentStage) setCurrentStage(env.preset)
        buildStageEnvironment(env.preset, env)
      }
    }

    setCurrentEpisode(episode)
    setCurrentSceneIndex(0)
    setSelectedTimelineShot(0)
    setShowTimeline(true)
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

    buildStageEnvironment('cyberpunk')

    // DEV-only: verify every procedural location builds real meshes with sane
    // bounds, is deterministic, and disposes cleanly. No-op in production.
    runEnvironmentSelfTest()

    loadActorModel(1, '/avatar.vrm')
    loadActorModel(2, '/avatar.vrm')

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

    const animate = (time: number) => {
      animationFrameId = requestAnimationFrame(animate)
      timer.update()
      const delta = timer.getDelta()
      const tSec = time * 0.001

      TWEEN.update(time)

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
          const mt = (performance.now() - m1.startedAt) / 1000
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
            gaitPhase1.current += delta * 7.2
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

        // --- idle breathing + subtle posture variation ---
        const breath1 = Math.sin(tSec * 1.8) * 0.018
        const swayZ1 = Math.sin(tSec * 0.47) * 0.02
        const swayY1 = Math.sin(tSec * 0.31 + 1.7) * 0.025
        if ((modeRef.current === 'mocap' || isRecordingPerfRef.current) && !activeUserPerf1Ref.current) {
          currentHeadQuat.current.slerp(targetHeadQuat.current, 0.2)
          const headNode = actor1VrmRef.current.humanoid?.getNormalizedBoneNode('head')
          if (headNode && !activeEmoteActor1.current) {
            headNode.quaternion.copy(currentHeadQuat.current)
          }
        } else if (!activeUserPerf1Ref.current) {
          const speaking1 = speakingActorRef.current === 1
          const nodX1 = speaking1 ? Math.sin(tSec * 4.2) * 0.038 : Math.sin(tSec * 0.83) * 0.02
          const idleYaw1 = speaking1 ? 0 : Math.sin(tSec * 0.5) * 0.05
          setBoneEuler(actor1VrmRef.current, 'head', nodX1, idleYaw1, 0, 0.12)
        }

        // --- gestures: run their own duration, then blend back to neutral ---
        const e1 = activeEmoteActor1.current
        if (e1) {
          emoteTimerActor1.current += delta
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

        actor1VrmRef.current.update(delta)
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
          const mt2 = (performance.now() - m2.startedAt) / 1000
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
            gaitPhase2.current += delta * 7.2
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

        // --- idle breathing + subtle posture variation ---
        const breath2 = Math.sin(tSec * 1.8 + 1.2) * 0.018
        const swayZ2 = Math.sin(tSec * 0.43 + 0.9) * 0.02
        const swayY2 = Math.sin(tSec * 0.29 + 3.1) * 0.025
        const speaking2 = speakingActorRef.current === 2
        const nodX2 = speaking2 ? Math.sin(tSec * 4.2) * 0.038 : Math.sin(tSec * 0.77 + 0.9) * 0.02
        const idleYaw2 = speaking2 ? 0 : Math.sin(tSec * 0.44 + 2.1) * 0.05
        setBoneEuler(actor2VrmRef.current, 'head', nodX2, idleYaw2, 0, 0.12)

        // --- gestures: run their own duration, then blend back to neutral ---
        const e2 = activeEmoteActor2.current
        if (e2) {
          emoteTimerActor2.current += delta
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

        actor2VrmRef.current.update(delta)
      }

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
    }
    // Mount-only lifecycle: renderer, stage, VRM actors, MediaPipe and the RAF
    // loop are created exactly once per page load. Mode changes are observed
    // via modeRef; Episode/Scene state can never restart this effect.
  }, [])

  // Keep modeRef in sync for the mount-only render loop (no effect restarts).
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

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

  return (
    <div className="d3-app">
      {/* Top Bar */}
      <div className="d3-app__topbar">
        <div className="d3-app__topbar-left">
          <div className="d3-logo">D3 STUDIO</div>
          <div className="d3-nav">
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
