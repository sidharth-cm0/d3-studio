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
import { D3Episode, D3Shot } from './types/d3'
import { AIDirectorService } from './services/aiDirector'
import { CharacterLibraryService } from './services/characterLibrary'
import { TimelineEditor } from './components/TimelineEditor'
import { PerformanceRecorder } from './services/performanceRecorder'
import type { D3Performance } from './types/d3'
import './App.css'

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
    gridColor: 0xf43f5e,
    keyColor: '#fff7ed',
    rimColor: '#f43f5e',
  },
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast Newsroom',
    floorColor: 0x1e293b,
    gridColor: 0x38bdf8,
    keyColor: '#ffffff',
    rimColor: '#6366f1',
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal Clean',
    floorColor: 0x0f172a,
    gridColor: 0x475569,
    keyColor: '#ffffff',
    rimColor: '#818cf8',
  },
}

const CINEMATIC_SHOTS: Record<string, CameraShotConfig> = {
  two_shot_wide: { name: 'Stage Two-Shot (Wide)', anchor: 'stage_center', radius: 2.8, phi: Math.PI / 2.1, theta: 0, fov: 40 },
  close_up: { name: 'Lead Close Up', anchor: 'actor1_head', radius: 0.72, phi: Math.PI / 2.05, theta: 0, fov: 28 },
  actor2_close: { name: 'Supporting Close Up', anchor: 'actor2_head', radius: 0.75, phi: Math.PI / 2.05, theta: -0.15, fov: 28 },
  low_angle: { name: 'Hero Low Angle', anchor: 'actor1_chest', radius: 1.05, phi: Math.PI / 1.65, theta: 0.08, fov: 34 },
  dutch_angle: { name: 'Dutch Angle', anchor: 'actor1_head', radius: 0.82, phi: Math.PI / 2.05, theta: -0.25, fov: 30, rollZ: 0.18 },
  over_shoulder: { name: 'Over Shoulder (OTS)', anchor: 'actor1_chest', radius: 0.95, phi: Math.PI / 2.2, theta: Math.PI * 0.7, fov: 30 },
}

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
  const [status, setStatus] = useState<string>('D3 Studio Ready — Suno for Animated Movies')
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
    'A detective enters an abandoned warehouse at midnight, looks around suspiciously, hears a sound and turns toward the shadows.'
  )
  const [currentEpisode, setCurrentEpisode] = useState<D3Episode | null>(null)
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

  const actor1VrmRef = useRef<VRM | null>(null)
  const actor2VrmRef = useRef<VRM | null>(null)
  const actor1SourceUrlRef = useRef<string>(DEFAULT_VRM_URL)
  const actor2SourceUrlRef = useRef<string>(DEFAULT_VRM_URL)
  const stageGroupRef = useRef<THREE.Group | null>(null)
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

  const buildStageEnvironment = (stageKey: string) => {
    if (!sceneRef.current) return
    const config = STAGE_PRESETS[stageKey] || STAGE_PRESETS.cyberpunk

    if (stageGroupRef.current) {
      sceneRef.current.remove(stageGroupRef.current)
    }

    const stageGroup = new THREE.Group()
    stageGroupRef.current = stageGroup

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

    sceneRef.current.add(stageGroup)

    if (keyLightRef.current && rimLightRef.current) {
      keyLightRef.current.color.set(config.keyColor)
      rimLightRef.current.color.set(config.rimColor)
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

  const loadActorModel = (actorNum: 1 | 2, url: string, isFallback = false) => {
    if (!sceneRef.current) return
    setStatus(`Loading Actor ${actorNum}...`)

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
        VRMUtils.removeUnnecessaryJoints(gltf.scene)
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
          isFallback
            ? `🎯 Actor ${actorNum} ready (sample VRM) — upload your own anytime`
            : `🎯 Actor ${actorNum} Ready on Stage`
        )
      },
      undefined,
      (err) => {
        // Vite returns index.html for missing /avatar.vrm → GLTF sees "<!doctype"
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`Actor ${actorNum} load failed (${url}):`, msg)
        if (!isFallback && (url === '/avatar.vrm' || url.startsWith('/'))) {
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
   * Generates or retrieves the deterministic timeline plan from the canonical AI Director layer.
   */
  const resolveCurrentTimelinePlan = () => {
    const stageKey = (currentStage as 'cyberpunk' | 'broadcast' | 'minimal') || 'cyberpunk'

    let episode: D3Episode
    if (mode === 'story') {
      episode = AIDirectorService.createEpisodePlan(storyPrompt, stageKey)
      setCurrentEpisode(episode)
    } else {
      episode = AIDirectorService.parseLegacyScriptToEpisode(multiActorPrompt, stageKey)
      setCurrentEpisode(episode)
    }

    return AIDirectorService.compileEpisodeToTimeline(episode, CINEMATIC_SHOTS)
  }

  /** Recompile canonical tracks from the structured episode (timeline editor path). */
  const recompileFromEpisode = (episode: D3Episode) => {
    const plan = AIDirectorService.compileEpisodeToTimeline(episode, CINEMATIC_SHOTS)
    lastTimelineRef.current = plan
    const total = episode.scenes.reduce(
      (sum, sc) => sum + sc.shots.reduce((s, sh) => s + sh.duration, 0),
      0
    )
    return { ...episode, estimatedDuration: total }
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

    // Schedule USER performance tracks from the current episode
    if (currentEpisode?.scenes[0]) {
      let tAcc = 0
      for (const shot of currentEpisode.scenes[0].shots) {
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
        } else {
          activeEmoteActor2.current = e.name
          emoteTimerActor2.current = 0
        }
      }, e.time * 1000)
      activeTimeoutsRef.current.push(id)
    })

    const finishTimeoutId = window.setTimeout(() => {
      isPlayingRef.current = false
      setIsPlaying(false)
      setStatus('🎬 Cut! Scene Complete — Ready to Export or Re-direct')
    }, plan.durationSeconds * 1000)
    activeTimeoutsRef.current.push(finishTimeoutId)
  }

  /** Generate from story/script prompt (AI Director). */
  const playStageDialogue = () => {
    const plan = resolveCurrentTimelinePlan()
    lastTimelineRef.current = plan
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
    const updated = recompileFromEpisode(currentEpisode)
    setCurrentEpisode(updated)
    if (lastTimelineRef.current) {
      schedulePlanPlayback(lastTimelineRef.current)
    }
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

  /** Map flat timeline index → { sceneIndex, localIndex } */
  const resolveFlatShotIndex = (flatIndex: number) => {
    if (!currentEpisode) return null
    let remaining = flatIndex
    for (let si = 0; si < currentEpisode.scenes.length; si++) {
      const count = currentEpisode.scenes[si].shots.length
      if (remaining < count) return { sceneIndex: si, localIndex: remaining }
      remaining -= count
    }
    return null
  }

  const updateShotInEpisode = (flatIndex: number, patch: Partial<D3Shot>) => {
    if (!currentEpisode) return
    const loc = resolveFlatShotIndex(flatIndex)
    if (!loc) return
    pushEpisodeUndo(currentEpisode)
    const scenes = currentEpisode.scenes.map((sc, si) => {
      if (si !== loc.sceneIndex) return sc
      const shots = sc.shots.map((sh, i) => (i === loc.localIndex ? { ...sh, ...patch } : sh))
      return { ...sc, shots }
    })
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setStatus('Timeline updated — Play Edit to preview')
  }

  const deleteShotInEpisode = (flatIndex: number) => {
    if (!currentEpisode) return
    const totalShots = currentEpisode.scenes.reduce((n, sc) => n + sc.shots.length, 0)
    if (totalShots <= 1) return
    const loc = resolveFlatShotIndex(flatIndex)
    if (!loc) return
    pushEpisodeUndo(currentEpisode)
    const scenes = currentEpisode.scenes
      .map((sc, si) => {
        if (si !== loc.sceneIndex) return sc
        const shots = sc.shots
          .filter((_, i) => i !== loc.localIndex)
          .map((sh, i) => ({ ...sh, shotNumber: i + 1 }))
        return { ...sc, shots }
      })
      .filter((sc) => sc.shots.length > 0)
      .map((sc, i) => ({ ...sc, sceneNumber: i + 1 }))
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setSelectedTimelineShot(Math.max(0, flatIndex - 1))
    setStatus('Shot deleted')
  }

  const duplicateShotInEpisode = (flatIndex: number) => {
    if (!currentEpisode) return
    const loc = resolveFlatShotIndex(flatIndex)
    if (!loc) return
    pushEpisodeUndo(currentEpisode)
    const scenes = currentEpisode.scenes.map((sc, si) => {
      if (si !== loc.sceneIndex) return sc
      const src = sc.shots[loc.localIndex]
      const copy: D3Shot = {
        ...structuredClone(src),
        id: `${src.id}_copy_${Date.now().toString(36)}`,
        shotNumber: loc.localIndex + 2,
      }
      const shots = [...sc.shots]
      shots.splice(loc.localIndex + 1, 0, copy)
      return {
        ...sc,
        shots: shots.map((sh, i) => ({ ...sh, shotNumber: i + 1 })),
      }
    })
    const next = recompileFromEpisode({ ...currentEpisode, scenes })
    setCurrentEpisode(next)
    setSelectedTimelineShot(flatIndex + 1)
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
    setStatus('Stage Stopped')
  }

  const startPerformanceRecording = () => {
    if (!currentEpisode?.scenes[0]?.shots[selectedTimelineShot]) {
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
    if (!recording || !currentEpisode?.scenes[0]) {
      setStatus('⚠️ Recording too short — hold still and try again')
      return
    }
    pushEpisodeUndo(currentEpisode)
    const shot = currentEpisode.scenes[0].shots[selectedTimelineShot]
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
      if (si !== 0) return sc
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
    if (!currentEpisode?.scenes[0]) return
    const shot = currentEpisode.scenes[0].shots[index]
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
      if (si !== 0) return sc
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
    } else {
      activeEmoteActor2.current = emoteName
      emoteTimerActor2.current = 0
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
    const timeline = lastTimelineRef.current ?? resolveCurrentTimelinePlan()

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

  useEffect(() => {
    const currentMount = mountRef.current
    if (!currentMount) return

    let faceLandmarker: FaceLandmarker | null = null
    let animationFrameId: number
    let videoStream: MediaStream | null = null
    let lastVideoTime = -1

    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
      window.speechSynthesis.getVoices()
    }

    const scene = new THREE.Scene()
    sceneRef.current = scene
    scene.background = new THREE.Color('#0b0f19')

    const camera = new THREE.PerspectiveCamera(30, currentMount.clientWidth / currentMount.clientHeight, 0.1, 25)
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

    const rimLight = new THREE.DirectionalLight(0x818cf8, 1.8)
    rimLight.position.set(0, 3.0, -2.5)
    scene.add(rimLight)
    rimLightRef.current = rimLight

    buildStageEnvironment('cyberpunk')

    loadActorModel(1, '/avatar.vrm')
    loadActorModel(2, '/avatar.vrm')

    async function initVisionAndCamera() {
      try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        )

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

        videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, facingMode: 'user' },
          audio: false,
        })

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

    const clock = new THREE.Clock()
    const tempEuler = new THREE.Euler()
    const offsetVector = new THREE.Vector3()

    const animate = (time: number) => {
      animationFrameId = requestAnimationFrame(animate)
      const delta = clock.getDelta()
      const tSec = time * 0.001

      TWEEN.update(time)

      if (
        (mode === 'mocap' || isRecordingPerfRef.current) &&
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
          } else if (mode === 'mocap' || isRecordingPerfRef.current) {
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

        const breath1 = Math.sin(tSec * 1.8) * 0.018
        if ((mode === 'mocap' || isRecordingPerfRef.current) && !activeUserPerf1Ref.current) {
          currentHeadQuat.current.slerp(targetHeadQuat.current, 0.2)
          const headNode = actor1VrmRef.current.humanoid?.getNormalizedBoneNode('head')
          if (headNode && !activeEmoteActor1.current) {
            headNode.quaternion.copy(currentHeadQuat.current)
          }
        } else if (!activeUserPerf1Ref.current) {
          const speechNodX = speakingActorRef.current === 1 ? Math.sin(tSec * 4.2) * 0.038 : 0
          setBoneEuler(actor1VrmRef.current, 'head', speechNodX, 0, 0, 0.12)
        }

        if (activeEmoteActor1.current) {
          emoteTimerActor1.current += delta
          const t = emoteTimerActor1.current
          if (activeEmoteActor1.current === 'wave') {
            const waveOsc = Math.sin(t * 8.0) * 0.45
            setBoneEuler(actor1VrmRef.current, 'rightUpperArm', -0.45, -0.35, -0.28, 0.18)
            setBoneEuler(actor1VrmRef.current, 'rightLowerArm', 0, 0, -1.75, 0.18)
            setBoneEuler(actor1VrmRef.current, 'rightHand', waveOsc * 0.25, 0, waveOsc, 0.25)
          } else if (activeEmoteActor1.current === 'bow') {
            const bowEnv = Math.sin(Math.min(t / 2.8, 1.0) * Math.PI)
            setBoneEuler(actor1VrmRef.current, 'spine', bowEnv * 0.55, 0, 0, 0.2)
            setBoneEuler(actor1VrmRef.current, 'head', bowEnv * 0.2, 0, 0, 0.2)
          } else if (activeEmoteActor1.current === 'look_around') {
            const lookOsc = Math.sin(t * 2.8) * 0.35
            setBoneEuler(actor1VrmRef.current, 'head', 0.1, lookOsc, 0, 0.15)
            setBoneEuler(actor1VrmRef.current, 'spine', 0, lookOsc * 0.5, 0, 0.1)
          } else if (activeEmoteActor1.current === 'turn_head') {
            const turnEnv = Math.sin(Math.min(t / 2.4, 1.0) * Math.PI) * 0.45
            setBoneEuler(actor1VrmRef.current, 'head', 0, turnEnv, 0, 0.18)
          } else if (activeEmoteActor1.current === 'thumbs') {
            setBoneEuler(actor1VrmRef.current, 'rightUpperArm', -0.4, 0, -0.3, 0.18)
            setBoneEuler(actor1VrmRef.current, 'rightLowerArm', 0, 0, -1.5, 0.18)
          }
          if (t > 3.2) activeEmoteActor1.current = null
        } else {
          setBoneEuler(actor1VrmRef.current, 'rightUpperArm', 0, 0, -1.25, 0.1)
          setBoneEuler(actor1VrmRef.current, 'leftUpperArm', 0, 0, 1.25, 0.1)
          setBoneEuler(actor1VrmRef.current, 'spine', breath1, 0, 0, 0.1)
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

        const breath2 = Math.sin(tSec * 1.8 + 1.2) * 0.018
        const speechNodX2 = speakingActorRef.current === 2 ? Math.sin(tSec * 4.2) * 0.038 : 0
        setBoneEuler(actor2VrmRef.current, 'head', speechNodX2, 0, 0, 0.12)

        if (activeEmoteActor2.current) {
          emoteTimerActor2.current += delta
          const t2 = emoteTimerActor2.current
          if (activeEmoteActor2.current === 'wave') {
            const waveOsc2 = Math.sin(t2 * 8.0) * 0.45
            setBoneEuler(actor2VrmRef.current, 'rightUpperArm', -0.45, -0.35, -0.28, 0.18)
            setBoneEuler(actor2VrmRef.current, 'rightLowerArm', 0, 0, -1.75, 0.18)
            setBoneEuler(actor2VrmRef.current, 'rightHand', waveOsc2 * 0.25, 0, waveOsc2, 0.25)
          } else if (activeEmoteActor2.current === 'bow') {
            const bowEnv2 = Math.sin(Math.min(t2 / 2.8, 1.0) * Math.PI)
            setBoneEuler(actor2VrmRef.current, 'spine', bowEnv2 * 0.55, 0, 0, 0.2)
            setBoneEuler(actor2VrmRef.current, 'head', bowEnv2 * 0.2, 0, 0, 0.2)
          } else if (activeEmoteActor2.current === 'look_around') {
            const lookOsc = Math.sin(t2 * 2.8) * 0.35
            setBoneEuler(actor2VrmRef.current, 'head', 0.1, -lookOsc, 0, 0.15)
          } else if (activeEmoteActor2.current === 'turn_head') {
            const turnEnv = Math.sin(Math.min(t2 / 2.4, 1.0) * Math.PI) * -0.45
            setBoneEuler(actor2VrmRef.current, 'head', 0, turnEnv, 0, 0.18)
          } else if (activeEmoteActor2.current === 'thumbs') {
            setBoneEuler(actor2VrmRef.current, 'rightUpperArm', -0.4, 0, -0.3, 0.18)
            setBoneEuler(actor2VrmRef.current, 'rightLowerArm', 0, 0, -1.5, 0.18)
          }
          if (t2 > 3.0) activeEmoteActor2.current = null
        } else {
          setBoneEuler(actor2VrmRef.current, 'rightUpperArm', 0, 0, -1.25, 0.1)
          setBoneEuler(actor2VrmRef.current, 'leftUpperArm', 0, 0, 1.25, 0.1)
          setBoneEuler(actor2VrmRef.current, 'spine', breath2, 0, 0, 0.1)
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
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
      window.speechSynthesis?.cancel()
      if (videoStream) videoStream.getTracks().forEach((t) => t.stop())
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (currentMount.contains(renderer.domElement)) currentMount.removeChild(renderer.domElement)
      renderer.dispose()
    }
  }, [mode])

  useEffect(() => {
    applyCustomAvatarFeatures(actor1VrmRef.current)
  }, [skinColor, hairColor, shirtColor, hairStyle, jawScale, shoulderWidth])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Top Left Navigation Bar */}
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 10 }}>
        <div style={{ padding: '8px 14px', background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', color: '#38bdf8', fontSize: '13px', fontWeight: 600, borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
          {status}
        </div>

        <div style={{ display: 'flex', gap: '6px', background: 'rgba(15, 23, 42, 0.85)', padding: '4px', borderRadius: '8px' }}>
          <button onClick={() => setMode('story')} style={{ background: mode === 'story' ? '#6366f1' : 'transparent', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>✨ Story-to-Movie AI</button>
          <button onClick={() => setMode('script')} style={{ background: mode === 'script' ? '#6366f1' : 'transparent', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>🎭 Script Mode</button>
          <button onClick={() => setMode('mocap')} style={{ background: mode === 'mocap' ? '#6366f1' : 'transparent', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>📹 Live MoCap</button>
          <button onClick={() => setShowCustomizer(!showCustomizer)} style={{ background: showCustomizer ? '#0284c7' : '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>🎨 Customize</button>
          <button
            onClick={() => setShowTimeline((v) => !v)}
            style={{ background: showTimeline ? '#0d9488' : '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            ⏱ Timeline
          </button>
          <button
            onClick={undoEpisodeEdit}
            title="Undo last timeline edit"
            style={{ background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            ↩ Undo
          </button>
          <button
            onClick={exportSceneGraph}
            disabled={isExporting}
            title="Export the complete scene graph to Blender"
            style={{ background: isExporting ? '#334155' : '#f59e0b', color: '#1e1b0f', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: isExporting ? 'not-allowed' : 'pointer' }}
          >
            {isExporting ? '📦 Packaging...' : '📦 Export Blender .scene.json'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', background: 'rgba(15, 23, 42, 0.88)', padding: '4px 8px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', alignSelf: 'center', marginRight: '4px' }}>STAGE:</span>
          {Object.entries(STAGE_PRESETS).map(([key, config]) => (
            <button
              key={key}
              onClick={() => {
                setCurrentStage(key)
                buildStageEnvironment(key)
              }}
              style={{
                background: currentStage === key ? '#6366f1' : '#1e293b',
                color: '#fff',
                border: 'none',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {config.name.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Story-to-Movie AI Mode Panel */}
      {mode === 'story' && !showCustomizer && (
        <div
          style={{
            position: 'absolute',
            top: 155,
            left: 16,
            width: '350px',
            background: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(14px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
            ✨ Suno for Animated Movies — Story Prompt
          </div>

          <textarea
            value={storyPrompt}
            onChange={(e) => setStoryPrompt(e.target.value)}
            placeholder="Type your story: e.g. A detective enters an abandoned warehouse at midnight..."
            style={{
              width: '100%',
              height: '85px',
              background: '#1e293b',
              color: '#fff',
              border: '1px solid #475569',
              borderRadius: '8px',
              padding: '8px',
              fontSize: '12px',
              resize: 'none',
              outline: 'none',
              fontFamily: 'sans-serif',
            }}
          />

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { label: '🕵️ Noir Mystery', prompt: 'A detective enters an abandoned warehouse at midnight, looks around suspiciously, hears a sound and turns toward the shadows.' },
              { label: '⚡ Cyber Infiltration', prompt: 'A netrunner jacks into a secure corporate core, discovers illegal telemetry data, and warns their operative to disconnect immediately.' },
              { label: '🎙️ Live Breaking News', prompt: 'A news anchor presents breaking satellite data while the remote correspondent delivers live verification from the field.' },
            ].map((p, idx) => (
              <button
                key={idx}
                onClick={() => setStoryPrompt(p.prompt)}
                style={{
                  background: '#334155',
                  color: '#e2e8f0',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={playStageDialogue}
              disabled={isPlaying}
              style={{
                flex: 1,
                minWidth: 140,
                background: isPlaying ? '#475569' : '#10b981',
                color: '#fff',
                border: 'none',
                padding: '10px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: isPlaying ? 'not-allowed' : 'pointer',
              }}
            >
              {isPlaying ? '🎬 Directing Movie Take...' : '▶ Generate & Direct Movie Scene'}
            </button>
            <button
              onClick={playEditedEpisode}
              disabled={isPlaying || !currentEpisode}
              title="Play current episode including timeline edits (does not re-run AI Director)"
              style={{
                background: isPlaying || !currentEpisode ? '#334155' : '#0ea5e9',
                color: '#fff',
                border: 'none',
                padding: '10px 12px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '12px',
                cursor: isPlaying || !currentEpisode ? 'not-allowed' : 'pointer',
              }}
            >
              ▶ Play Edit
            </button>
            <button
              onClick={stopStageDialogue}
              style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
            >
              ⏹ Stop
            </button>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={isRecordingPerf ? stopPerformanceRecording : startPerformanceRecording}
              disabled={!currentEpisode}
              style={{
                flex: 1,
                background: isRecordingPerf ? '#dc2626' : '#7c3aed',
                color: '#fff',
                border: 'none',
                padding: '8px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '12px',
                cursor: !currentEpisode ? 'not-allowed' : 'pointer',
              }}
            >
              {isRecordingPerf ? '⏹ Stop Record' : '🔴 Record Performance'}
            </button>
            <button
              onClick={() => togglePerformanceSource(selectedTimelineShot)}
              disabled={!currentEpisode}
              style={{
                background: '#334155',
                color: '#fff',
                border: 'none',
                padding: '8px 10px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '11px',
                cursor: !currentEpisode ? 'not-allowed' : 'pointer',
              }}
            >
              AI ⇄ USER
            </button>
          </div>

          {currentEpisode && (
            <div style={{ fontSize: '11px', color: '#94a3b8', borderTop: '1px solid #334155', paddingTop: '8px' }}>
              <div>🎬 <strong>Episode:</strong> {currentEpisode.title}</div>
              <div>⏱ <strong>Estimated Duration:</strong> {currentEpisode.estimatedDuration.toFixed(1)}s</div>
              <div>🎞 <strong>Scenes:</strong> {currentEpisode.scenes.length} · <strong>Shots:</strong> {currentEpisode.scenes.reduce((n, sc) => n + sc.shots.length, 0)} camera cuts</div>
              <div style={{ marginTop: 4 }}>
                🎭 <strong>Cast:</strong>{' '}
                {(currentEpisode.castSlots || [])
                  .map((s) => `${s.displayName} (slot ${s.slot})`)
                  .join(' · ') ||
                  (currentEpisode.characters || []).map((c) => c.name).join(' · ') ||
                  'Lead · Supporting'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Direct Script Mode Panel */}
      {mode === 'script' && !showCustomizer && (
        <div
          style={{
            position: 'absolute',
            top: 155,
            left: 16,
            width: '330px',
            background: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(14px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
            🎭 Script Mode Dialogue Director
          </div>

          <textarea
            value={multiActorPrompt}
            onChange={(e) => setMultiActorPrompt(e.target.value)}
            placeholder="Host: dialogue...
Guest: dialogue..."
            style={{
              width: '100%',
              height: '90px',
              background: '#1e293b',
              color: '#fff',
              border: '1px solid #475569',
              borderRadius: '8px',
              padding: '8px',
              fontSize: '11px',
              resize: 'none',
              outline: 'none',
              fontFamily: 'monospace',
            }}
          />

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={playStageDialogue}
              disabled={isPlaying}
              style={{ flex: 1, background: isPlaying ? '#475569' : '#10b981', color: '#fff', border: 'none', padding: '8px', borderRadius: '6px', fontWeight: 600, fontSize: '12px', cursor: isPlaying ? 'not-allowed' : 'pointer' }}>
              {isPlaying ? '🎬 Directing Scene...' : '▶ Play Dialogue Take'}
            </button>
            <button
              onClick={stopStageDialogue}
              style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', fontWeight: 600, fontSize: '12px', cursor: 'pointer' }}
            >
              ⏹ Stop
            </button>
          </div>
        </div>
      )}

      {/* Avatar Customization Drawer */}
      {showCustomizer && (
        <div
          style={{
            position: 'absolute',
            top: 155,
            left: 16,
            width: '320px',
            background: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            zIndex: 10,
            maxHeight: 'calc(100vh - 240px)',
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
            👤 Avatar Customization Suite
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Skin Tone:</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: c.hex,
                    border: skinColor === c.hex ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                  }}
                />
              ))}
              <input type="color" value={skinColor} onChange={(e) => setSkinColor(e.target.value)} style={{ width: '28px', height: '28px', border: 'none', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }} />
            </div>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Hair Style & Color:</span>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
              <button onClick={() => setHairStyle('short')} style={{ flex: 1, background: hairStyle === 'short' ? '#4f46e5' : '#1e293b', color: '#fff', border: 'none', padding: '6px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>✂️ Short Crop</button>
              <button onClick={() => setHairStyle('long')} style={{ flex: 1, background: hairStyle === 'long' ? '#4f46e5' : '#1e293b', color: '#fff', border: 'none', padding: '6px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>💇 Long Hair</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {['#140f0c', '#2c1810', '#4a2e1b', '#855430', '#c29d62'].map((hex) => (
                <button
                  key={hex}
                  onClick={() => setHairColor(hex)}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: hex,
                    border: hairColor === hex ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                  }}
                />
              ))}
              <input type="color" value={hairColor} onChange={(e) => setHairColor(e.target.value)} style={{ width: '26px', height: '26px', border: 'none', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }} />
            </div>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Outfit Color:</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {['#2563eb', '#0f172a', '#15803d', '#dc2626', '#f8fafc'].map((hex) => (
                <button
                  key={hex}
                  onClick={() => setShirtColor(hex)}
                  style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '4px',
                    background: hex,
                    border: shirtColor === hex ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                  }}
                />
              ))}
              <input type="color" value={shirtColor} onChange={(e) => setShirtColor(e.target.value)} style={{ width: '26px', height: '26px', border: 'none', borderRadius: '6px', cursor: 'pointer', background: 'transparent' }} />
            </div>
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Jaw Scale: {jawScale.toFixed(2)}</span>
            <input
              type="range"
              min="0.8"
              max="1.3"
              step="0.01"
              value={jawScale}
              onChange={(e) => setJawScale(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>

          <div>
            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Shoulder Width: {shoulderWidth.toFixed(2)}</span>
            <input
              type="range"
              min="0.8"
              max="1.4"
              step="0.01"
              value={shoulderWidth}
              onChange={(e) => setShoulderWidth(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </div>
        </div>
      )}

      {/* Right Camera Palette */}
      <div
        style={{
          position: 'absolute',
          top: 75,
          right: 16,
          bottom: 80,
          width: '230px',
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '12px',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>🎥 Camera Shots</div>
        {Object.entries(CINEMATIC_SHOTS).map(([key, config]) => (
          <button
            key={key}
            onClick={() => applyCameraShot(key)}
            style={{
              background: selectedShot === key ? '#6366f1' : '#1e293b',
              color: selectedShot === key ? '#fff' : '#cbd5e1',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '6px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              textAlign: 'left',
              cursor: 'pointer',
              fontWeight: selectedShot === key ? 600 : 400,
            }}
          >
            {config.name}
          </button>
        ))}
      </div>

      {/* Quick Trigger Emote Floating Bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 260,
          display: 'flex',
          gap: '6px',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          padding: '6px 10px',
          borderRadius: '10px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          zIndex: 10,
        }}
      >
        <button onClick={() => triggerEmote('wave', 1)} style={{ background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>👋 Wave</button>
        <button onClick={() => triggerEmote('look_around', 1)} style={{ background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>👀 Look Around</button>
        <button onClick={() => triggerEmote('turn_head', 2)} style={{ background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🔄 Turn Head</button>
        <button onClick={() => triggerEmote('bow', 2)} style={{ background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🙇 Bow</button>
      </div>

      {/* Actor Upload Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          padding: '10px 18px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 10,
        }}
      >
        <input type="file" ref={fileInputRef1} accept=".vrm" onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) loadActorModel(1, URL.createObjectURL(file))
        }} style={{ display: 'none' }} />
        <button
          onClick={() => fileInputRef1.current?.click()}
          title="Runtime slot 1 (Lead / former Host)"
          style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
        >
          📁 {CharacterLibraryService.displayNameForSlot(1, currentEpisode?.castSlots)} VRM
        </button>

        <input type="file" ref={fileInputRef2} accept=".vrm" onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) loadActorModel(2, URL.createObjectURL(file))
        }} style={{ display: 'none' }} />
        <button
          onClick={() => fileInputRef2.current?.click()}
          title="Runtime slot 2 (Supporting / former Guest)"
          style={{ background: '#ec4899', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
        >
          📁 {CharacterLibraryService.displayNameForSlot(2, currentEpisode?.castSlots)} VRM
        </button>
      </div>

      {/* MoCap Video Monitor */}
      {mode === 'mocap' && (
        <div style={{ position: 'absolute', bottom: 85, right: 16, zIndex: 10 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '160px', height: '120px', borderRadius: '10px', objectFit: 'cover', transform: 'scaleX(-1)', border: '2px solid rgba(255, 255, 255, 0.25)', boxShadow: '0 8px 20px rgba(0,0,0,0.5)', backgroundColor: '#000' }} />
        </div>
      )}

      {/* Module 6 — Interactive Timeline Editor */}
      {showTimeline && currentEpisode && !showCustomizer && (
        <TimelineEditor
          episode={currentEpisode}
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
  )
}

