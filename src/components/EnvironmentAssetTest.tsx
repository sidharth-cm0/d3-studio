/**
 * Environment Asset Visual Test — PHASE 4 (DEV-ONLY).
 *
 * A completely isolated, data-driven visual test harness for the registered
 * environment asset categories. Accessed via:
 *
 *   http://localhost:5173/?assetTest=office
 *   http://localhost:5173/?assetTest=city
 *   http://localhost:5173/?assetTest=forest
 *   http://localhost:5173/?assetTest=scifi
 *
 * (living_room keeps its own dedicated harness: LivingRoomAssetTest.tsx.)
 *
 * This component does NOT touch:
 *   - App.tsx (production rendering)
 *   - Character loading code
 *   - Camera controllers (uses its own OrbitControls)
 *   - Semantic environment resolution / production environment behavior
 *   - The asset files themselves
 *
 * It loads assets through the EXISTING environmentAssetLoader.instanciateAsset()
 * for whichever category is registered in environmentAssetLibrary.
 * Unknown categories (e.g. 'scifi', which has no manifest entry yet) render a
 * diagnostic overlay instead of failing silently.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ENVIRONMENT_ASSET_MANIFEST } from '../services/environmentAssetLibrary'
import type {
  EnvironmentAssetCategory,
  SemanticAssetId,
} from '../services/environmentAssetLibrary'
import { instanciateAsset } from '../services/environmentAssetLoader'

// Label color palette cycled per asset (matches LivingRoomAssetTest style)
const LABEL_COLORS = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa8e6cf, 0xff9f1c, 0x9b5de5, 0x00c2ff]

export default function EnvironmentAssetTest({ category }: { category: string }) {
  const mountRef = useRef<HTMLDivElement>(null)

  const registered =
    category in ENVIRONMENT_ASSET_MANIFEST &&
    (ENVIRONMENT_ASSET_MANIFEST as Readonly<Record<string, readonly unknown[]>>)[category].length > 0

  useEffect(() => {
    if (!registered || !mountRef.current) return
    const cat = category as EnvironmentAssetCategory

    // --- Scene setup ---
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x2a2a3a)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)
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

    const gridHelper = new THREE.GridHelper(30, 30, 0x555555, 0x333333)
    gridHelper.position.y = 0.001
    scene.add(gridHelper)

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(30, 30)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.8 })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    floor.receiveShadow = true
    scene.add(floor)

    const descriptors = ENVIRONMENT_ASSET_MANIFEST[cat]
    const loaded: THREE.Object3D[] = []
    const disposables: THREE.Object3D[] = []

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

    // --- Load assets (single row along X, spaced by footprint radius) ---
    async function loadAssets() {
      let cursorX = 0
      for (let i = 0; i < descriptors.length; i++) {
        const d = descriptors[i]
        const obj = await instanciateAsset({
          category: cat,
          semantic: d.semantic as SemanticAssetId,
        })
        if (!obj) {
          console.warn(`[ENV ASSET TEST] ${cat}/${d.semantic}: failed to load (${d.url})`)
          continue
        }

        const color = LABEL_COLORS[i % LABEL_COLORS.length]

        // Floor alignment: position so bounding-box min Y = 0
        const box = new THREE.Box3().setFromObject(obj)
        const size = new THREE.Vector3()
        box.getSize(size)
        const min = box.min.clone()

        obj.position.set(cursorX, 0, 0)
        obj.position.y -= min.y

        box.setFromObject(obj)

        console.log(`[ENV ASSET TEST] ${cat}/${d.semantic}`)
        console.log(`  url: ${d.url}`)
        console.log(`  native dimensions: ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`)
        console.log(`  scale: ${obj.scale.x.toFixed(3)}, ${obj.scale.y.toFixed(3)}, ${obj.scale.z.toFixed(3)}`)

        const debugBox = new THREE.Box3Helper(box, new THREE.Color(color))
        scene.add(debugBox)
        disposables.push(debugBox)

        const labelSprite = createLabelSprite(d.semantic.toUpperCase())
        labelSprite.position.set(cursorX, size.y + 1.0, 0)
        scene.add(labelSprite)
        disposables.push(labelSprite)

        scene.add(obj)
        loaded.push(obj)
        disposables.push(obj)

        cursorX += Math.max(size.x, d.footprintRadius * 2) + 1.5
      }

      // Center camera on the row extent
      const extent = Math.max(cursorX / 2, 4)
      camera.position.set(0, extent * 0.8, extent * 2.2)
      controls.target.set(0, 1, 0)
      controls.update()
    }

    // --- Render loop ---
    let frameId: number
    function animate() {
      frameId = requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }

    const onResize = () => {
      if (!mountRef.current) return
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    }
    window.addEventListener('resize', onResize)

    loadAssets().then(() => {
      console.log(`[ENV ASSET TEST] ${cat}: ${loaded.length}/${descriptors.length} assets loaded.`)
    })
    animate()

    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(frameId)
      disposables.forEach((d) => {
        scene.remove(d)
        d.traverse?.((child) => {
          const mesh = child as THREE.Mesh
          if (mesh.geometry) mesh.geometry.dispose()
        })
      })
      renderer.dispose()
      mountRef.current?.removeChild(renderer.domElement)
    }
  }, [registered, category])

  if (!registered) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a2e',
          color: '#ff6b6b',
          fontFamily: 'monospace',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>[ENV ASSET TEST] Unknown category: "{category}"</h2>
        <p style={{ margin: 0, color: '#a8e6cf' }}>
          Registered categories: {Object.keys(ENVIRONMENT_ASSET_MANIFEST).join(', ')}
        </p>
        <p style={{ margin: 0, color: '#ffe66d' }}>
          This category has no assets in ENVIRONMENT_ASSET_MANIFEST yet.
        </p>
      </div>
    )
  }

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