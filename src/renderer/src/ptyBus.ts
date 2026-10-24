// One IPC listener per channel, fanned out by agent id, instead of one listener per terminal.
type DataHandler = (data: string) => void
type ExitHandler = (exitCode: number) => void

const dataHandlers = new Map<string, DataHandler>()
const exitHandlers = new Map<string, ExitHandler>()

window.api.pty.onData((id, data) => dataHandlers.get(id)?.(data))
window.api.pty.onExit((id, code) => exitHandlers.get(id)?.(code))

export function attachPty(id: string, onData: DataHandler, onExit: ExitHandler): () => void {
  dataHandlers.set(id, onData)
  exitHandlers.set(id, onExit)
  return () => {
    if (dataHandlers.get(id) === onData) dataHandlers.delete(id)
    if (exitHandlers.get(id) === onExit) exitHandlers.delete(id)
  }
}
