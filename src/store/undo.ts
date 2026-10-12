// Undo/redo stack, depth 50 (PRD FR4.6). Stores inverse patches as JSON snapshots
// of the voices array — simple, robust, and fast enough at ≤500 chunks.
import type { Voice } from '../types'

const MAX_DEPTH = 50 as const

interface UndoEntry {
  label: string
  before: Voice[]
}

function cloneVoices(voices: Voice[]): Voice[] {
  return structuredClone(voices)
}

export class UndoStack {
  private undo: UndoEntry[] = []
  private redo: UndoEntry[] = []

  get canUndo(): boolean {
    return this.undo.length > 0
  }

  get canRedo(): boolean {
    return this.redo.length > 0
  }

  get depth(): number {
    return this.undo.length
  }

  /** Push current voices BEFORE a mutation. Call site then mutates the store. */
  push(label: string, before: Voice[]): void {
    this.undo.push({ label, before: cloneVoices(before) })
    if (this.undo.length > MAX_DEPTH) this.undo.shift()
    this.redo = []
  }

  /** Pop: returns voices to restore, stashing current on the redo stack. */
  undoPop(current: Voice[]): Voice[] | undefined {
    const entry = this.undo.pop()
    if (entry === undefined) return undefined
    this.redo.push({ label: entry.label, before: cloneVoices(current) })
    return entry.before
  }

  redoPop(current: Voice[]): Voice[] | undefined {
    const entry = this.redo.pop()
    if (entry === undefined) return undefined
    this.undo.push({ label: entry.label, before: cloneVoices(current) })
    return entry.before
  }

  clear(): void {
    this.undo = []
    this.redo = []
  }
}

export const undoStack = new UndoStack()
