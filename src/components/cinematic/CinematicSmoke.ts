import type { CinematicState, QualityTier } from './CinematicTimeline'

interface SmokeParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  ttl: number
  seed: number
  alpha: number
  rotation: number
}

export class CinematicSmoke {
  private readonly particles: SmokeParticle[] = []
  private emitAccumulator = 0

  constructor(private readonly quality: QualityTier, private readonly reducedMotion: boolean) {}

  burst(width: number, height: number) {
    const count = this.reducedMotion ? 8 : this.quality === 'high' ? 46 : this.quality === 'medium' ? 30 : 16
    for (let i = 0; i < count; i += 1) {
      this.spawnMouth(width, height, true)
    }
  }

  draw(
    context: CanvasRenderingContext2D,
    dt: number,
    now: number,
    state: CinematicState,
    stateAge: number,
    width: number,
    height: number
  ) {
    const activelySmoking = state === 'GORILLA_SMOKE' || state === 'EXHALE'
    if (activelySmoking && !this.reducedMotion) {
      const emitRate = state === 'EXHALE' ? 28 : 9
      this.emitAccumulator += dt * emitRate
      while (this.emitAccumulator >= 1) {
        this.emitAccumulator -= 1
        this.spawnMouth(width, height, state === 'EXHALE')
      }
    }

    if (state === 'GORILLA_SMOKE' && stateAge < 0.38 && this.particles.length < 8) {
      this.spawnMouth(width, height, false)
    }

    context.save()
    context.globalCompositeOperation = 'screen'
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i]
      particle.life += dt
      if (particle.life >= particle.ttl) {
        this.particles.splice(i, 1)
        continue
      }
      const p = particle.life / particle.ttl
      const turbulence = Math.sin(now * 0.0017 + particle.seed + p * 4.2) * (10 + particle.size * 0.12)
      particle.vx += turbulence * dt
      particle.vy -= (6 + particle.size * 0.055) * dt
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      particle.size += dt * (18 + particle.size * 0.22)
      particle.rotation += dt * Math.sin(particle.seed) * 0.8

      const alpha = particle.alpha * Math.sin(Math.PI * Math.min(1, p)) * Math.pow(1 - p, 0.62)
      const gradient = context.createRadialGradient(particle.x, particle.y, particle.size * 0.08, particle.x, particle.y, particle.size)
      gradient.addColorStop(0, `rgba(226, 233, 235, ${alpha * 0.34})`)
      gradient.addColorStop(0.42, `rgba(120, 132, 139, ${alpha * 0.18})`)
      gradient.addColorStop(1, 'rgba(8, 12, 16, 0)')

      context.save()
      context.translate(particle.x, particle.y)
      context.rotate(particle.rotation)
      context.scale(1.45 + Math.sin(particle.seed) * 0.18, 0.68 + Math.cos(particle.seed) * 0.1)
      context.fillStyle = gradient
      context.beginPath()
      context.arc(0, 0, particle.size, 0, Math.PI * 2)
      context.fill()
      context.restore()
    }
    context.restore()
  }

  reset() {
    this.particles.length = 0
    this.emitAccumulator = 0
  }

  private spawnMouth(width: number, height: number, exhale: boolean) {
    if (this.particles.length > (this.quality === 'high' ? 170 : this.quality === 'medium' ? 110 : 58)) return
    const seed = Math.random() * 1000
    const mouthX = width * 0.555 + (Math.random() - 0.5) * width * 0.018
    const mouthY = height * 0.47 + (Math.random() - 0.5) * height * 0.018
    this.particles.push({
      x: mouthX,
      y: mouthY,
      vx: (exhale ? -28 : -8) + (Math.random() - 0.5) * 36,
      vy: (exhale ? -34 : -18) - Math.random() * 26,
      size: (exhale ? 20 : 12) + Math.random() * (exhale ? 28 : 14),
      life: 0,
      ttl: (exhale ? 2.8 : 2.2) + Math.random() * 1.8,
      seed,
      alpha: (exhale ? 0.72 : 0.42) * (this.reducedMotion ? 0.48 : 1),
      rotation: Math.random() * Math.PI,
    })
  }
}