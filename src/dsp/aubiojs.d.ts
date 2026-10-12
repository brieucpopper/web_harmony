// Minimal ambient types for the untyped aubiojs WASM build (M2). Only the
// YIN pitch surface we use is declared — Tempo/Onset arrive with later needs.
declare module 'aubiojs' {
  export interface AubioPitch {
    do(buffer: Float32Array): number
    getConfidence(): number
  }

  export interface AubioModule {
    Pitch: new (
      method:
        | 'default'
        | 'yin'
        | 'yinfast'
        | 'yinfft'
        | 'mcomb'
        | 'schmitt'
        | 'fcomb'
        | 'specacf',
      bufferSize: number,
      hopSize: number,
      sampleRate: number,
    ) => AubioPitch
  }

  const createAubio: () => Promise<AubioModule>
  export default createAubio
}
