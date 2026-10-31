import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { indentWithTab } from '@codemirror/commands'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, Prec, type StateEffect } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { unifiedMergeView } from '@codemirror/merge'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { diskChange } from '@shared/conflict'

interface Props {
  root: string
  tabs: string[]
  active: string | null
  /** A spot to select and scroll to, e.g. a search match. A new object reveals it again. */
  reveal: Reveal | null
  onDirty(path: string, dirty: boolean): void
  /** The file changed on disk while it had unsaved edits, or that was resolved. */
  onConflict(path: string, conflicted: boolean): void
}

export interface Reveal {
  path: string
  /** 1-based. */
  line: number
  column: number
  length: number
}

/** Disk content that differs from what the editor was loaded from; null when the file was deleted. */
interface Conflict {
  disk: string | null
}

/**
 * An open file: its editor state (undo history included) and the disk content it was loaded from or
 * last acknowledged (null once a deletion was acknowledged).
 */
type Buffer = { state: EditorState; saved: string | null; scrollTop: number; conflict?: Conflict } | { error: string }

const ipcMessage = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const language = new Compartment()

// Match the app palette; one-dark supplies the syntax colors.
export const editorTheme = [
  oneDark,
  Prec.highest(
    EditorView.theme(
      {
        '&': { height: '100%', backgroundColor: 'var(--color-bg)', fontSize: '13px' },
        '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
        '.cm-gutters': { backgroundColor: 'var(--color-bg)', border: 'none' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#ffffff08' },
        '&.cm-focused': { outline: 'none' }
      },
      { dark: true }
    )
  )
]

export function CodeEditor({ root, tabs, active, reveal, onDirty, onConflict }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const buffers = useRef(new Map<string, Buffer>())
  /** The path whose state is currently live in the view; its Buffer.state is stale meanwhile. */
  const shownRef = useRef<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** The conflict of the file on screen, mirrored from its buffer so the banner re-renders. */
  const [conflict, setShownConflict] = useState<Conflict | null>(null)
  const [comparing, setComparing] = useState(false)
  /** Give the editor focus back once the conflict UI is gone (after Reload or Keep mine). */
  const refocus = useRef(false)
  /** A reveal waiting for its file to load or come on screen. */
  const pendingReveal = useRef<Reveal | null>(null)
  // Extensions are built once per file, so they reach the latest props through refs.
  const propsRef = useRef({ root, onDirty, onConflict })
  propsRef.current = { root, onDirty, onConflict }

  const liveState = (path: string, buffer: Buffer & { state: EditorState }) =>
    shownRef.current === path && viewRef.current ? viewRef.current.state : buffer.state

  /** Applies a change to a file's editor whether or not it is the one on screen. */
  const update = (path: string, spec: { changes?: { from: number; to: number; insert: string }; effects?: StateEffect<unknown> }) => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return
    if (shownRef.current === path && viewRef.current) viewRef.current.dispatch(spec)
    else buffer.state = buffer.state.update(spec).state
  }

  /** Bumped by every save of a path, so reads started before it can be told apart. */
  const writes = useRef(new Map<string, number>())

  /**
   * The file as it is on disk now: null when it is gone, undefined when it can't be read as text or
   * the read was overtaken by a save (its answer would be older than what was just written).
   */
  const readDisk = async (path: string): Promise<string | null | undefined> => {
    const generation = writes.current.get(path) ?? 0
    let disk: string | null | undefined
    try {
      const result = await window.api.files.read(propsRef.current.root, path)
      disk = 'error' in result ? undefined : result.content
    } catch (e) {
      disk = ipcMessage(e).startsWith('ENOENT') ? null : undefined
    }
    return (writes.current.get(path) ?? 0) === generation ? disk : undefined
  }

  const setConflict = (path: string, next: Conflict | undefined) => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return
    const had = buffer.conflict !== undefined
    buffer.conflict = next
    if (had !== (next !== undefined)) propsRef.current.onConflict(path, next !== undefined)
    if (shownRef.current === path) {
      setShownConflict(next ?? null)
      // A deletion has nothing to compare against.
      if (!next || next.disk === null) setComparing(false)
    }
  }

  /** Replaces the file's content with what is on disk, keeping undo history. */
  const reload = (path: string, disk: string) => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return
    buffer.saved = disk
    const doc = liveState(path, buffer).doc
    update(path, { changes: { from: 0, to: doc.length, insert: disk } })
    setConflict(path, undefined)
  }

  /**
   * Applies what is on disk to an open file: clean files follow it, files with unsaved edits get a
   * conflict instead of losing either side.
   */
  const followDisk = (path: string, disk: string | null): 'written' | 'blocked' | 'free' => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return 'blocked'
    const doc = liveState(path, buffer).doc.toString()
    switch (diskChange({ saved: buffer.saved, buffer: doc, disk })) {
      case 'none':
        // The disk is back to what was loaded (e.g. the agent undid its change): nothing to resolve.
        if (buffer.conflict) setConflict(path, undefined)
        return 'free'
      case 'in-sync':
        buffer.saved = disk
        setConflict(path, undefined)
        propsRef.current.onDirty(path, false)
        return 'written'
      case 'reload':
        reload(path, disk!)
        return 'blocked'
      case 'conflict':
        setConflict(path, { disk })
        return 'blocked'
    }
  }

  const save = async (path: string) => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return
    // Never write over disk content nobody has seen: check it first.
    const disk = await readDisk(path)
    if (disk !== undefined && followDisk(path, disk) !== 'free') return
    const content = liveState(path, buffer).doc.toString()
    try {
      writes.current.set(path, (writes.current.get(path) ?? 0) + 1)
      await window.api.files.write(propsRef.current.root, path, content)
      buffer.saved = content
      setConflict(path, undefined)
      propsRef.current.onDirty(path, liveState(path, buffer).doc.toString() !== content)
    } catch (e) {
      alert(`Could not save ${path}: ${ipcMessage(e)}`)
    }
  }

  const resolve = (choice: 'reload' | 'keep') => {
    const path = shownRef.current
    const buffer = path !== null ? buffers.current.get(path) : undefined
    if (path === null || !buffer || 'error' in buffer || !buffer.conflict) return
    const { disk } = buffer.conflict
    if (choice === 'reload' && disk !== null) reload(path, disk)
    else {
      // The disk version is now seen; the next save writes mine on purpose.
      buffer.saved = disk
      setConflict(path, undefined)
      propsRef.current.onDirty(path, liveState(path, buffer).doc.toString() !== disk)
    }
    // After the banner and comparison are gone: the editor can't take focus while still hidden.
    refocus.current = true
  }

  const createState = (path: string, content: string) => {
    const state = EditorState.create({
      doc: content,
      extensions: [
        keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => (void save(path), true) }]),
        basicSetup,
        editorTheme,
        language.of([]),
        EditorView.updateListener.of((u) => {
          const buffer = buffers.current.get(path)
          if (u.docChanged && buffer && 'saved' in buffer) {
            propsRef.current.onDirty(path, u.state.doc.toString() !== buffer.saved)
          }
        })
      ]
    })
    const name = path.split('/').pop() ?? path
    LanguageDescription.matchFilename(languages, name)
      ?.load()
      .then((support) => update(path, { effects: language.reconfigure(support) }))
      .catch(() => {})
    return state
  }

  const applyReveal = (view: EditorView, r: Reveal) => {
    const doc = view.state.doc
    // The file may have changed since it was searched; stay inside it.
    const line = doc.line(Math.min(Math.max(r.line, 1), doc.lines))
    const from = Math.min(line.from + r.column, line.to)
    const to = Math.min(from + r.length, line.to)
    view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    view.focus()
  }

  const show = (path: string | null) => {
    const view = viewRef.current!
    const prev = shownRef.current
    const prevBuffer = prev !== null ? buffers.current.get(prev) : undefined
    if (prevBuffer && 'state' in prevBuffer) {
      prevBuffer.state = view.state
      prevBuffer.scrollTop = view.scrollDOM.scrollTop
    }
    shownRef.current = null
    setComparing(false)
    setShownConflict(null)
    const buffer = path !== null ? buffers.current.get(path) : undefined
    if (path === null) return setMessage('Select a file to edit')
    if (!buffer) return setMessage('')
    if ('error' in buffer) return setMessage(buffer.error)
    view.setState(buffer.state)
    shownRef.current = path
    setMessage(null)
    setShownConflict(buffer.conflict ?? null)
    const r = pendingReveal.current
    if (r?.path === path) {
      pendingReveal.current = null
      requestAnimationFrame(() => applyReveal(view, r))
      return
    }
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = buffer.scrollTop
      view.focus()
    })
  }

  useEffect(() => {
    viewRef.current = new EditorView({ parent: hostRef.current! })
    return () => viewRef.current?.destroy()
  }, [])

  // A file's first showing focuses it in show(), but the host is still invisible then and
  // refuses focus; try again once it is visible.
  useEffect(() => {
    if (message === null) viewRef.current?.focus()
  }, [message])

  // Declared before the file switch below so a reveal into another file is pending by the time it shows.
  useEffect(() => {
    if (!reveal) return
    if (shownRef.current === reveal.path && viewRef.current) applyReveal(viewRef.current, reveal)
    else pendingReveal.current = reveal
  }, [reveal])

  // Switch files, loading from disk the first time a file is opened.
  useEffect(() => {
    show(active)
    if (active === null || buffers.current.has(active)) return
    let cancelled = false
    window.api.files
      .read(root, active)
      .then((r) => ('error' in r ? r : { state: createState(active, r.content), saved: r.content, scrollTop: 0 }))
      .catch((e: Error) => ({ error: e.message.replace(/^Error invoking remote method '[^']+': /, '') }))
      .then((buffer) => {
        if (cancelled) return
        buffers.current.set(active, buffer)
        show(active)
      })
    return () => {
      cancelled = true
    }
  }, [active, root])

  // Forget closed files.
  useEffect(() => {
    for (const path of buffers.current.keys()) {
      if (!tabs.includes(path)) buffers.current.delete(path)
    }
  }, [tabs])

  // Files changed on disk (usually by an agent) reload when clean, and raise a conflict when they
  // have unsaved edits.
  useEffect(
    () =>
      window.api.files.onChanged(async (changedRoot, paths) => {
        if (changedRoot !== root) return
        for (const path of paths) {
          const buffer = buffers.current.get(path)
          if (!buffer || 'error' in buffer) continue
          const disk = await readDisk(path)
          // Decided after the read, against the live document: the user may have typed meanwhile.
          if (disk !== undefined) followDisk(path, disk)
        }
      }),
    [root]
  )

  // Right after React removed the banner, before the next keystroke can land elsewhere; not on the next
  // animation frame, which a window in the background may get late.
  useLayoutEffect(() => {
    if (!refocus.current || conflict !== null || comparing) return
    refocus.current = false
    viewRef.current?.focus()
  }, [conflict, comparing])

  const showConflict = conflict !== null && message === null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showConflict && (
        <ConflictBanner
          deleted={conflict.disk === null}
          comparing={comparing}
          onCompare={() => setComparing((c) => !c)}
          onReload={() => resolve('reload')}
          onKeep={() => resolve('keep')}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {/* Hidden while comparing, so its tooltips (autocomplete) don't float over the comparison. */}
        <div
          ref={hostRef}
          className={`h-full ${message !== null || (showConflict && comparing) ? 'invisible' : ''}`}
          data-testid="code-editor"
        />
        {message && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">{message}</div>
        )}
        {showConflict && comparing && conflict.disk !== null && viewRef.current && shownRef.current !== null && (
          <ConflictDiff
            path={shownRef.current}
            disk={conflict.disk}
            mine={viewRef.current.state.doc.toString()}
          />
        )}
      </div>
    </div>
  )
}

function ConflictBanner(props: {
  deleted: boolean
  comparing: boolean
  onCompare(): void
  onReload(): void
  onKeep(): void
}) {
  const button = 'rounded px-2 py-0.5 text-fg hover:bg-raised'
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-line bg-amber-400/10 px-3 py-1.5 text-xs"
      role="alert"
      data-testid="disk-conflict"
    >
      <span className="text-amber-400">●</span>
      <span className="mr-auto">
        {props.deleted
          ? 'This file was deleted on disk. Your unsaved edits are still here.'
          : 'This file changed on disk while you had unsaved edits.'}
      </span>
      {!props.deleted && (
        <button className={button} aria-pressed={props.comparing} onClick={props.onCompare}>
          {props.comparing ? 'Hide comparison' : 'Compare'}
        </button>
      )}
      {!props.deleted && (
        <button className={button} title="Take the version on disk; ⌘Z brings your edits back" onClick={props.onReload}>
          Reload
        </button>
      )}
      <button className={button} title="Keep your edits; the next save writes them" onClick={props.onKeep}>
        Keep mine
      </button>
    </div>
  )
}

/** Read-only diff from the disk version to the editor's version, over the editor. */
function ConflictDiff({ path, disk, mine }: { path: string; disk: string; mine: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const lang = new Compartment()
    let live = true
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: mine,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          unifiedMergeView({ original: disk, mergeControls: false, gutter: true }),
          ...editorTheme,
          lang.of([])
        ]
      })
    })
    LanguageDescription.matchFilename(languages, path.split('/').pop() ?? path)
      ?.load()
      .then((support) => live && view.dispatch({ effects: lang.reconfigure(support) }))
      .catch(() => {})
    return () => {
      live = false
      view.destroy()
    }
  }, [path, disk, mine])
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg" data-testid="conflict-diff">
      <div className="shrink-0 border-b border-line px-3 py-1 text-[11px] text-muted">
        Changes from the version on disk to yours
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 [&>.cm-editor]:h-full" />
    </div>
  )
}
