import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { CinematicState, D3IntroMode, QualityTier } from './CinematicTimeline'
import { isAtOrAfter } from './CinematicTimeline'

const WOLF_URL = '/assets/cinematic/quaternius-wolf.glb'
const WOLF_IDLE_CLIP = 'Idle'
const WOLF_IDLE_2_CLIP = 'Idle_2'

interface SceneOptions {
  quality: QualityTier
  reducedMotion: boolean
  onWolfLoaded?: (loaded: boolean) => void
  onRenderParticleLayer?: (dt: number, now: number, stateAge: number) => void
}

interface CameraRig {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

const CAMERA_RIGS: Record<CinematicState, CameraRig> = {
  BOOT: { position: new THREE.Vector3(0, 1.75, 8.8), target: new THREE.Vector3(0, 1.12, -1.5), fov: 54 },
  STUDIO_REVEAL: { position: new THREE.Vector3(0, 1.68, 8.2), target: new THREE.Vector3(0, 1.08, -1.2), fov: 52 },
  CLAPBOARD_READY: { position: new THREE.Vector3(0, 1.5, 6.6), target: new THREE.Vector3(0, 1.1, -0.2), fov: 48 },
  CLAP: { position: new THREE.Vector3(0, 1.5, 6.35), target: new THREE.Vector3(0, 1.1, -0.25), fov: 46 },
  CAMERA_TRAVEL: { position: new THREE.Vector3(0.18, 1.38, 3.8), target: new THREE.Vector3(0.02, 1.05, -1.55), fov: 42 },
  WOLF_REVEAL: { position: new THREE.Vector3(0.55, 0.86, 2.35), target: new THREE.Vector3(0.05, 0.72, -0.35), fov: 36 },
  WOLF_IDLE: { position: new THREE.Vector3(0.34, 0.78, 1.95), target: new THREE.Vector3(0.02, 0.68, -0.28), fov: 33 },
  WOLF_SMOKE: { position: new THREE.Vector3(0.16, 0.76, 1.78), target: new THREE.Vector3(0.0, 0.72, -0.22), fov: 31 },
  EXHALE: { position: new THREE.Vector3(-0.1, 0.78, 1.74), target: new THREE.Vector3(0.02, 0.74, -0.22), fov: 30 },
  CIGAR_THROW: { position: new THREE.Vector3(0.1, 0.74, 1.9), target: new THREE.Vector3(0.42, 0.5, -0.32), fov: 33 },
  CIGAR_IMPACT: { position: new THREE.Vector3(0.22, 0.68, 2.2), target: new THREE.Vector3(0.1, 0.34, -0.15), fov: 36 },
  IGNITION: { position: new THREE.Vector3(0.16, 0.7, 2.1), target: new THREE.Vector3(0.02, 0.4, -0.12), fov: 35 },
  PAPER_BURN: { position: new THREE.Vector3(0.04, 0.8, 2.45), target: new THREE.Vector3(0, 0.52, -0.25), fov: 38 },
  MODES_REVEAL: { position: new THREE.Vector3(0.0, 0.84, 2.7), target: new THREE.Vector3(0, 0.58, -0.32), fov: 40 },
  MODES_READY: { position: new THREE.Vector3(0.0, 0.86, 2.75), target: new THREE.Vector3(0, 0.6, -0.34), fov: 40 },
  MODE_SELECTED: { position: new THREE.Vector3(0, 0.76, 2.0), target: new THREE.Vector3(0, 0.58, -0.42), fov: 30 },
  EXIT: { position: new THREE.Vector3(0, 1.02, 1.72), target: new THREE.Vector3(0, 0.82, -0.42), fov: 25 },
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose())
    return
  }
  material.dispose()
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) disposeMaterial(mesh.material)
  })
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return x * x * (3 - 2 * x)
}

export class CinematicScene {
  private readonly quality: QualityTier
  private readonly reducedMotion: boolean
  private readonly onWolfLoaded?: (loaded: boolean) => void
  private readonly onRenderParticleLayer?: (dt: number, now: number, stateAge: number) => void
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(54, 1, 0.05, 80)
  private readonly renderer: THREE.WebGLRenderer
  private readonly clock = new THREE.Clock()
  private readonly loader = new GLTFLoader()
  private readonly rootGroup = new THREE.Group()
  private readonly studioGroup = new THREE.Group()
  private readonly tunnelGroup = new THREE.Group()
  private readonly wolfRig = new THREE.Group()
  private readonly accessories = new THREE.Group()
  private readonly cigarRig = new THREE.Group()
  private readonly paperRig = new THREE.Group()
  private readonly thrownCigar = new THREE.Group()
  private readonly emberLight = new THREE.PointLight(0xff7b35, 0, 2.4)
  private readonly fireLight = new THREE.PointLight(0xff8b3a, 0, 4.2)
  private readonly cameraPosition = new THREE.Vector3().copy(CAMERA_RIGS.BOOT.position)
  private readonly cameraTarget = new THREE.Vector3().copy(CAMERA_RIGS.BOOT.target)
  private readonly pointer = new THREE.Vector2(0, 0)
  private readonly paperMeshes: Record<D3IntroMode, THREE.Mesh> = {} as Record<D3IntroMode, THREE.Mesh>
  private readonly edgeLights: THREE.Mesh[] = []
  private container: HTMLElement | null = null
  private animationFrame = 0
  private currentState: CinematicState = 'BOOT'
  private stateEnteredAt = performance.now()
  private paused = false
  private selectedMode: D3IntroMode | null = null
  private hoveredMode: D3IntroMode | null = null
  private wolfObject: THREE.Object3D | null = null
  private wolfMixer: THREE.AnimationMixer | null = null
  private wolfIdleAction: THREE.AnimationAction | null = null
  private wolfAssetLoaded = false
  private wolfHeadAnchor = new THREE.Vector3(0.02, 1.32, -0.22)
  private wolfCigarAnchor = new THREE.Vector3(0.48, 1.02, 0.18)
  private wolfHeadRadius = 0.36
  private wolfHeightScale = 1
  private travelRibbons: THREE.Mesh[] = []

  constructor(options: SceneOptions) {
    this.quality = options.quality
    this.reducedMotion = options.reducedMotion
    this.onWolfLoaded = options.onWolfLoaded
    this.onRenderParticleLayer = options.onRenderParticleLayer

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
    })
    this.renderer.setClearColor(0x010204, 1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = this.quality === 'high'
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setPixelRatio(this.pixelRatio())
    this.scene.fog = new THREE.FogExp2(0x02060a, 0.11)
    this.scene.add(this.rootGroup)
    this.rootGroup.add(this.studioGroup, this.tunnelGroup, this.wolfRig, this.paperRig)
    this.wolfRig.add(this.accessories, this.cigarRig)
    this.buildLights()
    this.buildStudio()
    this.buildAccessories()
    this.buildThrownCigar()
    this.buildBurningPapers()
    this.loadWolf()
  }

  mount(container: HTMLElement) {
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.className = 'd3-cinematic-webgl'
    this.resize()
    window.addEventListener('resize', this.resize)
    this.clock.start()
    this.animationFrame = requestAnimationFrame(this.animate)
  }

  setState(state: CinematicState) {
    if (state === this.currentState) return
    this.currentState = state
    this.stateEnteredAt = performance.now()
    if (state === 'CIGAR_THROW') {
      this.thrownCigar.visible = true
      this.thrownCigar.position.set(0.5, 1.05, 0.02)
      this.thrownCigar.rotation.set(1.1, 0.2, -0.9)
    }
    if (state === 'CIGAR_IMPACT') {
      this.thrownCigar.visible = true
      this.thrownCigar.position.set(0.03, 0.37, -0.42)
      this.thrownCigar.rotation.set(1.48, 0.55, 0.8)
    }
  }

  setPointer(x: number, y: number) {
    this.pointer.set(x, y)
  }

  setPaused(paused: boolean) {
    this.paused = paused
    if (!paused) this.clock.getDelta()
  }

  setSelectedMode(mode: D3IntroMode | null) {
    this.selectedMode = mode
  }

  setHoveredMode(mode: D3IntroMode | null) {
    this.hoveredMode = mode
  }

  /**
   * Project the two burning papers + the cigar impact point into canvas-space
   * pixel coordinates so the 2D particle layer can anchor fire EXACTLY on the
   * paper edges instead of guessing fixed screen fractions.
   */
  getFireAnchors(width: number, height: number): {
    ai: { x: number; y: number }
    director: { x: number; y: number }
    ignition: { x: number; y: number }
  } | null {
    if (!this.paperMeshes.ai || !this.paperMeshes.director) return null
    const project = (obj: THREE.Object3D, lift: number) => {
      const p = obj.getWorldPosition(new THREE.Vector3())
      p.y += lift
      p.project(this.camera)
      return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height }
    }
    const impact = new THREE.Vector3(0.03, 0.37, -0.42).project(this.camera)
    return {
      ai: project(this.paperMeshes.ai, 0.16),
      director: project(this.paperMeshes.director, 0.16),
      ignition: { x: (impact.x * 0.5 + 0.5) * width, y: (-impact.y * 0.5 + 0.5) * height },
    }
  }

  dispose() {
    window.removeEventListener('resize', this.resize)
    cancelAnimationFrame(this.animationFrame)
    if (this.container && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
    disposeObject(this.rootGroup)
    this.wolfMixer = null
    this.wolfObject = null
    this.wolfAssetLoaded = false
    this.renderer.dispose()
    this.container = null
  }

  private pixelRatio() {
    if (this.reducedMotion || this.quality === 'low') return Math.min(window.devicePixelRatio || 1, 1.05)
    if (this.quality === 'medium') return Math.min(window.devicePixelRatio || 1, 1.35)
    return Math.min(window.devicePixelRatio || 1, 1.65)
  }

  private readonly resize = () => {
    if (!this.container) return
    const rect = this.container.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(this.pixelRatio())
    this.renderer.setSize(width, height, false)
  }

  private readonly animate = (now: number) => {
    this.animationFrame = requestAnimationFrame(this.animate)
    const dt = Math.min(0.04, this.clock.getDelta())
    if (this.paused) return
    const stateAge = Math.max(0, (now - this.stateEnteredAt) / 1000)
    this.updateCamera(dt, now, stateAge)
    this.updateScene(dt, now, stateAge)
    this.renderer.render(this.scene, this.camera)
    this.onRenderParticleLayer?.(dt, now, stateAge)
  }

  private buildLights() {
    const ambient = new THREE.AmbientLight(0x26303a, 0.16)
    this.scene.add(ambient)

    const blueRim = new THREE.DirectionalLight(0x82ddeb, 1.1)
    blueRim.position.set(-3.8, 4.4, 1.8)
    this.scene.add(blueRim)

    const amberKey = new THREE.SpotLight(0xffa45f, 2.2, 10, Math.PI * 0.16, 0.72, 1.25)
    amberKey.position.set(3.2, 4.2, 2.4)
    amberKey.target.position.set(0, 0.75, -0.75)
    amberKey.castShadow = this.quality === 'high'
    if (amberKey.shadow) {
      amberKey.shadow.mapSize.set(512, 512)
    }
    this.scene.add(amberKey, amberKey.target)

    const overhead = new THREE.SpotLight(0x8ba6b8, 1.45, 9, Math.PI * 0.22, 0.86, 1.5)
    overhead.position.set(-1.2, 5.2, 1.6)
    overhead.target.position.set(0, 0.25, -1.2)
    this.scene.add(overhead, overhead.target)

    this.emberLight.position.set(0.58, 0.98, 0.42)
    this.fireLight.position.set(0, 0.26, -0.38)
    this.scene.add(this.emberLight, this.fireLight)
  }

  private buildStudio() {
    // … unchanged studio build (floor/pillars/beams/practicals/table/reflection/ribbons)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x080b0f,
      roughness: 0.38,
      metalness: 0.56,
      envMapIntensity: 0.25,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 18, 1, 1), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.02
    floor.position.z = -2.8
    floor.receiveShadow = true
    this.studioGroup.add(floor)

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x05080c, roughness: 0.72, metalness: 0.18 })
    for (let i = -3; i <= 3; i += 1) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.8, 0.1), wallMat)
      pillar.position.set(i * 1.55, 1.85, -4.6)
      pillar.castShadow = true
      this.studioGroup.add(pillar)
    }

    const beamMat = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.62, metalness: 0.52 })
    for (let i = 0; i < 6; i += 1) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(10, 0.08, 0.12), beamMat)
      beam.position.set(0, 2.85 + i * 0.02, -4.8 + i * 0.72)
      beam.rotation.z = i % 2 ? 0.03 : -0.025
      this.studioGroup.add(beam)
    }

    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff9b52 })
    ;[-2.9, 2.9].forEach((x, index) => {
      const practical = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.54, 16), lightMat)
      practical.rotation.z = Math.PI / 2
      practical.position.set(x, 1.65, -4.32)
      this.studioGroup.add(practical)
      const glow = new THREE.PointLight(0xff8d42, 0.28, 3)
      glow.position.copy(practical.position)
      glow.position.z += 0.2
      glow.name = `d3-practical-${index}`
      this.studioGroup.add(glow)
    })

    const tableMat = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.34, metalness: 0.4 })
    const table = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.16, 1.35), tableMat)
    table.position.set(0, 0.28, -0.48)
    table.castShadow = true
    table.receiveShadow = true
    this.studioGroup.add(table)

    const reflection = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.8),
      new THREE.MeshBasicMaterial({
        color: 0x21424c,
        transparent: true,
        opacity: 0.11,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    reflection.rotation.x = -Math.PI / 2
    reflection.position.set(0, 0.004, 0.55)
    this.studioGroup.add(reflection)

    const ribbonMat = new THREE.MeshBasicMaterial({ color: 0x21313c, transparent: true, opacity: 0.2, depthWrite: false })
    for (let i = 0; i < 12; i += 1) {
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 3.2), ribbonMat.clone())
      ribbon.position.set((i % 2 ? -1 : 1) * (1.8 + (i % 6) * 0.52), 0.65 + (i % 3) * 0.35, -0.4 - i * 0.44)
      ribbon.rotation.y = (i % 2 ? 1 : -1) * 0.16
      this.tunnelGroup.add(ribbon)
      this.travelRibbons.push(ribbon)
    }
  }

  private loadWolf() {
    this.loader.load(
      WOLF_URL,
      (gltf) => {
        const object = gltf.scene
        object.name = 'cinematic:licensed-quaternius-wolf'
        const box = new THREE.Box3().setFromObject(object)
        const size = new THREE.Vector3()
        const center = new THREE.Vector3()
        box.getSize(size)
        box.getCenter(center)
        // Wolf is quadruped: normalize so feet rest exactly on the studio floor
        // (y=0) and the standing height reads ~1.15 units — dominant, grounded.
        const scale = 1.15 / Math.max(size.y, 0.001)
        object.scale.setScalar(scale)
        object.position.x -= center.x * scale
        object.position.z -= center.z * scale
        object.position.y -= box.min.y * scale
        object.rotation.y = 0.16 // subtle angular pose facing camera-left
        object.updateMatrixWorld(true)
        this.wolfHeadAnchor = this.findWolfAnchor(object, 'head') ?? new THREE.Vector3(0.02, 1.32, -0.22)
        // Cigar is held in the wolf's muzzle (noir presentation) — derived from
        // the head anchor with a forward/down offset in wolf-local space.
        this.wolfCigarAnchor = this.wolfHeadAnchor.clone().add(new THREE.Vector3(0.04, -0.09, 0.3))
        this.wolfHeightScale = Math.max(0.6, Math.min(1.4, this.wolfHeadAnchor.y / 1.1))
        this.wolfHeadRadius = Math.max(0.2, Math.min(0.44, this.wolfHeadAnchor.y * 0.26))
        object.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = this.quality !== 'low'
          mesh.receiveShadow = true
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            materials.forEach((mat) => {
              if ('color' in mat && mat.color instanceof THREE.Color) {
                mat.color.multiplyScalar(0.32)
                mat.color.offsetHSL(0, -0.06, -0.1)
              }
              mat.needsUpdate = true
            })
          }
        })
        this.wolfRig.add(object)
        this.wolfObject = object
        this.wolfAssetLoaded = true
        // Play the Quaternius Idle clip if present; fade Idle_2 over to Idle with a subtle crossfade.
        if (gltf.animations.length > 0) {
          this.wolfMixer = new THREE.AnimationMixer(object)
          const idle = gltf.animations.find((clip) => clip.name === WOLF_IDLE_CLIP) ?? gltf.animations[0]
          const idle2 = gltf.animations.find((clip) => clip.name === WOLF_IDLE_2_CLIP)
          const primary = this.wolfMixer.clipAction(idle)
          primary.play()
          if (idle2) {
            const alt = this.wolfMixer.clipAction(idle2)
            alt.play()
            alt.crossFadeTo(primary, 0.6, false)
          }
          this.wolfIdleAction = primary
        }
        this.syncAccessoriesToWolf()
        this.onWolfLoaded?.(true)
      },
      undefined,
      (error) => {
        console.warn('[D3 CINEMATIC] Licensed wolf GLB failed to load; continuing without a geometric substitute.', error)
        this.wolfAssetLoaded = false
        this.onWolfLoaded?.(false)
      }
    )
  }

  private findWolfAnchor(root: THREE.Object3D, kind: 'head' | 'hand'): THREE.Vector3 | null {
    // Prefer actual armature node if present, else heuristic bounds
    let result: THREE.Vector3 | null = null
    root.traverse((node) => {
      const name = node.name || ''
      if (kind === 'head' && /head|neck/i.test(name) && !result) {
        const pos = node.getWorldPosition(new THREE.Vector3())
        result = root.worldToLocal(pos)
      }
      if (kind === 'hand' && /hand|paw|foot/i.test(name) && !result) {
        const pos = node.getWorldPosition(new THREE.Vector3())
        result = root.worldToLocal(pos)
      }
    })
    if (result) return result
    const bounds = new THREE.Box3().setFromObject(root)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const anchor = new THREE.Vector3(
      kind === 'hand' ? center.x + size.x * 0.3 : center.x,
      kind === 'hand' ? center.y - size.y * 0.08 : center.y + size.y * 0.2,
      center.z
    )
    root.worldToLocal(anchor)
    return anchor
  }

  private syncAccessoriesToWolf() {
    if (!this.wolfObject) return
    const head = this.wolfObject.localToWorld(this.wolfHeadAnchor.clone())
    const hand = this.wolfObject.localToWorld(this.wolfCigarAnchor.clone())
    const headDelta = head.sub(new THREE.Vector3(0.02, 1.32, -0.22))
    const headScale = this.wolfHeadRadius / 0.36
    this.accessories.position.copy(headDelta)
    this.accessories.scale.setScalar(headScale)
    this.cigarRig.position.copy(hand.sub(new THREE.Vector3(0.37, 0.97, 0.09)))
    this.cigarRig.scale.setScalar(this.wolfHeightScale)
  }

  private buildAccessories() {
    // headphones + cigar (attached to wolfRig via accessories/cigarRig)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x020405,
      roughness: 0.12,
      metalness: 0.45,
      transparent: true,
      opacity: 0.92,
      emissive: 0x061b22,
      emissiveIntensity: 0.2,
    })
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.3, metalness: 0.78 })
    const leftLens = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.03), glassMat)
    leftLens.position.set(-0.14, 1.34, 0.1)
    leftLens.rotation.z = 0.08
    const rightLens = leftLens.clone()
    rightLens.position.x = 0.16
    rightLens.rotation.z = -0.05
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.024, 0.035), frameMat)
    bridge.position.set(0.012, 1.335, 0.112)

    const headphoneMat = new THREE.MeshStandardMaterial({ color: 0x111821, roughness: 0.28, metalness: 0.52 })
    const cupL = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.105, 24), headphoneMat)
    cupL.position.set(-0.36, 1.35, -0.02)
    cupL.rotation.z = Math.PI / 2
    const cupR = cupL.clone()
    cupR.position.x = 0.38
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.024, 12, 48, Math.PI), headphoneMat.clone())
    band.position.set(0.01, 1.39, -0.03)
    band.rotation.z = Math.PI
    band.scale.y = 1.22

    const cigarMat = new THREE.MeshStandardMaterial({ color: 0x4e2b18, roughness: 0.56, metalness: 0.02 })
    const cigar = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.029, 0.42, 16), cigarMat)
    cigar.name = 'cinematic:cigar-held'
    cigar.position.set(0.48, 1.02, 0.18)
    cigar.rotation.set(Math.PI / 2, 0, -0.7)
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a2d })
    )
    ember.name = 'cinematic:cigar-held-ember'
    ember.position.set(0.62, 1.11, 0.16)
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12), new THREE.MeshStandardMaterial({ color: 0x17110e, roughness: 0.84 }))
    hand.position.set(0.37, 0.97, 0.09)
    hand.scale.set(1.4, 0.82, 0.9)

    this.accessories.add(leftLens, rightLens, bridge, cupL, cupR, band)
    hand.name = 'cinematic:wolf-hand'
    this.cigarRig.add(hand, cigar, ember)
  }

  private buildThrownCigar() {
    const cigar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 0.44, 16),
      new THREE.MeshStandardMaterial({ color: 0x56301a, roughness: 0.55 })
    )
    cigar.rotation.x = Math.PI / 2
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.033, 16, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2d }))
    ember.position.z = 0.23
    this.thrownCigar.add(cigar, ember)
    this.thrownCigar.visible = false
    this.scene.add(this.thrownCigar)
  }

  private buildBurningPapers() {
    this.paperRig.position.set(0, 0.34, -0.55)
    const makePaper = (mode: D3IntroMode) => {
      const isAi = mode === 'ai'
      const shape = new THREE.Shape()
      shape.moveTo(-0.55, -0.34)
      shape.lineTo(-0.48, 0.36)
      shape.lineTo(-0.1, 0.42)
      shape.lineTo(0.52, 0.33)
      shape.lineTo(0.56, -0.28)
      shape.lineTo(0.24, -0.38)
      shape.lineTo(-0.22, -0.35)
      shape.lineTo(-0.55, -0.34)
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({
          color: isAi ? 0x071216 : 0x1a1009,
          roughness: 0.85,
          metalness: 0.02,
          emissive: isAi ? 0x073d49 : 0x4a210c,
          emissiveIntensity: 0.08,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
        })
      )
      mesh.position.set(isAi ? -0.74 : 0.74, 0.04, 0.03)
      mesh.rotation.set(-Math.PI * 0.58, 0, isAi ? -0.06 : 0.08)
      this.paperRig.add(mesh)
      this.paperMeshes[mode] = mesh

      const edge = new THREE.Mesh(
        new THREE.RingGeometry(0.46, 0.49, 48, 1),
        new THREE.MeshBasicMaterial({
          color: isAi ? 0x6bd9e8 : 0xff9a4a,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      edge.position.copy(mesh.position)
      edge.position.z += 0.012
      edge.rotation.copy(mesh.rotation)
      edge.scale.set(1.22, 0.82, 1)
      this.paperRig.add(edge)
      this.edgeLights.push(edge)
    }
    makePaper('ai')
    makePaper('director')
  }

  private updateCamera(dt: number, now: number, stateAge: number) {
    const rig = CAMERA_RIGS[this.currentState]
    const targetPosition = rig.position.clone()
    const targetLook = rig.target.clone()
    if (!this.reducedMotion) {
      const handheld = Math.sin(now * 0.0007) * 0.018
      targetPosition.x += this.pointer.x * 0.12 + handheld
      targetPosition.y += this.pointer.y * -0.055 + Math.cos(now * 0.00051) * 0.014
      targetLook.x += this.pointer.x * 0.07
      targetLook.y += this.pointer.y * -0.04
    }

    if (this.currentState === 'CLAP' && stateAge < 0.26 && !this.reducedMotion) {
      const shake = (1 - stateAge / 0.26) * 0.08
      targetPosition.x += (Math.random() - 0.5) * shake
      targetPosition.y += (Math.random() - 0.5) * shake
    }

    if (this.currentState === 'MODE_SELECTED' && this.selectedMode) {
      targetPosition.x += this.selectedMode === 'ai' ? -0.45 : 0.45
      targetLook.x += this.selectedMode === 'ai' ? -0.5 : 0.5
    }

    const follow = this.reducedMotion ? 0.2 : 1 - Math.pow(0.024, dt)
    this.cameraPosition.lerp(targetPosition, follow)
    this.cameraTarget.lerp(targetLook, follow)
    this.camera.position.copy(this.cameraPosition)
    this.camera.lookAt(this.cameraTarget)
    this.camera.fov += (rig.fov - this.camera.fov) * follow
    this.camera.updateProjectionMatrix()
  }

  private updateScene(dt: number, now: number, stateAge: number) {
    const t = now * 0.001
    const reveal = isAtOrAfter(this.currentState, 'STUDIO_REVEAL') ? 1 : 0
    this.studioGroup.visible = reveal > 0
    this.tunnelGroup.visible = this.currentState === 'CAMERA_TRAVEL' || this.currentState === 'CLAP' || this.currentState === 'WOLF_REVEAL'
    this.wolfRig.visible = this.wolfAssetLoaded && isAtOrAfter(this.currentState, 'WOLF_REVEAL')
    this.paperRig.visible = isAtOrAfter(this.currentState, 'IGNITION')

    const breathing = Math.sin(t * 2.15) * 0.018
    this.wolfMixer?.update(dt)
    this.wolfRig.position.y = breathing
    this.wolfRig.rotation.y = Math.sin(t * 0.84) * 0.025 + this.pointer.x * 0.035
    this.wolfRig.rotation.x = Math.sin(t * 0.48) * 0.008
    this.wolfRig.rotation.z = Math.sin(t * 0.7) * 0.018

    this.updateCigar(now, stateAge)
    this.updateFireLight(now, stateAge)
    this.updatePapers(stateAge)
    this.updateTravelRibbons(dt, now)
  }

  private updateCigar(now: number, stateAge: number) {
    const ember = this.cigarRig.getObjectByName('cinematic:cigar-held-ember') as THREE.Mesh | undefined
    const held = this.cigarRig.getObjectByName('cinematic:cigar-held')
    const inhale = this.currentState === 'WOLF_SMOKE'
    const emberIntensity = inhale ? 0.75 + smoothstep(0.1, 1.25, stateAge) * 1.4 : isAtOrAfter(this.currentState, 'CIGAR_THROW') ? 0 : 0.45
    if (ember && ember.material instanceof THREE.MeshBasicMaterial) {
      ember.visible = !isAtOrAfter(this.currentState, 'CIGAR_THROW')
      ember.scale.setScalar(0.9 + Math.sin(now * 0.01) * 0.12 + emberIntensity * 0.22)
      ember.material.color.setHSL(0.07, 1, Math.min(0.7, 0.28 + emberIntensity * 0.16))
    }
    if (held) held.visible = !isAtOrAfter(this.currentState, 'CIGAR_THROW')
    this.emberLight.intensity = emberIntensity

    if (this.currentState === 'CIGAR_THROW') {
      const p = Math.min(1, stateAge / (this.reducedMotion ? 0.35 : 1.08))
      const eased = easeInOutCubic(p)
      const start = new THREE.Vector3(0.5, 1.05, 0.02)
      const end = new THREE.Vector3(0.03, 0.37, -0.42)
      this.thrownCigar.position.lerpVectors(start, end, eased)
      this.thrownCigar.position.y += Math.sin(Math.PI * p) * 0.42
      this.thrownCigar.rotation.set(1.1 + p * 6.2, 0.2 + p * 3.8, -0.9 + p * 4.6)
    } else if (this.currentState === 'CIGAR_IMPACT') {
      const bounce = Math.max(0, Math.sin(stateAge * 20) * Math.exp(-stateAge * 7))
      this.thrownCigar.position.y = 0.37 + bounce * 0.075
      this.thrownCigar.rotation.z += 0.01 * Math.exp(-stateAge * 4)
    }
  }

  private updateFireLight(now: number, stateAge: number) {
    const ignition = this.currentState === 'IGNITION'
    const burning = isAtOrAfter(this.currentState, 'PAPER_BURN') && this.currentState !== 'EXIT'
    const target = ignition ? smoothstep(0, 0.8, stateAge) * 1.1 : burning ? 1.25 : 0
    const flicker = 0.78 + Math.sin(now * 0.031) * 0.12 + Math.sin(now * 0.017) * 0.08
    this.fireLight.intensity += (target * flicker - this.fireLight.intensity) * 0.12
  }

  private updatePapers(stateAge: number) {
    const paperProgress = this.currentState === 'PAPER_BURN'
      ? smoothstep(0.1, 1.8, stateAge)
      : isAtOrAfter(this.currentState, 'MODES_REVEAL')
        ? 1
        : this.currentState === 'IGNITION'
          ? smoothstep(0.4, 1.0, stateAge) * 0.18
          : 0

    ;(['ai', 'director'] as D3IntroMode[]).forEach((mode, index) => {
      const mesh = this.paperMeshes[mode]
      if (!mesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      const stagger = mode === 'ai' ? 0 : 0.13
      const p = Math.max(0, Math.min(1, (paperProgress - stagger) / (1 - stagger)))
      material.opacity = p
      material.emissiveIntensity = 0.08 + p * 0.16 + (this.hoveredMode === mode ? 0.18 : 0)
      mesh.scale.setScalar(0.82 + easeOutCubic(p) * 0.18)
      mesh.position.y = 0.04 + (1 - p) * 0.12

      const edge = this.edgeLights[index]
      if (edge && edge.material instanceof THREE.MeshBasicMaterial) {
        edge.material.opacity = p * (0.22 + (this.hoveredMode === mode ? 0.22 : 0))
        edge.scale.set(1.08 + Math.sin(performance.now() * 0.006 + index) * 0.025, 0.78 + Math.cos(performance.now() * 0.005 + index) * 0.02, 1)
      }
    })
  }

  private updateTravelRibbons(dt: number, now: number) {
    const active = this.tunnelGroup.visible
    this.travelRibbons.forEach((ribbon, index) => {
      if (ribbon.material instanceof THREE.MeshBasicMaterial) {
        ribbon.material.opacity += ((active ? 0.18 + (index % 3) * 0.03 : 0) - ribbon.material.opacity) * 0.08
      }
      if (!active) return
      ribbon.position.z += dt * (1.4 + index * 0.04)
      ribbon.position.x += Math.sin(now * 0.001 + index) * dt * 0.08
      if (ribbon.position.z > 1.3) ribbon.position.z = -5.8 - index * 0.28
    })
  }
}