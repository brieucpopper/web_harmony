// Accessible modal shell: Esc + backdrop-click close, initial focus in dialog.
import { useEffect, useRef } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export default function Modal({ title, onClose, children }: ModalProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => { window.removeEventListener('keydown', onKey); }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[80vh] w-full max-w-md overflow-auto rounded border border-[#2A3A4A] bg-[#111A23] p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-[#2A3A4A] px-2 py-0.5"
            aria-label="Close dialog (Esc)"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
