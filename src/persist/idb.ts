// Local persistence (PRD FR11.1): Dexie IndexedDB, autosave debounce 1 s.
import Dexie, { type Table } from 'dexie'
import type { Project } from '../types'

export interface ProjectRow {
  id: string
  updatedAt: number
  project: Project
}

export interface AudioRow {
  id: string
  /** Mono mixdown samples. */
  mono: Float32Array
  sampleRate: number
  fileName: string
}

class HarmonyDb extends Dexie {
  projects!: Table<ProjectRow, string>
  audioBlobs!: Table<AudioRow, string>

  constructor() {
    super('harmony-db')
    this.version(1).stores({
      projects: 'id',
      audioBlobs: 'id',
    })
  }
}

export const db = new HarmonyDb()

export const AUTOSAVE_PROJECT_ID = 'autosave'
export const AUTOSAVE_AUDIO_ID = 'autosave-audio'

export async function autosaveProject(project: Project): Promise<void> {
  await db.projects.put({ id: AUTOSAVE_PROJECT_ID, updatedAt: Date.now(), project })
}

export async function autosaveAudio(row: AudioRow): Promise<void> {
  await db.audioBlobs.put(row)
}

export async function loadAutosave(): Promise<{ project: Project; audio: AudioRow | undefined }> {
  const projRow = await db.projects.get(AUTOSAVE_PROJECT_ID)
  if (projRow === undefined) throw new Error('empty')
  const audio = await db.audioBlobs.get(AUTOSAVE_AUDIO_ID)
  return { project: projRow.project, audio }
}

export async function clearAutosave(): Promise<void> {
  await db.projects.delete(AUTOSAVE_PROJECT_ID)
  await db.audioBlobs.delete(AUTOSAVE_AUDIO_ID)
}
