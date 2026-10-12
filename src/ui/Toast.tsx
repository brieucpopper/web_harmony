// Blocking error toast (PRD FR1.3): ingest failures with reason + dismiss.
import { useProjectStore } from '../store/projectStore'

export default function Toast(): React.JSX.Element {
  const error = useProjectStore((s) => s.error)
  const dismiss = useProjectStore((s) => s.dismissError)
  if (error === null) return <div aria-live="polite" />
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-center gap-3 rounded border border-[#EF4444] bg-[#2a1215] px-4 py-2 text-sm"
    >
      <span>{error}</span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded bg-[#EF4444] px-2 py-0.5 font-medium text-white"
        aria-label="Dismiss error"
      >
        OK
      </button>
    </div>
  )
}
