import { useEffect, useRef, useState } from 'react'
import { indentWithTab } from '@codemirror/commands'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, Prec, type StateEffect } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'

interface Props {
  root: string
  tabs: string[]
  active: string | null
  /** A spot to select and scroll to, e.g. a search match. A new object reveals it again. */
  reveal: Reveal | null
  onDirty(path: string, dirty: boolean): void
}

export interface Reveal {
  path: string
  /** 1-based. */
  line: number
  column: number
  length: number
}

/** An open file: its editor state (undo history included) and what is on disk. */
type Buffer = { state: EditorState; saved: string; scrollTop: number } | { error: string }

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

export function CodeEditor({ root, tabs, active, reveal, onDirty }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const buffers = useRef(new Map<string, Buffer>())
  /** The path whose state is currently live in the view; its Buffer.state is stale meanwhile. */
  const shownRef = useRef<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** A reveal waiting for its file to load or come on screen. */
  const pendingReveal = useRef<Reveal | null>(null)
  // Extensions are built once per file, so they reach the latest props through refs.
  const propsRef = useRef({ root, onDirty })
  propsRef.current = { root, onDirty }

  const liveState = (path: string, buffer: Buffer & { state: EditorState }) =>
    shownRef.current === path && viewRef.current ? viewRef.current.state : buffer.state

  /** Applies a change to a file's editor whether or not it is the one on screen. */
  const update = (path: string, spec: { changes?: { from: number; to: number; insert: string }; effects?: StateEffect<unknown> }) => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return
    if (shownRef.current === path && viewRef.current) viewRef.current.dispatch(spec)
    else buffer.state = buffer.state.update(spec).state
  }

  const save = async (path: string) => {
    const buffer = buffers.current.get(path)
    if (!buffer || 'error' in buffer) return
    const content = liveState(path, buffer).doc.toString()
    try {
      await window.api.files.write(propsRef.current.root, path, content)
      buffer.saved = content
      propsRef.current.onDirty(path, liveState(path, buffer).doc.toString() !== content)
    } catch (e) {
      alert(`Could not save ${path}: ${(e as Error).message}`)
    }
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
    const buffer = path !== null ? buffers.current.get(path) : undefined
    if (path === null) return setMessage('Select a file to edit')
    if (!buffer) return setMessage('')
    if ('error' in buffer) return setMessage(buffer.error)
    view.setState(buffer.state)
    shownRef.current = path
    setMessage(null)
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

  // Files changed on disk (usually by an agent) reload unless they have unsaved edits.
  useEffect(
    () =>
      window.api.files.onChanged(async (changedRoot, paths) => {
        if (changedRoot !== root) return
        for (const path of paths) {
          const buffer = buffers.current.get(path)
          if (!buffer || 'error' in buffer) continue
          if (liveState(path, buffer).doc.toString() !== buffer.saved) continue
          const result = await window.api.files.read(root, path).catch(() => null)
          if (!result || 'error' in result || result.content === buffer.saved) continue
          // Re-check: the user may have typed while the read was in flight.
          const doc = liveState(path, buffer).doc
          if (doc.toString() !== buffer.saved) continue
          buffer.saved = result.content
          update(path, { changes: { from: 0, to: doc.length, insert: result.content } })
        }
      }),
    [root]
  )

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={hostRef} className={`h-full ${message !== null ? 'invisible' : ''}`} data-testid="code-editor" />
      {message && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">{message}</div>
      )}
    </div>
  )
}
