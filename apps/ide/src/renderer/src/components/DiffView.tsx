import { useEffect, useRef, useState } from 'react'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { unifiedMergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import type { Commit, FileChange } from '@shared/git'
import { sendKeymap } from '../sendKeymap'
import { editorTheme } from './CodeEditor'

/** The read-only unified diff setup shared by the diff and review views. */
export function diffExtensions(
  original: string,
  lang: Extension | null,
  mergeControls: Parameters<typeof unifiedMergeView>[0]['mergeControls'] = false
): Extension[] {
  return [
    lineNumbers(),
    // Read-only but focusable, so text can be selected and sent to an agent (⌘L).
    EditorState.readOnly.of(true),
    unifiedMergeView({ original, mergeControls, gutter: true }),
    ...editorTheme,
    lang ?? []
  ]
}

/** The language support for a file name, if CodeMirror has one. */
export const languageFor = (path: string) =>
  LanguageDescription.matchFilename(languages, path.split('/').pop() ?? path)
    ?.load()
    .catch(() => null) ?? Promise.resolve(null)

interface Props {
  root: string
  change: FileChange
  /** Show what this commit did to the file instead of the uncommitted change. */
  commit?: Commit
  onOpenFile(path: string): void
  /** ⌘L: send these lines of the file (or all of it) to an agent. */
  onSend?(path: string, from?: number, to?: number): void
}

/**
 * Read-only unified diff of a file against HEAD, following the file as it changes on disk;
 * or, for a commit, of the file before and after that commit.
 */
export function DiffView({ root, change, commit, onOpenFile, onSend }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sendRef = useRef(onSend)
  sendRef.current = onSend
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let view: EditorView | null = null
    let cancelled = false

    const render = async () => {
      try {
        const { original, modified } = commit
          ? await window.api.git.commitDiff(root, commit.hash, change.path, change.from)
          : await window.api.git.diff(root, change.path, change.from)
        const lang = await languageFor(change.path)
        if (cancelled) return
        const scrollTop = view?.scrollDOM.scrollTop ?? 0
        view?.destroy()
        view = new EditorView({
          parent: hostRef.current!,
          state: EditorState.create({
            doc: modified,
            // Only the working tree's version can be sent: the agent reads the file as it is now.
            extensions: [
              ...diffExtensions(original, lang),
              commit || change.kind === 'D' ? [] : sendKeymap((from, to) => sendRef.current?.(change.path, from, to))
            ]
          })
        })
        view.scrollDOM.scrollTop = scrollTop
        setError(null)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }

    void render()
    // A commit never changes; only the working tree needs following.
    const off = commit
      ? () => {}
      : window.api.files.onChanged((r, paths) => {
          if (r === root && paths.includes(change.path)) void render()
        })
    return () => {
      cancelled = true
      off()
      view?.destroy()
    }
  }, [root, change.path, change.from, commit])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="diff-view">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-xs">
        <span className="truncate font-medium">{change.path}</span>
        {change.from && <span className="truncate text-muted">from {change.from}</span>}
        {commit && (
          <span className="truncate text-muted" title={commit.hash}>
            in <span className="font-mono">{commit.shortHash}</span> {commit.subject}
          </span>
        )}
        {!commit && change.kind !== 'D' && (
          <button
            className="ml-auto shrink-0 rounded px-2 py-0.5 text-muted hover:bg-raised hover:text-fg"
            onClick={() => onOpenFile(change.path)}
          >
            Open file
          </button>
        )}
      </div>
      {error && <p className="p-3 text-xs text-danger">{error}</p>}
      <div ref={hostRef} className={`min-h-0 flex-1 [&>.cm-editor]:h-full ${error ? 'hidden' : ''}`} />
    </div>
  )
}
