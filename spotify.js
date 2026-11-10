// Spotify Web API layer for the phone version. Same as the PC one, except:
//  - login is a page redirect (Spotify sends the browser back to this page with ?code=...)
//  - the music plays on whatever Spotify device is active (usually the Spotify app on this phone)

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

const CLIENT_KEY = 'lite.clientId';
const TOKEN_KEY = 'lite.tokens';
const PKCE_KEY = 'lite.pkce';

/** This page's own address, which must be listed as a Redirect URI in the Spotify dashboard. */
export const REDIRECT_URI = (() => {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  let path = u.pathname.replace(/[^/]*\.html?$/, '');
  if (!path.endsWith('/')) path += '/';
  u.pathname = path;
  return u.toString();
})();

export const getClientId = () => localStorage.getItem(CLIENT_KEY) || '';
const loadTokens = () => JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
const saveTokens = (t) => localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
export const isLoggedIn = () => !!loadTokens()?.refresh;
/** True when the saved login is missing permissions added in a newer version (needs a re-login). */
export const needsReauth = () => {
  const granted = (loadTokens()?.scope || '').split(' ');
  return isLoggedIn() && SCOPES.split(' ').some((s) => !granted.includes(s));
};
export const logout = () => localStorage.removeItem(TOKEN_KEY);

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return b64url(a);
}

/** Authorization Code + PKCE: sends the browser to Spotify. finishLogin() runs when it comes back. */
export async function login(clientId) {
  localStorage.setItem(CLIENT_KEY, clientId);
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  location.assign('https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
    state,
  }));
}

/**
 * Call once at startup. If Spotify just sent us back with ?code=..., trades it for tokens.
 * Returns true when a login was completed. Throws when Spotify reported an error.
 */
export async function finishLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  history.replaceState(null, '', REDIRECT_URI); // clean the address bar either way
  const pkce = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  localStorage.removeItem(PKCE_KEY);
  if (q.get('error')) throw new Error(`Spotify said: ${q.get('error')}`);
  if (!pkce || q.get('state') !== pkce.state) throw new Error('Login didn\'t match, please try again');
  await tokenRequest({
    grant_type: 'authorization_code',
    code: q.get('code'),
    redirect_uri: REDIRECT_URI,
    client_id: getClientId(),
    code_verifier: pkce.verifier,
  });
  return true;
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token request failed');
  const old = loadTokens();
  saveTokens({
    access: data.access_token,
    refresh: data.refresh_token || old?.refresh,
    scope: data.scope || old?.scope,
    exp: Date.now() + data.expires_in * 1000,
  });
}

let refreshing = null;
async function accessToken(force = false) {
  const t = loadTokens();
  if (!t) throw new Error('Not logged in');
  if (!force && t.exp - Date.now() > 60_000) return t.access;
  // Only one refresh at a time, even if several requests ask at once.
  refreshing ??= tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: t.refresh,
    client_id: getClientId(),
  }).finally(() => { refreshing = null; });
  await refreshing;
  return loadTokens().access;
}

/** Calls the Web API. Returns parsed JSON, or null for empty responses. */
export async function api(path, { method = 'GET', query, body } = {}, retried = false) {
  const url = new URL(`https://api.spotify.com/v1${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(retried)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) return api(path, { method, query, body }, true);
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error?.message || `Spotify API error ${res.status}`);
  return data;
}

// ---- Player helpers ----

export const getPlayer = () => api('/me/player', { query: { additional_types: 'episode' } });
/** What Spotify will play next: { currently_playing, queue: [tracks...] }. */
export const getQueue = () => api('/me/player/queue');
export const getDevices = async () => (await api('/me/player/devices'))?.devices || [];

/** The device to play on: the active one, else this phone's Spotify app, else whatever there is. */
export async function pickDevice() {
  const devices = await getDevices();
  const dev = devices.find((d) => d.is_active) || devices.find((d) => d.type === 'Smartphone') || devices[0];
  if (!dev) throw new Error('No Spotify device found. Open the Spotify app on this phone, then try again.');
  return dev;
}

/** Plays a context (playlist/album) or a list of track URIs. */
export async function play({ context_uri, uris, offset } = {}) {
  const dev = await pickDevice();
  const body = {};
  if (context_uri) body.context_uri = context_uri;
  if (uris) body.uris = uris;
  if (offset != null) body.offset = typeof offset === 'number' ? { position: offset } : { uri: offset };
  return api('/me/player/play', { method: 'PUT', query: { device_id: dev.id }, body: Object.keys(body).length ? body : undefined });
}

export const pause = () => api('/me/player/pause', { method: 'PUT' });
export const resume = () => api('/me/player/play', { method: 'PUT' });
export const next = () => api('/me/player/next', { method: 'POST' });
export const previous = () => api('/me/player/previous', { method: 'POST' });
export const seek = (ms) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms) } });
export const setVolume = (pct) => api('/me/player/volume', { method: 'PUT', query: { volume_percent: Math.round(pct) } });
export const setShuffle = (on) => api('/me/player/shuffle', { method: 'PUT', query: { state: on } });
export const setRepeat = (mode) => api('/me/player/repeat', { method: 'PUT', query: { state: mode } });
export const transferTo = (id, playNow = true) => api('/me/player', { method: 'PUT', body: { device_ids: [id], play: playNow } });

/** Transparent pixel for empty album art (avoids the broken-image outline). */
export const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ---- Library: favorites and playlists (Feb 2026 API: /me/library and /playlists/{id}/items) ----

const likedCache = new Map();

export async function isLiked(uri) {
  if (!likedCache.has(uri)) {
    const [liked] = await api('/me/library/contains', { query: { uris: uri } });
    likedCache.set(uri, !!liked);
  }
  return likedCache.get(uri);
}

export async function setLiked(uri, liked) {
  await api('/me/library', { method: liked ? 'PUT' : 'DELETE', query: { uris: uri } });
  likedCache.set(uri, liked);
}

/** Playlists you can add songs to (your own + collaborative). */
let myPlaylists = null;
let meId; // undefined = not looked up yet
export async function editablePlaylists(force = false) {
  if (myPlaylists && !force) return myPlaylists;
  if (meId === undefined) {
    try { meId = (await api('/me')).id; } catch { meId = null; }
  }
  const all = [];
  let next = '/me/playlists';
  let query = { limit: 50 };
  while (next && all.length < 200) {
    const page = await api(next, { query });
    all.push(...page.items.filter(Boolean));
    next = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
    query = undefined;
  }
  myPlaylists = all.filter((p) => !meId || p.owner?.id === meId || p.collaborative);
  return myPlaylists;
}

export const addToPlaylist = (playlistId, uri) =>
  api(`/playlists/${playlistId}/items`, { method: 'POST', body: { uris: [uri] } });

// Song URIs per playlist, reused until the playlist changes (every change gets a new snapshot_id).
const playlistSongs = new Map(); // playlist id -> { snapshot, uris: Set }

/** Every song URI in a playlist you own or collaborate on. Pass the playlist object from editablePlaylists(). */
export async function playlistUris(playlist) {
  const hit = playlistSongs.get(playlist.id);
  if (hit && hit.snapshot === playlist.snapshot_id) return hit.uris;
  const uris = new Set();
  let next = `/playlists/${playlist.id}/items`;
  let query = { limit: 100 };
  while (next) {
    const page = await api(next, { query });
    for (const row of page.items || []) {
      const t = row.item || row.track;
      if (t?.uri) uris.add(t.uri);
    }
    next = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
    query = undefined;
  }
  playlistSongs.set(playlist.id, { snapshot: playlist.snapshot_id, uris });
  return uris;
}

/** Adds a song to a playlist unless it's already in it. Returns false if it was already there. */
export async function addToPlaylistOnce(playlist, uri) {
  const uris = await playlistUris(playlist);
  if (uris.has(uri)) return false;
  const res = await addToPlaylist(playlist.id, uri);
  uris.add(uri);
  if (res?.snapshot_id) {
    playlist.snapshot_id = res.snapshot_id;
    playlistSongs.get(playlist.id).snapshot = res.snapshot_id;
  }
  return true;
}

/** All songs in a playlist (Spotify only allows this for playlists you own or collaborate on). */
export async function playlistTracks(playlistId, max = 500) {
  const tracks = [];
  let next = `/playlists/${playlistId}/items`;
  let query = { limit: 100 };
  while (next && tracks.length < max) {
    const page = await api(next, { query });
    for (const row of page.items || []) {
      const t = row.item || row.track;
      if (t?.uri && !t.uri.startsWith('spotify:local')) tracks.push(t);
    }
    next = page.next ? page.next.replace('https://api.spotify.com/v1', '') : null;
    query = undefined;
  }
  return tracks;
}

export const fmtTime = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Polls playback state and calls onUpdate({ state, progress }) about twice a second,
 * interpolating progress locally so we only hit the API every `pollMs`.
 * Pass shouldPoll() to pause polling (e.g. while the app is in the background).
 */
export function startPolling(onUpdate, { pollMs = 2000, shouldPoll = async () => true, onIdle } = {}) {
  let state = null;
  let fetchedAt = 0;
  let lastPoll = 0;

  async function poll() {
    try {
      state = await getPlayer();
      fetchedAt = Date.now();
    } catch (e) {
      console.warn('poll failed', e);
    }
  }

  const tick = async () => {
    if (!(await shouldPoll())) { onIdle?.(); return; }
    if (Date.now() - lastPoll >= pollMs) {
      lastPoll = Date.now();
      await poll();
    }
    let progress = state?.progress_ms || 0;
    if (state?.is_playing) progress += Date.now() - fetchedAt;
    if (state?.item) progress = Math.min(progress, state.item.duration_ms);
    onUpdate({ state, progress });
  };

  tick();
  const id = setInterval(tick, 500);
  return {
    refreshSoon: (delay = 300) => setTimeout(() => { lastPoll = 0; tick(); }, delay),
    stop: () => clearInterval(id),
  };
}
