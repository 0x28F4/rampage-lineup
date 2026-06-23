const APP_STATE_KEY = "rampage_youtube_state_v1";
const DEFAULT_VOLUME_SLIDER = 45;

const state = {
  artists: [],
  catalog: {},
  player: null,
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
  progressTimer: 0,
};

const els = {
  prev: document.querySelector("#prev"),
  play: document.querySelector("#play"),
  next: document.querySelector("#next"),
  status: document.querySelector("#status"),
  track: document.querySelector("#track"),
  artist: document.querySelector("#artist"),
  artists: document.querySelector("#artists"),
  currentLineupArtist: document.querySelector("#current-lineup-artist"),
  filter: document.querySelector("#filter"),
  filterClear: document.querySelector("#filter-clear"),
  filterCount: document.querySelector("#filter-count"),
  seek: document.querySelector("#seek"),
  elapsed: document.querySelector("#elapsed"),
  duration: document.querySelector("#duration"),
  volume: document.querySelector("#volume"),
  volumeValue: document.querySelector("#volume-value"),
  palette: document.querySelector("#palette"),
  paletteInput: document.querySelector("#palette-input"),
  paletteResults: document.querySelector("#palette-results"),
  artistCount: document.querySelector("#artist-count"),
  queueCount: document.querySelector("#queue-count"),
};

window.onYouTubeIframeAPIReady = () => {
  state.player = new YT.Player("yt-player", {
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
  });
};

init();
loadYouTubeIframeApi();

async function init() {
  state.artists = await fetch("artists.json").then((response) => response.json());
  state.catalog = await fetch("media_catalog.json").then((response) => response.json()).catch(() => ({ artists: {} }));
  restoreAppState();
  if (state.pendingArtists.length === 0) {
    state.pendingArtists = playableArtists();
  }
  state.suggestedArtists = getSuggestedArtists(3);
  updateCounts();
  renderArtists();
  els.artistCount.textContent = state.artists.length;
  bindEvents();
  startProgressTimer();
  setStatus("YouTube catalog loaded. Press Play, Next, or choose an artist.");
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    window.onYouTubeIframeAPIReady();
    return;
  }
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;
  document.head.append(script);
}

function bindEvents() {
  els.prev.addEventListener("click", () => playPreviousArtist());
  els.play.addEventListener("click", () => togglePlay());
  els.next.addEventListener("click", () => playNextArtist());
  els.filter.addEventListener("input", () => renderArtists());
  els.filterClear.addEventListener("click", () => {
    els.filter.value = "";
    renderArtists();
    els.filter.focus();
  });
  els.artists.addEventListener("click", (event) => {
    const artistButton = event.target.closest("[data-artist]");
    if (artistButton) {
      playArtist(artistButton.dataset.artist);
    }
  });
  els.volume.addEventListener("input", () => setVolume(Number(els.volume.value)));
  els.seek.addEventListener("input", () => {
    state.isSeeking = true;
    els.elapsed.textContent = formatTime(Number(els.seek.value));
  });
  els.seek.addEventListener("change", () => {
    if (!state.playerReady || !state.player) {
      return;
    }
    const position = Number(els.seek.value);
    state.positionSeconds = position;
    state.isSeeking = false;
    state.player.seekTo(position, true);
    updateSeekUI();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.palette.hidden) {
      closePalette();
      return;
    }
    if (event.key === "t" && canOpenPalette(event)) {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.key === "Enter" && !els.palette.hidden) {
      event.preventDefault();
      playPaletteSelection();
    }
  });
  els.palette.addEventListener("click", (event) => {
    if (event.target === els.palette) {
      closePalette();
    }
  });
  els.paletteInput.addEventListener("input", () => renderPaletteResults());
  els.paletteResults.addEventListener("click", (event) => {
    const result = event.target.closest("[data-artist]");
    if (result) {
      closePalette();
      playArtist(result.dataset.artist);
    }
  });
}

function handlePlayerReady() {
  state.playerReady = true;
  enablePlaybackControls();
  setVolume(DEFAULT_VOLUME_SLIDER);
}

function handlePlayerStateChange(event) {
  state.isPlaying = event.data === YT.PlayerState.PLAYING;
  els.play.textContent = state.isPlaying ? "Pause" : "Play";
  if (!state.playerReady || !state.player) {
    return;
  }
  state.durationSeconds = Math.floor(state.player.getDuration() || 0);
  updateSeekUI();
}

function handlePlayerError(event) {
  const artistName = state.currentArtist;
  if (!artistName) {
    return;
  }
  state.failedArtists.add(artistName);
  state.pendingArtists = state.pendingArtists.filter((artist) => artist !== artistName);
  state.currentReference = null;
  state.isPlaying = false;
  persistAppState();
  renderArtists();
  updateCounts();
  els.play.textContent = "Play";
  setStatus(`YouTube could not play ${artistName} (error ${event.data}). Skipping to another artist.`);
  window.setTimeout(() => playNextArtist(), 300);
}

function playableArtists() {
  return state.artists.filter((artist) => {
    const entry = state.catalog.artists?.[artist];
    return entry?.supported && entry?.resolved && entry.reference?.provider === "youtube";
  });
}

function renderArtists() {
  const query = els.filter.value.trim().toLowerCase();
  const artists = state.artists
    .map((name, index) => ({ name, index }))
    .filter((artist) => !query || artist.name.toLowerCase().includes(query));

  els.artists.innerHTML = "";
  for (const artist of artists) {
    const entry = state.catalog.artists?.[artist.name];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = [
      "artist",
      artistTier(artist.index),
      state.matchedArtists.has(artist.name) ? "matched" : "",
      state.failedArtists.has(artist.name) || entry?.supported === false ? "failed" : "",
      state.currentArtist === artist.name ? "current" : "",
    ].filter(Boolean).join(" ");
    chip.dataset.artist = artist.name;
    chip.textContent = artist.name;
    els.artists.append(chip);
  }

  els.filterClear.hidden = !query;
  els.filterCount.textContent = `${artists.length} shown`;
  els.currentLineupArtist.textContent = state.currentArtist ? `Now: ${state.currentArtist}` : "No artist selected";
}

function renderPaletteResults() {
  const query = els.paletteInput.value.trim();
  const matches = query
    ? fuzzyArtistMatches(query, 24)
    : state.artists.slice(0, 24).map((name, index) => ({ name, index, score: 0 }));

  els.paletteResults.innerHTML = "";
  for (const match of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = ["palette-result", artistTier(match.index), state.currentArtist === match.name ? "current" : ""].join(" ");
    button.dataset.artist = match.name;
    button.innerHTML = `<span>${match.name}</span><small>${artistBillingLabel(match.index)}</small>`;
    els.paletteResults.append(button);
  }
}

function openPalette() {
  els.palette.hidden = false;
  els.paletteInput.value = "";
  renderPaletteResults();
  window.requestAnimationFrame(() => els.paletteInput.focus());
}

function closePalette() {
  els.palette.hidden = true;
}

function playPaletteSelection() {
  const first = els.paletteResults.querySelector("[data-artist]");
  if (first) {
    closePalette();
    playArtist(first.dataset.artist);
  }
}

function canOpenPalette(event) {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  return !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function playNextArtist() {
  const artist = pickWeightedArtist();
  if (!artist) {
    setStatus("No more resolved YouTube artists are available.");
    return;
  }
  playArtist(artist);
}

function playPreviousArtist() {
  if (state.currentHistoryIndex <= 0) {
    return;
  }
  state.currentHistoryIndex -= 1;
  const artist = state.history[state.currentHistoryIndex];
  playArtist(artist, { addToHistory: false });
}

function togglePlay() {
  if (!state.playerReady || !state.player) {
    return;
  }
  if (!state.currentReference) {
    playNextArtist();
    return;
  }
  if (state.isPlaying) {
    state.player.pauseVideo();
  } else {
    state.player.playVideo();
  }
}

function playArtist(artistName, options = {}) {
  const entry = state.catalog.artists?.[artistName];
  const reference = entry?.reference;
  if (entry?.supported === false) {
    state.failedArtists.add(artistName);
    renderArtists();
    setStatus(`${artistName} is not supported yet. No reliable YouTube song match is curated for this artist.`);
    return;
  }
  if (!entry?.resolved || !reference || reference.provider !== "youtube") {
    state.failedArtists.add(artistName);
    renderArtists();
    setStatus(`No resolved YouTube track for ${artistName}.`);
    return;
  }
  if (!state.playerReady || !state.player) {
    setStatus("YouTube player is not ready yet.");
    return;
  }

  state.currentArtist = artistName;
  state.currentReference = reference;
  state.matchedArtists.add(artistName);
  state.failedArtists.delete(artistName);
  if (options.addToHistory !== false) {
    state.history = state.history.slice(0, state.currentHistoryIndex + 1);
    state.history.push(artistName);
    state.currentHistoryIndex = state.history.length - 1;
  }
  state.pendingArtists = state.pendingArtists.filter((artist) => artist !== artistName);
  state.suggestedArtists = getSuggestedArtists(3);
  persistAppState();
  updateCounts();
  renderArtists();

  els.track.textContent = reference.title;
  els.artist.textContent = artistName;
  state.player.loadVideoById(reference.item_id);
  setStatus(`Playing ${artistName} on YouTube.`);
}

function pickWeightedArtist() {
  const pool = state.pendingArtists.length > 0 ? state.pendingArtists : playableArtists().filter((artist) => artist !== state.currentArtist);
  if (pool.length === 0) {
    return "";
  }
  const totalWeight = pool.reduce((sum, artist) => sum + artistWeight(state.artists.indexOf(artist)), 0);
  let target = Math.random() * totalWeight;
  for (const artist of pool) {
    target -= artistWeight(state.artists.indexOf(artist));
    if (target <= 0) {
      return artist;
    }
  }
  return pool[0];
}

function getSuggestedArtists(count) {
  const source = state.pendingArtists.length > 0 ? [...state.pendingArtists] : playableArtists();
  const picks = [];
  while (picks.length < count && source.length > 0) {
    const next = pickWeightedArtistFrom(source);
    picks.push(next);
    source.splice(source.indexOf(next), 1);
  }
  return picks;
}

function pickWeightedArtistFrom(pool) {
  const totalWeight = pool.reduce((sum, artist) => sum + artistWeight(state.artists.indexOf(artist)), 0);
  let target = Math.random() * totalWeight;
  for (const artist of pool) {
    target -= artistWeight(state.artists.indexOf(artist));
    if (target <= 0) {
      return artist;
    }
  }
  return pool[0];
}

function updateCounts() {
  els.queueCount.textContent = state.history.length;
}

function enablePlaybackControls() {
  els.play.disabled = false;
  els.next.disabled = false;
  els.prev.disabled = state.history.length < 2;
  els.seek.disabled = false;
  els.volume.disabled = false;
}

function setStatus(message) {
  els.status.textContent = message;
}

function startProgressTimer() {
  if (state.progressTimer) {
    return;
  }
  state.progressTimer = window.setInterval(() => {
    if (!state.playerReady || !state.player || !state.isPlaying || state.isSeeking) {
      return;
    }
    state.positionSeconds = Math.floor(state.player.getCurrentTime() || 0);
    state.durationSeconds = Math.floor(state.player.getDuration() || 0);
    updateSeekUI();
  }, 1000);
}

function updateSeekUI() {
  if (!state.isSeeking) {
    els.seek.max = String(state.durationSeconds || 1000);
    els.seek.value = String(Math.min(state.positionSeconds, state.durationSeconds || state.positionSeconds));
  }
  els.elapsed.textContent = formatTime(state.positionSeconds);
  els.duration.textContent = formatTime(state.durationSeconds);
  els.prev.disabled = state.history.length < 2 || state.currentHistoryIndex <= 0;
}

async function setVolume(value) {
  const slider = Math.max(0, Math.min(100, value));
  const effective = volumeCurve(slider);
  els.volume.value = String(slider);
  els.volumeValue.textContent = `${Math.round(effective * 100)}%`;
  if (state.playerReady && state.player) {
    state.player.setVolume(Math.round(effective * 100));
  }
}

function volumeCurve(sliderValue) {
  return (sliderValue / 100) ** 3;
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  const remainder = String(value % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function artistWeight(index) {
  if (index < 4) {
    return 10;
  }
  if (index < 48) {
    return 6;
  }
  if (index < 180) {
    return 3;
  }
  return 1;
}

function artistTier(index) {
  if (index < 4) {
    return "tier-headliner";
  }
  if (index < 48) {
    return "tier-large";
  }
  if (index < 180) {
    return "tier-mid";
  }
  return "tier-small";
}

function artistBillingLabel(index) {
  if (index < 4) {
    return "headliner";
  }
  if (index < 48) {
    return "top billing";
  }
  if (index < 180) {
    return "lineup";
  }
  return "support";
}

function fuzzyArtistMatches(query, limit) {
  return state.artists
    .map((name, index) => ({ name, index, score: fuzzyScore(name, query) }))
    .filter((artist) => artist.score < Number.POSITIVE_INFINITY)
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .slice(0, limit);
}

function fuzzyScore(value, query) {
  const normalizedValue = normalizeSearch(value);
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    return normalizedValue.indexOf(normalizedQuery);
  }
  let score = 0;
  let cursor = 0;
  for (const char of normalizedQuery) {
    const found = normalizedValue.indexOf(char, cursor);
    if (found === -1) {
      return Number.POSITIVE_INFINITY;
    }
    score += found - cursor + 1;
    cursor = found + 1;
  }
  return score + normalizedValue.length * 0.05;
}

function normalizeSearch(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function persistAppState() {
  const payload = {
    currentArtist: state.currentArtist,
    matchedArtists: [...state.matchedArtists],
    failedArtists: [...state.failedArtists],
    pendingArtists: [...state.pendingArtists],
    history: [...state.history],
    currentHistoryIndex: state.currentHistoryIndex,
  };
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(payload));
}

function restoreAppState() {
  try {
    const payload = JSON.parse(localStorage.getItem(APP_STATE_KEY) || "{}");
    state.currentArtist = payload.currentArtist || "";
    state.matchedArtists = new Set(payload.matchedArtists || []);
    state.failedArtists = new Set(payload.failedArtists || []);
    state.pendingArtists = Array.isArray(payload.pendingArtists) ? payload.pendingArtists : playableArtists();
    state.history = Array.isArray(payload.history) ? payload.history : [];
    state.currentHistoryIndex = Number.isInteger(payload.currentHistoryIndex) ? payload.currentHistoryIndex : state.history.length - 1;
  } catch {
    state.pendingArtists = playableArtists();
  }
}
