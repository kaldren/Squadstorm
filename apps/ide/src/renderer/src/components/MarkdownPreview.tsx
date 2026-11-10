import { useEffect, useLayoutEffect, useRef } from 'react'
import { isMarkdown, resolveLink } from '@shared/markdown'
import { addAnchors, drawMermaid, highlightBlocks, loadImages, renderMarkdown } from '../markdown/render'

interface Props {
  root: string
  /** The markdown file shown, relative to the root. */
  path: string
  /** Its text as it is in the editor, unsaved edits included. */
  source: string
  /** A link to a file in the repo; markdown files open in preview. */
  onOpenFile(path: string, opts: { preview: boolean }): void
}

export function MarkdownPreview({ root, path, source, onOpenFile }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  /** Bumped by every render, so async passes started for an older one stop. */
  const run = useRef(0)

  useLayoutEffect(() => {
    const container = body.current!
    const mine = ++run.current
    const current = () => run.current === mine
    container.innerHTML = renderMarkdown(source)
    addAnchors(container)
    void highlightBlocks(container, current)
    void drawMermaid(container, current)
    void loadImages(container, root, path, current)
  }, [root, path, source])

  // Keys go here, never to the hidden editor underneath.
  useEffect(() => {
    ref.current?.focus()
  }, [path])

  const onClick = (e: React.MouseEvent) => {
    const link = (e.target as Element).closest('a[href]')
    if (!link) return
    e.preventDefault()
    const target = resolveLink(path, link.getAttribute('href')!)
    if (!target) return
    if (target.kind === 'external') window.open(target.url)
    else if (target.kind === 'file') onOpenFile(target.path, { preview: isMarkdown(target.path) })
    else body.current?.querySelector(`[data-anchor="${CSS.escape(target.id)}"]`)?.scrollIntoView({ block: 'start' })
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="markdown-preview"
      className="markdown-preview absolute inset-0 overflow-auto outline-none"
      onClick={onClick}
    >
      <div ref={body} className="markdown-body" />
    </div>
  )
}
