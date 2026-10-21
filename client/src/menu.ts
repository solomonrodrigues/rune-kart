// Main menu: Quick Race, Host / Join a lobby, Practice, How to Play, and your racer name — over a slow
// orbit of the selected track. Choosing something navigates to a game URL (e.g. ?host&track=hollow), so
// the game itself always starts the same way from its URL.
import * as THREE from 'three';
import { PORT } from 'shared/constants';
import { createTrack } from 'shared/track';
import { DEFAULT_TRACK, TRACKS } from 'shared/tracks';
import { buildScene } from './scene';
import { Sound } from './audio';
import { applyPixelSize, PIXEL_SIZES, pixelSize, setPixelSize } from './pixel';

const NAME_KEY = 'runekart.name';
export function loadName() {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
function saveName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode: just don't remember it */ }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const api = (path: string) => `${import.meta.env.DEV ? `http://${location.hostname}:${PORT}` : ''}${path}`;
const go = (query: Record<string, string | number | boolean | undefined>) => {
  const q = Object.entries(query).filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => v === true ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  location.search = q;
};

// --- Background: the chosen track, orbiting slowly ---
function background() {
  // Logarithmic depth: from this far up, the road (0.1 above the grass) would otherwise z-fight with it.
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  applyPixelSize(renderer, pixelSize());
  renderer.localClippingEnabled = true;
  renderer.domElement.className = 'menu-bg';
  document.body.prepend(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
  let current: { scene: THREE.Scene; update: (c: THREE.Camera, at: THREE.Vector3, dt: number, t: number) => void; centre: THREE.Vector3; radius: number } | null = null;
  const show = (id: string) => {
    const track = createTrack(TRACKS[id]);
    const { scene, sky, update } = buildScene(track);
    const xs = track.samples.map(s => s.x), zs = track.samples.map(s => s.z);
    const centre = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
    const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    // The orbit camera is far above the track (further on bigger tracks); push the fog and far plane back to match.
    const far = Math.max(900, radius * 2.5);
    if (scene.fog instanceof THREE.Fog) { scene.fog.near = Math.max(260, radius); scene.fog.far = far; }
    camera.far = far; camera.updateProjectionMatrix();
    // The mountain ring (inner radius 390) would cut through a big track, so spread it out past the far edge.
    sky.scale.setScalar(Math.max(1, radius * 1.6 / 390));
    current = { scene, update, centre, radius };
  };
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  /** Preview a pixel filter on the backdrop (the game picks it up when it starts). */
  const setPixels = (size: number) => { applyPixelSize(renderer, size); resize(); };
  addEventListener('resize', resize);
  resize();
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    if (!current) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const a = now / 1000 * 0.05;
    const { centre, radius } = current;
    // High and outside the track, looking down at 45° from far enough back that the near side stays in frame.
    camera.position.set(centre.x + Math.sin(a) * radius * 0.85, radius * 0.85, centre.z + Math.cos(a) * radius * 0.85);
    camera.lookAt(centre.x, 0, centre.z);
    current.update(camera, centre, dt, now / 1000);
    renderer.render(current.scene, camera);
  });
  return { show, setPixels };
}

// --- Screens ---
const trackPicker = (selected: string) =>
  `<div class="tracks">${Object.entries(TRACKS).map(([id, t]) =>
    `<button class="track${id === selected ? ' on' : ''}" data-track="${id}"><b>${esc(t.name)}</b><small>${esc(t.blurb ?? '')}</small></button>`).join('')}</div>`;

export function runMenu() {
  document.body.classList.add('in-menu');
  const { show: showTrack, setPixels } = background();
  const root = document.createElement('div');
  root.id = 'menu';
  document.body.append(root);

  let track = DEFAULT_TRACK, laps = 3, priv = false;
  let lobbies: { roomId: string; clients: number; maxClients: number; metadata?: { name?: string; track?: string; laps?: number; phase?: string } }[] = [];
  let refresh: number | undefined;
  showTrack(track);

  const nameField = () => `<label class="name">Your name <input id="player" maxlength="16" placeholder="Nameless rider" value="${esc(loadName())}" autocomplete="off" spellcheck="false"></label>`;
  const player = () => (root.querySelector<HTMLInputElement>('#player')?.value ?? loadName()).trim();

  const screens: Record<string, () => string> = {
    main: () => `<h1>Rune Kart</h1><p class="tag">Race the dark roads. Bend the runes.</p>${nameField()}
      <nav>
        <button data-go="quick" class="primary">Quick Race<small>Join an open lobby, or start one</small></button>
        <button data-go="host">Host Lobby<small>Choose the track and laps; invite friends</small></button>
        <button data-go="join">Join Lobby<small>Browse open lobbies or enter a code</small></button>
        <button data-go="practice">Practice<small>Drive alone, no opponents</small></button>
        <button data-go="settings">Settings<small>Volume and music</small></button>
        <button data-go="howto">How to Play</button>
      </nav>`,
    host: () => `<h2>Host a lobby</h2>${trackPicker(track)}
      <div class="row"><span>Laps</span><button data-laps="-1" aria-label="Fewer laps">−</button><b class="laps">${laps}</b><button data-laps="1" aria-label="More laps">+</button></div>
      <label class="row check"><input type="checkbox" id="private" ${priv ? 'checked' : ''}> Private (join by code only)</label>
      <div class="actions"><button data-go="main">Back</button><button class="primary" data-start="host">Create lobby</button></div>`,
    join: () => `<h2>Join a lobby</h2>
      <div class="lobbies">${lobbies.length ? lobbies.map(l => {
        const m = l.metadata ?? {}, t = TRACKS[m.track ?? ''];
        return `<button class="lobby" data-room="${esc(l.roomId)}"><b>${esc(m.name ?? 'Lobby')}</b>
          <small>${esc(t?.name ?? '')} · ${m.laps ?? 3} laps · ${l.clients}/${l.maxClients} · ${m.phase === 'lobby' ? 'in lobby' : 'racing'}</small></button>`;
      }).join('') : '<p class="empty">No open lobbies right now. Host one, or try Quick Race.</p>'}</div>
      <form class="row code"><input id="code" placeholder="Room code" autocomplete="off" spellcheck="false" aria-label="Room code"><button class="primary">Join</button></form>
      <div class="actions"><button data-go="main">Back</button></div>`,
    practice: () => `<h2>Practice</h2>${trackPicker(track)}
      <div class="actions"><button data-go="main">Back</button><button class="primary" data-start="practice">Drive</button></div>`,
    settings: () => {
      const slider = (id: string, label: string, v: number) =>
        `<label class="row"><span>${label}</span><input type="range" id="${id}" min="0" max="100" step="5" value="${Math.round(v * 100)}"><output for="${id}">${Math.round(v * 100)}%</output></label>`;
      const px = pixelSize();
      const pixels = `<div class="row"><span>Pixels</span>${PIXEL_SIZES.map(v =>
        `<button data-pixel="${v}" class="${v === px ? 'on' : ''}" aria-pressed="${v === px}">${v ? `${v}×` : 'Off'}</button>`).join('')}</div>`;
      return `<h2>Settings</h2>${slider('volume', 'Volume', sound.volume)}${slider('musicVolume', 'Music', sound.musicVolume)}${pixels}
      <p class="hint">Pixels: a retro pixel filter with dithering, drawn at a half, third or quarter of the resolution (also faster).</p>
      <p class="hint">In a race, M mutes everything and K turns the music off.</p>
      <div class="actions"><button data-go="main">Back</button></div>`;
    },
    howto: () => `<h2>How to play</h2><dl class="keys">
      <dt>W A S D / arrows</dt><dd>Drive and steer</dd>
      <dt>Space / Shift</dt><dd>Drift — hold through a corner; sparks go blue → orange → purple; release to boost</dd>
      <dt>1 2 3 4</dt><dd>Cast Haste, Smite, Snare, Ward — they cost mana, which refills over time</dd>
      <dt>C</dt><dd>Look back</dd>
      <dt>M</dt><dd>Mute or unmute sound</dd>
      <dt>K</dt><dd>Music on or off</dd>
      <dt>Enter</dt><dd>Ready up in the lobby</dd>
      <dt>Esc</dt><dd>Back to this menu</dd></dl>
      <div class="actions"><button data-go="main">Back</button></div>`,
  };

  const draw = (screen: string) => {
    root.innerHTML = `<div class="panel">${screens[screen]()}</div>`;
    root.dataset.screen = screen;
  };
  /** Switch screens. The lobby list polls while it's open and redraws unless you're typing a code. */
  const render = (screen: string) => {
    clearInterval(refresh);
    draw(screen);
    if (screen !== 'join') return;
    const load = () => fetch(api('/api/rooms')).then(r => r.json()).then(d => {
      lobbies = d.rooms ?? [];
      if (root.dataset.screen === 'join' && document.activeElement?.id !== 'code') draw('join');
    }).catch(() => {});
    load();
    refresh = setInterval(load, 3000);
  };

  root.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'volume' || el.id === 'musicVolume') {
      sound.unlock();
      (el.id === 'volume' ? sound.setVolume : sound.setMusicVolume).call(sound, Number(el.value) / 100);
      el.nextElementSibling!.textContent = `${el.value}%`;
    }
    if ((e.target as HTMLElement).id === 'player') saveName(player());
    if ((e.target as HTMLElement).id === 'private') priv = (e.target as HTMLInputElement).checked;
  });
  const sound = new Sound();
  sound.setMusic('hymn'); // starts with the first click (browsers need a gesture first)
  root.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    sound.unlock();
    sound.click();
    if (b.dataset.go === 'quick') go({ quick: true, player: player() || undefined });
    else if (b.dataset.go) render(b.dataset.go);
    if (b.dataset.track) { track = b.dataset.track; showTrack(track); root.querySelectorAll('.track').forEach(t => t.classList.toggle('on', t === b)); }
    if (b.dataset.laps) { laps = Math.max(1, Math.min(9, laps + Number(b.dataset.laps))); root.querySelector('.laps')!.textContent = String(laps); }
    if (b.dataset.start === 'host') {
      const name = player();
      go({ host: true, track, laps, private: priv, player: name || undefined, lobby: name ? `${name}'s lobby` : undefined });
    }
    if (b.dataset.start === 'practice') go({ practice: true, track });
    if (b.dataset.pixel !== undefined) { setPixelSize(Number(b.dataset.pixel)); setPixels(Number(b.dataset.pixel)); render('settings'); }
    if (b.dataset.room) go({ join: b.dataset.room, player: player() || undefined });
  });
  // Letting go of the Volume slider plays a click at the new level (the music previews itself as you drag).
  root.addEventListener('change', e => { if ((e.target as HTMLElement).id === 'volume') sound.click(); });
  root.addEventListener('submit', e => {
    e.preventDefault();
    const code = root.querySelector<HTMLInputElement>('#code')!.value.trim();
    if (code) go({ join: code, player: player() || undefined });
  });
  render('main');
}
