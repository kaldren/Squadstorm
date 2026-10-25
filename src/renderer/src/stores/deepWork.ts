import { create } from 'zustand'

export interface Station {
  id: string
  title: string
  blurb: string
}

// SomaFM channels (free, listener-supported, no ads) picked for coding: instrumental, steady.
export const STATIONS: Station[] = [
  { id: 'groovesalad', title: 'Groove Salad', blurb: 'Chilled ambient and downtempo beats' },
  { id: 'dronezone', title: 'Drone Zone', blurb: 'Atmospheric textures, no beats' },
  { id: 'deepspaceone', title: 'Deep Space One', blurb: 'Deep ambient and space music' },
  { id: 'spacestation', title: 'Space Station Soma', blurb: 'Spaced-out mid-tempo electronica' },
  { id: 'defcon', title: 'DEF CON Radio', blurb: 'Music for hacking' },
  { id: 'fluid', title: 'Fluid', blurb: 'Instrumental hip-hop and future soul' },
  { id: 'beatblender', title: 'Beat Blender', blurb: 'Late-night deep house and downtempo' },
  { id: 'cliqhop', title: 'cliqhop idm', blurb: 'Blips and beeps over beats' }
]

const API = 'https://api.somafm.com'
const STATION_KEY = 'deepWork.station'

interface DeepWorkStore {
  station: string
  playing: boolean
  /** Waiting for the stream to start. */
  loading: boolean
  /** "Artist – Title" of what the station is playing now. */
  track: string | null
  error: string | null
  toggle(): void
  setStation(id: string): void
}

function savedStation(): string {
  try {
    const id = localStorage.getItem(STATION_KEY)
    if (id && STATIONS.some((s) => s.id === id)) return id
  } catch {}
  return STATIONS[0].id
}

// Mirrors from the station's .pls playlist, which is SomaFM's stable way to find its streams.
async function streamUrls(station: string): Promise<string[]> {
  const res = await fetch(`${API}/${station}.pls`)
  if (!res.ok) throw new Error(`SomaFM returned ${res.status}`)
  return [...(await res.text()).matchAll(/^File\d+=(.+)$/gm)].map((m) => m[1].trim())
}

async function nowPlaying(station: string): Promise<string | null> {
  const res = await fetch(`${API}/songs/${station}.json`)
  if (!res.ok) return null
  const song = ((await res.json()) as { songs?: { artist: string; title: string }[] }).songs?.[0]
  return song ? `${song.artist} – ${song.title}` : null
}

const audio = new Audio()
let poll: ReturnType<typeof setInterval> | undefined
// Bumped on every start/stop so a slow start can't resume after the user moved on.
let session = 0

export const useDeepWork = create<DeepWorkStore>((set, get) => {
  const refreshTrack = async (id: string) => {
    const track = await nowPlaying(id).catch(() => null)
    if (get().station === id && get().playing) set({ track })
  }

  const stop = () => {
    session++
    clearInterval(poll)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    set({ playing: false, loading: false, track: null })
  }

  const start = async () => {
    const id = get().station
    const mine = ++session
    set({ loading: true, error: null })
    try {
      for (const url of await streamUrls(id)) {
        if (mine !== session) return
        audio.src = url
        try {
          await audio.play()
        } catch {
          continue // Mirror down or refusing; try the next one.
        }
        if (mine !== session) return
        set({ playing: true, loading: false })
        void refreshTrack(id)
        clearInterval(poll)
        poll = setInterval(() => void refreshTrack(id), 30_000)
        return
      }
      throw new Error('No stream mirror responded')
    } catch (err) {
      if (mine !== session) return
      stop()
      set({ error: `Couldn't reach SomaFM: ${(err as Error).message}` })
    }
  }

  // A stream that drops mid-session (network blip) reconnects instead of going silent.
  audio.addEventListener('error', () => {
    if (get().playing) void start()
  })

  return {
    station: savedStation(),
    playing: false,
    loading: false,
    track: null,
    error: null,

    toggle: () => (get().playing || get().loading ? stop() : void start()),

    setStation(id) {
      try {
        localStorage.setItem(STATION_KEY, id)
      } catch {}
      const wasOn = get().playing || get().loading
      set({ station: id })
      if (wasOn) {
        stop()
        void start()
      }
    }
  }
})
