import * as THREE from 'three';
import { Client } from 'colyseus.js';
import { PORT, ROOM_NAME, TICK_HZ } from 'shared/constants';
import type { KartInput } from 'shared/kart';

const hud = document.getElementById('hud')!;

// --- Scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6d8);
scene.fog = new THREE.Fog(0x87b6d8, 60, 160);
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a6b3a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(30, 50, 20);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x5f9e4a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground, new THREE.GridHelper(200, 40, 0x3c6b2e, 0x3c6b2e));

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Input ---
const keys = new Set<string>();
addEventListener('keydown', e => keys.add(e.code));
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const axis = (neg: string[], pos: string[]) =>
  (pos.some(k => keys.has(k)) ? 1 : 0) - (neg.some(k => keys.has(k)) ? 1 : 0);
const readInput = (): KartInput => ({
  steer: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
  throttle: axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
});

// --- Network ---
// Dev: Vite serves the page, so the game server is on its own port. Prod: same origin.
const wsUrl = import.meta.env.DEV
  ? `ws://${location.hostname}:${PORT}`
  : location.origin.replace(/^http/, 'ws');
const room = await new Client(wsUrl).joinOrCreate<any>(ROOM_NAME).catch(err => {
  hud.textContent = `Could not connect to ${wsUrl}: ${err.message ?? err}`;
  throw err;
});
setInterval(() => room.send('input', readInput()), 1000 / TICK_HZ);

// --- Render ---
// shortcut: renders raw server state (snaps at patch rate); prediction + interpolation land in milestone 3.
const meshes = new Map<string, THREE.Mesh>();
const kartGeo = new THREE.BoxGeometry(1.4, 0.8, 2.2);
const camTarget = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const karts: Map<string, any> = room.state.karts;
  for (const [id, mesh] of meshes) {
    if (!karts.has(id)) { scene.remove(mesh); meshes.delete(id); }
  }
  karts.forEach((k, id) => {
    let mesh = meshes.get(id);
    if (!mesh) {
      mesh = new THREE.Mesh(kartGeo, new THREE.MeshLambertMaterial({ color: k.color }));
      scene.add(mesh);
      meshes.set(id, mesh);
    }
    mesh.position.set(k.x, 0.4, k.z);
    mesh.rotation.y = k.yaw;
  });

  const me = meshes.get(room.sessionId);
  if (me) {
    // Chase camera behind and above our kart.
    camTarget.set(-Math.sin(me.rotation.y) * 8, 4, -Math.cos(me.rotation.y) * 8).add(me.position);
    camera.position.lerp(camTarget, 0.1);
    camera.lookAt(me.position);
  }
  hud.textContent = `Rune Kart · ${karts.size} racer${karts.size === 1 ? '' : 's'} · WASD to drive`;
  renderer.render(scene, camera);
});
