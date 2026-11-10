// Artist mode, phone version. Same idea as on the PC: when a song by an artist with a folder
// plays, show their edits / the song's Spotify Canvas as a video background, floating emoji
// you can pop, and a draggable mascot picture that sometimes says something.
//
// On the phone everything comes from files published next to this page:
//   artists/index.json           which artists exist and what files they have
//   artists/<artist>/theme.json  colors, emoji, pictures, messages
//   artists/<artist>/*.jpg|mp4   pictures and edits
//   canvas.json                  { "spotify:track:...": "https://...mp4" } collected by the PC app

const DEFAULT_THEME = {
  dim: 0.5,
  maxSecondsPerEdit: 0,
  canvas: true,
  canvasSeconds: 15,
  floaties: ['✨'],
  albumFloaties: {},
  songFloaties: {},
  maxFloaties: 6,
  mascotImages: null,
  mascotChangeChance: 0.5,
  albumMascots: {},
  unlikeBlock: null,
  messages: ['now playing: {song} ♡'],
  messageChance: 0.5,
};

const FADE_S = 0.9; // must match the .bg-video opacity transition

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const baseTitle = (s) => (s || '').split(/ \(| - | \[/)[0];
const enc = (segments) => segments.map(encodeURIComponent).join('/');

// ---- Published data (loaded once) ----
let artistsIndex = null; // { folder: { pictures, videos, songVideos, theme, messages } }
let canvasMap = {};

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function loadData() {
  if (artistsIndex) return;
  const [index, canvases] = await Promise.all([
    fetchJson('artists/index.json').catch((e) => { console.warn(e); return {}; }),
    fetchJson('canvas.json').catch((e) => { console.warn(e); return {}; }),
  ]);
  canvasMap = canvases || {};
  artistsIndex = {};
  for (const [folder, files] of Object.entries(index || {})) {
    const [theme, messages] = await Promise.all([
      fetchJson(`artists/${enc([folder])}/theme.json`).catch(() => ({})),
      files.messages ? fetch(`artists/${enc([folder])}/messages.txt`).then((r) => (r.ok ? r.text() : '')).catch(() => '') : '',
    ]);
    artistsIndex[folder] = { ...files, theme, messages };
  }
}

/** The published artist matching one of the song's artists, if any. */
function artistFor(item) {
  const names = (item?.artists || []).map((a) => norm(a.name));
  const folder = Object.keys(artistsIndex || {}).find((f) => names.includes(norm(f)));
  return folder ? { folder, ...artistsIndex[folder] } : null;
}

export function createArtistMode() {
  const layer = document.createElement('div');
  layer.className = 'artist-layer';
  layer.innerHTML = '<video class="bg-video" muted playsinline></video>'
    + '<video class="bg-video" muted playsinline></video><div class="bg-dim"></div>';
  document.body.prepend(layer);
  const vids = [...layer.querySelectorAll('video')];
  for (const v of vids) { v.muted = true; v.defaultMuted = true; }

  // Floaties sit above the UI (so they can be tapped) but let taps through elsewhere.
  const floatLayer = document.createElement('div');
  floatLayer.className = 'floaties';
  document.body.append(floatLayer);

  const mascot = createMascot();

  let active = false;
  let playing = false;
  let running = false;
  let artist = null;
  let theme = DEFAULT_THEME;
  let song = '';
  let trackUri = '';
  let loadId = 0;
  let playlist = [];
  let idx = 0;
  let front = 0;
  let switching = false;
  let errorStreak = 0;
  let spawnTimer = null;
  let sticker = null; // url of the mascot picture for this song
  let canvasSrc = null;
  let shownAt = 0;
  let floatPool = ['✨'];

  for (const v of vids) {
    v.addEventListener('timeupdate', () => {
      if (v !== vids[front] || switching || playlist.length < 2) return;
      if (canvasSrc && v.getAttribute('src') === canvasSrc) {
        if (Date.now() - shownAt >= theme.canvasSeconds * 1000) nextVideo();
        return;
      }
      const nearEnd = Number.isFinite(v.duration) && v.duration - v.currentTime < FADE_S;
      const tooLong = theme.maxSecondsPerEdit > 0 && v.currentTime >= theme.maxSecondsPerEdit;
      if (nearEnd || tooLong) nextVideo();
    });
    v.addEventListener('ended', () => { if (v === vids[front] && !switching) nextVideo(); });
    v.addEventListener('error', () => {
      if (v !== vids[front] || !v.getAttribute('src')) return;
      console.warn('Skipping a video that can\'t play:', v.src);
      switching = false;
      if (++errorStreak < playlist.length) nextVideo();
    });
  }

  // iOS in Low Power Mode refuses to start videos on its own: the first tap anywhere starts them.
  let hint = null;
  const unlock = () => {
    hint?.remove();
    hint = null;
    if (running) vids[front].play().catch(() => {});
  };
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('click', unlock);

  async function load(item) {
    const id = ++loadId;
    await loadData();
    if (id !== loadId) return;
    const a = artistFor(item);
    if (!a) return loadCanvasOnly(item);

    artist = a;
    song = item.name;
    theme = { ...DEFAULT_THEME, ...(a.theme || {}) };
    floatPool = buildFloatPool(item);
    canvasSrc = theme.canvas ? canvasMap[item.uri] || null : null;

    const base = `artists/${enc([a.folder])}`;
    const songKey = Object.keys(a.songVideos || {}).find((k) => norm(k) === norm(baseTitle(item.name)));
    const songVideos = (songKey ? a.songVideos[songKey] : []).map((f) => `${base}/songs/${enc([songKey, f])}`);
    const anyVideos = (a.videos || []).map((f) => `${base}/${enc([f])}`);
    playlist = [...(canvasSrc ? [canvasSrc] : []), ...shuffle(songVideos)];
    if (!playlist.length) playlist = shuffle(anyVideos);
    idx = 0;
    errorStreak = 0;

    active = true;
    document.body.classList.add('artist-mode');
    const root = document.documentElement.style;
    if (theme.accent) root.setProperty('--accent', theme.accent); else root.removeProperty('--accent');
    root.setProperty('--dim', String(theme.dim));
    document.body.classList.toggle('has-video', playlist.length > 0);
    if (playlist.length) showVideo(playlist[0]);
    else for (const v of vids) unload(v);

    sticker = chooseSticker(item, base);
    mascot.show(sticker);
    const messages = allMessages();
    if (messages.length && Math.random() < theme.messageChance) {
      mascot.say(pick(messages).replaceAll('{song}', baseTitle(song)));
    }
    syncPlaying(true);
  }

  // Every other song: just its Spotify Canvas as the background.
  function loadCanvasOnly(item) {
    const url = canvasMap[item?.uri];
    if (!url) return stop();
    artist = null;
    song = item.name;
    theme = { ...DEFAULT_THEME, maxFloaties: 0 };
    canvasSrc = url;
    playlist = [url];
    idx = 0;
    errorStreak = 0;
    floatLayer.replaceChildren();
    mascot.hide();
    active = true;
    document.body.classList.add('artist-mode', 'has-video');
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.setProperty('--dim', String(theme.dim));
    showVideo(url);
    syncPlaying(true);
  }

  function allMessages() {
    const fromFile = (artist?.messages || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return [...(theme.messages || []), ...fromFile];
  }

  function stop() {
    if (!active) return;
    active = false;
    artist = null;
    clearInterval(spawnTimer);
    spawnTimer = null;
    running = false;
    switching = false;
    document.body.classList.remove('artist-mode', 'has-video');
    document.documentElement.style.removeProperty('--accent');
    for (const v of vids) unload(v);
    floatLayer.replaceChildren();
    mascot.hide();
  }

  function buildFloatPool(item) {
    const title = norm(baseTitle(item.name));
    const album = norm(item.album?.name);
    const songOnes = Object.entries(theme.songFloaties || {})
      .filter(([name]) => norm(baseTitle(name)) === title).flatMap(([, list]) => list);
    const albumOnes = Object.entries(theme.albumFloaties || {})
      .filter(([name]) => album && album.includes(norm(name))).flatMap(([, list]) => list);
    const pool = [...songOnes, ...songOnes, ...songOnes, ...albumOnes, ...albumOnes, ...(theme.floaties || [])];
    return pool.length ? pool : ['✨'];
  }

  function pictureUrl(base, name) {
    const file = (artist?.pictures || []).find((p) => p.toLowerCase() === String(name).toLowerCase());
    return file ? `${base}/${enc([file])}` : null;
  }

  function chooseSticker(item, base) {
    for (const [album, file] of Object.entries(theme.albumMascots || {})) {
      if (norm(item.album?.name).includes(norm(album))) {
        const forced = pictureUrl(base, file);
        if (forced) return forced;
      }
    }
    const pool = (theme.mascotImages || artist?.pictures || []).map((f) => pictureUrl(base, f)).filter(Boolean);
    if (!pool.length) return null;
    const keep = pool.includes(sticker) && Math.random() >= theme.mascotChangeChance;
    if (keep) return sticker;
    const others = pool.filter((p) => p !== sticker);
    return pick(others.length ? others : pool);
  }

  function unload(v) {
    v.classList.remove('show');
    v.pause();
    v.removeAttribute('src');
    v.load();
  }

  function nextVideo() {
    idx = (idx + 1) % playlist.length;
    if (idx === 0) {
      const last = playlist[playlist.length - 1];
      playlist = shuffle(playlist);
      if (playlist.length > 1 && playlist[0] === last) playlist.push(playlist.shift());
    }
    showVideo(playlist[idx]);
  }

  function showVideo(src) {
    const incoming = vids[1 - front];
    const outgoing = vids[front];
    front = 1 - front;
    switching = true;
    incoming.loop = playlist.length === 1 || src === canvasSrc;
    incoming.src = src;
    incoming.addEventListener('loadeddata', () => {
      if (vids[front] !== incoming) return;
      switching = false;
      errorStreak = 0;
      shownAt = Date.now();
      incoming.classList.add('show');
      outgoing.classList.remove('show');
      setTimeout(() => { if (vids[front] !== outgoing) unload(outgoing); }, FADE_S * 1000);
    }, { once: true });
    if (playing) tryPlay(incoming);
  }

  function tryPlay(v) {
    v.play().catch((e) => {
      // Autoplay refused (iOS Low Power Mode): ask for a tap.
      if (e?.name === 'NotAllowedError' && !hint) {
        hint = document.createElement('div');
        hint.className = 'tap-hint';
        hint.textContent = 'Tap to start the video';
        document.body.append(hint);
      }
    });
  }

  document.addEventListener('visibilitychange', () => syncPlaying(!document.hidden));

  function syncPlaying(force = false) {
    const should = active && playing && !document.hidden;
    if (!force && should === running) return;
    running = should;
    clearInterval(spawnTimer);
    spawnTimer = null;
    if (should) {
      tryPlay(vids[front]);
      if (theme.maxFloaties > 0) spawnTimer = setInterval(spawnFloaty, 1870);
    } else {
      for (const v of vids) v.pause();
    }
  }

  function spawnFloaty() {
    if (document.hidden) return;
    if (floatLayer.querySelectorAll('.floaty').length >= theme.maxFloaties) return;
    const el = document.createElement('span');
    el.className = 'floaty';
    el.textContent = pick(floatPool);
    el.style.left = `${Math.random() * 92}%`;
    el.style.fontSize = `${16 + Math.random() * 18}px`;
    el.style.setProperty('--drift', `${(Math.random() - 0.5) * 90}px`);
    el.style.setProperty('--spin', `${(Math.random() - 0.5) * 60}deg`);
    el.style.animationDuration = `${9 + Math.random() * 7}s`;
    el.addEventListener('animationend', () => el.remove());
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      burst(e.clientX, e.clientY, el.textContent);
      el.remove();
    });
    floatLayer.append(el);
  }

  function burst(x, y, emoji) {
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.textContent = i % 2 ? emoji : '✦';
      const angle = (Math.PI * 2 * i) / 7 + Math.random() * 0.5;
      const dist = 30 + Math.random() * 30;
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      s.addEventListener('animationend', () => s.remove());
      floatLayer.append(s);
    }
  }

  /** "Try again." popup with the theme's picture. Tap anywhere to close. */
  function showNope(imageUrl, text) {
    document.querySelector('.nope')?.remove();
    const el = document.createElement('div');
    el.className = 'nope';
    el.innerHTML = '<div class="nope-card"><img alt=""><div class="nope-text"></div></div>';
    const img = el.querySelector('img');
    if (imageUrl) img.src = imageUrl; else img.remove();
    el.querySelector('.nope-text').textContent = text;
    el.addEventListener('pointerdown', () => el.remove());
    document.body.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ---- Mascot: draggable picture that wiggles and talks when tapped ----
  function createMascot() {
    const el = document.createElement('div');
    el.className = 'mascot hidden';
    el.innerHTML = '<div class="bubble"></div><div class="buddy"></div>';
    document.body.append(el);
    const bubble = el.querySelector('.bubble');
    const buddy = el.querySelector('.buddy');
    let bubbleTimer;
    let current = null;

    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('lite.mascotPos')); } catch {}
    const place = (x, y) => {
      const maxX = window.innerWidth - el.offsetWidth;
      const maxY = window.innerHeight - el.offsetHeight;
      el.style.left = `${Math.max(0, Math.min(maxX, x))}px`;
      el.style.top = `${Math.max(0, Math.min(maxY, y))}px`;
      bubble.classList.toggle('left', el.offsetLeft < window.innerWidth / 2);
    };

    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      drag = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, x: e.clientX, y: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
      if (drag.moved) place(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag) return;
      if (drag.moved) {
        try { localStorage.setItem('lite.mascotPos', JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })); } catch {}
      } else {
        buddy.classList.remove('wiggle');
        void buddy.offsetWidth;
        buddy.classList.add('wiggle');
        burst(e.clientX, e.clientY, pick(floatPool));
        const messages = allMessages();
        if (messages.length) api.say(pick(messages).replaceAll('{song}', baseTitle(song)));
      }
      drag = null;
    });
    window.addEventListener('resize', () => { if (!el.classList.contains('hidden')) place(el.offsetLeft, el.offsetTop); });

    const api = {
      show(url) {
        if (!url) return api.hide();
        if (url !== current) {
          current = url;
          const img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.src = url;
          buddy.replaceChildren(img);
          buddy.classList.remove('pop-in');
          void buddy.offsetWidth;
          buddy.classList.add('pop-in');
        }
        const wasHidden = el.classList.contains('hidden');
        el.classList.remove('hidden');
        if (wasHidden) {
          if (saved) place(saved.x, saved.y);
          else place(window.innerWidth - el.offsetWidth - 14, window.innerHeight * 0.36);
        }
      },
      hide() { el.classList.add('hidden'); },
      say(text) {
        bubble.textContent = text;
        bubble.classList.add('show');
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 3500);
      },
    };
    return api;
  }

  return {
    update(state) {
      const item = state?.item;
      if ((item?.uri || '') !== trackUri) {
        trackUri = item?.uri || '';
        if (item) load(item); else stop();
      }
      playing = !!state?.is_playing;
      syncPlaying();
    },
    idle() {
      playing = false;
      syncPlaying();
    },
    blockUnlike(uri) {
      const rule = theme.unlikeBlock;
      if (!active || !artist || !rule || uri !== trackUri) return false;
      if (Math.random() >= (rule.chance ?? 0.25)) return false;
      showNope(rule.image ? pictureUrl(`artists/${enc([artist.folder])}`, rule.image) : null, rule.text || 'Try again.');
      return true;
    },
    get artist() { return artist?.folder || null; },
  };
}
