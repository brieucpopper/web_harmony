// Keyboard-shortcut guide (`?`). Lists only shortcuts that exist today.
import Modal from './Modal'

interface ShortcutsHelpProps {
  onClose: () => void
}

const GROUPS: Array<{ name: string; rows: Array<[string, string]> }> = [
  {
    name: 'Transport',
    rows: [
      ['Space', 'Play / pause'],
      ['S', 'Stop (back to start)'],
      ['L', 'Loop whole project on/off'],
      ['← / → on ruler', 'Seek ∓ 1 s'],
    ],
  },
  {
    name: 'Edit',
    rows: [
      ['V / C', 'Select / Cut tool'],
      ['Click chunk', 'Select (Shift-click adds)'],
      ['Drag empty', 'Marquee select'],
      ['Drag chunk', 'Move (ghost preview + tooltip)'],
      ['Drag right edge', 'Trim end'],
      ['Cut tool + click', 'Split note in two'],
      ['← / →', 'Move ∓ 10 ms (Shift: 100 ms, Snap: 1 beat)'],
      ['↑ / ↓', 'Move ∓ 1 semitone (Shift: octave)'],
      ['Del', 'Delete selected'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Esc', 'Clear selection'],
      ['Dbl-click', 'Advanced edit (M5)'],
    ],
  },
  {
    name: 'View',
    rows: [
      ['Wheel', 'Zoom pitch axis (to cursor)'],
      ['Ctrl/⌘ + wheel', 'Zoom time axis (to cursor)'],
      ['Shift + wheel', 'Scroll horizontally'],
      ['Middle-drag', 'Pan anywhere'],
      ['Ctrl + / − / 0', 'Zoom time in / out / reset to 100%'],
      ['H − / + buttons', 'Zoom time axis'],
      ['V − / + buttons', 'Zoom pitch axis'],
      ['100% button', 'Reset zoom'],
      ['Click minimap', 'Jump timeline'],
      ['?', 'This guide'],
    ],
  },
]

export default function ShortcutsHelp({ onClose }: ShortcutsHelpProps): React.JSX.Element {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {GROUPS.map((g) => (
        <section key={g.name} className="mb-3">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7d8fa1]">{g.name}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {g.rows.map(([keys, desc]) => (
              <div key={keys} className="contents">
                <dt className="font-mono text-[#E89A2E]">{keys}</dt>
                <dd>{desc}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Modal>
  )
}
