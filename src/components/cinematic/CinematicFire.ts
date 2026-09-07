import type { CinematicState, QualityTier, D3IntroMode } from './CinematicTimeline'

export interface FireAnchor {
  x: number
  y: number
}

export interface FireAnchors {
  ai: FireAnchor
  director: FireAnchor
  ignition: FireAnchor
}

interface FlameParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  ttl: number
  heat: number
  side: -1 | 0 | 1
  seed: number
}

interface SparkParticle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  ttl: number
  size: number
  color: string
}

interface FireSmokeParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  ttl: number
  seed: number
}

const PAPER_SPAN_PX = 150 // horizontal half-spread of the paper edge line

export class CinematicFire {
  private readonly flames: FlameParticle[] = []
  private readonly sparks: SparkParticle[] = []
  private readonly smoke: FireSmokeParticle[] = []
  private flameAccumulator = 0
  private smokeAccumulator = 0

  constructor(private readonly quality: QualityTier, private readonly reducedMotion: boolean) {}

  burstImpact(width: number, height: number, anchor?: FireAnchor) {
    const cx = anchor?.x ?? width * 0.48
    const cy = anchor?.y ?? height * 0.785
    const count = this.reducedMotion ? 10 : this.quality === 'high' ? 58 : this.quality === 'medium' ? 36 : 20
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI * (0.1 + Math.random() * 0.82)
      const force = 80 + Math.random() * 360
      this.sparks.push({
        x: cx + (Math.random() - 0.5) * 24,
        y: cy + (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force - 40,
        life: 0,
        ttl: 0.32 + Math.random() * 0.58,
        size: 0.8 + Math.random() * 2.4,
        color: Math.random() > 0.22 ? '#ff9d45' : '#fff0b6',
      })
    }
  }

  burstClap(width: number, height: number) {
    const count = this.reducedMotion ? 8 : this.quality === 'high' ? 42 : 24
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const force = 80 + Math.random() * 220
      this.sparks.push({
        x: width * 0.5 + (Math.random() - 0.5) * width * 0.32,
        y: height * 0.43 + (Math.random() - 0.5) * height * 0.16,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force,
        life: 0,
        ttl: 0.18 + Math.random() * 0.24,
        size: 0.6 + Math.random() * 1.7,
        color: Math.random() > 0.5 ? '#bfefff' : '#ffb56a',
      })
    }
  }

  burstMode(mode: D3IntroMode, width: number, height: number) {
    const count = this.reducedMotion ? 10 : this.quality === 'high' ? 72 : this.quality === 'medium' ? 42 : 24
    const x = mode === 'ai' ? width * 0.36 : width * 0.64
    const y = height * 0.68
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const force = 35 + Math.random() * 210
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 210,
        y: y + (Math.random() - 0.5) * 110,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force - 30,
        life: 0,
        ttl: 0.38 + Math.random() * 0.64,
        size: 0.8 + Math.random() * 2.5,
        color: mode === 'ai' ? '#6bd9e8' : '#ffad64',
      })
    }
  }

  draw(
    context: CanvasRenderingContext2D,
    dt: number,
    now: number,
    state: CinematicState,
    stateAge: number,
    width: number,
    height: number,
    hoveredMode: D3IntroMode | null,
    anchors?: FireAnchors | null
  ) {
    this.emitForState(dt, state, stateAge, width, height, hoveredMode, anchors)
    this.drawEmberBed(context, dt, now, state, stateAge, anchors)
    this.drawFlames(context, dt, now)
    this.drawSparks(context, dt)
    this.drawSmoke(context, dt, now, anchors)
  }

  reset() {
    this.flames.length = 0
    this.sparks.length = 0
    this.smoke.length = 0
    this.flameAccumulator = 0
    this.smokeAccumulator = 0
  }

  private emitForState(
    dt: number,
    state: CinematicState,
    stateAge: number,
    width: number,
    height: number,
    hoveredMode: D3IntroMode | null,
    anchors?: FireAnchors | null
  ) {
    const ignition = state === 'IGNITION'
    const papersBurning = state === 'PAPER_BURN' || state === 'MODES_REVEAL' || state === 'MODES_READY' || state === 'MODE_SELECTED'
    const active = ignition || papersBurning
    if (!active) return

    const ignitionAnchor = anchors?.ignition ?? { x: width * 0.49, y: height * 0.795 }
    const aiAnchor = anchors?.ai ?? { x: width * 0.36, y: height * 0.72 }
    const directorAnchor = anchors?.director ?? { x: width * 0.64, y: height * 0.72 }

    const qualityRate = this.quality === 'high' ? 76 : this.quality === 'medium' ? 48 : 25
    const rate = this.reducedMotion ? 10 : qualityRate * (hoveredMode ? 1.18 : 1)
    this.flameAccumulator += dt * rate
    while (this.flameAccumulator >= 1) {
      this.flameAccumulator -= 1
      if (ignition) {
        // Compact ignition point — flames hug the cigar contact zone.
        this.spawnFlame(ignitionAnchor.x, ignitionAnchor.y, 26, 0)
      } else {
        // Edge-crawl: spawn along a NARROW line across each paper's top edge so
        // the burn reads as a connected fire line, not scattered blobs.
        const crawl = Math.min(1, Math.max(0, stateAge / 1.9))
        const span = PAPER_SPAN_PX * (0.35 + crawl * 0.65)
        const jitterY = 6 + crawl * 10
        this.spawnFlame(aiAnchor.x + (Math.random() - 0.5) * span, aiAnchor.y + (Math.random() - 0.5) * jitterY, 22 + crawl * 14, -1)
        this.spawnFlame(directorAnchor.x + (Math.random() - 0.5) * span, directorAnchor.y + (Math.random() - 0.5) * jitterY, 22 + crawl * 14, 1)
      }
    }

    this.smokeAccumulator += dt * (this.reducedMotion ? 2 : papersBurning ? 10 : 4)
    while (this.smokeAccumulator >= 1) {
      this.smokeAccumulator -= 1
      const center: FireAnchor = ignition
        ? ignitionAnchor
        : Math.random() > 0.5 ? aiAnchor : directorAnchor
      this.smoke.push({
        x: center.x + (Math.random() - 0.5) * PAPER_SPAN_PX,
        y: center.y + (Math.random() - 0.5) * 26,
        vx: (Math.random() - 0.5) * 20,
        vy: -16 - Math.random() * 30,
        size: 12 + Math.random() * 22,
        life: 0,
        ttl: 2.2 + Math.random() * 2.6,
        seed: Math.random() * 1000,
      })
    }
  }

  private spawnFlame(x: number, y: number, spread: number, side: -1 | 0 | 1) {
    if (this.flames.length > (this.quality === 'high' ? 180 : this.quality === 'medium' ? 118 : 64)) return
    const seed = Math.random() * 1000
    this.flames.push({
      x: x + (Math.random() - 0.5) * spread * 0.5,
      y: y + (Math.random() - 0.5) * 10,
      // Hug the edge: minimal lateral drift, steady upward buoyancy.
      vx: (Math.random() - 0.5) * 16 + side * (Math.random() - 0.5) * 6,
      vy: -52 - Math.random() * 72,
      size: 12 + Math.random() * 26,
      life: 0,
      ttl: 0.5 + Math.random() * 0.6,
      heat: Math.random(),
      side,
      seed,
    })
  }

  /**
   * Persistent glowing ember line drawn under the flames at each paper edge —
   * a connected luminous bed so the fire reads as ONE burning object.
   */
  private drawEmberBed(
    context: CanvasRenderingContext2D,
    _dt: number,
    now: number,
    state: CinematicState,
    stateAge: number,
    anchors?: FireAnchors | null
  ) {
    if (!anchors) return
    const ignition = state === 'IGNITION'
    const papersBurning = state === 'PAPER_BURN' || state === 'MODES_REVEAL' || state === 'MODES_READY' || state === 'MODE_SELECTED'
    if (!ignition && !papersBurning) return
    const growth = ignition ? Math.min(1, stateAge / 0.9) : Math.min(1, 0.4 + stateAge / 2.2)
    const span = PAPER_SPAN_PX * (ignition ? 0.3 : 0.55 + growth * 0.45)

    context.save()
    context.globalCompositeOperation = 'lighter'
    const beds: Array<{ a: FireAnchor; mode: D3IntroMode }> = ignition
      ? [{ a: anchors.ignition, mode: 'director' }]
      : [{ a: anchors.ai, mode: 'ai' }, { a: anchors.director, mode: 'director' }]
    for (const { a, mode } of beds) {
      const flicker = 0.72 + Math.sin(now * 0.017 + (mode === 'ai' ? 1.3 : 4.1)) * 0.14 + Math.sin(now * 0.041) * 0.08
      const h = 6 + growth * 9
      const gradient = context.createLinearGradient(a.x - span, a.y, a.x + span, a.y)
      const core = mode === 'ai' ? 'rgba(120,235,255,' : 'rgba(255,214,140,'
      gradient.addColorStop(0, 'rgba(90,20,4,0)')
      gradient.addColorStop(0.18, `${core}${0.34 * flicker})`)
      gradient.addColorStop(0.5, `${core}${0.62 * flicker})`)
      gradient.addColorStop(0.82, `${core}${0.34 * flicker})`)
      gradient.addColorStop(1, 'rgba(90,20,4,0)')
      context.fillStyle = gradient
      context.beginPath()
      context.ellipse(a.x, a.y, span, h, 0, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }

  private drawFlames(context: CanvasRenderingContext2D, dt: number, now: number) {
    context.save()
    context.globalCompositeOperation = 'lighter'
    for (let i = this.flames.length - 1; i >= 0; i -= 1) {
      const flame = this.flames[i]
      flame.life += dt
      if (flame.life >= flame.ttl) {
        this.flames.splice(i, 1)
        continue
      }
      const p = flame.life / flame.ttl
      const flicker = Math.sin(now * 0.019 + flame.seed) * 9
      flame.x += (flame.vx + flicker) * dt
      flame.y += flame.vy * dt
      flame.size *= 1 + dt * 0.32
      const alpha = Math.pow(1 - p, 0.8)
      const gradient = context.createRadialGradient(flame.x, flame.y, 0, flame.x, flame.y, flame.size)
      gradient.addColorStop(0, `rgba(255, 248, 198, ${alpha * 0.95})`)
      gradient.addColorStop(0.2, `rgba(255, 185, 78, ${alpha * 0.72})`)
      gradient.addColorStop(0.58, `rgba(214, 73, 23, ${alpha * 0.42})`)
      gradient.addColorStop(1, 'rgba(60, 7, 2, 0)')
      context.fillStyle = gradient
      context.beginPath()
      context.moveTo(flame.x, flame.y + flame.size * 0.65)
      context.bezierCurveTo(
        flame.x - flame.size * (0.5 + flame.heat * 0.25),
        flame.y + flame.size * 0.16,
        flame.x - flame.size * 0.14 + flicker,
        flame.y - flame.size * 0.7,
        flame.x,
        flame.y - flame.size * (1.1 + flame.heat * 0.45)
      )
      context.bezierCurveTo(
        flame.x + flame.size * 0.24 + flicker * 0.4,
        flame.y - flame.size * 0.52,
        flame.x + flame.size * (0.52 - flame.heat * 0.18),
        flame.y + flame.size * 0.08,
        flame.x,
        flame.y + flame.size * 0.65
      )
      context.fill()
    }
    context.restore()
  }

  private drawSparks(context: CanvasRenderingContext2D, dt: number) {
    context.save()
    context.globalCompositeOperation = 'lighter'
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i]
      spark.life += dt
      if (spark.life >= spark.ttl) {
        this.sparks.splice(i, 1)
        continue
      }
      spark.vy += 360 * dt
      spark.vx *= Math.pow(0.94, dt * 60)
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
      const p = spark.life / spark.ttl
      context.globalAlpha = Math.pow(1 - p, 1.4)
      context.fillStyle = spark.color
      context.shadowBlur = 12
      context.shadowColor = spark.color
      context.beginPath()
      context.arc(spark.x, spark.y, spark.size * (1 - p * 0.45), 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
  }

  private drawSmoke(context: CanvasRenderingContext2D, dt: number, now: number, anchors?: FireAnchors | null) {
    context.save()
    context.globalCompositeOperation = 'screen'
    for (let i = this.smoke.length - 1; i >= 0; i -= 1) {
      const smoke = this.smoke[i]
      smoke.life += dt
      if (smoke.life >= smoke.ttl) {
        this.smoke.splice(i, 1)
        continue
      }
      const p = smoke.life / smoke.ttl
      smoke.x += (smoke.vx + Math.sin(now * 0.0012 + smoke.seed) * 9) * dt
      smoke.y += smoke.vy * dt
      smoke.size += dt * 14
      const alpha = 0.12 * Math.sin(Math.PI * p) * Math.pow(1 - p, 0.35)
      const gradient = context.createRadialGradient(smoke.x, smoke.y, 0, smoke.x, smoke.y, smoke.size)
      gradient.addColorStop(0, `rgba(128, 136, 136, ${alpha})`)
      gradient.addColorStop(1, 'rgba(20, 24, 25, 0)')
      context.fillStyle = gradient
      context.beginPath()
      context.ellipse(smoke.x, smoke.y, smoke.size * 1.45, smoke.size * 0.72, Math.sin(smoke.seed) * 1.2, 0, Math.PI * 2)
      context.fill()
    }
    context.restore()
    void anchors
  }
}