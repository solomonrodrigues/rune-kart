import * as THREE from 'three';
import { Client, type Room } from 'colyseus.js';
import { PORT, ROOM_NAME } from 'shared/constants';
import { DT, KART, copyKart, driftTier, kartSpeed, newKart, type KartInput, type KartState } from 'shared/kart';
import { Predictor, type SeqInput } from 'shared/prediction';
import { createTrack, spawnPoint } from 'shared/track';
import { autopilot } from 'shared/race';
import { TRACKS, trackDef } from 'shared/tracks';
import { loadName, runMenu } from './menu';
import { KartModel } from './KartModel';
import { EffectsView } from './effects';
import { Sound } from './audio';
import { applyPixelSize, ditherLevels, ditherPass, pixelSize } from './pixel';
import { Minimap, type MapKart } from './minimap';
import { fxCamera } from './arcane';
import { deniedCast, renderSpells, setManaColour } from './spellUi';
import { MANA, NO_CAST, SPELLS, spawnEffect, stepEffects, type Effect } from 'shared/spells';
import { buildScene, MOON_DIR } from './scene';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { renderRace, type RaceView, type Standing } from './raceUi';

const hud = document.getElementById('hud')!;
const params = new URLSearchParams(location.search);
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// Which screen: the main menu (no params), practice (solo, no server), or an online lobby.
type Mode = 'menu' | 'practice' | 'quick' | 'host' | 'join';
const MODE: Mode = params.has('offline') || params.has('practice') ? 'practice'
  : params.has('host') ? 'host' : params.has('join') ? 'join'
  : params.has('quick') || params.has('autopilot') ? 'quick' : 'menu';
const OFFLINE = MODE === 'practice';
if (MODE === 'menu') {
  runMenu();
  await new Promise(() => {}); // the menu owns the page; choosing something navigates to a game URL
}

// Online: connect before building anything, because the room decides the track.
let joined: Room<any> | null = null;
if (!OFFLINE) {
  // Dev: Vite serves the page, so the game server is on its own port. Prod: same origin.
  const wsUrl = import.meta.env.DEV ? `ws://${location.hostname}:${PORT}` : location.origin.replace(/^http/, 'ws');
  const client = new Client(wsUrl);
  const opts = {
    player: params.get('player') || loadName() || undefined,
    track: params.get('track') ?? undefined, laps: Number(params.get('laps')) || undefined,
    lobby: params.get('lobby') ?? undefined, private: params.has('private'),
  };
  joined = await (MODE === 'host' ? client.create(ROOM_NAME, opts)
    : MODE === 'join' ? client.joinById(params.get('join')!, opts)
    : client.joinOrCreate(ROOM_NAME, opts)).catch(err => {
    hud.innerHTML = `Couldn’t join: ${esc(err.message ?? String(err))}. <a href="/">Back to the menu</a>`;
    throw err;
  });
  // The address bar now holds a link to this room: refresh to rejoin, or send it to a friend.
  history.replaceState(null, '', `?join=${joined.roomId}${params.has('autopilot') ? '&autopilot' : ''}`);
  await new Promise<void>(r => { const c = () => (joined!.state.track ? r() : joined!.onStateChange.once(c)); c(); });
}
addEventListener('keydown', e => { if (e.code === 'Escape') { joined?.leave(); location.search = ''; } });

// --- Renderer / scene ---
// No canvas MSAA: everything goes through the composer below, which antialiases with FXAA instead.
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
// Retina at 2× is ~78% more pixels than 1.5× for little visible gain on a low-poly game. With the pixel
// filter (Settings) it draws at a fraction of that and the canvas scales up with hard pixels instead.
const PIXEL = pixelSize();
applyPixelSize(renderer, PIXEL);
renderer.shadowMap.enabled = true;
renderer.localClippingEnabled = true; // mana tanks clip their liquid to the mana level
document.body.appendChild(renderer.domElement);

const track = createTrack(trackDef(joined ? joined.state.track : params.get('track')));
const { scene, sun, update: updateScene, setBloodMoon } = buildScene(track);
const effects = new EffectsView(scene);
const minimap = new Minimap(track);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
// Bloom makes the bright, unlit things (runes, crystals, spells, the moon) glow against the dark.
// Half-float target so over-bright colours survive into the bloom. No MSAA on it: measured at 2400×1500,
// 4× MSAA cost ~8 ms a frame; FXAA at the end gives near the same edges for ~0.5 ms.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.45, 0.55)); // strength, radius, threshold
composer.addPass(new OutputPass());
if (PIXEL) composer.addPass(ditherPass(ditherLevels(PIXEL)));
const fxaa = new ShaderPass(FXAAShader); // after OutputPass: FXAA expects display (sRGB) colours
fxaa.enabled = !PIXEL; // smoothing would only blur the pixels
composer.addPass(fxaa);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  const pr = renderer.getPixelRatio();
  fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Input ---
const keys = new Set<string>();
addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
// Sound starts on the first key press or click (browser autoplay rules); M toggles mute, K the music.
const sound = new Sound();
for (const ev of ['keydown', 'pointerdown'] as const) addEventListener(ev, sound.unlock);
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'KeyM') sound.toggleMute();
  if (e.code === 'KeyK') sound.toggleMusic();
});
// Casts are edge-triggered: a key press queues one cast for the next physics step.
let pendingCast = NO_CAST;
addEventListener('keydown', e => {
  const slot = Number(e.key) - 1;
  if (!e.repeat && Number.isInteger(slot) && slot >= 0 && slot < SPELLS.length) pendingCast = slot;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const axis = (neg: string[], pos: string[]) =>
  (pos.some(k => keys.has(k)) ? 1 : 0) - (neg.some(k => keys.has(k)) ? 1 : 0);
const readInput = (): KartInput => ({
  steer: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
  throttle: axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
  drift: keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight'),
});

// --- Karts on screen ---
const view = newKart({ x: 0, y: 0, z: 0, yaw: 0 }); // scratch: the blended state we render
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function lerpKart(out: KartState, a: KartState, b: KartState, t: number): KartState {
  copyKart(out, b);
  for (const f of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'vx', 'vy', 'vz'] as const) out[f] = a[f] + (b[f] - a[f]) * t;
  out.yaw = a.yaw + wrap(b.yaw - a.yaw) * t;
  return out;
}

// Remote karts are drawn INTERP_DELAY in the past, between the two snapshots that bracket that moment,
// so patch jitter never shows. If snapshots stop arriving, extrapolate briefly on velocity.
const INTERP_DELAY = 100;
const MAX_EXTRAPOLATE = 0.1;
interface Remote { snaps: { t: number; s: KartState }[]; model: KartModel; color: number }
const remotes = new Map<string, Remote>();

function sampleRemote(r: Remote, t: number): KartState {
  const snaps = r.snaps;
  while (snaps.length > 2 && snaps[1].t <= t) snaps.shift(); // keep the pair that brackets t
  const a = snaps[0], b = snaps[1];
  if (!b || t <= a.t) {
    const ahead = Math.min(MAX_EXTRAPOLATE, Math.max(0, (t - a.t) / 1000));
    copyKart(view, a.s);
    view.x += a.s.vx * ahead; view.y += a.s.vy * ahead; view.z += a.s.vz * ahead;
    return view;
  }
  if (t >= b.t) {
    copyKart(view, b.s);
    const ahead = Math.min(MAX_EXTRAPOLATE, (t - b.t) / 1000);
    view.x += b.s.vx * ahead; view.y += b.s.vy * ahead; view.z += b.s.vz * ahead;
    return view;
  }
  return lerpKart(view, a.s, b.s, (t - a.t) / (b.t - a.t));
}

// --- Local kart: predicted every fixed step, reconciled against the server when online ---
// ?lag=ms simulates a round trip on localhost: half on the way out, half on the way back.
const LAG = Math.max(0, Number(params.get('lag')) || 0);
// ?autopilot drives for you the whole time — for testing races solo.
const AUTOPILOT = params.has('autopilot');
const delayed = (fn: () => void) => (LAG ? setTimeout(fn, LAG / 2) : fn());

let notice = ''; // shown above the HUD, e.g. on disconnect
let race: RaceView | null = null; // latest race state (online only)
let myId = '';
let joinHint = '';
let send = (_: SeqInput) => {};
let start: KartState = newKart(spawnPoint(track, 0));
let myColor = 0xe84a3c;
let onServerState = (_: KartState, __: number) => {};

if (!OFFLINE) {
  const room = joined!;
  let connected = true;
  room.onLeave(() => { connected = false; notice = 'Disconnected from server — reload to rejoin.<br>'; });
  myId = room.sessionId;
  // Hosting on this machine: show the LAN address friends can join at.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const base = import.meta.env.DEV ? `http://${location.hostname}:${PORT}` : '';
    fetch(`${base}/api/server-info`).then(r => r.json()).then(({ addresses }: { addresses: string[] }) => {
      if (addresses.length) joinHint = `Friends join at ${addresses.join(' or ')}`;
    }).catch(() => {});
  }
  addEventListener('keydown', e => {
    const me = race?.standings.find(s => s.id === myId);
    if (e.code === 'Enter' && race?.phase === 'lobby' && connected) room.send('ready', !me?.ready);
    // Host controls (the server ignores them from anyone else): bots and laps.
    if ((e.code === 'KeyB' || e.code === 'KeyN') && !e.repeat && race?.phase === 'lobby' && connected) room.send('bots', e.code === 'KeyB' ? 1 : -1);
    if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.repeat && race?.phase === 'lobby' && connected) room.send('laps', e.code === 'BracketRight' ? 1 : -1);
  });
  send = input => delayed(() => { if (connected) room.send('input', input); });

  // Wait for our kart so prediction starts from the server's spawn.
  const mine = await new Promise<any>(resolve => {
    const check = () => { const k = room.state.karts?.get(room.sessionId); if (k) resolve(k); else room.onStateChange.once(check); };
    check();
  });
  start = copyKart(newKart(mine), mine);
  myColor = mine.color;

  room.onStateChange(state => {
    // Copy out now (the live state keeps changing), deliver after the simulated lag.
    const snap: [string, KartState, number, number][] = [];
    const standings: Standing[] = [];
    state.karts.forEach((k: any, id: string) => {
      snap.push([id, copyKart(newKart(k), k), k.ack, k.color]);
      standings.push({ id, color: k.color, place: k.place, finishTime: k.finishTime, lap: k.lap, racing: k.racing, ready: k.ready, bot: k.bot, name: k.name });
    });
    const view = { phase: state.phase, timer: state.timer, laps: state.laps, standings, host: state.host, trackName: TRACKS[state.track]?.name ?? '', code: room.roomId };
    const fx: Effect[] = [];
    state.effects.forEach((e: any) => fx.push({ id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, z: e.z, vx: e.vx, vz: e.vz, age: e.age, target: e.target }));
    delayed(() => {
      const now = performance.now();
      race = { ...view, at: now };
      effects.set(fx, now);
      for (const [id, s, ack, color] of snap) {
        if (id === room.sessionId) { onServerState(s, ack); continue; }
        let r = remotes.get(id);
        if (!r) {
          r = { snaps: [], model: new KartModel(color), color };
          scene.add(r.model.root, r.model.fx);
          remotes.set(id, r);
        }
        r.snaps.push({ t: now, s });
      }
      for (const [id, r] of remotes) {
        if (!snap.some(([sid]) => sid === id)) { scene.remove(r.model.root, r.model.fx); r.model.dispose(); remotes.delete(id); }
      }
    });
  });
}

const predictor = new Predictor(start, track);
// Offline there's no server, so smites and snares are simulated here (you can trip your own snares).
const offlineFx: Effect[] = [];
let offlineFxId = 1;
const local = predictor.state;
const localPrev = copyKart(newKart(local), local); // state one step back, for render interpolation
const localView = newKart(local); // scratch: the local kart as drawn
const localModel = new KartModel(myColor, true); // local: no lamps or beams shining back at your camera
setManaColour(myColor); // your orb matches your kart's tank
scene.add(localModel.root, localModel.fx);
// A real headlight for your own kart only: it lights walls and trees, and one fixed light keeps shaders cheap
// (every kart still gets glowing lamps).
const headlight = new THREE.SpotLight(0xffe2b0, 45, 50, 0.55, 0.9, 1.3); // soft-edged so it blends with the beams
// Mounted ahead of the ram and horns: a spot right next to the kart lights its own parts blindingly bright
// when the body slides mid-drift.
headlight.position.set(0, 0.8, 2.2);
headlight.target.position.set(0, 0, 15);
localModel.root.add(headlight, headlight.target);
// Visual-only offset that absorbs reconciliation corrections and decays to zero.
const correction = { x: 0, y: 0, z: 0, yaw: 0 };
const SNAP_DISTANCE = 4; // bigger corrections (respawns, big bumps) are applied immediately

onServerState = (server, ack) => {
  const err = predictor.reconcile(server, ack);
  if (Math.hypot(err.x, err.y, err.z) > SNAP_DISTANCE) return;
  correction.x += err.x; correction.y += err.y; correction.z += err.z; correction.yaw += wrap(err.yaw);
  // Shift the previous step too, so render interpolation doesn't see a jump.
  localPrev.x -= err.x; localPrev.y -= err.y; localPrev.z -= err.z; localPrev.yaw -= err.yaw;
};

// Live tuning/debugging from the console, e.g. KART.maxSpeed = 35
Object.assign(window, { KART, MANA, me: local, correction, predictor, debug: { renderer, composer, scene, sun, headlight, sound } });

// --- Camera ---
let camYaw = local.yaw;
let finishCam = 0; // 0 normal chase cam → 1 swung round to the front after you finish
const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3(), focus = new THREE.Vector3();

let lastTier = 0, lastBoost = 0, lastStun = 0, lastRescue = 0, lastHeld = 0;
effects.onImpact = p => sound.impact(p.distanceTo(camera.position));

// Race sounds: countdown beeps and GO, a chime each lap (a flourish for the last), a fanfare at the finish.
let lastPhase = '', lastCount = 0, lastLapHeard = 0, finishedHeard = false;
function raceSounds(now: number) {
  if (!race) return;
  const me = race.standings.find(s => s.id === myId);
  if (race.phase === 'countdown') {
    const n = Math.ceil(Math.max(0, race.timer - (now - race.at) / 1000));
    if (n !== lastCount && n > 0) sound.countdown(false);
    lastCount = n;
  }
  if (race.phase === 'racing' && lastPhase === 'countdown') sound.countdown(true);
  if (race.phase === 'racing' && me?.racing) {
    if (lastLapHeard && me.lap > lastLapHeard && me.finishTime < 0) sound.lap(me.lap === race.laps);
    lastLapHeard = me.lap;
    if (me.finishTime >= 0 && !finishedHeard) { sound.finish(); finishedHeard = true; }
  } else {
    lastLapHeard = 0;
    if (race.phase !== 'results') finishedHeard = false;
  }
  lastPhase = race.phase;
}

let acc = 0;
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Frozen on the grid during the countdown (the server enforces this too).
  const frozen = race?.phase === 'countdown';
  // Like Mario Kart: once you've crossed the line, the kart drives itself while the others finish.
  const mine = race?.standings.find(s => s.id === myId);
  const finished = !!mine?.racing && mine.finishTime >= 0 && (race?.phase === 'racing' || race?.phase === 'results');
  const input = frozen ? { steer: 0, throttle: 0, drift: false }
    : finished || AUTOPILOT ? { ...autopilot(track, local), throttle: finished ? 0.7 : 1 } // a relaxed victory lap
    : readInput();
  finishCam = finished ? Math.min(1, finishCam + dt / 1.6) : 0;

  acc = Math.min(acc + dt, 0.25);
  while (acc >= DT) {
    copyKart(localPrev, local);
    const tried = frozen ? NO_CAST : pendingCast;
    send(predictor.step({ ...input, cast: tried }));
    pendingCast = NO_CAST;
    const spell = predictor.lastCast;
    if (tried !== NO_CAST && !spell) { deniedCast(tried); sound.denied(); }
    if (spell) sound.spell(spell.id);
    // A sudden loss of speed in one step (not from a spin-out) is a wall or a kart: thud.
    const before = Math.hypot(localPrev.vx, localPrev.vz), after = Math.hypot(local.vx, local.vz);
    if (before - after > 5 && local.stunTime <= 0) sound.wallHit(before - after);
    if (spell) {
      effects.burst(local.x, local.y, local.z, spell.color);
      const e = OFFLINE && spawnEffect(offlineFxId++, spell, 'local', local);
      if (e) offlineFx.push(e);
    }
    if (OFFLINE) {
      const dead = stepEffects(offlineFx, [['local', local]], track, DT);
      if (dead.size) offlineFx.splice(0, offlineFx.length, ...offlineFx.filter(e => !dead.has(e)));
      effects.set(offlineFx, now);
    }
    acc -= DT;
  }

  // Sounds driven by state changes (these can also arrive from the server: a stun, a server-side bump).
  const tierNow = local.driftDir ? driftTier(local) : 0;
  if (tierNow > lastTier) sound.driftTier(tierNow);
  if (local.boostTime > lastBoost + 0.05) sound.boost(local.boostTier); // any boost: drift tier or Haste (0)
  if (local.stunTime > 0 && lastStun <= 0) sound.hit();
  if (local.rescue > 0 && lastRescue <= 0) sound.rescue(); // the crows have you
  if (local.driftHeld && !lastHeld && local.grounded) sound.hop(); // the drift hop (KartModel draws it)
  lastTier = tierNow; lastBoost = local.boostTime; lastStun = local.stunTime; lastRescue = local.rescue; lastHeld = local.driftHeld;
  sound.drive(kartSpeed(local), input.throttle, local.boostTime > 0, !!local.driftDir);
  raceSounds(now);

  const decay = Math.exp(-dt / 0.1);
  correction.x *= decay; correction.y *= decay; correction.z *= decay; correction.yaw *= decay;
  const k = lerpKart(localView, localPrev, local, acc / DT);
  k.x += correction.x; k.y += correction.y; k.z += correction.z; k.yaw += correction.yaw;
  fxCamera.copy(camera.position); // wisp ribbons face the camera (last frame's position is close enough)
  localModel.update(k, dt, now / 1000);
  effects.update(now, dt, camera.position);
  renderSpells(local);

  const renderT = now - INTERP_DELAY;
  const mapKarts: MapKart[] = [{ x: k.x, z: k.z, yaw: k.yaw, color: myColor, me: true }];
  for (const r of remotes.values()) {
    const s = sampleRemote(r, renderT);
    mapKarts.push({ x: s.x, z: s.z, yaw: s.yaw, color: r.color, me: false });
    r.model.update(s, dt, now / 1000);
  }
  minimap.draw(mapKarts);

  const speed = kartSpeed(k);
  // Lag the camera's heading behind the kart's, more so mid-drift so the slide reads.
  const rate = k.driftDir ? 3 : 6;
  camYaw += wrap(k.yaw - camYaw) * (1 - Math.exp(-rate * dt));
  const dist = 6.5 + Math.max(0, speed) * 0.06;
  if (finishCam > 0) {
    // Finished: swing round from behind to a front view of you cruising, like Mario Kart's finish camera.
    const swing = Math.PI * finishCam * finishCam * (3 - 2 * finishCam); // smoothstep 0 → π
    const r = 6.5 - finishCam * 0.8, h = 2.8 - finishCam * 1.1;
    // Placed directly (no positional smoothing): the kart drives at the camera, so a lagging follow would
    // let it close in. The swing and camYaw are already smooth.
    camera.position.set(k.x - Math.sin(camYaw + swing) * r, k.y + h, k.z - Math.cos(camYaw + swing) * r);
    camera.lookAt(k.x, k.y + 1.1, k.z);
  } else if (keys.has('KeyC')) {
    // Look back: hard cut to a camera in front of the kart, facing the driver and whoever's behind.
    camera.position.set(k.x + Math.sin(k.yaw) * 5, k.y + 2.2, k.z + Math.cos(k.yaw) * 5);
    camera.lookAt(k.x, k.y + 1.2, k.z);
  } else {
    camPos.set(k.x - Math.sin(camYaw) * dist, k.y + 2.8, k.z - Math.cos(camYaw) * dist);
    // Snap back after a look-back instead of swinging through the kart.
    if (camera.position.distanceToSquared(camPos) > 64) camera.position.copy(camPos);
    camera.position.lerp(camPos, 1 - Math.exp(-12 * dt));
    lookAt.set(k.x + Math.sin(camYaw) * 4, k.y + 1, k.z + Math.cos(camYaw) * 4);
    camera.lookAt(lookAt);
  }
  const fov = 70 + Math.max(0, speed - KART.maxSpeed * 0.5) * 0.4 + (k.boostTime > 0 ? 8 : 0);
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
  camera.updateProjectionMatrix();

  // Moonlight comes from where the moon is in the sky, centred on the player for sharp shadows.
  sun.position.set(k.x + MOON_DIR.x * 70, k.y + MOON_DIR.y * 70, k.z + MOON_DIR.z * 70);
  sun.target.position.set(k.x, k.y, k.z);
  focus.set(k.x, k.y, k.z);
  // The blood moon rises once anyone reaches the final lap, and sets when the race ends; the music follows:
  // the Hymn in the lobby, the Gallop from GO (and in practice), Blood Moon on the final lap, a Requiem at the end.
  const finalLap = race?.phase === 'racing' && race.standings.some(s => s.racing && s.lap >= race!.laps);
  setBloodMoon(finalLap);
  sound.setMusic(!race ? 'gallop' : race.phase === 'racing' ? (finalLap ? 'blood' : 'gallop') : race.phase === 'results' ? 'requiem' : 'hymn');
  updateScene(camera, focus, dt, now / 1000);

  const tier = driftTier(k);
  const racers = remotes.size + 1;
  const raceLine = renderRace(race, myId, now, joinHint);
  hud.innerHTML = notice + (raceLine ? `<b>${raceLine}</b><br>` : '') +
    `<b>${Math.round(Math.abs(speed) * 3.6)}</b> km/h` +
    (k.driftDir ? ` · drift ${'●'.repeat(tier)}${'○'.repeat(3 - tier)}` : '') +
    (k.boostTime > 0 ? ' · BOOST' : '') +
    `<br><small>${OFFLINE ? 'offline' : `${racers} racer${racers === 1 ? '' : 's'}${LAG ? ` · lag ${LAG}ms` : ''}`} · WASD drive · Space/Shift drift · 1–4 spells · C look back · M mute · K music · Esc menu</small>`;
  composer.render(dt);
});
