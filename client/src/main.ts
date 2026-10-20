import * as THREE from 'three';
import { Client } from 'colyseus.js';
import { PORT, ROOM_NAME } from 'shared/constants';
import { DT, KART, copyKart, driftTier, kartSpeed, newKart, type KartInput, type KartState } from 'shared/kart';
import { Predictor, type SeqInput } from 'shared/prediction';
import { createTrack, spawnPoint } from 'shared/track';
import { GREYBOX } from 'shared/tracks';
import { KartModel } from './KartModel';
import { EffectsView } from './effects';
import { renderSpells } from './spellUi';
import { NO_CAST, SPELLS, spawnEffect, stepEffects, type Effect } from 'shared/spells';
import { buildScene, MOON_DIR } from './scene';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { renderRace, type RaceView, type Standing } from './raceUi';

const OFFLINE = new URLSearchParams(location.search).has('offline');
const hud = document.getElementById('hud')!;

// --- Renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const track = createTrack(GREYBOX);
const { scene, sun, update: updateScene } = buildScene(track);
const effects = new EffectsView(scene);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
// Bloom makes the bright, unlit things (runes, crystals, spells, the moon) glow against the dark.
// A multisampled target keeps the antialiasing the plain renderer had.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.45, 0.55)); // strength, radius, threshold
composer.addPass(new OutputPass());
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Input ---
const keys = new Set<string>();
addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
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
interface Remote { snaps: { t: number; s: KartState }[]; model: KartModel }
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
const params = new URLSearchParams(location.search);
// ?lag=ms simulates a round trip on localhost: half on the way out, half on the way back.
const LAG = Math.max(0, Number(params.get('lag')) || 0);
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
  // Dev: Vite serves the page, so the game server is on its own port. Prod: same origin.
  const wsUrl = import.meta.env.DEV ? `ws://${location.hostname}:${PORT}` : location.origin.replace(/^http/, 'ws');
  const room = await new Client(wsUrl).joinOrCreate<any>(ROOM_NAME).catch(err => {
    hud.textContent = `Could not connect to ${wsUrl}: ${err.message ?? err}. Add ?offline to drive solo.`;
    throw err;
  });
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
      standings.push({ id, color: k.color, place: k.place, finishTime: k.finishTime, lap: k.lap, racing: k.racing, ready: k.ready });
    });
    const view = { phase: state.phase, timer: state.timer, laps: state.laps, standings };
    const fx: Effect[] = [];
    state.effects.forEach((e: any) => fx.push({ id: e.id, kind: e.kind, owner: e.owner, x: e.x, y: e.y, z: e.z, vx: e.vx, vz: e.vz, age: e.age }));
    delayed(() => {
      const now = performance.now();
      race = { ...view, at: now };
      effects.set(fx, now);
      for (const [id, s, ack, color] of snap) {
        if (id === room.sessionId) { onServerState(s, ack); continue; }
        let r = remotes.get(id);
        if (!r) {
          r = { snaps: [], model: new KartModel(color) };
          scene.add(r.model.root);
          remotes.set(id, r);
        }
        r.snaps.push({ t: now, s });
      }
      for (const [id, r] of remotes) {
        if (!snap.some(([sid]) => sid === id)) { scene.remove(r.model.root); r.model.dispose(); remotes.delete(id); }
      }
    });
  });
}

const predictor = new Predictor(start, track);
// Offline there's no server, so bolts and runes are simulated here (you can trip your own runes).
const offlineFx: Effect[] = [];
let offlineFxId = 1;
const local = predictor.state;
const localPrev = copyKart(newKart(local), local); // state one step back, for render interpolation
const localView = newKart(local); // scratch: the local kart as drawn
const localModel = new KartModel(myColor, false);
scene.add(localModel.root);
// A real headlight for your own kart only: it lights walls and trees, and one fixed light keeps shaders cheap
// (every kart still gets glowing lamps).
const headlight = new THREE.SpotLight(0xffe2b0, 45, 50, 0.55, 0.9, 1.3); // soft-edged so it blends with the beams
headlight.position.set(0, 0.8, 1.2);
headlight.target.position.set(0, 0, 14);
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
Object.assign(window, { KART, me: local, correction, predictor });

// --- Camera ---
let camYaw = local.yaw;
const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3(), focus = new THREE.Vector3();

let acc = 0;
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Frozen on the grid during the countdown (the server enforces this too).
  const frozen = race?.phase === 'countdown';
  const input = frozen ? { steer: 0, throttle: 0, drift: false } : readInput();

  acc = Math.min(acc + dt, 0.25);
  while (acc >= DT) {
    copyKart(localPrev, local);
    send(predictor.step({ ...input, cast: frozen ? NO_CAST : pendingCast }));
    pendingCast = NO_CAST;
    const spell = predictor.lastCast;
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

  const decay = Math.exp(-dt / 0.1);
  correction.x *= decay; correction.y *= decay; correction.z *= decay; correction.yaw *= decay;
  const k = lerpKart(localView, localPrev, local, acc / DT);
  k.x += correction.x; k.y += correction.y; k.z += correction.z; k.yaw += correction.yaw;
  localModel.update(k, dt, now / 1000);
  effects.update(now, dt);
  renderSpells(local);

  const renderT = now - INTERP_DELAY;
  for (const r of remotes.values()) r.model.update(sampleRemote(r, renderT), dt, now / 1000);

  const speed = kartSpeed(k);
  // Lag the camera's heading behind the kart's, more so mid-drift so the slide reads.
  const rate = k.driftDir ? 3 : 6;
  camYaw += wrap(k.yaw - camYaw) * (1 - Math.exp(-rate * dt));
  const dist = 6.5 + Math.max(0, speed) * 0.06;
  if (keys.has('KeyC')) {
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
  updateScene(camera, focus, dt, now / 1000);

  const tier = driftTier(k);
  const racers = remotes.size + 1;
  const raceLine = renderRace(race, myId, now, joinHint);
  hud.innerHTML = notice + (raceLine ? `<b>${raceLine}</b><br>` : '') +
    `<b>${Math.round(Math.abs(speed) * 3.6)}</b> km/h` +
    (k.driftDir ? ` · drift ${'●'.repeat(tier)}${'○'.repeat(3 - tier)}` : '') +
    (k.boostTime > 0 ? ' · BOOST' : '') +
    `<br><small>${OFFLINE ? 'offline' : `${racers} racer${racers === 1 ? '' : 's'}${LAG ? ` · lag ${LAG}ms` : ''}`} · WASD drive · Space/Shift drift · 1–4 spells · C look back</small>`;
  composer.render(dt);
});
