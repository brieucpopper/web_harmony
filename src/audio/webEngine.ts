// WebAudio transport (PRD FR10). Single AudioContext clock, sample-accurate starts.
import type { EngineState, IEngine } from './engine'

/**
 * M1 scope: plays ONE loaded mix buffer (original mono). M4 upgrades to
 * playAll(voiceBuffers...) with mute/solo — same clock, same playhead logic.
 */
export class WebEngine implements IEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private durationSec = 0
  private startCtxTime = 0
  private startOffsetSec = 0
  private playing = false
  private loopAll = false
  private volume = 1
  private listeners = new Set<(s: EngineState) => void>()

  private ensureCtx(): AudioContext {
    if (this.ctx !== null) return this.ctx
    // Runtime WebAudio probe (typed as possibly-missing for old browsers).
    const globals = globalThis as unknown as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const Ctx = globals.AudioContext ?? globals.webkitAudioContext
    if (Ctx === undefined) throw new Error('WebAudio is not available in this browser.')
    this.ctx = new Ctx({ latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.gain.value = this.volume
    this.master.connect(this.ctx.destination)
    return this.ctx
  }

  loadBuffer(buffer: AudioBuffer, durationSec: number): void {
    const wasPlaying = this.playing
    this.stopSource()
    this.buffer = buffer
    this.durationSec = durationSec
    this.startOffsetSec = 0
    this.playing = false
    if (wasPlaying) this.play()
    else this.emit()
  }

  hasBuffer(): boolean {
    return this.buffer !== null
  }

  play(): void {
    const ctx = this.ensureCtx()
    if (this.buffer === null) return
    if (this.playing) return
    if (ctx.state === 'suspended') void ctx.resume()
    // Restart from 0 when playhead reached the end (Stop semantics + natural end).
    if (this.startOffsetSec >= this.durationSec - 0.001) this.startOffsetSec = 0
    this.startSource(this.startOffsetSec)
  }

  pause(): void {
    if (!this.playing) return
    this.startOffsetSec = this.getPlayhead()
    this.stopSource()
    this.playing = false
    this.emit()
  }

  stop(): void {
    this.stopSource()
    this.startOffsetSec = 0
    this.playing = false
    this.emit()
  }

  seek(sec: number): void {
    const clamped = Math.min(Math.max(0, sec), Math.max(0, this.durationSec))
    const wasPlaying = this.playing
    this.stopSource()
    this.startOffsetSec = clamped
    if (wasPlaying) this.startSource(clamped)
    else this.emit()
  }

  setMasterVolume(v: number): void {
    this.volume = Math.min(1.5, Math.max(0, v))
    if (this.master !== null && this.ctx !== null) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01)
    }
    this.emit()
  }

  setLoopAll(loop: boolean): void {
    this.loopAll = loop
    if (this.source !== null) this.source.loop = loop
  }

  getPlayhead(): number {
    if (!this.playing || this.ctx === null) return this.startOffsetSec
    const elapsed = this.ctx.currentTime - this.startCtxTime
    const pos = this.startOffsetSec + elapsed
    if (this.loopAll && this.durationSec > 0) return pos % this.durationSec
    return Math.min(pos, this.durationSec)
  }

  isPlaying(): boolean {
    return this.playing
  }

  onStateChange(cb: (s: EngineState) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  dispose(): void {
    this.stopSource()
    this.listeners.clear()
    if (this.ctx !== null) void this.ctx.close().catch(() => undefined)
    this.ctx = null
    this.master = null
  }

  /** Exposed for the app to build AudioBuffers without creating a second context. */
  getContext(): AudioContext {
    return this.ensureCtx()
  }

  private startSource(offsetSec: number): void {
    const ctx = this.ensureCtx()
    if (this.buffer === null || this.master === null) return
    this.stopSource()
    const src = ctx.createBufferSource()
    src.buffer = this.buffer
    src.loop = this.loopAll
    src.connect(this.master)
    const onEnded = (): void => {
      // Ignore seeks/stops (they disconnect + replace the source).
      if (this.source !== src) return
      this.playing = false
      this.startOffsetSec = this.loopAll ? 0 : this.durationSec
      // Loop wrap: restart immediately on the same clock.
      if (this.loopAll) {
        this.startSource(0)
        return
      }
      this.emit()
    }
    src.onended = onEnded
    // Start slightly ahead to avoid flam with UI state.
    const when = ctx.currentTime + 0.05
    src.start(when, Math.min(offsetSec, this.buffer.duration))
    this.source = src
    this.startCtxTime = when
    this.startOffsetSec = offsetSec
    this.playing = true
    this.emit()
  }

  private stopSource(): void {
    if (this.source !== null) {
      const src = this.source
      this.source = null
      src.onended = null
      try {
        src.stop()
      } catch {
        // Already stopped — harmless.
      }
      try {
        src.disconnect()
      } catch {
        // Already disconnected — harmless.
      }
    }
  }

  private emit(): void {
    const s: EngineState = {
      playing: this.playing,
      playheadSec: this.getPlayhead(),
      durationSec: this.durationSec,
    }
    for (const cb of this.listeners) cb(s)
  }
}

/** App-wide singleton (one clock, PRD §10 risk: timing drift). */
let singleton: WebEngine | null = null

export function getEngine(): WebEngine {
  if (singleton === null) singleton = new WebEngine()
  return singleton
}
