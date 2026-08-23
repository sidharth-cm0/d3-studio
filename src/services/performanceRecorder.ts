/**
 * Module 7 — Webcam Performance Recorder
 *
 * Captures face blendshapes + head rotation while the user performs.
 * Result is stored as a USER-sourced D3Performance on a shot.
 */

import type { D3Emotion, D3Gesture, D3Performance } from '../types/d3'

export interface PerformanceSample {
  time: number
  blendshapes: Record<string, number>
  headQuaternion: [number, number, number, number]
}

export interface RecordedPerformance {
  samples: PerformanceSample[]
  duration: number
  recordedAt: string
}

export class PerformanceRecorder {
  private samples: PerformanceSample[] = []
  private startTime = 0
  private recording = false

  get isRecording(): boolean {
    return this.recording
  }

  get sampleCount(): number {
    return this.samples.length
  }

  start(): void {
    this.samples = []
    this.startTime = performance.now()
    this.recording = true
  }

  sample(
    blendshapes: Record<string, number>,
    headQuat: { x: number; y: number; z: number; w: number }
  ): void {
    if (!this.recording) return
    const time = (performance.now() - this.startTime) / 1000
    const last = this.samples[this.samples.length - 1]
    if (last && time - last.time < 1 / 30) return
    this.samples.push({
      time,
      blendshapes: { ...blendshapes },
      headQuaternion: [headQuat.x, headQuat.y, headQuat.z, headQuat.w],
    })
  }

  stop(): RecordedPerformance | null {
    if (!this.recording) return null
    this.recording = false
    const duration = this.samples.length ? this.samples[this.samples.length - 1].time : 0
    if (this.samples.length < 3) return null
    return {
      samples: this.samples,
      duration,
      recordedAt: new Date().toISOString(),
    }
  }

  cancel(): void {
    this.recording = false
    this.samples = []
  }

  static toD3Performance(
    recording: RecordedPerformance,
    emotion: D3Emotion = 'neutral',
    gesture?: D3Gesture
  ): D3Performance {
    return {
      source: 'USER',
      emotion,
      gesture,
      blendshapeTrack: recording.samples.map((s) => ({
        time: s.time,
        blendshapes: s.blendshapes,
      })),
      headRotationTrack: recording.samples.map((s) => ({
        time: s.time,
        quaternion: s.headQuaternion,
      })),
    }
  }

  static sampleBlendshapesAt(
    track: Array<{ time: number; blendshapes: Record<string, number> }> | undefined,
    t: number
  ): Record<string, number> | null {
    if (!track || track.length === 0) return null
    if (t <= track[0].time) return track[0].blendshapes
    if (t >= track[track.length - 1].time) return track[track.length - 1].blendshapes
    for (let i = 0; i < track.length - 1; i++) {
      if (t >= track[i].time && t <= track[i + 1].time) {
        const a = track[i]
        const b = track[i + 1]
        const span = b.time - a.time || 1
        const alpha = (t - a.time) / span
        const out: Record<string, number> = {}
        const keys = new Set([...Object.keys(a.blendshapes), ...Object.keys(b.blendshapes)])
        keys.forEach((k) => {
          const va = a.blendshapes[k] ?? 0
          const vb = b.blendshapes[k] ?? 0
          out[k] = va + (vb - va) * alpha
        })
        return out
      }
    }
    return track[track.length - 1].blendshapes
  }

  static sampleHeadAt(
    track: Array<{ time: number; quaternion: [number, number, number, number] }> | undefined,
    t: number
  ): [number, number, number, number] | null {
    if (!track || track.length === 0) return null
    if (t <= track[0].time) return track[0].quaternion
    if (t >= track[track.length - 1].time) return track[track.length - 1].quaternion
    for (let i = 0; i < track.length - 1; i++) {
      if (t >= track[i].time && t <= track[i + 1].time) {
        const mid = (track[i].time + track[i + 1].time) / 2
        return t < mid ? track[i].quaternion : track[i + 1].quaternion
      }
    }
    return track[track.length - 1].quaternion
  }
}
