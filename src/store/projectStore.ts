// Project + transport UI state (PRD M1, FR1/FR10/FR11).
// Big audio samples live here but components must select narrow slices.
import { create } from 'zustand'
import type { KeySignature, Project, ProjectStatus } from '../types'
import { emptyProject } from '../types'
import type { DecodedAudio } from '../dsp/audioUtil'
import { autosaveAudio, autosaveProject, AUTOSAVE_AUDIO_ID } from '../persist/idb'
import { undoStack } from './undo'
import { useSelectionStore } from './selectionStore'

export interface LoadedAudio {
  mono: Float32Array
  sampleRate: number
  durationSec: number
  fileName: string
}

interface ProjectState {
  project: Project | null
  audio: LoadedAudio | null
  status: ProjectStatus
  /** 0–1 progress for decode/analyze/segment stages. */
  progress: number
  progressLabel: string
  error: string | null
  /** Transport mirror (engine is the clock; this is for UI). */
  playing: boolean
  playheadSec: number
  loopAll: boolean
  masterVol: number
  dirty: boolean

  // Actions
  beginDecode: (fileName: string) => void
  reportProgress: (label: string, fraction: number) => void
  finishIngest: (decoded: DecodedAudio) => void
  fail: (message: string) => void
  dismissError: () => void
  reset: () => void

  setBpm: (bpm: number) => void
  setKey: (key: KeySignature) => void
  setShowGrid: (v: boolean) => void
  setSnapToGrid: (v: boolean) => void
  setHighlightKey: (v: boolean) => void
  setMasterVol: (v: number) => void
  setLoopAll: (v: boolean) => void
  setPlaying: (v: boolean) => void
  setPlayhead: (sec: number) => void
  /** Restore a project + audio (reload path, FR11). */
  restore: (project: Project, audio: LoadedAudio | null) => void
  markClean: () => void
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutosave(project: Project, audio: LoadedAudio | null): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void autosaveProject(project).catch(() => undefined)
    if (audio !== null) {
      void autosaveAudio({
        id: AUTOSAVE_AUDIO_ID,
        mono: audio.mono,
        sampleRate: audio.sampleRate,
        fileName: audio.fileName,
      }).catch(() => undefined)
    }
  }, 1000)
}

function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return 120
  return Math.min(240, Math.max(40, Math.round(bpm)))
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  project: null,
  audio: null,
  status: 'empty',
  progress: 0,
  progressLabel: '',
  error: null,
  playing: false,
  playheadSec: 0,
  loopAll: false,
  masterVol: 1,
  dirty: false,

  beginDecode: (fileName) => { set({
      status: 'decoding',
      progress: 0,
      progressLabel: `Decoding ${fileName}…`,
      error: null,
      playing: false,
      playheadSec: 0,
    }); },

  reportProgress: (label, fraction) => { set({ progressLabel: label, progress: Math.min(1, Math.max(0, fraction)) }); },

  finishIngest: (decoded) => {
    // M1: single white-voice-less project shell. M2 adds f0 + white voice chunks.
    const project = emptyProject(decoded.fileName)
    project.durationSec = decoded.durationSec
    project.sampleRate = decoded.sampleRate
    const audio: LoadedAudio = {
      mono: decoded.mono,
      sampleRate: decoded.sampleRate,
      durationSec: decoded.durationSec,
      fileName: decoded.fileName,
    }
    // New project = new history: drop any undo/redo from the previous one
    // and clear stale chunk selection (ids would dangle).
    undoStack.clear()
    useSelectionStore.getState().clear()
    scheduleAutosave(project, audio)
    set({
      project,
      audio,
      status: 'ready',
      progress: 1,
      progressLabel: 'Ready',
      error: null,
      dirty: true,
    })
  },

  fail: (message) => { set({ status: 'error', error: message, progressLabel: '' }); },

  dismissError: () => { set((s) => ({ error: null, status: s.project !== null ? 'ready' : 'empty' })); },

  reset: () => {
    const { project, audio } = get()
    if (project !== null && audio !== null) scheduleAutosave(project, audio)
    undoStack.clear()
    useSelectionStore.getState().clear()
    set({
      project: null,
      audio: null,
      status: 'empty',
      progress: 0,
      progressLabel: '',
      playing: false,
      playheadSec: 0,
      dirty: false,
    })
  },

  setBpm: (bpm) => {
    const { project, audio } = get()
    if (project === null) return
    const next = { ...project, bpm: clampBpm(bpm) }
    scheduleAutosave(next, audio)
    set({ project: next, dirty: true })
  },

  setKey: (key) => {
    const { project, audio } = get()
    if (project === null) return
    const next = { ...project, key: { ...key } }
    scheduleAutosave(next, audio)
    set({ project: next, dirty: true })
  },

  setShowGrid: (v) => {
    const { project, audio } = get()
    if (project === null) return
    const next = { ...project, showGrid: v }
    scheduleAutosave(next, audio)
    set({ project: next, dirty: true })
  },

  setSnapToGrid: (v) => {
    const { project, audio } = get()
    if (project === null) return
    const next = { ...project, snapToGrid: v }
    scheduleAutosave(next, audio)
    set({ project: next, dirty: true })
  },

  setHighlightKey: (v) => {
    const { project, audio } = get()
    if (project === null) return
    const next = { ...project, highlightKey: v }
    scheduleAutosave(next, audio)
    set({ project: next, dirty: true })
  },

  setMasterVol: (v) => { set({ masterVol: Math.min(1.5, Math.max(0, v)) }); },
  setLoopAll: (v) => { set({ loopAll: v }); },
  setPlaying: (v) => { set({ playing: v }); },
  setPlayhead: (sec) => { set({ playheadSec: Math.max(0, sec) }); },

  restore: (project, audio) => {
    // Pre-highlightKey autosaves lack the field — IDB data is untrusted,
    // so read through a partial and default to ON.
    const saved = project as Partial<Project>
    const normalized: Project = { ...project, highlightKey: saved.highlightKey ?? true }
    // Switching projects invalidates undo/redo + selection from the old one.
    // M6 Load calls this same path, so history never leaks across projects.
    undoStack.clear()
    useSelectionStore.getState().clear()
    set({
      project: normalized,
      audio,
      status: 'ready',
      progress: 1,
      progressLabel: 'Ready',
      error: null,
      playing: false,
      playheadSec: 0,
      loopAll: false,
      dirty: false,
    }); },

  markClean: () => { set({ dirty: false }); },
}))
