import type { D3IntroMode } from './CinematicTimeline'

type BrowserWindowWithWebkitAudio = typeof window & {
  webkitAudioContext?: typeof AudioContext
}

function getAudioContextCtor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as BrowserWindowWithWebkitAudio).webkitAudioContext || null
}

export class CinematicAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private roomOscillator: OscillatorNode | null = null
  private roomGain: GainNode | null = null
  private muted = false

  async resumeFromGesture() {
    const context = this.ensureContext()
    if (!context) return null
    if (context.state === 'suspended') await context.resume()
    this.startRoomTone()
    return context
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (!this.context || !this.master) return
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(muted ? 0.0001 : 0.82, now, 0.035)
  }

  async playClap() {
    const context = await this.resumeFromGesture()
    if (!context || this.muted || !this.master) return

    const now = context.currentTime + 0.004
    const bus = context.createGain()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.setValueAtTime(-20, now)
    compressor.knee.setValueAtTime(8, now)
    compressor.ratio.setValueAtTime(5, now)
    compressor.attack.setValueAtTime(0.002, now)
    compressor.release.setValueAtTime(0.13, now)

    bus.gain.setValueAtTime(0.0001, now)
    bus.gain.exponentialRampToValueAtTime(0.96, now + 0.006)
    bus.gain.exponentialRampToValueAtTime(0.18, now + 0.05)
    bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.34)
    bus.connect(compressor)
    compressor.connect(this.master)

    const click = context.createOscillator()
    const clickGain = context.createGain()
    click.type = 'square'
    click.frequency.setValueAtTime(1900, now)
    click.frequency.exponentialRampToValueAtTime(250, now + 0.055)
    clickGain.gain.setValueAtTime(0.58, now)
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
    click.connect(clickGain)
    clickGain.connect(bus)
    click.start(now)
    click.stop(now + 0.09)

    const body = context.createOscillator()
    const bodyFilter = context.createBiquadFilter()
    const bodyGain = context.createGain()
    body.type = 'triangle'
    body.frequency.setValueAtTime(132, now)
    body.frequency.exponentialRampToValueAtTime(44, now + 0.28)
    bodyFilter.type = 'lowpass'
    bodyFilter.frequency.setValueAtTime(430, now)
    bodyGain.gain.setValueAtTime(0.38, now + 0.006)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    body.connect(bodyFilter)
    bodyFilter.connect(bodyGain)
    bodyGain.connect(bus)
    body.start(now)
    body.stop(now + 0.34)

    this.playNoiseBurst({
      when: now,
      duration: 0.17,
      gain: 0.33,
      filterType: 'bandpass',
      frequency: 1480,
      q: 1.8,
      decayPower: 3.25,
      destination: bus,
    })
  }

  async playImpact() {
    const context = await this.resumeFromGesture()
    if (!context || this.muted || !this.master) return
    const now = context.currentTime + 0.004
    const impact = context.createOscillator()
    const gain = context.createGain()
    const filter = context.createBiquadFilter()
    impact.type = 'triangle'
    impact.frequency.setValueAtTime(92, now)
    impact.frequency.exponentialRampToValueAtTime(38, now + 0.2)
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(220, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26)
    impact.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    impact.start(now)
    impact.stop(now + 0.28)
    this.playNoiseBurst({
      when: now,
      duration: 0.1,
      gain: 0.11,
      filterType: 'highpass',
      frequency: 1900,
      q: 0.7,
      decayPower: 2.6,
      destination: this.master,
    })
  }

  async playIgnition() {
    const context = await this.resumeFromGesture()
    if (!context || this.muted || !this.master) return
    const now = context.currentTime + 0.006
    this.playNoiseBurst({
      when: now,
      duration: 0.44,
      gain: 0.18,
      filterType: 'bandpass',
      frequency: 720,
      q: 0.9,
      decayPower: 1.35,
      destination: this.master,
    })
    ;[188, 282, 376].forEach((frequency, index) => {
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.type = 'sawtooth'
      const start = now + index * 0.035
      osc.frequency.setValueAtTime(frequency, start)
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.55, start + 0.23)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.05 / (index + 1), start + 0.026)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42)
      osc.connect(gain)
      gain.connect(this.master!)
      osc.start(start)
      osc.stop(start + 0.48)
    })
  }

  async playMode(mode: D3IntroMode) {
    const context = await this.resumeFromGesture()
    if (!context || this.muted || !this.master) return
    const now = context.currentTime + 0.004
    const frequencies = mode === 'ai' ? [220, 330, 495, 742] : [96, 144, 216, 324]
    frequencies.forEach((frequency, index) => {
      const osc = context.createOscillator()
      const gain = context.createGain()
      const filter = context.createBiquadFilter()
      osc.type = mode === 'ai' ? 'sine' : 'triangle'
      const start = now + index * 0.06
      osc.frequency.setValueAtTime(frequency, start)
      osc.frequency.exponentialRampToValueAtTime(frequency * (mode === 'ai' ? 1.22 : 0.86), start + 0.34)
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(mode === 'ai' ? 1700 : 760, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18 / (index + 1), start + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.62)
      osc.connect(filter)
      filter.connect(gain)
      gain.connect(this.master!)
      osc.start(start)
      osc.stop(start + 0.68)
    })
  }

  dispose() {
    this.stopRoomTone()
    if (this.context && this.context.state !== 'closed') {
      void this.context.close()
    }
    this.context = null
    this.master = null
  }

  private ensureContext() {
    if (this.context) return this.context
    const AudioContextCtor = getAudioContextCtor()
    if (!AudioContextCtor) return null
    this.context = new AudioContextCtor()
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0.0001 : 0.82
    this.master.connect(this.context.destination)
    return this.context
  }

  private startRoomTone() {
    if (!this.context || !this.master || this.roomOscillator) return
    const now = this.context.currentTime
    const osc = this.context.createOscillator()
    const gain = this.context.createGain()
    const filter = this.context.createBiquadFilter()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(48, now)
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(95, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.65)
    osc.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    osc.start(now)
    this.roomOscillator = osc
    this.roomGain = gain
  }

  private stopRoomTone() {
    if (!this.context || !this.roomOscillator || !this.roomGain) return
    const now = this.context.currentTime
    this.roomGain.gain.cancelScheduledValues(now)
    this.roomGain.gain.setTargetAtTime(0.0001, now, 0.08)
    this.roomOscillator.stop(now + 0.28)
    this.roomOscillator = null
    this.roomGain = null
  }

  private playNoiseBurst(options: {
    when: number
    duration: number
    gain: number
    filterType: BiquadFilterType
    frequency: number
    q: number
    decayPower: number
    destination: AudioNode
  }) {
    if (!this.context) return
    const buffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * options.duration), this.context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
      const decay = Math.pow(1 - i / data.length, options.decayPower)
      data[i] = (Math.random() * 2 - 1) * decay
    }

    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()
    source.buffer = buffer
    filter.type = options.filterType
    filter.frequency.setValueAtTime(options.frequency, options.when)
    filter.Q.setValueAtTime(options.q, options.when)
    gain.gain.setValueAtTime(options.gain, options.when)
    gain.gain.exponentialRampToValueAtTime(0.0001, options.when + options.duration)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(options.destination)
    source.start(options.when)
    source.stop(options.when + options.duration)
  }
}