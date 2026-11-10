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
purify.addHook('uponSanitizeElement', (node) => {
  // `<a name="install">` / `<a id="install">` targets keep working as anchors, without the file
  // getting to set ids (which could clash with or clobber the app's own).
  if (!(node instanceof Element)) return
  const anchor = node.getAttribute('id') ?? node.getAttribute('name')
  if (anchor) node.setAttribute('data-anchor', anchor)
})
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    // Nothing loads until resolveImage has decided where the image may come from.
    const src = node.getAttribute('src')
    node.removeAttribute('src')
    if (src) node.setAttribute('data-src', src)
  } else if (node instanceof HTMLInputElement) {
    // Task-list checkboxes (and any other input) are read-only in the preview, and load nothing.
    node.setAttribute('disabled', '')
    node.removeAttribute('src')
  }
})

const PURIFY_CONFIG = {
  FORBID_TAGS: [
    'style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta', 'button', 'textarea', 'select',
    // Ways to load an image or media around resolveImage.
    'picture', 'source', 'video', 'audio', 'track', 'image', 'feImage'
  ],
  FORBID_ATTR: ['style', 'id', 'name', 'srcset', 'poster', 'background']
}

/** The markdown as sanitized HTML: no scripts, event handlers, frames, forms or `javascript:` links. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false })
  return purify.sanitize(html, PURIFY_CONFIG)
}

// Mermaid's SVG goes through the same kind of wall as the markdown. It keeps its own <style> (scoped
// to the diagram's id) and HTML labels inside <foreignObject>.
const svgPurify = DOMPurify(window)
const SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['foreignObject', 'style'],
  FORBID_TAGS: ['image', 'feImage', 'img', 'a', 'script'],
  HTML_INTEGRATION_POINTS: { foreignobject: true }
}

/**
 * What a preview keeps between renders of the same file, so a re-render (an agent saving the file)
 * shows images and diagrams at once instead of reloading them.
 */
export interface PreviewCache {
  /** Repo path → data URL and the natural size it was shown at (0 until it loaded). */
  images: Map<string, { url: string; width: number; height: number }>
  /** Diagram source → sanitized SVG, or the error it failed with. */
  diagrams: Map<string, { svg: string } | { error: string }>
}

export const newPreviewCache = (): PreviewCache => ({ images: new Map(), diagrams: new Map() })

/** Gives every heading a GitHub-style anchor for `#heading` links (a data attribute, not an id). */
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

const showDiagram = (pre: Element, result: { svg: string } | { error: string }) => {
  if ('svg' in result) {
    const figure = document.createElement('div')
    figure.className = 'mermaid'
    figure.innerHTML = result.svg
    pre.replaceWith(figure)
  } else {
    const error = document.createElement('p')
    error.className = 'mermaid-error'
    error.textContent = `Mermaid: ${result.error}`
    pre.after(error)
  }
}

/**
 * Draws ```mermaid blocks; mermaid is only loaded for a file that has one. Diagrams drawn before
 * are shown straight away (synchronously), so a re-render doesn't flash their source.
 */
export async function drawMermaid(container: HTMLElement, cache: PreviewCache, current: () => boolean) {
  const todo: HTMLElement[] = []
  for (const code of container.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const cached = cache.diagrams.get(code.textContent ?? '')
    if (cached) showDiagram(code.parentElement!, cached)
    else todo.push(code)
  }
  if (todo.length === 0) return
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict', suppressErrorRendering: true })
    return mermaid
  })
  const mermaid = await mermaidReady
  for (const code of todo) {
    if (!current()) return
    const text = code.textContent ?? ''
    const id = `squadstorm-mermaid-${++diagrams}`
    let result: { svg: string } | { error: string }
    try {
      const { svg } = await mermaid.render(id, text)
      result = { svg: svgPurify.sanitize(svg, SVG_CONFIG) }
    } catch (e) {
      result = { error: (e as Error).message ?? String(e) }
      // A failed render can leave its scratch element behind in <body>.
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
    }
    cache.diagrams.set(text, result)
    if (!current()) return
    showDiagram(code.parentElement!, result)
  }
}

const showImage = (img: HTMLImageElement, shown: { url: string; width: number; height: number }) => {
  img.src = shown.url
  // Reserve the space it took last time, so the page doesn't jump while it decodes.
  if (shown.width && !img.hasAttribute('width') && !img.hasAttribute('height')) {
    img.setAttribute('width', String(shown.width))
    img.setAttribute('height', String(shown.height))
    img.classList.add('sized')
  }
}

/**
 * Loads images from the repo (through the main process) and https; anything else stays unloaded.
 * Repo images read before are shown straight away (synchronously) from the cache.
 */
export async function loadImages(container: HTMLElement, root: string, filePath: string, cache: PreviewCache, current: () => boolean) {
  await Promise.all(
    [...container.querySelectorAll<HTMLImageElement>('img[data-src]')].map(async (img) => {
      const src = img.getAttribute('data-src')!
      const target = resolveImage(filePath, src)
      if (!target) {
        img.title = `Not loaded: ${src}`
        return
      }
      if (target.kind === 'web') return void (img.src = target.url)
      const cached = cache.images.get(target.path)
      if (cached) return showImage(img, cached)
      try {
        const entry = { url: await window.api.files.readImage(root, target.path), width: 0, height: 0 }
        cache.images.set(target.path, entry)
        img.addEventListener(
          'load',
          () => {
            entry.width = img.naturalWidth
            entry.height = img.naturalHeight
          },
          { once: true }
        )
        if (current()) img.src = entry.url
      } catch (e) {
        img.title = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      }
    })
  )
}
