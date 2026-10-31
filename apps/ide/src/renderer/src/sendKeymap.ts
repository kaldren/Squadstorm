import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'

/**
 * ⌘L (Ctrl+L elsewhere) sends the selected lines, or the whole file when nothing is selected, to an
 * agent. It takes over CodeMirror's "select line" (a triple-click still does that).
 */
export const sendKeymap = (send: (from?: number, to?: number) => void) =>
  Prec.highest(
    keymap.of([
      {
        key: 'Mod-l',
        preventDefault: true,
        run: (view) => {
          const { from, to, empty } = view.state.selection.main
          if (empty) {
            send()
            return true
          }
          const doc = view.state.doc
          const first = doc.lineAt(from).number
          const end = doc.lineAt(to)
          // A selection that ends at the start of a line doesn't include that line.
          const last = to === end.from && end.number > first ? end.number - 1 : end.number
          send(first, last)
          return true
        }
      }
    ])
  )
