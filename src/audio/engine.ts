// Transport engine contract (PRD §8, FR10). V2 synth/VST can re-implement IEngine.
export interface EngineState {
  playing: boolean
  /** Playhead position in seconds (project timeline). */
  playheadSec: number
  durationSec: number
}

export interface IEngine {
  /** Load (or replace) the mix buffer to play. */
  loadBuffer(buffer: AudioBuffer, durationSec: number): void
  hasBuffer(): boolean
  play(): void
  pause(): void
  stop(): void
  /** Jump playhead; resumes from new offset if playing. */
  seek(sec: number): void
  setMasterVolume(v: number): void
  setLoopAll(loop: boolean): void
  getPlayhead(): number
  isPlaying(): boolean
  onStateChange(cb: (s: EngineState) => void): () => void
  dispose(): void
}
