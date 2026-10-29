import { STATIONS, useDeepWork } from '../stores/deepWork'

/** Deep Work mode: coding radio from SomaFM, at the foot of the sidebar. */
export function DeepWork() {
  const { station, playing, loading, track, error, toggle, setStation } = useDeepWork()
  const on = playing || loading
  const current = STATIONS.find((s) => s.id === station)!

  return (
    <div className="border-t border-line p-2" data-testid="deep-work">
      <div className={`rounded-md px-2.5 py-2 ${on ? 'bg-raised' : ''}`}>
        <div className="flex items-center gap-2">
          <button
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] ${
              on ? 'bg-accent text-bg' : 'border border-line text-muted hover:text-fg'
            }`}
            title={on ? 'Leave Deep Work' : 'Enter Deep Work'}
            aria-label={on ? 'Stop' : 'Play'}
            data-testid="deep-work-toggle"
            onClick={toggle}
          >
            {on ? '❚❚' : '▶'}
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Deep Work</span>
            <span className="truncate text-[11px] text-muted" title={track ?? current.blurb}>
              {loading ? 'Tuning in…' : (track ?? current.blurb)}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <select
            className="min-w-0 flex-1 rounded border border-line bg-panel px-1.5 py-1 text-xs text-fg"
            value={station}
            aria-label="Station"
            onChange={(e) => setStation(e.target.value)}
          >
            {STATIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {/* SomaFM is listener-supported; credit it and point to where to donate. */}
          <a
            href="https://somafm.com/support/"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-muted hover:text-fg"
            title="Free, ad-free radio from SomaFM. Consider supporting them."
          >
            SomaFM ↗
          </a>
        </div>
        {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}
      </div>
    </div>
  )
}
