import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from 'shared/track';
import { buildMountains } from './mountains';

// Dark fantasy palette: a moonlit dusk, cold stone, and runes and crystals that glow (bloom picks them up).
const HORIZON = 0x3a2846;
const ZENITH = 0x080a1a;
const FOG = 0x2a2136;
const RUNE = 0xa77bff;
const CRYSTAL = 0x5ff0d0;
/** Where the moon (and its light) sits relative to the player. */
export const MOON_DIR = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();

const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

/** Sky, lights, track meshes and scattered low-poly scenery (visual only — no collision). */
export function buildScene(track: Track) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(ZENITH);
  scene.fog = new THREE.Fog(FOG, 50, 240);

  // --- Sky: a gradient dome with a moon and stars that travels with the camera ---
  const sky = new THREE.Group();
  const domeGeo = new THREE.SphereGeometry(500, 24, 12);
  const top = new THREE.Color(ZENITH), bottom = new THREE.Color(HORIZON), c = new THREE.Color();
  const dp = domeGeo.attributes.position;
  const domeCol: number[] = [];
  for (let i = 0; i < dp.count; i++) {
    c.lerpColors(bottom, top, Math.min(1, Math.max(0, dp.getY(i) / 500) ** 0.6));
    domeCol.push(c.r, c.g, c.b);
  }
  domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(domeCol, 3));
  sky.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(16, 1), new THREE.MeshBasicMaterial({ color: 0xe6e9ff, fog: false }));
  moon.position.copy(MOON_DIR).multiplyScalar(450);
  sky.add(moon);
  let seed = 4242;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars: number[] = [];
  for (let i = 0; i < 700; i++) {
    const a = rand() * Math.PI * 2, y = 0.08 + rand() * 0.92, r = Math.sqrt(1 - y * y);
    stars.push(Math.cos(a) * r * 480, y * 480, Math.sin(a) * r * 480);
  }
  const starGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
  sky.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd6ff, size: 1.6, sizeAttenuation: false, fog: false })));
  sky.add(buildMountains(rand));
  sky.renderOrder = -1;
  scene.add(sky);

  // --- Light: dim violet ambience and cold moonlight (it follows the player so shadows stay sharp) ---
  scene.add(new THREE.HemisphereLight(0x6a5c9e, 0x1a1d14, 1.0));
  const sun = new THREE.DirectionalLight(0xb4c2ff, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 150 });
  scene.add(sun, sun.target);

  // --- Track ---
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const vcol = (side: THREE.Side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side });
  // The track's vertex colours are authored as sRGB; three.js treats vertex colours as linear, so convert.
  const c2 = new THREE.Color();
  for (const geo of [track.road, track.walls, track.trim]) {
    const col = geo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      c2.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace);
      col.setXYZ(i, c2.r, c2.g, c2.b);
    }
  }
  mesh(track.road, vcol());
  mesh(track.walls, vcol(THREE.DoubleSide)).castShadow = true;
  mesh(track.trim, vcol(THREE.DoubleSide));
  mesh(track.ground, flat(0x34452b));

  const { samples, def } = track;
  const half = def.width / 2;
  const right = (s: { yaw: number }) => new THREE.Vector3(-Math.cos(s.yaw), 0, Math.sin(s.yaw));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);

  // Glowing runes set into the inside face of the outer wall.
  const runeSlots = samples.filter((_, i) => i % 6 === 3);
  const runes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.45, 0.9), glow(RUNE), runeSlots.length);
  runeSlots.forEach((s, i) => {
    const r = right(s).multiplyScalar(track.outer * (half - 0.05));
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
    runes.setMatrixAt(i, m.compose(p.set(s.x + r.x, s.y + 0.9, s.z + r.z), q, sc));
  });
  scene.add(runes);

  // Start: a glowing rune line across the road under a stone arch.
  const s0 = samples[0], r0 = right(s0);
  q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s0.yaw);
  const line = new THREE.Mesh(new THREE.BoxGeometry(def.width, 0.04, 0.8), glow(RUNE));
  line.position.set(s0.x, s0.y + 0.03, s0.z);
  line.quaternion.copy(q);
  scene.add(line);
  const stone = flat(0x3b3843);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 9, 1.1), stone);
    pillar.position.set(s0.x + r0.x * side * (half + 1.2), s0.y + 4.5, s0.z + r0.z * side * (half + 1.2));
    pillar.quaternion.copy(q);
    pillar.castShadow = true;
    scene.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(def.width + 5, 1.4, 1.8), stone);
  lintel.position.set(s0.x, s0.y + 9.4, s0.z);
  lintel.quaternion.copy(q);
  lintel.castShadow = true;
  const lintelRunes = new THREE.Mesh(new THREE.BoxGeometry(def.width - 1, 0.35, 1.84), glow(RUNE));
  lintelRunes.position.copy(lintel.position);
  lintelRunes.quaternion.copy(q);
  scene.add(lintel, lintelRunes);

  // --- Scenery, scattered deterministically so every client sees the same world ---
  const clearance = half + 5;
  const nearRoad = (x: number, z: number) => samples.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < clearance * clearance);

  const pine = mergeGeometries([
    new THREE.CylinderGeometry(0.25, 0.35, 2, 5).translate(0, 1, 0),
    new THREE.ConeGeometry(1.8, 3.2, 6).translate(0, 3.2, 0),
    new THREE.ConeGeometry(1.3, 2.6, 6).translate(0, 4.8, 0),
  ].map(g => g.toNonIndexed()));
  const branch = (len: number, tiltZ: number, tiltX: number, y: number) =>
    new THREE.CylinderGeometry(0.06, 0.14, len, 4).translate(0, len / 2, 0).rotateZ(tiltZ).rotateX(tiltX).translate(0, y, 0);
  const deadTree = mergeGeometries([
    new THREE.CylinderGeometry(0.18, 0.4, 4.5, 5).translate(0, 2.25, 0).rotateZ(0.08),
    branch(2.2, 0.9, 0.2, 2.6), branch(1.8, -1.0, -0.3, 3.2), branch(1.5, 0.3, 0.9, 3.8), branch(1.2, -0.4, -1.0, 4.1),
  ].map(g => g.toNonIndexed()));
  const standing = new THREE.BoxGeometry(1, 4.2, 0.7).translate(0, 2.0, 0);
  const standingRune = new THREE.BoxGeometry(0.35, 1.6, 0.74).translate(0, 2.3, 0);
  const crystal = new THREE.OctahedronGeometry(0.6, 0).scale(1, 2.6, 1);
  const rock = new THREE.DodecahedronGeometry(1.4, 0);

  const kinds = {
    pine: new THREE.InstancedMesh(pine, flat(0x1b3530), 220),
    dead: new THREE.InstancedMesh(deadTree, flat(0x2f2628), 90),
    rock: new THREE.InstancedMesh(rock, flat(0x45434d), 160),
    stone: new THREE.InstancedMesh(standing, flat(0x3b3843), 40),
    stoneRune: new THREE.InstancedMesh(standingRune, glow(RUNE), 40),
    crystal: new THREE.InstancedMesh(crystal, glow(CRYSTAL), 120),
  };
  const count = Object.fromEntries(Object.keys(kinds).map(k => [k, 0])) as Record<keyof typeof kinds, number>;
  const place = (k: keyof typeof kinds, matrix: THREE.Matrix4) => {
    if (count[k] >= kinds[k].instanceMatrix.count) return false;
    kinds[k].setMatrixAt(count[k]++, matrix);
    return true;
  };
  // Scatter over the track's own area plus a margin, so every track gets a full forest.
  const xs = samples.map(s => s.x), zs = samples.map(s => s.z), M = 110;
  const bx0 = Math.min(...xs) - M, bx1 = Math.max(...xs) + M, bz0 = Math.min(...zs) - M, bz1 = Math.max(...zs) + M;
  for (let i = 0; i < 4000; i++) {
    const x = bx0 + rand() * (bx1 - bx0), z = bz0 + rand() * (bz1 - bz0);
    if (nearRoad(x, z)) continue;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
    const roll = rand();
    const size = 0.7 + rand() * 0.8;
    m.compose(p.set(x, -0.1, z), q, sc.setScalar(size));
    if (roll < 0.45) place('pine', m);
    else if (roll < 0.62) place('dead', m);
    else if (roll < 0.82) place('rock', m);
    else if (roll < 0.9) { if (place('stone', m)) place('stoneRune', m); }
    else {
      // A small cluster of crystals leaning outwards.
      for (let j = 0; j < 3; j++) {
        const e = new THREE.Euler((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9);
        m.compose(p.set(x + (rand() - 0.5) * 1.6, 0.4, z + (rand() - 0.5) * 1.6), q.setFromEuler(e), sc.setScalar(0.5 + rand() * 0.7));
        place('crystal', m);
      }
    }
  }
  for (const [k, im] of Object.entries(kinds)) {
    im.count = count[k as keyof typeof kinds];
    im.castShadow = k !== 'crystal' && k !== 'stoneRune';
    scene.add(im);
  }

  // --- Drifting motes: embers and wisps that float up around the player ---
  const MOTES = 260, BOX = 60;
  const motePos = new Float32Array(MOTES * 3), moteCol = new Float32Array(MOTES * 3);
  const ember = new THREE.Color(0xffa25c), wisp = new THREE.Color(0xb59bff);
  for (let i = 0; i < MOTES; i++) {
    motePos.set([(rand() - 0.5) * BOX, rand() * 14, (rand() - 0.5) * BOX], i * 3);
    (rand() < 0.5 ? ember : wisp).toArray(moteCol, i * 3);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCol, 3));
  // A soft round dot, so motes read as glowing specks rather than squares.
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const g = dot.getContext('2d')!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.35, '#fffa'); grad.addColorStop(1, '#fff0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    size: 0.14, map: new THREE.CanvasTexture(dot), vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  motes.frustumCulled = false;
  scene.add(motes);

  /** Per frame: keep the sky centred on the camera and drift the motes around the player. */
  function update(camera: THREE.Camera, around: THREE.Vector3, dt: number, time: number) {
    sky.position.set(camera.position.x, 0, camera.position.z); // ground level, so a high camera (the menu) looks down on the mountains
    for (let i = 0; i < MOTES; i++) {
      const o = i * 3;
      motePos[o + 1] += dt * (0.4 + (i % 5) * 0.12);
      motePos[o] += Math.sin(time * 0.7 + i) * dt * 0.3;
      // Wrap into a box that follows the player, so there are always motes nearby.
      for (const [axis, centre, span] of [[0, around.x, BOX], [2, around.z, BOX]] as const) {
        const d = motePos[o + axis] - centre;
        if (d > span / 2) motePos[o + axis] -= span; else if (d < -span / 2) motePos[o + axis] += span;
      }
      if (motePos[o + 1] > around.y + 14) motePos[o + 1] = around.y;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  return { scene, sun, update };
}
