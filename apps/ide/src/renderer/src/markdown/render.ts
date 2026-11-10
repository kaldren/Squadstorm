// Turns untrusted markdown into safe HTML for the preview, then fills in what needs async work:
// code colours, mermaid diagrams and images.

import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { highlightCode } from '@lezer/highlight'
import { resolveImage, slugger } from '@shared/markdown'

const marked = new Marked({ gfm: true })

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    // Nothing loads until resolveImage has decided where the image may come from.
    const src = node.getAttribute('src')
    node.removeAttribute('src')
    node.removeAttribute('srcset')
    if (src) node.setAttribute('data-src', src)
  } else if (node instanceof HTMLInputElement) {
    // Task-list checkboxes (and any other input) are read-only in the preview.
    node.setAttribute('disabled', '')
  }
})

const PURIFY_CONFIG = {
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style', 'id', 'name']
}

/** The markdown as sanitized HTML: no scripts, event handlers, frames, forms or `javascript:` links. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false })
  return purify.sanitize(html, PURIFY_CONFIG)
}

/**
 * Gives every heading a GitHub-style anchor for `#heading` links. It's a data attribute, not an id,
 * so a file can't clash with (or clobber) the app's own element ids.
 */
export function addAnchors(container: HTMLElement) {
  const slug = slugger()
  for (const heading of container.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    heading.setAttribute('data-anchor', slug(heading.textContent ?? ''))
  }
}

const findLanguage = (lang: string) =>
  LanguageDescription.matchLanguageName(languages, lang, true) ?? LanguageDescription.matchFilename(languages, `file.${lang}`)

/** Colours fenced code with the editor's own grammars and one-dark's palette. */
export async function highlightBlocks(container: HTMLElement, current: () => boolean) {
  for (const code of container.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice('language-'.length)
    if (!lang || lang === 'mermaid') continue
    const support = await findLanguage(lang)
      ?.load()
      .catch(() => null)
    if (!current()) return
    if (!support) continue
    const text = code.textContent ?? ''
    const tree = support.language.parser.parse(text)
    const out = document.createDocumentFragment()
    highlightCode(
      text,
      tree,
      oneDarkHighlightStyle,
      (piece, classes) => {
        if (!classes) return void out.append(piece)
        const span = document.createElement('span')
        span.className = classes
        span.textContent = piece
        out.append(span)
      },
      () => out.append('\n')
    )
    code.replaceChildren(out)
    code.classList.add('highlighted')
  }
}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let diagrams = 0

/** Draws ```mermaid blocks; mermaid is only loaded for a file that has one. */
export async function drawMermaid(container: HTMLElement, current: () => boolean) {
  const blocks = [...container.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]
  if (blocks.length === 0) return
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
    return mermaid
  })
  const mermaid = await mermaidReady
  for (const code of blocks) {
    if (!current()) return
    const pre = code.parentElement!
    const text = code.textContent ?? ''
    try {
      const { svg } = await mermaid.render(`squadstorm-mermaid-${++diagrams}`, text)
      if (!current()) return
      const figure = document.createElement('div')
      figure.className = 'mermaid'
      figure.innerHTML = svg
      pre.replaceWith(figure)
    } catch (e) {
      if (!current()) return
      const error = document.createElement('p')
      error.className = 'mermaid-error'
      error.textContent = `Mermaid: ${(e as Error).message ?? e}`
      pre.after(error)
    }
  }
}

/** Loads images from the repo (through the main process) and https; anything else stays unloaded. */
export async function loadImages(container: HTMLElement, root: string, filePath: string, current: () => boolean) {
  await Promise.all(
    [...container.querySelectorAll<HTMLImageElement>('img[data-src]')].map(async (img) => {
      const src = img.getAttribute('data-src')!
      const target = resolveImage(filePath, src)
      if (!target) {
        img.title = `Not loaded: ${src}`
        return
      }
      if (target.kind === 'web') return void (img.src = target.url)
      try {
        const url = await window.api.files.readImage(root, target.path)
        if (current()) img.src = url
      } catch (e) {
        img.title = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      }
    })
  )
}
