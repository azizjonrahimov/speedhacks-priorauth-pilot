import { useEffect, useMemo, useRef } from 'react'
import type { Criterion } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CriterionChip } from '@/components/StatusBadges'
import { cn } from '@/lib/utils'

interface Segment {
  text: string
  criterion?: Criterion
}

/** Split the raw note into plain and highlighted segments. Overlapping ranges keep the earliest/longest. */
function segment(note: string, criteria: Criterion[]): Segment[] {
  const ranges = criteria
    .filter((c) => c.char_start != null && c.char_end != null && c.char_end > c.char_start && c.char_start >= 0 && c.char_end <= note.length)
    .sort((a, b) => a.char_start! - b.char_start! || b.char_end! - a.char_end!)
  const out: Segment[] = []
  let pos = 0
  for (const c of ranges) {
    if (c.char_start! < pos) continue
    if (c.char_start! > pos) out.push({ text: note.slice(pos, c.char_start!) })
    out.push({ text: note.slice(c.char_start!, c.char_end!), criterion: c })
    pos = c.char_end!
  }
  if (pos < note.length) out.push({ text: note.slice(pos) })
  return out
}

const MARK: Record<string, string> = {
  met: 'bg-met-bg decoration-met text-met-fg',
  unclear: 'bg-unclear-bg decoration-unclear text-unclear-fg',
  missing: 'bg-missing-bg decoration-missing text-missing-fg',
  not_applicable: 'bg-muted decoration-slate-400',
}

export function NotePane({
  note,
  criteria,
  selectedId,
  onSelect,
}: {
  note: string
  criteria: Criterion[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const segments = useMemo(() => segment(note, criteria), [note, criteria])
  const refs = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    if (!selectedId) return
    const el = refs.current.get(selectedId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('note-flash')
    const t = setTimeout(() => el.classList.remove('note-flash'), 1400)
    return () => clearTimeout(t)
  }, [selectedId])

  const highlighted = criteria.filter((c) => c.char_start != null).length

  return (
    <div className="flex h-full flex-col">
      <div className="text-muted-foreground flex items-center justify-between border-b px-5 py-2.5 text-xs">
        <span className="font-medium tracking-wide uppercase">Visit note</span>
        <span className="tabular">
          {highlighted ? `${highlighted} quote${highlighted === 1 ? '' : 's'} highlighted · ` : ''}
          {note.length.toLocaleString()} chars
        </span>
      </div>
      <pre className="flex-1 overflow-auto px-6 py-5 font-mono text-[13.5px] leading-[1.75] whitespace-pre-wrap">
        {segments.map((s, i) =>
          s.criterion ? (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <mark
                  ref={(el) => {
                    if (el) refs.current.set(s.criterion!.id, el)
                  }}
                  data-criterion={s.criterion.id}
                  onClick={() => onSelect(s.criterion!.id)}
                  className={cn(
                    'cursor-pointer rounded-sm px-0.5 underline decoration-2 underline-offset-[3px] transition-colors',
                    MARK[s.criterion.status] ?? MARK.not_applicable,
                    selectedId === s.criterion.id && 'ring-primary/60 ring-2',
                  )}
                >
                  {s.text}
                </mark>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm">
                <div className="flex items-start gap-2">
                  <CriterionChip status={s.criterion.status} />
                  <span className="text-[12.5px] leading-snug">{s.criterion.text}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
        {!note && <span className="text-muted-foreground">No note.</span>}
      </pre>
    </div>
  )
}
