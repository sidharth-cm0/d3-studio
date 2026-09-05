/**
 * Visual Style Controller — PHASE 1 + 1.1 (D3 Studio)
 *
 * Safely applies a VisualStylePreset to the EXISTING Three.js objects:
 *
 *   scene.background · scene.fog · renderer.toneMappingExposure
 *   ambient light · key light · rim light · fill light (+ positions)
 *   environment MATERIALS (reversible grade — Phase 1.1)
 *
 * Guarantees:
 *  - NO new lights are ever created. The controller wraps the lights App.tsx
 *    already made (created once, mutated in place, cleaned up on unmount).
 *  - NO per-frame allocation: scratch THREE.Color instances are reused and
 *    the fog/background objects are mutated, never replaced (replacing the
 *    fog object would trigger global shader recompiles).
 *  - 'default' is an IDENTITY operation: it restores the last grade recorded
 *    from the Environment Resolver (or does nothing before the first grade),
 *    so the pre-style-engine look is preserved bit-for-bit — including light
 *    POSITIONS and every touched environment material value.
 *  - Destructive VRM/MToon material conversion is intentionally NOT done —
 *    MToon is already a cel shader; the noir look comes from lighting ratios.
 *
 * Phase 1.1 — ENVIRONMENT GRADING (Noir Deco):
 *  - When a non-default style is active, stage/prop MATERIALS are graded
 *    (darkened · desaturated · emissive tamed) so bright generated
 *    environments (e.g. a dawn forest) cannot overpower the treatment.
 *  - The grade NEVER touches VRM character materials: only the environment
 *    roots registered via recordEnvironmentGrade() are traversed.
 *  - REVERSIBILITY: the FIRST time a material is seen, its pristine
 *    color/emissive/emissiveIntensity are captured into a WeakMap. Every
 *    grade is DERIVED FROM THAT BASELINE (never from the live value), so
 *      Default → Noir → Default → Noir → Default …
 *    cannot accumulate drift. Restoring copies the baseline straight back.
 *  - PERFORMANCE: grading runs only on style change or environment rebuild
 *    (both event-driven) — never per animation frame.
 *
 * Also provides SteppedAnimationClock: a visual motion-sampling quantizer
 * (12/24 fps) for the render loop. Rendering stays at browser refresh rate;
 * only CHARACTER animation time is stepped. Camera tweens, UI, MediaPipe and
 * episode/timeline timing are untouched, and total animation time is
 * preserved (steps sum to real time — nothing slows down).
 */

import * as THREE from 'three'
import type { EnvironmentGradeParams, VisualStylePreset } from './visualStyle'
import { MILD_ENV_GRADE } from './visualStyle'

/** Snapshot of the Environment Resolver's live lighting/atmosphere grade. */
export interface EnvironmentGradeSnapshot {
  backgroundColor: string
  fogColor: string
  fogNear: number
  fogFar: number
  ambientIntensity: number
  keyLightIntensity: number
  keyLightColor: string
  rimLightIntensity: number
  rimLightColor: string
  fillLightIntensity: number
  fillLightColor: string
}

export interface VisualStyleTargets {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  ambientLight: THREE.AmbientLight | null
  keyLight: THREE.DirectionalLight | null
  fillLight: THREE.DirectionalLight | null
  rimLight: THREE.DirectionalLight | null
}

/**
 * Structural view of gradable environment materials (MeshStandardMaterial,
 * MeshBasicMaterial). Emissive fields are optional because Basic materials
 * don't have them — grading degrades gracefully per material.
 */
interface GradableMaterial {
  color: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
}

/** Pristine material state — the single source of truth for all grading. */
interface MaterialBaseline {
  color: THREE.Color
  emissive: THREE.Color
  emissiveIntensity: number
}

export class VisualStyleController {
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private ambientLight: THREE.AmbientLight | null
  private keyLight: THREE.DirectionalLight | null
  private fillLight: THREE.DirectionalLight | null
  private rimLight: THREE.DirectionalLight | null

  /** Exposure the renderer had when the controller was created (= old look). */
  private baselineExposure: number

  /** Baseline light positions captured at construction (= old look). */
  private baselineKeyPos: THREE.Vector3 | null
  private baselineFillPos: THREE.Vector3 | null
  private baselineRimPos: THREE.Vector3 | null

  /** Last Environment Resolver grade — what 'default' restores to. */
  private grade: EnvironmentGradeSnapshot | null = null

  /**
   * Roots of the CURRENT environment (the stage group — composed prop groups
   * are children of it). Registered on every environment rebuild so grading
   * always targets the live geometry and never VRM characters.
   */
  private envRoots: THREE.Object3D[] = []

  /** Pristine env material values keyed by material (GC-friendly WeakMap). */
  private materialBaselines = new WeakMap<object, MaterialBaseline>()

  // Scratch objects — mutated in place, never reallocated per apply.
  private scratchBg = new THREE.Color()
  private scratchFog = new THREE.Color()
  private scratchKey = new THREE.Color()
  private scratchRim = new THREE.Color()
  private scratchFill = new THREE.Color()

  constructor(targets: VisualStyleTargets) {
    this.scene = targets.scene
    this.renderer = targets.renderer
    this.ambientLight = targets.ambientLight
    this.keyLight = targets.keyLight
    this.fillLight = targets.fillLight
    this.rimLight = targets.rimLight
    this.baselineExposure = targets.renderer.toneMappingExposure
    this.baselineKeyPos = targets.keyLight?.position.clone() ?? null
    this.baselineFillPos = targets.fillLight?.position.clone() ?? null
    this.baselineRimPos = targets.rimLight?.position.clone() ?? null
  }

  /**
   * Called by App.buildStageEnvironment right after the Environment Resolver
   * has graded the stage. Captures that grade so switching the visual style
   * back to 'default' reproduces the resolver's look exactly.
   *
   * Phase 1.1: optionally registers the freshly built environment roots so
   * material grading/restoration targets the live stage (which contains the
   * procedural props group). Must be called BEFORE applyStyle on rebuilds.
   */
  recordEnvironmentGrade(grade: EnvironmentGradeSnapshot, envRoots?: THREE.Object3D[]): void {
    this.grade = { ...grade }
    if (envRoots) {
      this.envRoots = envRoots.filter(Boolean)
    }
  }

  /**
   * Apply a visual style preset on top of the current stage.
   * Safe to call repeatedly; only mutates existing objects. All material
   * grading derives from captured baselines — repeated application is
   * idempotent (no cumulative darkening).
   */
  applyStyle(preset: VisualStylePreset): void {
    if (preset.id === 'default') {
      this.applyDefault()
      return
    }

    // Atmosphere
    this.scratchBg.set(preset.backgroundColor)
    this.scene.background = this.scratchBg
    const fog = this.adoptOrCreateFog()
    this.scratchFog.set(preset.fogColor)
    fog.color.copy(this.scratchFog)
    fog.near = preset.fogNear
    fog.far = preset.fogFar

    // Lighting (existing lights only) — intensities, colors and positions.
    this.applyLightingGrade(preset)

    // Environment material grade (Phase 1.1) — darken/desaturate/tame the
    // stage itself so bright environments submit to the style treatment.
    this.applyEnvironmentGrade(preset.envGrade ?? MILD_ENV_GRADE)

    // Exposure
    this.renderer.toneMappingExposure = preset.exposure
  }

  /**
   * Restore the Environment Resolver's grade (the pre-style-engine look).
   * With no recorded grade this still undoes material/light-position edits
   * (back to construction-time baselines) — the initial state already IS
   * the old look.
   */
  private applyDefault(): void {
    // Undo the environment material grade FIRST (exact baseline restore).
    this.restoreEnvironmentBaseline()
    this.restoreLightPositions()
    this.renderer.toneMappingExposure = this.baselineExposure

    const g = this.grade
    if (!g) return

    this.scratchBg.set(g.backgroundColor)
    this.scene.background = this.scratchBg
    const fog = this.adoptOrCreateFog()
    this.scratchFog.set(g.fogColor)
    fog.color.copy(this.scratchFog)
    fog.near = g.fogNear
    fog.far = g.fogFar

    if (this.ambientLight) this.ambientLight.intensity = g.ambientIntensity
    if (this.keyLight) {
      this.keyLight.intensity = g.keyLightIntensity
      this.scratchKey.set(g.keyLightColor)
      this.keyLight.color.copy(this.scratchKey)
    }
    if (this.rimLight) {
      this.rimLight.intensity = g.rimLightIntensity
      this.scratchRim.set(g.rimLightColor)
      this.rimLight.color.copy(this.scratchRim)
    }
    if (this.fillLight) {
      this.fillLight.intensity = g.fillLightIntensity
      this.scratchFill.set(g.fillLightColor)
      this.fillLight.color.copy(this.scratchFill)
    }
  }

  /** Preset lighting onto the EXISTING lights (values + optional positions). */
  private applyLightingGrade(preset: VisualStylePreset): void {
    if (this.ambientLight) this.ambientLight.intensity = preset.ambientIntensity
    if (this.keyLight) {
      this.keyLight.intensity = preset.keyLightIntensity
      this.scratchKey.set(preset.keyLightColor)
      this.keyLight.color.copy(this.scratchKey)
      if (preset.keyLightPosition) this.keyLight.position.set(...preset.keyLightPosition)
    }
    if (this.rimLight) {
      this.rimLight.intensity = preset.rimLightIntensity
      this.scratchRim.set(preset.rimLightColor)
      this.rimLight.color.copy(this.scratchRim)
      if (preset.rimLightPosition) this.rimLight.position.set(...preset.rimLightPosition)
    }
    if (this.fillLight) {
      this.fillLight.intensity = preset.fillLightIntensity
      this.scratchFill.set(preset.fillLightColor)
      this.fillLight.color.copy(this.scratchFill)
      if (preset.fillLightPosition) this.fillLight.position.set(...preset.fillLightPosition)
    }
  }

  /** Restore the exact light positions the app started with. */
  private restoreLightPositions(): void {
    if (this.keyLight && this.baselineKeyPos) this.keyLight.position.copy(this.baselineKeyPos)
    if (this.fillLight && this.baselineFillPos) this.fillLight.position.copy(this.baselineFillPos)
    if (this.rimLight && this.baselineRimPos) this.rimLight.position.copy(this.baselineRimPos)
  }

  /**
   * Lazily capture a material's pristine state on first contact. Every later
   * grade/restore reads THIS snapshot — never the live (possibly graded)
   * values — which is what makes the whole system non-cumulative.
   */
  private ensureBaseline(mat: GradableMaterial): MaterialBaseline {
    let baseline = this.materialBaselines.get(mat)
    if (!baseline) {
      baseline = {
        color: mat.color.clone(),
        emissive: mat.emissive ? mat.emissive.clone() : new THREE.Color(0, 0, 0),
        emissiveIntensity: mat.emissiveIntensity ?? 1,
      }
      this.materialBaselines.set(mat, baseline)
    }
    return baseline
  }

  /** Collect materials from the registered environment roots (event-time only). */
  private collectEnvMaterials(): GradableMaterial[] {
    const found: GradableMaterial[] = []
    for (const root of this.envRoots) {
      root.traverse((node) => {
        const mesh = node as THREE.Mesh
        const mat = mesh.material as unknown as GradableMaterial | GradableMaterial[] | undefined
        if (!mat) return
        if (Array.isArray(mat)) found.push(...mat)
        else found.push(mat)
      })
    }
    return found
  }

  /**
   * Grade environment materials FROM BASELINES: darken, desaturate, tame
   * emissive. Idempotent by construction (always recomputed from the
   * captured pristine values). Runs only on style/env change events.
   */
  private applyEnvironmentGrade(params: EnvironmentGradeParams): void {
    const hsl = { h: 0, s: 0, l: 0 }
    for (const mat of this.collectEnvMaterials()) {
      const baseline = this.ensureBaseline(mat)
      baseline.color.getHSL(hsl)
      mat.color.setHSL(
        hsl.h,
        hsl.s * (1 - params.desaturation),
        THREE.MathUtils.clamp(hsl.l * params.brightness, 0, 1)
      )
      if (mat.emissive) mat.emissive.copy(baseline.emissive)
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = baseline.emissiveIntensity * params.emissiveScale
      }
    }
  }

  /**
   * Copy every captured baseline back onto the live materials. Materials
   * never graded have no entry and are already pristine — skipped.
   */
  private restoreEnvironmentBaseline(): void {
    for (const mat of this.collectEnvMaterials()) {
      const baseline = this.materialBaselines.get(mat)
      if (!baseline) continue
      mat.color.copy(baseline.color)
      if (mat.emissive) mat.emissive.copy(baseline.emissive)
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = baseline.emissiveIntensity
      }
    }
  }

  /**
   * Reuse whatever Fog the scene currently has (buildStageEnvironment swaps
   * in a fresh Fog per rebuild, so always re-adopt the live instance) —
   * mutating an existing Fog avoids global material/shader recompiles.
   */
  private adoptOrCreateFog(): THREE.Fog {
    const existing = this.scene.fog
    if (existing && (existing as THREE.Fog).isFog) {
      return existing as THREE.Fog
    }
    const fog = new THREE.Fog(0x000000, 10, 30)
    this.scene.fog = fog
    return fog
  }

  /** Release object references (lights themselves die with the scene). */
  dispose(): void {
    this.scene = null as unknown as THREE.Scene
    this.renderer = null as unknown as THREE.WebGLRenderer
    this.ambientLight = null
    this.keyLight = null
    this.fillLight = null
    this.rimLight = null
    this.grade = null
    this.envRoots = []
    this.baselineKeyPos = null
    this.baselineFillPos = null
    this.baselineRimPos = null
  }
}

/**
 * Quantizes CHARACTER animation time to a fixed visual sample rate.
 *
 * Usage in the RAF loop:
 *   const dt = clock.advance(realDelta)  // 0 ⇒ hold last pose this frame
 *   …skip character updates when dt === 0…
 *
 * Properties:
 *  - Steps sum to real elapsed time ⇒ animation duration/speed unchanged.
 *  - Sample instants sit on an exact 1/fps grid (classic 12/24 fps cadence).
 *  - After a long stall (hidden tab) it resyncs instead of bursting frames.
 *  - fps = null ⇒ fully native passthrough (zero behavior change).
 */
export class SteppedAnimationClock {
  private fpsValue: number | null = null
  private elapsed = 0
  private sampledAt = 0
  private nextSampleAt = 0
  private steppedTimeValue = 0

  /** Active sample rate (null = native passthrough). */
  get fps(): number | null {
    return this.fpsValue
  }

  /** Set the sample rate; null/0/invalid ⇒ native. Resets accumulators on change. */
  setFps(fps: number | null): void {
    const normalized = fps && fps > 0 && Number.isFinite(fps) ? fps : null
    if (normalized === this.fpsValue) return
    this.fpsValue = normalized
    this.reset()
  }

  /** Absolute (grid-aligned) character time, for phase-driven idle motion. */
  get steppedTime(): number {
    return this.steppedTimeValue
  }

  reset(): void {
    this.elapsed = 0
    this.sampledAt = 0
    this.nextSampleAt = 0
    this.steppedTimeValue = 0
  }

  /**
   * Advance by the real frame delta and return the character-time delta to
   * use THIS rendered frame. Returns 0 on frames where the pose is held.
   */
  advance(realDelta: number): number {
    if (!this.fpsValue) return realDelta

    this.elapsed += realDelta
    if (this.elapsed + 1e-6 < this.nextSampleAt) return 0

    let dt = this.elapsed - this.sampledAt
    this.steppedTimeValue = this.nextSampleAt
    this.sampledAt = this.nextSampleAt
    this.nextSampleAt += 1 / this.fpsValue

    // Resync after a stall (tab was hidden) — never burst-catch-up.
    if (dt > 0.25) {
      dt = 1 / this.fpsValue
      this.sampledAt = this.elapsed
      this.steppedTimeValue = this.elapsed
      this.nextSampleAt = this.elapsed + 1 / this.fpsValue
    }
    return dt
  }
}