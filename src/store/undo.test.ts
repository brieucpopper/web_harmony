// Undo stack: depth 50, push/undo/redo round-trip (PRD FR4.6).
import { describe, expect, it } from 'vitest'
import { UndoStack } from './undo'
import type { Voice } from '../types'

function voice(name: string): Voice {
  return { id: name, name, color: '#fff', mute: false, solo: false, volume: 1, chunks: [] }
}

describe('UndoStack', () => {
  it('undo restores the before-state and redo re-applies', () => {
    const stack = new UndoStack()
    const before = [voice('v1')]
    const after = [voice('v1'), voice('v2')]
    stack.push('add voice', before)
    expect(stack.canUndo).toBe(true)
    const restored = stack.undoPop(after)
    expect(restored?.map((v) => v.id)).toEqual(['v1'])
    expect(stack.canRedo).toBe(true)
    const redone = stack.redoPop(restored ?? [])
    expect(redone?.map((v) => v.id)).toEqual(['v1', 'v2'])
  })

  it('returns undefined when stacks are empty', () => {
    const stack = new UndoStack()
    expect(stack.undoPop([])).toBeUndefined()
    expect(stack.redoPop([])).toBeUndefined()
  })

  it('caps depth at 50', () => {
    const stack = new UndoStack()
    for (let i = 0; i < 60; i++) stack.push(`edit ${i}`, [voice(`v${i}`)])
    expect(stack.depth).toBe(50)
  })

  it('new push clears the redo stack', () => {
    const stack = new UndoStack()
    stack.push('a', [])
    stack.undoPop([voice('x')])
    expect(stack.canRedo).toBe(true)
    stack.push('b', [])
    expect(stack.canRedo).toBe(false)
  })

  it('clear drops undo and redo (project switch must not leak history)', () => {
    const stack = new UndoStack()
    stack.push('a', [voice('v1')])
    stack.undoPop([voice('v2')])
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(true)
    stack.clear()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
    expect(stack.depth).toBe(0)
  })
})
