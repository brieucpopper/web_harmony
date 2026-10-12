// Edit toolbar (M3, PRD FR4.1/FR4.6): Select/Cut tools + Undo/Redo + Delete.
// Sits under VoiceTabs; disabled without a project.
import { useProjectStore } from '../store/projectStore'
import { useSelectionStore } from '../store/selectionStore'
import { undoStack } from '../store/undo'

export default function Toolbar(): React.JSX.Element {
  const hasProject = useProjectStore((s) => s.project !== null)
  // Reactive bits only: undo depth + selection size. canUndo/canRedo read the
  // singleton at render; historyVersion bumps on every voices mutation.
  useProjectStore((s) => s.historyVersion)
  const tool = useSelectionStore((s) => s.tool)
  const selectedCount = useSelectionStore((s) => s.selectedIds.length)

  const setTool = useSelectionStore((s) => s.setTool)
  const btn = 'rounded px-2 py-0.5 text-xs disabled:opacity-40'
  const on = 'bg-[#E89A2E] text-black'
  const off = 'bg-[#2A3A4A]'

  return (
    <div
      className="flex items-center gap-1 bg-[#111A23] px-3 py-1"
      role="toolbar"
      aria-label="Edit tools"
      data-testid="edit-toolbar"
    >
      <div className="flex items-center gap-1" role="group" aria-label="Tool">
        <button
          type="button"
          disabled={!hasProject}
          aria-pressed={tool === 'select'}
          title="Select tool (V): click, Shift-click, marquee, drag to move"
          aria-label="Select tool (V)"
          className={`${btn} ${tool === 'select' ? on : off}`}
          onClick={() => { setTool('select'); }}
        >
          Select
        </button>
        <button
          type="button"
          disabled={!hasProject}
          aria-pressed={tool === 'cut'}
          title="Cut tool (C): click a note to split it"
          aria-label="Cut tool (C)"
          className={`${btn} ${tool === 'cut' ? on : off}`}
          onClick={() => { setTool('cut'); }}
        >
          Cut
        </button>
      </div>
      <span className="mx-1 h-4 w-px bg-[#2A3A4A]" aria-hidden="true" />
      <div className="flex items-center gap-1" role="group" aria-label="History">
        <button
          type="button"
          disabled={!hasProject || !undoStack.canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo (Ctrl+Z)"
          className={`${btn} ${off}`}
          onClick={() => { useProjectStore.getState().undo(); }}
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!hasProject || !undoStack.canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo (Ctrl+Shift+Z)"
          className={`${btn} ${off}`}
          onClick={() => { useProjectStore.getState().redo(); }}
        >
          Redo
        </button>
      </div>
      <span className="mx-1 h-4 w-px bg-[#2A3A4A]" aria-hidden="true" />
      <button
        type="button"
        disabled={!hasProject || selectedCount === 0}
        title="Delete selected notes (Del)"
        aria-label={`Delete selected notes (Del)${selectedCount > 0 ? `, ${String(selectedCount)} selected` : ''}`}
        className={`${btn} ${off}`}
        onClick={() => {
          const st = useProjectStore.getState()
          st.deleteChunks(useSelectionStore.getState().selectedIds)
        }}
      >
        Delete
      </button>
      {selectedCount > 0 ? (
        <span className="ml-1 text-xs text-[#7d8fa1]" data-testid="selection-count">
          {selectedCount} selected
        </span>
      ) : null}
    </div>
  )
}
