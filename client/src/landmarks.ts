// One landmark per track, placed from the track's own shape: a ruined watchtower by Moonlit Loop's raised hairpin,
// a ruined cathedral beside Hollow Crown's viaduct and a giant broken crown in its infield, and a colossal serpent
// skeleton arching over Serpent's Pass. Visual only — nothing collides, and nothing over the road comes within
// 5 m of it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from 'shared/track';
import { GREYBOX, HOLLOW, SERPENT } from 'shared/tracks';
import type { Reserved } from './dressing';

const flat = (color: number, side: THREE.Side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ color, flatShading: true, side });
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
const STONE = 0x3b3843, PALE = 0x4a4752, BONE = 0xbdb59a;
const CANDLE = 0xb8742e; // the castle's window light: just under the bloom threshold
const RUNE = 0xa77bff, CRYSTAL = 0x5ff0d0;
const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rz = 0) =>
  new THREE.BoxGeometry(w, h, d).rotateZ(rz).rotateY(ry).translate(x, y, z);
/** A bar from a to b (2D, in the XY plane at depth z), `t` thick. */
const strut = (ax: number, ay: number, bx: number, by: number, t: number, z: number, depth = t) =>
  new THREE.BoxGeometry(Math.hypot(bx - ax, by - ay), t, depth).rotateZ(Math.atan2(by - ay, bx - ax)).translate((ax + bx) / 2, (ay + by) / 2, z);

/** A group from (geometry, material) pairs, standing at (x, z) and turned `ry`. */
function assemble(parts: [THREE.BufferGeometry, THREE.Material][], x: number, z: number, ry: number, y = 0) {
  const g = new THREE.Group();
  for (const [geo, mat] of parts) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !(mat instanceof THREE.MeshBasicMaterial);
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.position.set(x, y, z);
  g.rotation.y = ry;
  return g;
}

/** The y-rotation that turns local +x to point along the road at `yaw` (forward is (sin yaw, cos yaw)). */
const alongRoad = (yaw: number) => yaw - Math.PI / 2;

// --- Moonlit Loop: a leaning ruined watchtower, broken at the top, a few windows still lit ---
function watchtower() {
  const stone: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(3.2, 3.6, 16, 8).translate(0, 8, 0),
    new THREE.CylinderGeometry(3.55, 3.55, 0.5, 8).translate(0, 11.5, 0), // a string course
  ];
  // Battlements, three of them fallen and two broken short.
  for (let i = 0; i < 8; i++) {
    if (i === 2 || i === 3 || i === 6) continue;
    const a = (i / 8) * Math.PI * 2, h = i === 4 || i === 7 ? 0.8 : 1.6;
    stone.push(box(1.3, h, 0.9, Math.cos(a) * 2.9, 16 + h / 2, Math.sin(a) * 2.9, -a + Math.PI / 2));
  }
  const rubble = [0, 1.3, 2.4, 3.9, 5.1].map((a, i) => new THREE.DodecahedronGeometry(0.6 + (i % 3) * 0.35, 0).translate(Math.cos(a) * 4.6, 0.3, Math.sin(a) * 4.6));
  const windows = [[6, 0.4], [10, 2.3], [14, 4.1]].map(([y, a]) => box(0.6, 1.2, 0.3, Math.cos(a) * 3.15, y, Math.sin(a) * 3.15, -a + Math.PI / 2));
  const door = box(1.4, 2.4, 0.3, 3.5, 1.2, 0, Math.PI / 2);
  const g = assemble([[merge(stone), flat(STONE)], [merge(rubble), flat(PALE)], [merge(windows), glow(CANDLE)], [door, flat(0x0b0a0d)]], 0, 0, 0);
  g.rotation.z = 0.04; // leans
  return g;
}

// --- Hollow Crown: a ruined cathedral — arcades of broken pointed arches, a facade with a glowing rose window,
// a bell tower with a snapped spire — laid out along the road (local +x) ---
function cathedral() {
  const stone: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], rose: THREE.BufferGeometry[] = [];
  const COLS = 6, SPAN = 6, x0 = -15;
  for (const z of [-7, 7]) {
    for (let i = 0; i < COLS; i++) {
      const x = x0 + i * SPAN, broken = (z < 0 && i === 4) || (z > 0 && i === 1);
      stone.push(box(1.3, broken ? 3.5 : 9, 1.3, x, broken ? 1.75 : 4.5, z));
      // A pointed arch to the next column, unless either side has fallen.
      const nextBroken = (z < 0 && i + 1 === 4) || (z > 0 && i + 1 === 1);
      if (i < COLS - 1 && !broken && !nextBroken && !(z > 0 && i === 3)) {
        stone.push(strut(x, 9, x + SPAN / 2, 12.2, 0.7, z, 1.1), strut(x + SPAN / 2, 12.2, x + SPAN, 9, 0.7, z, 1.1));
      }
    }
  }
  // Facade at the +x end: a tall gabled wall, a dark doorway and the rose window.
  const fx = x0 + (COLS - 1) * SPAN + 3;
  stone.push(box(1.5, 16, 15, fx, 8, 0)); // wall
  stone.push(new THREE.BoxGeometry(1.5, 1.2, 9).rotateX(-0.62).translate(fx, 18.6, -3.4), new THREE.BoxGeometry(1.5, 1.2, 9).rotateX(0.62).translate(fx, 18.6, 3.4)); // gable: peaks over the middle
  dark.push(box(1.6, 6, 3, fx, 3, 0));
  rose.push(new THREE.TorusGeometry(3, 0.22, 4, 16).rotateY(Math.PI / 2).translate(fx + 0.8, 11, 0));
  for (let i = 0; i < 6; i++) rose.push(new THREE.BoxGeometry(0.15, 5.8, 0.15).rotateX((i / 6) * Math.PI).translate(fx + 0.8, 11, 0)); // spokes
  // Bell tower beside the facade, its spire snapped and leaning.
  stone.push(box(4.2, 24, 4.2, fx - 2, 12, -10));
  stone.push(new THREE.ConeGeometry(2.9, 8, 4).rotateY(Math.PI / 4).rotateZ(0.25).translate(fx - 1.2, 27.6, -10));
  // The apse at the far end: a half-ring of low broken walls; and fallen blocks in the nave.
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 + (i / 6) * Math.PI, h = [4, 2.5, 5, 1.5, 3.5, 2, 4.5][i];
    stone.push(box(1.2, h, 3.4, x0 - 3 + Math.cos(a) * 7, h / 2, Math.sin(a) * 7, -a));
  }
  const blocks = [[-6, 2], [3, -3], [8, 4], [-11, -2]].map(([x, z], i) => new THREE.DodecahedronGeometry(0.9 + (i % 2) * 0.5, 0).translate(x, 0.5, z));
  return assemble([[merge(stone), flat(STONE)], [merge(blocks), flat(PALE)], [merge(dark), flat(0x0b0a0d)], [merge(rose), glow(RUNE)]], 0, 0, 0);
}

// --- Hollow Crown's infield: a giant stone crown half-sunk in the earth, its spikes broken, gems still glowing ---
function crown() {
  const R = 12, stone: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(R, R * 1.03, 3.2, 16, 1, true).translate(0, 1.4, 0)];
  stone.push(new THREE.TorusGeometry(R + 0.05, 0.35, 4, 16).rotateX(Math.PI / 2).translate(0, 3, 0));
  const gems: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, x = Math.cos(a) * R, z = Math.sin(a) * R;
    const broken = i === 2 || i === 5 || i === 6, h = broken ? 3.5 : 9;
    // Spikes lean slightly outwards, like a crown's points.
    const spike = broken ? new THREE.CylinderGeometry(1.0, 1.5, h, 4) : new THREE.ConeGeometry(1.6, h, 4);
    stone.push(spike.translate(0, h / 2, 0).rotateZ(-0.12).rotateY(-a).translate(x, 3, z));
    if (i % 2 === 0) gems.push(new THREE.OctahedronGeometry(0.8, 0).scale(1, 1.4, 1).translate(Math.cos(a + Math.PI / 8) * (R + 0.4), 1.6, Math.sin(a + Math.PI / 8) * (R + 0.4)));
  }
  // One point snapped off and lying in the grass outside.
  stone.push(new THREE.ConeGeometry(1.6, 9, 4).rotateZ(Math.PI / 2 - 0.1).translate(R + 7, 1.2, 4));
  const g = assemble([[merge(stone), flat(PALE, THREE.DoubleSide)], [merge(gems), glow(CRYSTAL)]], 0, 0, 0, -0.6);
  g.rotation.x = 0.1; // half-sunk, tilted
  return g;
}

// --- Serpent's Pass: a serpent's skeleton — the spine arching over the road, ribs to the ground either side,
// the skull resting by the road at one end and the tail sinking into the earth at the other ---
function serpent(track: Track, run: number[]) {
  const { samples } = track, half = track.def.width / 2, n = samples.length;
  const bones: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  const bone = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
    const len = a.distanceTo(b);
    q.setFromUnitVectors(up, dir.subVectors(b, a).normalize());
    bones.push(new THREE.CylinderGeometry(t * 0.8, t, len, 5).applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
  };
  const at = (i: number, offset: number, y: number) => {
    const s = samples[(i + n) % n];
    return new THREE.Vector3(s.x - Math.cos(s.yaw) * offset, y, s.z + Math.sin(s.yaw) * offset);
  };
  const W = half + 4; // rib feet: just outside the walls
  const spineY = (k: number) => samples[run[k]].y + 9 + Math.sin((k / (run.length - 1)) * Math.PI) * 2.5;
  const spine = run.map((i, k) => at(i, 0, spineY(k)));
  spine.forEach((p, k) => {
    if (k) bone(spine[k - 1], p, 0.55);
    bones.push(new THREE.DodecahedronGeometry(0.75, 0).scale(1, 0.8, 1.2).translate(p.x, p.y, p.z)); // vertebra
    if (k % 2) return;
    // A rib each side: a quarter-ellipse from the spine down to a foot outside the wall. At the road's edge
    // it's still ≥ 5 m up, so no kart can reach it.
    for (const side of [-1, 1]) {
      let prev = p;
      for (let j = 1; j <= 7; j++) {
        const th = (Math.PI / 2) * (1 - j / 7);
        const next = at(run[k], side * W * Math.cos(th), p.y * Math.sin(th));
        bone(prev, next, 0.32 - j * 0.025);
        prev = next;
      }
    }
  });
  // The neck down to the skull, resting beside the road before the run, and the tail sinking into the earth
  // after it. Each crosses the wall high (6.5 m) before dropping, so it stays well clear of the road.
  const first = run[0], last = run[run.length - 1];
  const neck: [number, number, number][] = [[first, 0, spineY(0)], [first - 3, half + 3, 6.5], [first - 7, half + 9, 2.4]];
  const tail: [number, number, number][] = [[last, 0, spineY(run.length - 1)], [last + 3, -(half + 3), 6.5], [last + 6, -(half + 7), 1.5], [last + 9, -(half + 9), -1]];
  for (const [path, t0] of [[neck, 0.6], [tail, 0.5]] as const) {
    let prev = at(path[0][0], path[0][1], path[0][2]), j = 0;
    const steps = (path.length - 1) * 3;
    for (let leg = 1; leg < path.length; leg++)
      for (let k = 1; k <= 3; k++) {
        const [i0, o0, y0] = path[leg - 1], [i1, o1, y1] = path[leg], f = k / 3, shrink = 1 - (++j / steps) * 0.6;
        const next = at(Math.round(i0 + (i1 - i0) * f), o0 + (o1 - o0) * f, y0 + (y1 - y0) * f);
        bone(prev, next, t0 * shrink);
        bones.push(new THREE.DodecahedronGeometry(0.7 * shrink, 0).translate(next.x, next.y, next.z));
        prev = next;
      }
  }
  const skullAt = at(first - 7, half + 9, 2.4), tailEnd = at(last + 9, -(half + 9), -1);
  // The skull: a long cranium and snout, the jaw dropped open, fangs, and a cold glow in the eye sockets.
  const s0 = samples[(run[0] - 7 + n) % n], face = s0.yaw + Math.PI; // facing back down the road, towards you
  const skull = [
    new THREE.DodecahedronGeometry(3, 0).scale(1.1, 0.7, 1.4),
    box(3.2, 1.5, 4.5, 0, -0.2, 3.6),
    new THREE.BoxGeometry(2.8, 0.6, 4.6).rotateX(0.35).translate(0, -2.1, 3.2), // jaw
    ...[-1, 1].flatMap(side => [
      new THREE.ConeGeometry(0.3, 1.4, 4).rotateX(Math.PI).translate(side * 1.1, -1.5, 5.4),
      new THREE.ConeGeometry(0.25, 1.1, 4).translate(side * 1.0, -1.6, 4.8),
    ]),
  ].map(g => g.rotateY(face).translate(skullAt.x, skullAt.y, skullAt.z));
  const eyes = [-1, 1].map(side => new THREE.OctahedronGeometry(0.45, 0).translate(side * 1.3, 0.9, 1.9).rotateY(face).translate(skullAt.x, skullAt.y, skullAt.z));
  const g = assemble([[merge([...bones, ...skull]), flat(BONE)], [merge(eyes), glow(CRYSTAL)]], 0, 0, 0);
  const reserved: Reserved[] = [{ x: skullAt.x, z: skullAt.z, r: 8 }, { x: tailEnd.x, z: tailEnd.z, r: 4 }];
  run.forEach((i, k) => { if (k % 2 === 0) for (const side of [-1, 1]) { const f = at(i, side * W, 0); reserved.push({ x: f.x, z: f.z, r: 2 }); } });
  return { group: g, reserved };
}

/** Where a spot (x, z) of radius r is clear of the road; true when clear. */
type Clear = (x: number, z: number, r: number) => boolean;

/** A clear spot of radius `r` as close as possible to (cx, cz), spiralling outwards. */
function nearestClear(cx: number, cz: number, r: number, clear: Clear) {
  for (let d = 0; d < 200; d += 4)
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (clear(x, z, r)) return { x, z };
      if (d === 0) break;
    }
  return null;
}

/** Build this track's landmark(s); `clear` tests a spot against the road. */
export function buildLandmarks(track: Track, clear: Clear) {
  const objects: THREE.Object3D[] = [], reserved: Reserved[] = [];
  const { samples } = track, half = track.def.width / 2, n = samples.length;
  const beside = (i: number, offset: number) => {
    const s = samples[i];
    return { x: s.x - Math.cos(s.yaw) * offset, z: s.z + Math.sin(s.yaw) * offset };
  };

  if (track.def === GREYBOX) {
    // Beside the highest point of the raised hairpin, on the outside of the lap.
    const top = samples.reduce((b, s, i) => (s.y > samples[b].y ? i : b), 0);
    const spot = [18, 24, 30].map(d => beside(top, track.outer * (half + d))).find(p => clear(p.x, p.z, 8));
    if (spot) {
      const tower = watchtower();
      tower.position.set(spot.x, 0, spot.z);
      tower.scale.setScalar(1.4); // ~22 m: tall enough to read as the track's landmark
      objects.push(tower);
      reserved.push({ ...spot, r: 9 });
    }
  }

  if (track.def === HOLLOW) {
    // The cathedral stands beside the middle of the viaduct, its nave running alongside it.
    const mid = track.bridges[Math.floor(track.bridges.length / 2)] ?? 0;
    for (const i of [mid, ...track.bridges]) {
      // (clear() keeps `r` m beyond the scenery's own margin past the road edge, so the offset must exceed that.)
      const spot = [30, 38, 48].flatMap(d => [1, -1].map(side => beside(i, side * (half + d)))).find(p => clear(p.x, p.z, 20));
      if (!spot) continue;
      const c = cathedral();
      c.position.set(spot.x, 0, spot.z);
      c.rotation.y = alongRoad(samples[i].yaw);
      objects.push(c);
      reserved.push({ ...spot, r: 24 });
      break;
    }
    // The crown sits in the infield nearest the middle of the figure-of-eight.
    const cx = samples.reduce((a, s) => a + s.x, 0) / n, cz = samples.reduce((a, s) => a + s.z, 0) / n;
    const spot = nearestClear(cx, cz, 16, (x, z, r) => clear(x, z, r) && !reserved.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2));
    if (spot) {
      const c = crown();
      c.position.x = spot.x; c.position.z = spot.z;
      objects.push(c);
      reserved.push({ ...spot, r: 20 });
    }
  }

  if (track.def === SERPENT) {
    // The first stretch of 26 samples, from halfway round, that's near the ground, off any bridge, and has room
    // for the ribs' feet, the skull and the tail.
    const L = 26, bridges = new Set(track.bridges);
    const footClear = (i: number, offset: number) => {
      const p = beside((i + n) % n, offset);
      return !samples.some(o => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < (half + 1) ** 2);
    };
    for (let t = 0; t < n; t += 2) {
      const start = (Math.floor(n * 0.5) + t) % n;
      const run = Array.from({ length: L }, (_, k) => (start + k) % n);
      if (run.some(i => samples[i].y > 2.5 || bridges.has(i))) continue;
      if (run.some((i, k) => k % 2 === 0 && (!footClear(i, half + 4) || !footClear(i, -(half + 4))))) continue;
      if (!footClear(start - 7, half + 9) || !footClear(start + L - 1 + 9, -(half + 9))) continue;
      const s = serpent(track, run);
      objects.push(s.group);
      reserved.push(...s.reserved);
      break;
    }
  }
  return { objects, reserved };
}
