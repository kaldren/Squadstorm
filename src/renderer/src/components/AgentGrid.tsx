import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { evenSplit, gridRows, resizeSplit } from '@shared/layout'
import type { Workspace } from '@shared/types'
import { useWorkspaces } from '../stores/workspaces'
import { AgentTerminal } from './AgentTerminal'

// Matches the m-2 margin around the grid.
const GAP = 8
const MIN_WIDTH = 160
const MIN_HEIGHT = 100

/** Fractions for the row heights and, per row, the tile widths. Only valid for the row shape it was made for. */
interface Sizes {
  shape: string
  rows: number[]
  cols: number[][]
}

/** CSS offset and length of slot `i` along an axis split into `fracs`, with GAP between slots. */
function slot(fracs: number[], i: number): { start: string; size: string } {
  const free = `(100% - ${(fracs.length - 1) * GAP}px)`
  const before = fracs.slice(0, i).reduce((a, b) => a + b, 0)
  return { start: `calc(${before} * ${free} + ${i * GAP}px)`, size: `calc(${fracs[i]} * ${free})` }
}

/** The GAP-wide strip after slot `i`, where its divider sits. */
function gapAfter(fracs: number[], i: number): string {
  const free = `(100% - ${(fracs.length - 1) * GAP}px)`
  const through = fracs.slice(0, i + 1).reduce((a, b) => a + b, 0)
  return `calc(${through} * ${free} + ${i * GAP}px)`
}

export function AgentGrid({ workspace, hidden }: { workspace: Workspace; hidden: boolean }) {
  const removeAgent = useWorkspaces((s) => s.removeAgent)
  const moveAgent = useWorkspaces((s) => s.moveAgent)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  // Derived, so removing the maximized agent drops back to the grid on its own.
  const maximized = workspace.agents.some((a) => a.id === maximizedId) ? maximizedId : null
  const rowLengths = gridRows(workspace.agents.length)
  const shape = rowLengths.join(',')
  const [storedSizes, setSizes] = useState<Sizes | null>(null)
  // Adding or removing a tile changes the shape, which starts over from an even split.
  const sizes: Sizes =
    storedSizes?.shape === shape
      ? storedSizes
      : { shape, rows: evenSplit(rowLengths.length), cols: rowLengths.map(evenSplit) }
  const containerRef = useRef<HTMLDivElement>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const endDrag = () => {
    setDraggingId(null)
    setDropTargetId(null)
  }

  const withSplit = (axis: 'row' | 'col', row: number, fracs: number[]): Sizes =>
    axis === 'row' ? { ...sizes, rows: fracs } : { ...sizes, cols: sizes.cols.map((c, i) => (i === row ? fracs : c)) }

  const startResize = (e: ReactPointerEvent<HTMLDivElement>, axis: 'row' | 'col', row: number, boundary: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = containerRef.current!.getBoundingClientRect()
    const fracs = axis === 'row' ? sizes.rows : sizes.cols[row]
    const free = (axis === 'row' ? rect.height : rect.width) - (fracs.length - 1) * GAP
    const min = Math.min((axis === 'row' ? MIN_HEIGHT : MIN_WIDTH) / free, 1 / fracs.length)
    const origin = axis === 'row' ? e.clientY : e.clientX
    // Always measured from the drag's start, so dragging back undoes any tiles it pushed.
    const move = (ev: PointerEvent) => {
      const delta = ((axis === 'row' ? ev.clientY : ev.clientX) - origin) / free
      setSizes(withSplit(axis, row, resizeSplit(fracs, boundary, delta, min)))
    }
    // On the window so the drag keeps going while the pointer is over a terminal.
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    document.body.style.cursor = axis === 'row' ? 'row-resize' : 'col-resize'
  }

  const tileStyle = (index: number): CSSProperties => {
    if (maximized) return { inset: 0 }
    let row = 0
    let col = index
    while (col >= rowLengths[row]) col -= rowLengths[row++]
    const y = slot(sizes.rows, row)
    const x = slot(sizes.cols[row], col)
    return { top: y.start, height: y.size, left: x.start, width: x.size }
  }

  return (
    // Hidden, not unmounted: agents keep running while the code view is open.
    <div className={`${hidden ? 'hidden' : 'flex'} min-h-0 flex-1 flex-col`}>
      {workspace.agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          Nothing running. Add an agent or a terminal from the toolbar.
        </div>
      ) : (
        <div ref={containerRef} className="relative m-2 min-h-0 min-w-0 flex-1">
          {/* Tiles stay flat, keyed siblings so resizing and reordering never remount a terminal. */}
          {workspace.agents.map((agent, index) => {
            const hidden = maximized !== null && agent.id !== maximized
            return (
              <div key={agent.id} className={`${hidden ? 'hidden' : 'flex'} absolute`} style={tileStyle(index)}>
                <AgentTerminal
                  agent={agent}
                  cwd={workspace.path}
                  // Other tiles are hidden rather than unmounted so their terminals keep running.
                  maximized={agent.id === maximized}
                  hidden={hidden}
                  onMaximize={() => setMaximizedId(agent.id)}
                  onRestore={() => setMaximizedId(null)}
                  onClose={() => removeAgent(workspace.id, agent.id)}
                  // Reordering moves the existing DOM nodes, so terminals and their ptys survive it.
                  reorder={
                    maximized
                      ? null
                      : {
                          dragging: agent.id === draggingId,
                          dropTarget: draggingId !== null && agent.id === dropTargetId && agent.id !== draggingId,
                          onDragStart: () => setDraggingId(agent.id),
                          onDragEnd: endDrag,
                          onDragOver: () => {
                            if (draggingId === null) return false
                            setDropTargetId(agent.id)
                            return true
                          },
                          onDragLeave: () => setDropTargetId((id) => (id === agent.id ? null : id)),
                          onDrop: () => {
                            if (draggingId !== null) moveAgent(workspace.id, draggingId, index)
                            endDrag()
                          }
                        }
                  }
                />
              </div>
            )
          })}
          {!maximized &&
            sizes.rows.slice(0, -1).map((_, i) => (
              <Divider
                key={`row-${i}`}
                axis="row"
                style={{ top: gapAfter(sizes.rows, i), left: 0, right: 0, height: GAP }}
                onPointerDown={(e) => startResize(e, 'row', 0, i)}
                onReset={() => setSizes(withSplit('row', 0, evenSplit(sizes.rows.length)))}
              />
            ))}
          {!maximized &&
            sizes.cols.flatMap((cols, row) => {
              const y = slot(sizes.rows, row)
              return cols.slice(0, -1).map((_, i) => (
                <Divider
                  key={`col-${row}-${i}`}
                  axis="col"
                  style={{ left: gapAfter(cols, i), top: y.start, height: y.size, width: GAP }}
                  onPointerDown={(e) => startResize(e, 'col', row, i)}
                  onReset={() => setSizes(withSplit('col', row, evenSplit(cols.length)))}
                />
              ))
            })}
        </div>
      )}
    </div>
  )
}

function Divider({
  axis,
  style,
  onPointerDown,
  onReset
}: {
  axis: 'row' | 'col'
  style: CSSProperties
  onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void
  onReset(): void
}) {
  return (
    <div
      className={`group absolute z-10 flex items-center justify-center ${
        axis === 'row' ? 'cursor-row-resize' : 'cursor-col-resize'
      }`}
      style={style}
      data-testid={`grid-divider-${axis}`}
      title="Drag to resize, double-click to even out"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
    >
      <div
        className={`rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-60 group-active:opacity-100 ${
          axis === 'row' ? 'h-0.5 w-full' : 'h-full w-0.5'
        }`}
      />
    </div>
  )
}
