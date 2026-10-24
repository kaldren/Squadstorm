import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { CodeEditor } from './CodeEditor'
import { FileTree } from './FileTree'

const basename = (path: string) => path.split('/').pop() ?? path

export function CodeView({ root, hidden }: { root: string; hidden: boolean }) {
  const [tabs, setTabs] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())

  // Agents edit files while the code view is open; the tree and editor follow along.
  useEffect(() => {
    window.api.files.watch(root)
    return () => window.api.files.unwatch(root)
  }, [root])

  const open = (path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]))
    setActive(path)
  }

  const close = (path: string) => {
    if (dirty.has(path) && !confirm(`Discard unsaved changes to ${basename(path)}?`)) return
    const index = tabs.indexOf(path)
    const rest = tabs.filter((t) => t !== path)
    setTabs(rest)
    markDirty(path, false)
    if (active === path) setActive(rest[Math.min(index, rest.length - 1)] ?? null)
  }

  const markDirty = (path: string, isDirty: boolean) =>
    setDirty((d) => {
      if (d.has(path) === isDirty) return d
      const next = new Set(d)
      if (isDirty) next.add(path)
      else next.delete(path)
      return next
    })

  return (
    <div className={`${hidden ? 'hidden' : 'flex'} min-h-0 flex-1`}>
      <Group orientation="horizontal" className="h-full w-full">
        <Panel id="files" defaultSize={240} minSize={160} maxSize={480}>
          <FileTree root={root} activePath={active} onOpen={open} />
        </Panel>
        <Separator className="w-px bg-line transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel id="editor" minSize={300}>
          <div className="flex h-full flex-col">
            {tabs.length > 0 && (
              <div className="flex h-8 shrink-0 overflow-x-auto border-b border-line bg-panel text-xs">
                {tabs.map((path) => (
                  <div
                    key={path}
                    role="tab"
                    aria-selected={path === active}
                    title={path}
                    data-testid="editor-tab"
                    className={`group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-line pr-1.5 pl-3 ${
                      path === active ? 'bg-bg text-fg' : 'text-muted hover:text-fg'
                    }`}
                    onClick={() => setActive(path)}
                    onAuxClick={(e) => e.button === 1 && close(path)}
                  >
                    {basename(path)}
                    <button
                      className="flex h-4 w-4 items-center justify-center rounded hover:bg-raised"
                      aria-label={`Close ${basename(path)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        close(path)
                      }}
                    >
                      {/* Unsaved files show a dot that turns into the close button on hover. */}
                      {dirty.has(path) ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-fg group-hover:hidden" data-testid="dirty-dot" />
                          <span className="hidden group-hover:inline">✕</span>
                        </>
                      ) : (
                        <span className={path === active ? '' : 'invisible group-hover:visible'}>✕</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <CodeEditor root={root} tabs={tabs} active={active} onDirty={markDirty} />
          </div>
        </Panel>
      </Group>
    </div>
  )
}
