// Selection + tool state (PRD FR4). Chunk editing lands in M3; shape is fixed now.
import { create } from 'zustand'

export type Tool = 'select' | 'cut'

interface SelectionState {
  selectedIds: string[]
  tool: Tool
  setTool: (t: Tool) => void
  selectOnly: (id: string) => void
  toggleAdd: (id: string) => void
  selectMany: (ids: string[]) => void
  clear: () => void
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedIds: [],
  tool: 'select',
  setTool: (tool) => { set({ tool }); },
  selectOnly: (id) => { set({ selectedIds: [id] }); },
  toggleAdd: (id) => { set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })); },
  selectMany: (ids) => { set({ selectedIds: ids }); },
  clear: () => { set({ selectedIds: [] }); },
}))
