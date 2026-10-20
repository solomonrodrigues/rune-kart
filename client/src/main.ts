import * as THREE from 'three';
import { Client } from 'colyseus.js';
import { PORT, ROOM_NAME } from 'shared/constants';
import { DT, KART, driftTier, kartSpeed, newKart, stepKart, type KartInput, type KartState } from 'shared/kart';
import { createTrack, spawnPoint } from 'shared/track';
import { GREYBOX } from 'shared/tracks';
import { KartModel } from './KartModel';
import { buildScene } from './scene';

const OFFLINE = new URLSearchParams(location.search).has('offline');
const hud = document.getElementById('hud')!;

// --- Renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const track = createTrack(GREYBOX);
const { scene, sun } = buildScene(track);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Input ---
const keys = new Set<string>();
addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const axis = (neg: string[], pos: string[]) =>
  (pos.some(k => keys.has(k)) ? 1 : 0) - (neg.some(k => keys.has(k)) ? 1 : 0);
const readInput = (): KartInput => ({
  steer: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
  throttle: axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
  drift: keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight'),
});

// --- Snapshot interpolation: every kart is drawn between its last two states ---
interface Interp { prev: KartState; curr: KartState; t0: number; t1: number; model: KartModel }
const karts = new Map<string, Interp>();
const view = newKart({ x: 0, y: 0, z: 0, yaw: 0 }); // scratch: the blended state we render
// Explicit field copy: Colyseus schema fields are accessors, so Object.assign/spread would miss them.
const FIELDS = Object.keys(view) as (keyof KartState)[];
const copy = (to: KartState, from: KartState) => { for (const f of FIELDS) to[f] = from[f]; return to; };

function push(id: string, s: KartState, t: number, color: number) {
  let e = karts.get(id);
  if (!e) {
    e = { prev: copy(newKart(s), s), curr: copy(newKart(s), s), t0: t, t1: t, model: new KartModel(color) };
    scene.add(e.model.root);
    karts.set(id, e);
  }
  copy(e.prev, e.curr);
  copy(e.curr, s);
  e.t0 = e.t1;
  e.t1 = t;
}

function blend(e: Interp, alpha: number): KartState {
  const a = e.prev, b = e.curr;
  copy(view, b);
  for (const f of ['x', 'y', 'z', 'nx', 'ny', 'nz', 'vx', 'vz'] as const) view[f] = a[f] + (b[f] - a[f]) * alpha;
  view.yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * alpha;
  return view;
}

// --- Simulation source: local (offline) or server snapshots (online) ---
let myId = 'local';
let banner = ''; // shown above the HUD, e.g. on disconnect
let sendInput = (_: KartInput) => {};
let simAlpha: (now: number) => number;

if (OFFLINE) {
  const me = newKart(spawnPoint(track, 0));
  let acc = 0, last = performance.now();
  push(myId, me, 0, 0xe84a3c);
  // Live tuning/debugging from the console, e.g. KART.maxSpeed = 35
  Object.assign(window, { KART, me });
  simAlpha = now => {
    acc = Math.min(acc + (now - last) / 1000, 0.25);
    last = now;
    while (acc >= DT) {
      stepKart(me, readInput(), track, DT);
      push(myId, me, 0, 0);
      acc -= DT;
    }
    return acc / DT;
  };
} else {
  // Dev: Vite serves the page, so the game server is on its own port. Prod: same origin.
  const wsUrl = import.meta.env.DEV ? `ws://${location.hostname}:${PORT}` : location.origin.replace(/^http/, 'ws');
  const room = await new Client(wsUrl).joinOrCreate<any>(ROOM_NAME).catch(err => {
    hud.textContent = `Could not connect to ${wsUrl}: ${err.message ?? err}. Add ?offline to drive solo.`;
    throw err;
  });
  myId = room.sessionId;
  let connected = true;
  room.onLeave(() => { connected = false; banner = 'Disconnected from server — reload to rejoin.<br>'; });
  sendInput = input => { if (connected) room.send('input', input); };
  room.onStateChange(state => {
    const now = performance.now();
    state.karts.forEach((k: any, id: string) => push(id, k, now, k.color));
    for (const [id, e] of karts) {
      if (!state.karts.has(id)) { scene.remove(e.model.root); e.model.dispose(); karts.delete(id); }
    }
  });
  // shortcut: draws remote state one patch behind (adds ~33ms to your own kart); milestone 3 predicts it.
  simAlpha = now => {
    const e = karts.get(myId);
    if (!e || e.t1 === e.t0) return 1;
    return Math.min(1, (now - e.t1) / (e.t1 - e.t0));
  };
}

if (!OFFLINE) setInterval(() => sendInput(readInput()), DT * 1000);

// --- Camera ---
let camYaw = 0, camInit = false;
const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3();

let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const alpha = simAlpha(now);
  const input = readInput();

  for (const [id, e] of karts) {
    // Remote karts each have their own patch timing; the local kart uses the sim's alpha.
    const a = id === myId ? alpha : e.t1 === e.t0 ? 1 : Math.min(1, (now - e.t1) / (e.t1 - e.t0));
    e.model.update(blend(e, a), id === myId ? input.steer : 0, dt, now / 1000);
  }

  const me = karts.get(myId);
  if (me) {
    const k = blend(me, alpha);
    const speed = kartSpeed(k);
    if (!camInit) { camYaw = k.yaw; camInit = true; }
    // Lag the camera's heading behind the kart's, more so mid-drift so the slide reads.
    const rate = k.driftDir ? 3 : 6;
    camYaw += Math.atan2(Math.sin(k.yaw - camYaw), Math.cos(k.yaw - camYaw)) * (1 - Math.exp(-rate * dt));
    const dist = 6.5 + Math.max(0, speed) * 0.06;
    camPos.set(k.x - Math.sin(camYaw) * dist, k.y + 2.8, k.z - Math.cos(camYaw) * dist);
    camera.position.lerp(camPos, 1 - Math.exp(-12 * dt));
    lookAt.set(k.x + Math.sin(camYaw) * 4, k.y + 1, k.z + Math.cos(camYaw) * 4);
    camera.lookAt(lookAt);
    const fov = 70 + Math.max(0, speed - KART.maxSpeed * 0.5) * 0.4 + (k.boostTime > 0 ? 8 : 0);
    camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
    camera.updateProjectionMatrix();

    sun.position.set(k.x + 30, k.y + 50, k.z + 20);
    sun.target.position.set(k.x, k.y, k.z);

    const tier = driftTier(k);
    hud.innerHTML = banner +
      `<b>${Math.round(Math.abs(speed) * 3.6)}</b> km/h` +
      (k.driftDir ? ` · drift ${'●'.repeat(tier)}${'○'.repeat(3 - tier)}` : '') +
      (k.boostTime > 0 ? ' · BOOST' : '') +
      `<br><small>${OFFLINE ? 'offline' : `${karts.size} racer${karts.size === 1 ? '' : 's'}`} · WASD drive · Space/Shift drift</small>`;
  }
  renderer.render(scene, camera);
});
