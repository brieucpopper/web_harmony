// TopBar (PRD FR3.1, FR8, FR10): file status | BPM/key/grid | transport | save/export.
// Export + Save/Load buttons are M6 stubs (disabled with tooltip) — layout is final.
import { useEffect, useState } from 'react'
import { formatTime } from '../constants'
import { getEngine } from '../audio/webEngine'
import { useProjectStore } from '../store/projectStore'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

interface TopBarProps {
  onShowHelp: () => void
}

export default function TopBar({ onShowHelp }: TopBarProps): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const audio = useProjectStore((s) => s.audio)
  const playing = useProjectStore((s) => s.playing)
  const playheadSec = useProjectStore((s) => s.playheadSec)
  const loopAll = useProjectStore((s) => s.loopAll)
  const masterVol = useProjectStore((s) => s.masterVol)
  const dirty = useProjectStore((s) => s.dirty)

  // Mirror engine clock → store (UI only; canvas reads engine directly at 60 fps).
  useEffect(() => {
    const engine = getEngine()
    return engine.onStateChange((s) => {
      useProjectStore.getState().setPlaying(s.playing)
      useProjectStore.getState().setPlayhead(s.playheadSec)
    })
  }, [])

  // Live readout: the store mirrors play/pause/seek/end, but during playback
  // the engine clock is the source of truth — poll it at 10 Hz (FR10.1).
  const [nowSec, setNowSec] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      try {
        setNowSec(getEngine().getPlayhead())
      } catch {
        // Engine unavailable — keep last value.
      }
    }, 100)
    return () => { window.clearInterval(id); }
  }, [])

  const togglePlay = (): void => {
    const engine = getEngine()
    if (!engine.hasBuffer()) return
    if (engine.isPlaying()) engine.pause()
    else engine.play()
  }
  const stop = (): void => {
    getEngine().stop()
  }
  const toggleLoop = (): void => {
    const next = !useProjectStore.getState().loopAll
    useProjectStore.getState().setLoopAll(next)
    getEngine().setLoopAll(next)
  }

  const duration = project?.durationSec ?? audio?.durationSec ?? 0
  const fileName = project?.name ?? audio?.fileName ?? 'No file'
  // While playing, the engine clock leads the store mirror — show the live value.
  const shownSec = playing ? nowSec : playheadSec

  return (
    <header
      className="flex items-center gap-4 overflow-x-auto bg-[#111A23] px-3 py-2 text-sm"
      aria-label="Top bar"
    >
      {/* Left: file status */}
      <div className="flex min-w-0 shrink-0 items-center gap-2" data-testid="file-status">
        <span className="truncate font-medium" title={fileName}>
          {fileName}
        </span>
        {duration > 0 ? (
          <span className="shrink-0 text-[#7d8fa1]">{formatTime(duration)}</span>
        ) : null}
        {dirty ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#E89A2E]" title="Unsaved changes" />
        ) : null}
      </div>

      {/* Center: musical context */}
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-1">
          BPM
          <input
            type="number"
            min={40}
            max={240}
            value={project?.bpm ?? 120}
            disabled={project === null}
            onChange={(e) => { useProjectStore.getState().setBpm(Number(e.target.value)); }}
            className="w-16 rounded bg-[#1E2A36] px-1 py-0.5"
            aria-label="Beats per minute, 40 to 240"
          />
        </label>
        <label className="flex items-center gap-1">
          Key
          <select
            value={project?.key.root ?? 0}
            disabled={project === null}
            onChange={(e) => { useProjectStore.getState().setKey({
                root: Number(e.target.value),
                mode: project?.key.mode ?? 'major',
              }); }
            }
            className="rounded bg-[#1E2A36] px-1 py-0.5"
            aria-label="Key root"
          >
            {ROOTS.map((r, i) => (
              <option key={r} value={i}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={project?.key.mode ?? 'major'}
            disabled={project === null}
            onChange={(e) => { useProjectStore.getState().setKey({
                root: project?.key.root ?? 0,
                mode: e.target.value === 'minor' ? 'minor' : 'major',
              }); }
            }
            className="rounded bg-[#1E2A36] px-1 py-0.5"
            aria-label="Key mode"
          >
            <option value="major">maj</option>
            <option value="minor">min</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={project?.showGrid ?? true}
            disabled={project === null}
            onChange={(e) => { useProjectStore.getState().setShowGrid(e.target.checked); }}
          />
          Grid
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={project?.snapToGrid ?? false}
            disabled={project === null}
            onChange={(e) => { useProjectStore.getState().setSnapToGrid(e.target.checked); }}
          />
          Snap
        </label>
        <label className="flex items-center gap-1 text-xs" title="Highlight pitch rows in the selected key">
          <input
            type="checkbox"
            checked={project?.highlightKey !== false}
            disabled={project === null}
            onChange={(e) => {
              useProjectStore.getState().setHighlightKey(e.target.checked)
            }}
            aria-label="Highlight key"
          />
          Key
        </label>
      </div>

      {/* Right: transport + persistence */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap font-mono text-xs text-[#7d8fa1]" data-testid="time-display">
          {formatTime(shownSec)} / {formatTime(duration)}
        </span>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!getEngineSafeHasBuffer() && audio === null}
          className="rounded bg-[#E89A2E] px-3 py-1 font-medium text-black disabled:opacity-40"
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={audio === null}
          className="rounded bg-[#2A3A4A] px-2 py-1 disabled:opacity-40"
          aria-label="Stop (S)"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={toggleLoop}
          aria-pressed={loopAll}
          className={`rounded px-2 py-1 ${loopAll ? 'bg-[#E89A2E] text-black' : 'bg-[#2A3A4A]'}`}
          aria-label="Loop all (L)"
          title="Loop entire project"
        >
          Loop
        </button>
        <label className="flex items-center gap-1 text-xs">
          Vol
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={masterVol}
            onChange={(e) => {
              const v = Number(e.target.value)
              useProjectStore.getState().setMasterVol(v)
              getEngine().setMasterVolume(v)
            }}
            className="w-20"
            aria-label="Master volume, 0 to 1.5"
          />
        </label>
        <button type="button" disabled title="Save .harmony.json — lands in M6" className="rounded bg-[#2A3A4A] px-2 py-1 opacity-40">
          Save
        </button>
        <button type="button" disabled title="Load .harmony.json — lands in M6" className="rounded bg-[#2A3A4A] px-2 py-1 opacity-40">
          Load
        </button>
        <button type="button" disabled title="Export WAV — lands in M6" className="rounded bg-[#2A3A4A] px-2 py-1 opacity-40">
          WAV
        </button>
        <button type="button" disabled title="Export MIDI — lands in M6" className="rounded bg-[#2A3A4A] px-2 py-1 opacity-40">
          MIDI
        </button>
        <button
          type="button"
          onClick={onShowHelp}
          className="rounded bg-[#2A3A4A] px-2 py-1 font-bold"
          aria-label="Keyboard shortcuts (?)"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
      </div>
    </header>
  )
}

function getEngineSafeHasBuffer(): boolean {
  try {
    return getEngine().hasBuffer()
  } catch {
    return false
  }
}
