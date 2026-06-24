import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const APP_STATE_KEY = "rampage_youtube_state_v1"
const DEFAULT_VOLUME_SLIDER = 45

type ArtistCatalog = {
  artists?: Record<string, ArtistEntry | undefined>
}

type ArtistGenreAnnotation = {
  name: string
  genres: string[]
}

type ArtistEntry = {
  artist_name?: string
  genres: string[]
  supported?: boolean
  resolved?: boolean
  reference?: MediaReference | null
  reason?: string
}

type MediaReference = {
  provider: string
  item_id: string
  title: string
}

type StoredState = {
  currentArtist?: string
  matchedArtists?: string[]
  failedArtists?: string[]
  pendingArtists?: string[]
  history?: string[]
  currentHistoryIndex?: number
}

type YouTubeEvent = {
  data: number
}

type YouTubePlayer = {
  loadVideoById: (videoId: string) => void
  pauseVideo: () => void
  playVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
  getCurrentTime: () => number
  getDuration: () => number
  destroy?: () => void
}

type LineupState = {
  artists: string[]
  catalog: ArtistCatalog
  status: string
  playerReady: boolean
  currentArtist: string
  currentReference: MediaReference | null
  matchedArtists: Set<string>
  failedArtists: Set<string>
  pendingArtists: string[]
  suggestedArtists: string[]
  history: string[]
  currentHistoryIndex: number
  isPlaying: boolean
  isSeeking: boolean
  durationSeconds: number
  positionSeconds: number
  volumeSlider: number
  filter: string
  selectedGenres: string[]
  paletteOpen: boolean
  paletteQuery: string
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        config: {
          height: string
          width: string
          playerVars: Record<string, number>
          events: {
            onReady: () => void
            onStateChange: (event: YouTubeEvent) => void
            onError: (event: YouTubeEvent) => void
          }
        },
      ) => YouTubePlayer
      PlayerState: {
        ENDED: number
        PLAYING: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

const initialState: LineupState = {
  artists: [],
  catalog: {},
  status: "Loading YouTube catalog.",
  playerReady: false,
  currentArtist: "",
  currentReference: null,
  matchedArtists: new Set(),
  failedArtists: new Set(),
  pendingArtists: [],
  suggestedArtists: [],
  history: [],
  currentHistoryIndex: -1,
  isPlaying: false,
  isSeeking: false,
  durationSeconds: 0,
  positionSeconds: 0,
  volumeSlider: DEFAULT_VOLUME_SLIDER,
  filter: "",
  selectedGenres: [],
  paletteOpen: false,
  paletteQuery: "",
}

export function useLineupPlayer() {
  const [state, setState] = useState<LineupState>(initialState)
  const stateRef = useRef(state)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const advanceTimerRef = useRef<number>(0)
  const stateLoadedRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const playableArtists = useCallback((artists = stateRef.current.artists, catalog = stateRef.current.catalog) => {
    return artists.filter((artist) => {
      const entry = catalog.artists?.[artist]
      return entry?.supported && entry?.resolved && entry.reference?.provider === "youtube"
    })
  }, [])

  const persistAppState = useCallback((next: LineupState) => {
    if (!stateLoadedRef.current) {
      return
    }

    const payload: StoredState = {
      currentArtist: next.currentArtist,
      matchedArtists: [...next.matchedArtists],
      failedArtists: [...next.failedArtists],
      pendingArtists: [...next.pendingArtists],
      history: [...next.history],
      currentHistoryIndex: next.currentHistoryIndex,
    }

    localStorage.setItem(APP_STATE_KEY, JSON.stringify(payload))
  }, [])

  const restoreAppState = useCallback(
    (artists: string[], catalog: ArtistCatalog) => {
      const playable = playableArtists(artists, catalog)

      try {
        const payload = JSON.parse(localStorage.getItem(APP_STATE_KEY) || "{}") as StoredState
        const pendingArtists = Array.isArray(payload.pendingArtists) ? payload.pendingArtists : playable

        return {
          currentArtist: payload.currentArtist || "",
          matchedArtists: new Set(payload.matchedArtists || []),
          failedArtists: new Set(payload.failedArtists || []),
          pendingArtists: pendingArtists.length > 0 ? pendingArtists : playable,
          history: Array.isArray(payload.history) ? payload.history : [],
          currentHistoryIndex: Number.isInteger(payload.currentHistoryIndex)
            ? Number(payload.currentHistoryIndex)
            : (payload.history?.length || 0) - 1,
        }
      } catch {
        return {
          currentArtist: "",
          matchedArtists: new Set<string>(),
          failedArtists: new Set<string>(),
          pendingArtists: playable,
          history: [],
          currentHistoryIndex: -1,
        }
      }
    },
    [playableArtists],
  )

  const getSuggestedArtists = useCallback(
    (count: number, sourceState = stateRef.current) => {
      const source =
        sourceState.pendingArtists.length > 0
          ? [...sourceState.pendingArtists]
          : playableArtists(sourceState.artists, sourceState.catalog)
      const picks: string[] = []

      while (picks.length < count && source.length > 0) {
        const next = pickRandomArtistFrom(source)
        picks.push(next)
        source.splice(source.indexOf(next), 1)
      }

      return picks
    },
    [playableArtists],
  )

  const applyVolume = useCallback((sliderValue: number) => {
    const slider = Math.max(0, Math.min(100, sliderValue))
    const effective = volumeCurve(slider)
    playerRef.current?.setVolume(Math.round(effective * 100))
    setState((previous) => ({ ...previous, volumeSlider: slider }))
  }, [])

  const handlePlayerReady = useCallback(() => {
    setState((previous) => ({ ...previous, playerReady: true }))
    applyVolume(DEFAULT_VOLUME_SLIDER)
  }, [applyVolume])

  const playNextArtist = useCallback(() => {
    const current = stateRef.current
    const artist = pickRandomArtist(current, playableArtists(current.artists, current.catalog))

    if (!artist) {
      setState((previous) => ({ ...previous, status: "No more resolved YouTube artists are available." }))
      return
    }

    playArtistByName(artist)
  }, [playableArtists])

  const scheduleNextArtist = useCallback(() => {
    if (advanceTimerRef.current) {
      return
    }

    setState((previous) => ({ ...previous, status: "Track ended. Loading the next artist." }))
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = 0
      playNextArtist()
    }, 300)
  }, [playNextArtist])

  const handlePlayerStateChange = useCallback(
    (event: YouTubeEvent) => {
      const yt = window.YT
      const player = playerRef.current

      if (yt && event.data === yt.PlayerState.ENDED) {
        setState((previous) => ({
          ...previous,
          isPlaying: false,
          positionSeconds: previous.durationSeconds,
        }))
        scheduleNextArtist()
        return
      }

      const isPlaying = !!yt && event.data === yt.PlayerState.PLAYING
      setState((previous) => ({
        ...previous,
        isPlaying,
        durationSeconds: Math.floor(player?.getDuration() || previous.durationSeconds || 0),
      }))
    },
    [scheduleNextArtist],
  )

  const handlePlayerError = useCallback(
    (event: YouTubeEvent) => {
      const { currentArtist } = stateRef.current
      if (!currentArtist) {
        return
      }

      setState((previous) => {
        const failedArtists = new Set(previous.failedArtists)
        failedArtists.add(currentArtist)
        const next = {
          ...previous,
          currentReference: null,
          failedArtists,
          isPlaying: false,
          pendingArtists: previous.pendingArtists.filter((artist) => artist !== currentArtist),
          status: `YouTube could not play ${currentArtist} (error ${event.data}). Skipping to another artist.`,
        }
        persistAppState(next)
        return next
      })

      window.setTimeout(() => playNextArtist(), 300)
    },
    [persistAppState, playNextArtist],
  )

  useEffect(() => {
    let cancelled = false

    async function loadCatalog() {
      const [artists, catalog, genreAnnotations] = await Promise.all([
        fetch("./artists.json").then((response) => response.json() as Promise<string[]>),
        fetch("./media_catalog.json")
          .then((response) => response.json() as Promise<ArtistCatalog>)
          .catch(() => ({ artists: {} })),
        fetch("./artists_with_genres.json")
          .then((response) => response.json() as Promise<ArtistGenreAnnotation[]>)
          .catch(() => []),
      ])

      if (cancelled) {
        return
      }

      const mergedCatalog = mergeGenreAnnotations(catalog, genreAnnotations)
      const restored = restoreAppState(artists, mergedCatalog)
      const nextState: LineupState = {
        ...initialState,
        ...restored,
        artists,
        catalog: mergedCatalog,
        status: "YouTube catalog loaded. Press Play, Next, or choose an artist.",
      }
      nextState.suggestedArtists = getSuggestedArtists(3, nextState)
      stateLoadedRef.current = true
      setState(nextState)
    }

    loadCatalog()

    return () => {
      cancelled = true
    }
  }, [getSuggestedArtists, restoreAppState])

  useEffect(() => {
    window.onYouTubeIframeAPIReady = () => {
      playerRef.current = new window.YT!.Player("yt-player", {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: handlePlayerReady,
          onStateChange: handlePlayerStateChange,
          onError: handlePlayerError,
        },
      })
    }

    if (window.YT?.Player) {
      window.onYouTubeIframeAPIReady()
    } else if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script")
      script.src = "https://www.youtube.com/iframe_api"
      script.async = true
      document.head.append(script)
    }

    return () => {
      playerRef.current?.destroy?.()
      playerRef.current = null
    }
  }, [handlePlayerError, handlePlayerReady, handlePlayerStateChange])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = stateRef.current
      const player = playerRef.current

      if (!current.playerReady || !player || !current.isPlaying || current.isSeeking) {
        return
      }

      setState((previous) => ({
        ...previous,
        positionSeconds: Math.floor(player.getCurrentTime() || 0),
        durationSeconds: Math.floor(player.getDuration() || 0),
      }))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = stateRef.current

      if (event.key === "Escape" && current.paletteOpen) {
        setState((previous) => ({ ...previous, paletteOpen: false }))
        return
      }

      if (event.key === "t" && canOpenPalette(event)) {
        event.preventDefault()
        setState((previous) => ({ ...previous, paletteOpen: true, paletteQuery: "" }))
        return
      }

      if (event.key === "Enter" && current.paletteOpen) {
        event.preventDefault()
        const first = fuzzyArtistMatches(current.paletteQuery, current.artists, 24)[0]
        if (first) {
          setState((previous) => ({ ...previous, paletteOpen: false }))
          playArtistByName(first.name)
        }
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) {
        window.clearTimeout(advanceTimerRef.current)
      }
    }
  }, [])

  const playArtistByName = useCallback(
    (artistName: string, options: { addToHistory?: boolean } = {}) => {
      if (advanceTimerRef.current) {
        window.clearTimeout(advanceTimerRef.current)
        advanceTimerRef.current = 0
      }

      const current = stateRef.current
      const entry = current.catalog.artists?.[artistName]
      const reference = entry?.reference

      if (entry?.supported === false) {
        setState((previous) => {
          const failedArtists = new Set(previous.failedArtists)
          const history =
            options.addToHistory === false
              ? previous.history
              : [...previous.history.slice(0, previous.currentHistoryIndex + 1), artistName]
          const currentHistoryIndex = options.addToHistory === false ? previous.currentHistoryIndex : history.length - 1
          failedArtists.add(artistName)
          const next = {
            ...previous,
            currentArtist: artistName,
            currentReference: null,
            failedArtists,
            history,
            currentHistoryIndex,
            isPlaying: false,
            positionSeconds: 0,
            durationSeconds: 0,
            status: `No YouTube media is available for ${artistName}.`,
          }
          persistAppState(next)
          return next
        })
        playerRef.current?.pauseVideo()
        return
      }

      if (!entry?.resolved || !reference || reference.provider !== "youtube") {
        setState((previous) => {
          const failedArtists = new Set(previous.failedArtists)
          const history =
            options.addToHistory === false
              ? previous.history
              : [...previous.history.slice(0, previous.currentHistoryIndex + 1), artistName]
          const currentHistoryIndex = options.addToHistory === false ? previous.currentHistoryIndex : history.length - 1
          failedArtists.add(artistName)
          const next = {
            ...previous,
            currentArtist: artistName,
            currentReference: null,
            failedArtists,
            history,
            currentHistoryIndex,
            isPlaying: false,
            positionSeconds: 0,
            durationSeconds: 0,
            status: `No YouTube media is available for ${artistName}.`,
          }
          persistAppState(next)
          return next
        })
        playerRef.current?.pauseVideo()
        return
      }

      if (!current.playerReady || !playerRef.current) {
        setState((previous) => ({ ...previous, status: "YouTube player is not ready yet." }))
        return
      }

      setState((previous) => {
        const matchedArtists = new Set(previous.matchedArtists)
        const failedArtists = new Set(previous.failedArtists)
        const history =
          options.addToHistory === false
            ? previous.history
            : [...previous.history.slice(0, previous.currentHistoryIndex + 1), artistName]
        const currentHistoryIndex = options.addToHistory === false ? previous.currentHistoryIndex : history.length - 1
        matchedArtists.add(artistName)
        failedArtists.delete(artistName)

        const next = {
          ...previous,
          currentArtist: artistName,
          currentReference: reference,
          matchedArtists,
          failedArtists,
          history,
          currentHistoryIndex,
          pendingArtists: previous.pendingArtists.filter((artist) => artist !== artistName),
          positionSeconds: 0,
          durationSeconds: 0,
          status: `Playing ${artistName} on YouTube.`,
        }
        next.suggestedArtists = getSuggestedArtists(3, next)
        persistAppState(next)
        return next
      })

      playerRef.current.loadVideoById(reference.item_id)
    },
    [getSuggestedArtists, persistAppState],
  )

  const playPreviousArtist = useCallback(() => {
    const current = stateRef.current

    if (current.currentHistoryIndex <= 0) {
      return
    }

    const nextIndex = current.currentHistoryIndex - 1
    const artist = current.history[nextIndex]
    setState((previous) => ({ ...previous, currentHistoryIndex: nextIndex }))
    playArtistByName(artist, { addToHistory: false })
  }, [playArtistByName])

  const togglePlay = useCallback(() => {
    const current = stateRef.current
    const player = playerRef.current

    if (!current.playerReady || !player) {
      return
    }

    if (!current.currentReference) {
      playNextArtist()
      return
    }

    if (current.isPlaying) {
      player.pauseVideo()
    } else {
      player.playVideo()
    }
  }, [playNextArtist])

  const seekTo = useCallback((position: number) => {
    const player = playerRef.current
    if (!stateRef.current.playerReady || !player) {
      return
    }

    player.seekTo(position, true)
    setState((previous) => ({
      ...previous,
      isSeeking: false,
      positionSeconds: position,
    }))
  }, [])

  const filteredArtists = useMemo(() => {
    const query = normalizeSearch(state.filter)
    return state.artists
      .map((name, index) => ({ name, index }))
      .filter((artist) => {
        const genres = state.catalog.artists?.[artist.name]?.genres ?? []
        const matchesQuery =
          !query ||
          normalizeSearch(artist.name).includes(query) ||
          genres.some((genre) => normalizeSearch(genre).includes(query))
        const matchesGenres =
          state.selectedGenres.length === 0 || state.selectedGenres.some((genre) => genres.includes(genre))

        return matchesQuery && matchesGenres
      })
  }, [state.artists, state.catalog, state.filter, state.selectedGenres])

  const genres = useMemo(() => {
    const values = new Set<string>()
    for (const artist of state.artists) {
      const entry = state.catalog.artists?.[artist]
      for (const genre of entry?.genres ?? []) {
        values.add(genre)
      }
    }
    return [...values].sort((first, second) => first.localeCompare(second))
  }, [state.artists, state.catalog])

  const paletteMatches = useMemo(() => {
    return state.paletteQuery
      ? fuzzyArtistMatches(state.paletteQuery, state.artists, 24)
      : state.artists.slice(0, 24).map((name, index) => ({ name, index, score: 0 }))
  }, [state.artists, state.paletteQuery])

  return {
    ...state,
    currentLineupLabel: state.currentArtist ? `Now: ${state.currentArtist}` : "No artist selected",
    elapsedLabel: formatTime(state.positionSeconds),
    durationLabel: formatTime(state.durationSeconds),
    filteredArtists,
    genres,
    paletteMatches,
    playableCount: playableArtists().length,
    playArtist: playArtistByName,
    playNextArtist,
    playPreviousArtist,
    togglePlay,
    seekTo,
    setFilter: (filter: string) => setState((previous) => ({ ...previous, filter })),
    clearFilter: () => setState((previous) => ({ ...previous, filter: "" })),
    toggleGenre: (genre: string) =>
      setState((previous) => ({
        ...previous,
        selectedGenres: previous.selectedGenres.includes(genre)
          ? previous.selectedGenres.filter((selected) => selected !== genre)
          : [...previous.selectedGenres, genre],
      })),
    clearGenres: () => setState((previous) => ({ ...previous, selectedGenres: [] })),
    setPaletteOpen: (paletteOpen: boolean) => setState((previous) => ({ ...previous, paletteOpen, paletteQuery: "" })),
    setPaletteQuery: (paletteQuery: string) => setState((previous) => ({ ...previous, paletteQuery })),
    setIsSeeking: (isSeeking: boolean) => setState((previous) => ({ ...previous, isSeeking })),
    setPositionSeconds: (positionSeconds: number) => setState((previous) => ({ ...previous, positionSeconds })),
    setVolume: applyVolume,
  }
}

function pickRandomArtist(state: LineupState, playable: string[]) {
  const pool = state.pendingArtists.length > 0 ? state.pendingArtists : playable.filter((artist) => artist !== state.currentArtist)
  if (pool.length === 0) {
    return ""
  }

  return pickRandomArtistFrom(pool)
}

function pickRandomArtistFrom(pool: string[]) {
  return pool[Math.floor(Math.random() * pool.length)]
}

function mergeGenreAnnotations(catalog: ArtistCatalog, annotations: ArtistGenreAnnotation[]): ArtistCatalog {
  const artists = { ...(catalog.artists ?? {}) }

  for (const annotation of annotations) {
    const entry = artists[annotation.name]
    if (entry) {
      artists[annotation.name] = {
        ...entry,
        genres: annotation.genres,
      }
    }
  }

  return { ...catalog, artists }
}

function fuzzyArtistMatches(query: string, artists: string[], limit: number) {
  return artists
    .map((name, index) => ({ name, index, score: fuzzyScore(name, query) }))
    .filter((artist) => artist.score < Number.POSITIVE_INFINITY)
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .slice(0, limit)
}

function fuzzyScore(value: string, query: string) {
  const normalizedValue = normalizeSearch(value)
  const normalizedQuery = normalizeSearch(query)

  if (!normalizedQuery) {
    return 0
  }

  if (normalizedValue.includes(normalizedQuery)) {
    return normalizedValue.indexOf(normalizedQuery)
  }

  let score = 0
  let cursor = 0

  for (const char of normalizedQuery) {
    const found = normalizedValue.indexOf(char, cursor)
    if (found === -1) {
      return Number.POSITIVE_INFINITY
    }
    score += found - cursor + 1
    cursor = found + 1
  }

  return score + normalizedValue.length * 0.05
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function canOpenPalette(event: KeyboardEvent) {
  const target = event.target
  const isTyping =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
  return !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey
}

function volumeCurve(sliderValue: number) {
  return (sliderValue / 100) ** 3
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(value / 60)
  const remainder = String(value % 60).padStart(2, "0")
  return `${minutes}:${remainder}`
}
