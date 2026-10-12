// Ingest UI (PRD FR1): picker + drag-drop, progress, blocking error toasts,
// monophonic banner. Decodes → pitch-tracks (M2 worker) → segments white
// voice → loads engine buffer → stores project.
import { useCallback, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { IngestError, decodeFile, monoToAudioBuffer } from '../dsp/audioUtil'
import type { DecodedAudio } from '../dsp/audioUtil'
import { segmentFramesToChunks } from '../dsp/segment'
import { trackPitch } from '../dsp/pitchTrack'
import type { Frame } from '../types'
import { getEngine } from '../audio/webEngine'
import { useProjectStore } from '../store/projectStore'

function loadEngineBuffer(decoded: DecodedAudio): void {
  const engine = getEngine()
  const ctx = engine.getContext()
  const buf = monoToAudioBuffer(ctx, decoded.mono, decoded.sampleRate)
  engine.loadBuffer(buf, decoded.durationSec)
  engine.setMasterVolume(useProjectStore.getState().masterVol)
}

export default function Dropzone(): React.JSX.Element {
  const status = useProjectStore((s) => s.status)
  const progress = useProjectStore((s) => s.progress)
  const progressLabel = useProjectStore((s) => s.progressLabel)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const ingest = useCallback(async (file: File) => {
    const st = useProjectStore.getState()
    const controller = new AbortController()
    abortRef.current = controller
    st.beginDecode(file.name)
    try {
      const decoded = await decodeFile(file, (stage, frac) => {
        if (controller.signal.aborted) throw new IngestError('decode', 'Cancelled.')
        const s = useProjectStore.getState()
        if (stage === 'decoding') s.reportProgress(`Decoding ${file.name}…`, frac * 0.5)
        else s.reportProgress('Mixing to mono…', 0.5 + frac * 0.3)
      })
      if (controller.signal.aborted) throw new IngestError('decode', 'Cancelled.')
      // M2: Analyzing pitch (x%) → Segmenting → Ready. No abort checkpoint
      // needed between decode and analysis: trackPitch re-checks the signal
      // on entry, so a late abort funnels to 'Cancelled.' → reset (no stuck
      // 'decoding' state).
      st.beginAnalysis()
      let frames: Frame[]
      try {
        frames = await trackPitch(
          decoded.mono,
          decoded.sampleRate,
          (frac) => {
            if (controller.signal.aborted) throw new IngestError('decode', 'Cancelled.')
            useProjectStore
              .getState()
              .reportProgress(`Analyzing pitch ${Math.round(frac * 100)}%…`, 0.8 + frac * 0.12)
          },
          controller.signal,
        )
      } catch (err) {
        if (err instanceof IngestError && err.message === 'Cancelled.') throw err
        // Degraded: analysis failed but the audio decoded fine — keep it
        // playable (M1 shell) and surface the reason as a blocking toast.
        loadEngineBuffer(decoded)
        useProjectStore.getState().finishIngest(decoded)
        useProjectStore
          .getState()
          .fail(err instanceof Error ? err.message : 'Pitch analysis failed.')
        return
      }
      // Segmentation is synchronous: no abort can interleave here, and once
      // frames resolved the worker is settled — always finish (an abort that
      // lands now is a no-op by design, never a stuck 'analyzing' state).
      st.beginSegmenting()
      const whiteId = nanoid()
      const chunks = segmentFramesToChunks(frames, whiteId)
      loadEngineBuffer(decoded)
      st.finishAnalysis(decoded, frames, whiteId, chunks)
    } catch (err) {
      if (err instanceof IngestError && err.message === 'Cancelled.') {
        useProjectStore.getState().reset()
        return
      }
      const msg = err instanceof Error ? err.message : 'Unknown ingest error.'
      useProjectStore.getState().fail(msg)
    } finally {
      setCancelling(false)
    }
  }, [])

  const busy = status === 'decoding' || status === 'analyzing' || status === 'segmenting'

  return (
    <div
      className={`flex flex-col items-center gap-2 border-b border-[#0d141c] bg-[#111A23] px-4 py-3 ${
        dragOver ? 'outline-2 outline-[#E89A2E]' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => { setDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f !== undefined) void ingest(f)
      }}
      data-testid="dropzone"
    >
      <p className="text-xs text-[#7d8fa1]">Best with solo voice, no instruments. (monophonic)</p>
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".mp3,.wav,audio/mpeg,audio/wav"
          className="hidden"
          aria-label="Choose audio file, MP3 or WAV"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f !== undefined) void ingest(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="rounded bg-[#E89A2E] px-4 py-1.5 font-medium text-black disabled:opacity-40"
        >
          {status === 'empty' ? 'Upload MP3 / WAV' : 'Replace audio'}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort()
              setCancelling(true)
            }}
            disabled={cancelling}
            className="rounded bg-[#2A3A4A] px-3 py-1.5"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {busy ? (
        <div className="w-full max-w-md" role="status" aria-live="polite">
          <div className="mb-1 text-center text-xs">{progressLabel}</div>
          <div className="h-1.5 overflow-hidden rounded bg-[#2A3A4A]">
            <div className="h-full bg-[#E89A2E]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <p className="text-[11px] text-[#334455]">MP3 or WAV · ≤20 MB · ≤120 s · stays on this device</p>
    </div>
  )
}
