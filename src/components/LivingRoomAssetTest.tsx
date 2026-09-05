/**
 * Living Room Asset Visual Test — PHASE 4D-2B (DEV-ONLY).
 *
 * A completely isolated visual test harness for the six registered living-room
 * GLB assets. Accessed via:
 *
 *   http://localhost:5173/?assetTest=living_room
 *
 * This component does NOT touch:
 *   - App.tsx (production rendering)
 *   - Character loading code
 *   - Camera controllers (uses its own OrbitControls)
 *   - Semantic environment resolution
 *   - The asset files themselves
 *
 * It loads furniture through the EXISTING environmentAssetLoader.instanciateAsset()
 * and optionally loads a Quaternius character GLB as a scale reference.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { instanciateAsset } from '../services/environmentAssetLoader'
import { getAssetDescriptor } from '../services/environmentAssetLibrary'
import type { EnvironmentAssetCategory, SemanticAssetId } from '../services/environmentAssetLibrary'

// ---------------------------------------------------------------------------
// Asset layout definition
// ---------------------------------------------------------------------------

interface TestAsset {
  id: string
  semantic: SemanticAssetId
  category: EnvironmentAssetCategory
  label: string
  position: THREE.Vector3
  color: number
}

const TEST_ASSETS: TestAsset[] = [
  {
    id: 'quaternius_living_sofa_01',
    semantic: 'sofa',
    category: 'living_room',
    label: 'SOFA',
    position: new THREE.Vector3(-4, 0, -3),
    color: 0xff6b6b,
  },
  {
    id: 'quaternius_living_cabinet_01',
    semantic: 'cabinet',
    category: 'living_room',
    label: 'CABINET',
    position: new THREE.Vector3(4, 0, -3),
    color: 0x4ecdc4,
  },
  {
    id: 'quaternius_living_chair_01',
    semantic: 'chair',
    category: 'living_room',
    label: 'CHAIR',
    position: new THREE.Vector3(-4, 0, 0),
    color: 0xffe66d,
  },
  {
    id: 'quaternius_living_coffee_table_01',
    semantic: 'table',
    category: 'living_room',
    label: 'TABLE',
    position: new THREE.Vector3(0, 0, 0),
    color: 0xa8e6cf,
  },
  {
    id: 'quaternius_living_lamp_01',
    semantic: 'lamp',
    category: 'living_room',
    label: 'LAMP',
    position: new THREE.Vector3(4, 0, 0),
    color: 0xff9f1c,
  },
  {
    id: 'quaternius_living_plant_01',
    semantic: 'plant',
    category: 'living_room',
    label: 'PLANT',
    position: new THREE.Vector3(0, 0, 3),
    color: 0x9b5de5,
  },
]

// Quaternius male character for scale reference
const CHARACTER_GLTF_URL = '/characters/quaternius/Superhero_Male_FullBody.gltf'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LivingRoomAssetTest() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mountRef.current) return

    // --- Scene setup ---
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x2a2a3a)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 4, 10)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    mountRef.current.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.update()

    // --- Lighting ---
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
    hemiLight.position.set(0, 5, 0)
    scene.add(hemiLight)

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(5, 10, 5)
    dirLight.castShadow = true
    scene.add(dirLight)

    // --- Helpers ---
    const axisHelper = new THREE.AxesHelper(2)
    axisHelper.position.set(-6, 0, -6)
    scene.add(axisHelper)

    const gridHelper = new THREE.GridHelper(20, 20, 0x555555, 0x333333)
    gridHelper.position.y = 0.001
    scene.add(gridHelper)

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(20, 20)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.8 })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    floor.receiveShadow = true
    scene.add(floor)

    // --- Load assets ---
    const assetGroups: THREE.Object3D[] = []
    const debugBoxes: THREE.Box3Helper[] = []

    async function loadAssets() {
      for (const a of TEST_ASSETS) {
        const obj = await instanciateAsset({ category: a.category, semantic: a.semantic })
        if (!obj) {
          console.warn(`[ASSET TEST] Failed to load: ${a.id}`)
          continue
        }

        // Floor alignment: position so bounding-box min Y = 0
        const box = new THREE.Box3().setFromObject(obj)
        const size = new THREE.Vector3()
        box.getSize(size)
        const min = box.min.clone()
        const center = new THREE.Vector3()
        box.getCenter(center)

        // Position the object so its lowest point is at floor Y=0
        obj.position.copy(a.position)
        obj.position.y -= min.y // shift up so min Y = 0

        // Re-calculate box after position change
        box.setFromObject(obj)

        // Print debug info
        console.log(`[ASSET TEST] ${a.label} (${a.id})`)
        console.log(`  position: ${obj.position.x.toFixed(3)}, ${obj.position.y.toFixed(3)}, ${obj.position.z.toFixed(3)}`)
        console.log(`  native dimensions: ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`)
        console.log(`  bounding center: ${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}`)
        console.log(`  rotation: ${obj.rotation.x.toFixed(3)}, ${obj.rotation.y.toFixed(3)}, ${obj.rotation.z.toFixed(3)}`)
        console.log(`  scale: ${obj.scale.x.toFixed(3)}, ${obj.scale.y.toFixed(3)}, ${obj.scale.z.toFixed(3)}`)

        // Bounding box helper (colored per asset)
        const debugBox = new THREE.Box3Helper(box, new THREE.Color(a.color))
        scene.add(debugBox)
        debugBoxes.push(debugBox)

        // Label sprite
        const labelSprite = createLabelSprite(a.label)
        labelSprite.position.set(a.position.x, a.position.y + 2.5, a.position.z)
        scene.add(labelSprite)

        // Add to scene
        scene.add(obj)
        assetGroups.push(obj)
      }

      // --- Load character as scale reference ---
      await loadCharacter()
    }

    async function loadCharacter() {
      const gltfLoader = new GLTFLoader()
      try {
        const gltf = await new Promise<GLTF>((resolve, reject) => {
          gltfLoader.load(CHARACTER_GLTF_URL, (data) => resolve(data), undefined, (err) => reject(err))
        })
        const charScene = gltf.scene
        charScene.traverse((child: THREE.Object3D) => {
          if ((child as unknown as { isMesh?: boolean }).isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        // Floor-align the character
        const box = new THREE.Box3().setFromObject(charScene)
        const min = box.min.clone()
        const size = new THREE.Vector3()
        box.getSize(size)

        charScene.position.set(0, 0, 6)
        charScene.position.y -= min.y

        console.log(`[ASSET TEST] CHARACTER (Quaternius Male)`)
        console.log(`  position: ${charScene.position.x.toFixed(3)}, ${charScene.position.y.toFixed(3)}, ${charScene.position.z.toFixed(3)}`)
        console.log(`  native dimensions: ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`)

        // Bounding box for character
        const charBox = new THREE.Box3().setFromObject(charScene)
        const charDebugBox = new THREE.Box3Helper(charBox, 0x00ff00)
        scene.add(charDebugBox)
        debugBoxes.push(charDebugBox)

        // Label
        const labelSprite = createLabelSprite('CHARACTER (scale ref)')
        labelSprite.position.set(0, 3, 6)
        scene.add(labelSprite)

        scene.add(charScene)
        assetGroups.push(charScene)
      } catch (err) {
        console.warn('[ASSET TEST] Failed to load character:', err)
      }
    }

    function createLabelSprite(text: string): THREE.Sprite {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = 256
      canvas.height = 64
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = '24px monospace'
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, canvas.width / 2, canvas.height / 2)

      const texture = new THREE.CanvasTexture(canvas)
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
      const sprite = new THREE.Sprite(material)
      sprite.scale.set(2, 0.5, 1)
      return sprite
    }

    // --- Render loop ---
    let frameId: number
    function animate() {
      frameId = requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }

    // Handle resize
    const onResize = () => {
      if (!mountRef.current) return
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    }
    window.addEventListener('resize', onResize)

    // Start
    loadAssets().then(() => {
      console.log('[ASSET TEST] All assets loaded. Scene ready.')
    })
    animate()

    // Cleanup
    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(frameId)
      renderer.dispose()
      mountRef.current?.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div
      ref={mountRef}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#1a1a2e',
        overflow: 'hidden',
      }}
    />
  )
}
