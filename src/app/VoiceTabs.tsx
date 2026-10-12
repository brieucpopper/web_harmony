// Voice tabs (PRD FR6). M1: empty state — voices are created in M2 (white)
// and M4 (harmonies). Tab layout + palette contract live here already.
import { MAX_VOICES } from '../constants'
import { useProjectStore } from '../store/projectStore'

export default function VoiceTabs(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)

  if (project === null) return <div className="bg-[#111A23] px-3 py-1 text-xs text-[#7d8fa1]" />

  if (project.voices.length === 0) {
    return (
      <div className="flex items-center gap-2 bg-[#111A23] px-3 py-1 text-xs text-[#7d8fa1]">
        <span>Voices appear after pitch analysis (M2).</span>
        <span className="opacity-60">Up to {MAX_VOICES} voices in V1.</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 bg-[#111A23] px-3 py-1" role="tablist" aria-label="Voices">
      {project.voices.map((v) => (
        <div
          key={v.id}
          role="tab"
          aria-selected={false}
          className="flex items-center gap-2 rounded bg-[#1E2A36] px-2 py-1 text-xs"
        >
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: v.color }}
            aria-hidden="true"
          />
          <span>{v.name}</span>
        </div>
      ))}
    </div>
  )
}
