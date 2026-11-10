// Lite Player, phone version. Controls the Spotify app on this phone through the Web API.

import * as sp from './spotify.js';
import { icons, paintIcons } from './icons.js';
import { createArtistMode } from './artist-mode.js';

const $ = (id) => document.getElementById(id);
const APP_VERSION = '2026-11-10b';
// Last console warnings/errors, shown in the diagnostics panel (triple-tap the title).
const logLines = [];
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    logLines.push(`${level}: ${args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.slice(0, 300));
    if (logLines.length > 30) logLines.shift();
  };
}
window.addEventListener('error', (e) => console.error('uncaught', e.message, e.filename?.split('/').pop(), e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('promise', e.reason?.message || e.reason));
const artistMode = createArtistMode();
window.lite = { sp, icons, onUpdate: [], artistMode };
paintIcons();

// Works offline-ish and installs to the home screen.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version was published: reload once to use it.
    if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); }
  });
}

// ---------- Setup ----------
$('redirect-uri').textContent = sp.REDIRECT_URI;
$('client-id').value = sp.getClientId();

function showSetup(error = '') {
  $('player').classList.add('hidden');
  $('setup').classList.remove('hidden');
  $('setup-error').textContent = error;
}

$('login-btn').onclick = () => {
  const id = $('client-id').value.trim();
  $('setup-error').textContent = '';
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    $('setup-error').textContent = 'That doesn\'t look like a Client ID (32 letters/numbers).';
    return;
  }
  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Opening Spotify…';
  sp.login(id); // leaves the page; finishLogin() runs when Spotify sends us back
};

// ---------- Player ----------
let poller;
let current = null;
let seeking = false;

function showPlayer() {
  $('setup').classList.add('hidden');
  $('player').classList.remove('hidden');
  $('reauth').classList.toggle('hidden', !sp.needsReauth());
  poller ??= sp.startPolling(render, {
    shouldPoll: async () => !document.hidden,
    onIdle: () => artistMode.idle(),
  });
  queueTimer ??= setInterval(() => { if (!document.hidden) refreshQueue(); }, 12000);
  loadTab('search');
}

// ---------- Queue drawer: pulled down it shows the next song, pulled up the whole queue ----------
const queueEl = $('queue');
let queueTimer = null;
let lastQueueKey = null;

async function refreshQueue() {
  if (!current?.item) return showQueue([]);
  try {
    const q = await sp.getQueue();
    const items = (q?.queue || []).filter((t) => t?.uri);
    const key = items.map((t) => t.uri).join('|');
    if (key === lastQueueKey) return;
    lastQueueKey = key;
    showQueue(items);
  } catch (e) {
    console.warn('queue', e);
    showQueue([]);
  }
}

function showQueue(items) {
  const next = items[0];
  queueEl.classList.toggle('hidden', !next);
  document.body.classList.toggle('has-queue', !!next);
  if (!next) { lastQueueKey = null; queueEl.classList.remove('open'); return; }
  $('queue-next').querySelector('img').src = img(next.album?.images) || sp.BLANK_IMG;
  $('queue-next').querySelector('.name').textContent = `${next.name} · ${artists(next)}`;
  const list = $('queue-list');
  list.replaceChildren();
  items.slice(0, 30).forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="pos"></span><img alt="" loading="lazy"><div class="txt"><div class="ellipsis"></div><div class="sub ellipsis"></div></div><span class="dur"></span>';
    row.querySelector('.pos').textContent = i + 1;
    row.querySelector('img').src = img(t.album?.images) || sp.BLANK_IMG;
    row.querySelector('.ellipsis').textContent = t.name;
    row.querySelector('.sub').textContent = artists(t);
    row.querySelector('.dur').textContent = sp.fmtTime(t.duration_ms);
    // Spotify can't jump straight to a queued song, so this skips forward until it's reached.
    row.onclick = () => act(async () => {
      if (i > 15) throw new Error('Too far down the queue to skip to');
      for (let n = 0; n <= i; n++) await sp.next();
      queueEl.classList.remove('open');
      toast(`Skipping to ${t.name}`);
    });
    list.append(row);
  });
}

// Drag the handle up/down, or tap it to toggle.
{
  const handle = $('queue-handle');
  let drag = null;
  const closedY = () => queueEl.offsetHeight - (66 + (parseFloat(getComputedStyle(queueEl).paddingBottom) || 0));
  handle.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, startOpen: queueEl.classList.contains('open'), moved: false };
    handle.setPointerCapture(e.pointerId);
    queueEl.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 6) drag.moved = true;
    const max = closedY();
    const y = Math.max(0, Math.min(max, (drag.startOpen ? 0 : max) + dy));
    queueEl.style.transform = `translateY(${y}px)`;
  });
  const finish = (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const open = drag.moved ? (dy < -40 ? true : dy > 40 ? false : drag.startOpen) : !drag.startOpen;
    queueEl.classList.remove('dragging');
    queueEl.style.transform = '';
    queueEl.classList.toggle('open', open);
    drag = null;
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

// Back from the background: refresh right away instead of waiting for the next poll.
document.addEventListener('visibilitychange', () => { if (!document.hidden) poller?.refreshSoon(0); });

function render({ state, progress }) {
  const prevUri = current?.item?.uri;
  current = state;
  const item = state?.item;
  const art = item?.album?.images?.[0]?.url || item?.images?.[0]?.url || sp.BLANK_IMG;
  if ($('art').getAttribute('src') !== art) $('art').src = art;
  $('title').textContent = item?.name || 'Nothing playing';
  $('artist').textContent = item
    ? (item.artists || []).map((a) => a.name).join(', ') || item.show?.name || ''
    : 'Pick something below';

  const dur = item?.duration_ms || 0;
  $('pos').textContent = sp.fmtTime(progress);
  $('dur').textContent = sp.fmtTime(dur);
  if (!seeking) setRange($('seek'), dur ? (progress / dur) * 1000 : 0);

  $('play-btn').innerHTML = state?.is_playing ? icons.pause : icons.play;
  $('shuffle-btn').classList.toggle('on', !!state?.shuffle_state);
  const rep = state?.repeat_state || 'off';
  $('repeat-btn').classList.toggle('on', rep !== 'off');
  $('repeat-btn').innerHTML = rep === 'track' ? icons.repeatOne : icons.repeat;

  // Phones don't let apps set Spotify's volume, so the slider only shows for devices that do.
  const dev = state?.device;
  const canVolume = !!dev && dev.supports_volume !== false && dev.type !== 'Smartphone';
  $('volume-row').classList.toggle('hidden', !canVolume);
  if (canVolume && document.activeElement !== $('volume')) setRange($('volume'), dev.volume_percent ?? 0);
  paintMute(canVolume && dev.volume_percent === 0);

  $('device-dot').className = 'dot ' + (dev ? 'ok' : '');
  $('device-text').textContent = dev ? `Playing on ${dev.name}` : 'Open Spotify on this phone, then press play';

  if (item?.uri !== prevUri) {
    refreshLike(item);
    highlightPlaying();
    refreshQueue();
  }
  artistMode.update(state);
  for (const fn of window.lite.onUpdate) try { fn({ state, progress }); } catch (e) { console.error(e); }
}

function setRange(el, value) {
  el.value = value;
  el.style.setProperty('--fill', `${((value - el.min) / (el.max - el.min)) * 100}%`);
}

/** Runs a player action, shows errors as a toast, and refreshes state shortly after. */
async function act(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  }
  poller?.refreshSoon();
}

$('play-btn').onclick = () => act(async () => {
  if (current?.is_playing) return sp.pause();
  if (current?.device) return sp.resume();
  // Nothing active: wake up the phone's Spotify app.
  const dev = await sp.pickDevice();
  return sp.transferTo(dev.id, true);
});
$('next-btn').onclick = () => act(sp.next);
$('prev-btn').onclick = () => act(sp.previous);
$('shuffle-btn').onclick = () => act(() => sp.setShuffle(!current?.shuffle_state));
$('repeat-btn').onclick = () => act(() => {
  const order = ['off', 'context', 'track'];
  return sp.setRepeat(order[(order.indexOf(current?.repeat_state || 'off') + 1) % 3]);
});
$('logout-btn').onclick = () => { if (confirm('Log out of Spotify in Lite Player?')) { sp.logout(); location.reload(); } };

// ---------- Search from anywhere (magnifier at the top) ----------
$('search-btn').onclick = () => {
  if (popover) return closePopover();
  const menu = openPopover('Search Spotify');
  menu.classList.add('sheet-search');
  const input = document.createElement('input');
  input.className = 'search';
  input.placeholder = 'Song, artist or album';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  const results = document.createElement('div');
  results.className = 'results';
  menu.append(input, results);
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { results.replaceChildren(); return; }
      try {
        const res = await sp.api('/search', { query: { q, type: 'track', limit: 10 } });
        if (popover !== menu) return;
        renderRows(results, res.tracks.items.map((t) => ({
          uri: t.uri, title: t.name, sub: `${artists(t)} · ${t.album.name}`, image: img(t.album.images), duration: t.duration_ms,
          play: async () => { await sp.play({ context_uri: t.album.uri, offset: t.uri }); closePopover(); },
        })));
      } catch (e) { results.replaceChildren(note(e.message, 'error')); }
    }, 350);
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); };
  setTimeout(() => input.focus(), 50);
};

// ---------- Diagnostics: triple-tap the title ----------
let titleTaps = [];
$('app-title').addEventListener('pointerdown', () => {
  const now = Date.now();
  titleTaps = titleTaps.filter((t) => now - t < 900);
  titleTaps.push(now);
  if (titleTaps.length >= 3) { titleTaps = []; showDiagnostics(); }
});
function showDiagnostics() {
  document.querySelector('.diag')?.remove();
  const el = document.createElement('div');
  el.className = 'diag';
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = 'Close';
  close.onclick = () => el.remove();
  const info = {
    version: APP_VERSION, page: location.href, standalone: !!navigator.standalone || matchMedia('(display-mode: standalone)').matches,
    online: navigator.onLine, screen: `${innerWidth}x${innerHeight} dpr ${devicePixelRatio}`, ua: navigator.userAgent.slice(0, 120),
    device: current?.device ? `${current.device.name} (${current.device.type})` : 'none', playing: !!current?.is_playing,
    track: current?.item ? `${current.item.name} · ${artists(current.item)} · ${current.item.uri}` : 'none',
    artistMode: artistMode.debug(),
    log: logLines.slice(-15),
  };
  const text = document.createElement('div');
  text.textContent = JSON.stringify(info, null, 2);
  el.append(close, text);
  document.body.append(el);
}

$('seek').oninput = (e) => { seeking = true; setRange(e.target, e.target.value); };
$('seek').onchange = (e) => {
  seeking = false;
  const dur = current?.item?.duration_ms;
  if (dur) act(() => sp.seek((e.target.value / 1000) * dur));
};
$('volume').oninput = (e) => setRange(e.target, e.target.value);
$('volume').onchange = (e) => act(() => sp.setVolume(e.target.value));

function paintMute(muted) {
  const icon = muted ? icons.volumeOff : icons.volume;
  if ($('mute-btn').innerHTML !== icon) $('mute-btn').innerHTML = icon;
}
$('mute-btn').onclick = () => {
  const vol = current?.device?.volume_percent ?? Number($('volume').value);
  let target = 0;
  if (vol > 0) {
    try { localStorage.setItem('lite.unmuteVolume', String(vol)); } catch {}
  } else {
    let saved = NaN;
    try { saved = Number(localStorage.getItem('lite.unmuteVolume')); } catch {}
    target = saved > 0 ? saved : 50;
  }
  setRange($('volume'), target);
  act(() => sp.setVolume(target));
};

// ---------- Cover fade + player-only view ----------
$('art').onclick = () => document.body.classList.toggle('cover-faded');

function setPlayerOnly(on) {
  document.body.classList.toggle('player-only', on);
  $('player-only-btn').classList.toggle('on-toggle', on);
  try { localStorage.setItem('lite.playerOnly', on ? '1' : ''); } catch {}
}
$('player-only-btn').onclick = () => setPlayerOnly(!document.body.classList.contains('player-only'));
try { setPlayerOnly(!!localStorage.getItem('lite.playerOnly')); } catch {}

// ---------- Devices ----------
$('devices-btn').onclick = async () => {
  if (popover) return closePopover();
  const menu = openPopover('Play on');
  menu.classList.add('devices');
  try {
    const devices = await sp.getDevices();
    if (popover !== menu) return;
    if (!devices.length) {
      menu.append(note('No devices. Open the Spotify app on this phone (or any device on your account) and try again.', 'note'));
      return;
    }
    for (const d of devices) {
      const b = document.createElement('button');
      b.className = 'dev' + (d.is_active ? ' active' : '');
      b.innerHTML = '<span class="name ellipsis"></span><span class="type"></span>';
      b.querySelector('.name').textContent = d.name;
      b.querySelector('.type').textContent = d.is_active ? 'playing here' : d.type;
      b.onclick = () => { closePopover(); act(() => sp.transferTo(d.id, !!current?.is_playing)); };
      menu.append(b);
    }
  } catch (e) {
    menu.append(note(e.message, 'error'));
  }
};

// ---------- Library lists ----------
let tab = 'search';
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => loadTab(b.dataset.tab);
});

let searchTimer;
$('search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadTab('search'), 350);
};
$('search').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };

const img = (images) => images?.[images.length > 1 ? images.length - 2 : 0]?.url || '';
const artists = (t) => (t.artists || []).map((a) => a.name).join(', ');
const note = (text, cls = 'muted') => {
  const p = document.createElement('p');
  p.className = cls;
  p.style.padding = '8px';
  p.textContent = text;
  return p;
};

async function loadTab(name) {
  tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('search').classList.toggle('hidden', name !== 'search');
  const list = $('list');
  try {
    if (name === 'search') {
      const q = $('search').value.trim();
      if (!q) { list.replaceChildren(note('Search for a song, artist or album.')); return; }
      const res = await sp.api('/search', { query: { q, type: 'track', limit: 10 } });
      if (tab !== name) return;
      renderRows(list, res.tracks.items.map((t) => ({
        uri: t.uri, title: t.name, sub: `${artists(t)} · ${t.album.name}`, image: img(t.album.images),
        duration: t.duration_ms,
        play: () => sp.play({ context_uri: t.album.uri, offset: t.uri }),
      })));
    } else if (name === 'playlists') {
      const res = await sp.api('/me/playlists', { query: { limit: 50 } });
      if (tab !== name) return;
      renderRows(list, res.items.filter(Boolean).map((p) => ({
        uri: p.uri, title: p.name, sub: `Playlist · ${p.owner?.display_name || ''}`, image: img(p.images),
        play: () => sp.play({ context_uri: p.uri }),
        expand: () => playlistSongs(p),
      })));
    } else if (name === 'liked' || name === 'recent') {
      const res = name === 'liked'
        ? await sp.api('/me/tracks', { query: { limit: 50 } })
        : await sp.api('/me/player/recently-played', { query: { limit: 50 } });
      if (tab !== name) return;
      const tracks = res.items.map((i) => i.track).filter(Boolean);
      const uris = tracks.map((t) => t.uri);
      renderRows(list, tracks.map((t, i) => ({
        uri: t.uri, title: t.name, sub: artists(t), image: img(t.album?.images), duration: t.duration_ms,
        play: () => sp.play({ uris, offset: i }),
      })));
    }
  } catch (e) {
    list.replaceChildren(note(e.message, 'error'));
  }
}

async function playlistSongs(p) {
  const tracks = await sp.playlistTracks(p.id);
  return tracks.map((t) => ({
    uri: t.uri, title: t.name, sub: artists(t), image: img(t.album?.images), duration: t.duration_ms,
    play: () => sp.play({ context_uri: p.uri, offset: t.uri }),
  }));
}

function renderRows(container, rows) {
  container.replaceChildren();
  if (!rows.length) { container.append(note('Nothing here.')); return; }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.uri = r.uri;
    row.innerHTML = '<img alt="" loading="lazy"><div class="txt"><div class="ellipsis"></div><div class="sub ellipsis"></div></div>';
    row.querySelector('img').src = r.image || sp.BLANK_IMG;
    row.querySelector('.ellipsis').textContent = r.title;
    row.querySelector('.sub').textContent = r.sub;
    if (r.duration) {
      const d = document.createElement('span');
      d.className = 'dur';
      d.textContent = sp.fmtTime(r.duration);
      row.append(d);
    }
    row.onclick = () => act(r.play);
    container.append(row);
    if (r.expand) addExpander(row, r.expand);
  }
  highlightPlaying();
}

function addExpander(row, loadRows) {
  const btn = document.createElement('button');
  btn.className = 'icon expand';
  btn.innerHTML = icons.chevron;
  row.append(btn);
  let sub = null;
  btn.onclick = async (e) => {
    e.stopPropagation();
    if (sub) { sub.remove(); sub = null; btn.classList.remove('open'); return; }
    btn.classList.add('open');
    const target = document.createElement('div');
    target.className = 'sublist';
    target.append(note('Loading…'));
    row.after(target);
    sub = target;
    try {
      renderRows(target, await loadRows());
    } catch (err) {
      const forbidden = /403|forbidden/i.test(err.message);
      target.replaceChildren(note(forbidden
        ? 'Spotify only lets apps list songs in playlists you made or collaborate on.'
        : err.message, 'note'));
    }
  };
}

function highlightPlaying() {
  const uri = current?.item?.uri;
  document.querySelectorAll('.row').forEach((r) => r.classList.toggle('playing', r.dataset.uri === uri));
}

// ---------- Like + add to playlist ----------
let likedFor = null;

async function refreshLike(item) {
  likedFor = item?.uri || null;
  paintLike(false);
  if (!item?.uri || sp.needsReauth()) return;
  try {
    const liked = await sp.isLiked(item.uri);
    if (likedFor === item.uri) paintLike(liked);
  } catch (e) { console.warn('like status', e); }
}

function paintLike(liked) {
  $('like-btn').innerHTML = liked ? icons.heartFill : icons.heart;
  $('like-btn').classList.toggle('liked', liked);
  $('like-btn').dataset.liked = liked ? '1' : '';
}

async function toggleLike() {
  const uri = current?.item?.uri;
  if (!uri) return;
  const liked = !$('like-btn').dataset.liked;
  if (!liked && artistMode.blockUnlike(uri)) return;
  paintLike(liked);
  try {
    await sp.setLiked(uri, liked);
    toast(liked ? 'Added to Liked Songs ♡' : 'Removed from Liked Songs');
  } catch (e) {
    paintLike(!liked);
    toast(e.message);
  }
}

let popover = null;
function closePopover() { popover?.remove(); popover = null; }

function openPopover(title, subtitle) {
  const menu = document.createElement('div');
  menu.className = 'popover';
  const head = document.createElement('div');
  head.className = 'head';
  head.textContent = title;
  if (subtitle) {
    const sub = document.createElement('small');
    sub.className = 'ellipsis';
    sub.textContent = subtitle;
    head.append(sub);
  }
  menu.append(head);
  document.body.append(menu);
  popover = menu;
  return menu;
}

async function openAddMenu() {
  const item = current?.item;
  if (!item?.uri) return;
  if (popover) return closePopover();
  const menu = openPopover('Add to playlist', `${item.name} · ${artists(item)}`);
  const loading = note('Loading your playlists…');
  menu.append(loading);
  try {
    const lists = await sp.editablePlaylists(true);
    if (popover !== menu) return;
    loading.remove();
    if (!lists.length) menu.append(note('You don\'t have any playlists yet.'));

    const rows = lists.map((p) => {
      const b = document.createElement('button');
      b.className = 'pl';
      b.innerHTML = '<img alt=""><span class="name ellipsis"></span><span class="state"></span>';
      b.querySelector('img').src = img(p.images) || sp.BLANK_IMG;
      b.querySelector('.name').textContent = p.name;
      const state = b.querySelector('.state');
      const markAdded = () => {
        b.classList.add('added');
        b.disabled = true;
        state.textContent = '✓ Added';
      };
      b.onclick = async () => {
        b.disabled = true;
        state.textContent = 'Adding…';
        try {
          const added = await sp.addToPlaylistOnce(p, item.uri);
          markAdded();
          toast(added ? `Added to ${p.name} ✓` : `Already in ${p.name}`);
        } catch (e) {
          b.disabled = false;
          state.textContent = '';
          toast(e.message);
        }
      };
      menu.append(b);
      return { p, markAdded };
    });

    const queue = [...rows];
    const worker = async () => {
      while (queue.length && popover === menu) {
        const row = queue.shift();
        try {
          if ((await sp.playlistUris(row.p)).has(item.uri)) row.markAdded();
        } catch (e) { console.warn('playlist check', e); }
      }
    };
    await Promise.all([worker(), worker()]);
  } catch (e) {
    loading.remove();
    menu.append(note(e.message, 'error'));
  }
}

document.addEventListener('pointerdown', (e) => {
  if (popover && !popover.contains(e.target) && !e.target.closest('#add-btn, #devices-btn')) closePopover();
});

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
}

$('like-btn').onclick = toggleLike;
$('add-btn').onclick = openAddMenu;
$('reauth-btn').onclick = () => sp.login(sp.getClientId());

// ---------- Start ----------
(async () => {
  try {
    await sp.finishLogin();
  } catch (e) {
    showSetup(e.message);
    return;
  }
  if (sp.isLoggedIn()) showPlayer(); else showSetup();
})();
