// Set dressing: fenced graveyards, gibbets with swaying cages at corners, tattered rune banners lining the
// straights, and ruined walls and columns. Placed with the scene's seeded random so every client sees the same
// world; everything is instanced (banners are one merged mesh), and the scene keeps its trees out of the way.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Track } from 'shared/track';
import { roadside } from './atmosphere';

const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
const STONE = 0x4a4752, IRON = 0x1e1b22, BONE = 0xbdb59a;
const up = THREE.Object3D.DEFAULT_UP;

/** A pool of instances of one mesh, filled with `add` and trimmed to what was used by `done`. */
function pool(geo: THREE.BufferGeometry, mat: THREE.Material, max: number) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.castShadow = true;
  let n = 0;
  return {
    mesh,
    add(m: THREE.Matrix4) { if (n < max) mesh.setMatrixAt(n++, m); return n - 1; },
    done() { mesh.count = n; return mesh; },
  };
}

/** A circle of ground kept free of trees and rocks. */
export interface Reserved { x: number; z: number; r: number }

export function buildDressing(track: Track, rand: () => number, clear: (x: number, z: number, margin: number) => boolean) {
  const objects: THREE.Object3D[] = [], reserved: Reserved[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  const { samples } = track, half = track.def.width / 2;
  const xs = samples.map(s => s.x), zs = samples.map(s => s.z);
  const bx0 = Math.min(...xs) - 70, bx1 = Math.max(...xs) + 70, bz0 = Math.min(...zs) - 70, bz1 = Math.max(...zs) + 70;
  /** A random spot `radius` m clear of the road and of everything placed so far, within sight of the track. */
  const findSpot = (radius: number) => {
    for (let tries = 0; tries < 200; tries++) {
      const x = bx0 + rand() * (bx1 - bx0), z = bz0 + rand() * (bz1 - bz0);
      if (!clear(x, z, radius) || reserved.some(r => (r.x - x) ** 2 + (r.z - z) ** 2 < (r.r + radius) ** 2)) continue;
      // …but not so far out that nobody sees it.
      if (!samples.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < (half + radius + 25) ** 2)) continue;
      return { x, z };
    }
    return null;
  };
  const place = (into: { add(m: THREE.Matrix4): number }, x: number, y: number, z: number, rx: number, ry: number, rz: number, s = sc) =>
    into.add(m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s));

  // --- Graveyards: rows of crooked headstones and Celtic crosses, an open grave, inside a broken iron fence ---
  const headstone = pool(merge([
    new THREE.BoxGeometry(0.7, 0.8, 0.18).translate(0, 0.4, 0),
    new THREE.CylinderGeometry(0.35, 0.35, 0.18, 8, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0.8, 0),
  ]), flat(STONE), 140);
  const cross = pool(merge([
    new THREE.BoxGeometry(0.18, 1.7, 0.18).translate(0, 0.85, 0),
    new THREE.BoxGeometry(0.9, 0.18, 0.18).translate(0, 1.2, 0),
    new THREE.TorusGeometry(0.27, 0.045, 3, 10).translate(0, 1.2, 0),
  ]), flat(STONE), 40);
  const pit = pool(new THREE.BoxGeometry(1, 0.04, 2).translate(0, 0.0, 0), flat(0x0b0a0d), 10);
  const mound = pool(new THREE.DodecahedronGeometry(0.8, 0).scale(1, 0.35, 1.4), flat(0x2e2620), 10);
  const post = pool(merge([
    new THREE.BoxGeometry(0.08, 1.2, 0.08).translate(0, 0.6, 0),
    new THREE.ConeGeometry(0.07, 0.22, 4).translate(0, 1.31, 0),
  ]), flat(IRON), 320);
  const rail = pool(new THREE.BoxGeometry(1, 0.05, 0.05), flat(IRON), 640);
  for (let g = 0; g < 6; g++) {
    const rows = 2 + Math.floor(rand() * 2), cols = 3 + Math.floor(rand() * 3);
    const w = cols * 1.6 + 1.6, d = rows * 2.4 + 1.6, at = findSpot(Math.hypot(w, d) / 2 + 1);
    if (!at) continue;
    reserved.push({ ...at, r: Math.hypot(w, d) / 2 + 1 });
    const rot = rand() * Math.PI * 2, cos = Math.cos(rot), sin = Math.sin(rot);
    const local = (lx: number, lz: number) => [at.x + lx * cos + lz * sin, at.z - lx * sin + lz * cos] as const;
    let grave = false;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const [x, z] = local((c - (cols - 1) / 2) * 1.6 + (rand() - 0.5) * 0.3, (r - (rows - 1) / 2) * 2.4 + (rand() - 0.5) * 0.3);
      const roll = rand(), lean = () => (rand() - 0.5) * 0.35;
      if (roll < 0.68) place(headstone, x, 0, z, lean(), rot + (rand() - 0.5) * 0.3, lean());
      else if (roll < 0.86) place(cross, x, 0, z, lean(), rot + (rand() - 0.5) * 0.3, lean());
      else if (!grave) { // one open grave per graveyard, with its earth heaped beside it
        grave = true;
        place(pit, x, 0.0, z, 0, rot, 0);
        const [mx, mz] = local((c - (cols - 1) / 2) * 1.6 + 0.9, (r - (rows - 1) / 2) * 2.4);
        place(mound, mx, 0, mz, 0, rot, 0);
      }
    }
    // The fence: posts every ~1.4 m round the edge, a gate gap at the front, some posts missing or leaning;
    // two rails between each pair of posts that are both still standing.
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    for (let side = 0; side < 4; side++) {
      const [ax, az] = corners[side], [bx, bz] = corners[(side + 1) % 4];
      const steps = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 1.4));
      let prev: [number, number] | null = null;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
        const gate = side === 0 && Math.abs(lx) < 0.9;
        if (gate || (k > 0 && k < steps && rand() < 0.15)) { prev = null; continue; }
        const [x, z] = local(lx, lz);
        place(post, x, 0, z, (rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25);
        if (prev) {
          const [px, pz] = prev, len = Math.hypot(x - px, z - pz), yaw = Math.atan2(-(z - pz), x - px);
          for (const h of [0.45, 0.95]) place(rail, (x + px) / 2, h, (z + pz) / 2, 0, yaw, 0, sc.set(len, 1, 1));
          sc.set(1, 1, 1);
        }
        prev = [x, z];
      }
    }
  }
  objects.push(headstone.done(), cross.done(), pit.done(), mound.done(), post.done(), rail.done());

  // --- Gibbets: a post and arm on the outside of a few corners, an iron cage (and its occupant) swaying below ---
  const gibbetSpots = roadside(track, { step: 4, offset: half + 7, where: 'corners', start: 2 })
    .filter((s, i) => i % 3 === 0 && s.y < 1.5).slice(0, 8);
  const frame = pool(merge([
    new THREE.BoxGeometry(0.25, 4.8, 0.25).translate(0, 2.4, 0),
    new THREE.BoxGeometry(1.7, 0.2, 0.2).translate(0.75, 4.6, 0),
    new THREE.BoxGeometry(0.95, 0.12, 0.12).rotateZ(Math.PI / 4).translate(0.35, 4.2, 0),
  ]), flat(0x2a211d), gibbetSpots.length);
  // The cage hangs from a pivot at the end of the arm (local origin), so swinging is just rotating it.
  const bars = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return new THREE.BoxGeometry(0.04, 1.3, 0.04).translate(Math.cos(a) * 0.34, -1.55, Math.sin(a) * 0.34);
  });
  const cage = pool(merge([
    new THREE.BoxGeometry(0.04, 0.9, 0.04).translate(0, -0.45, 0), // chain
    ...bars,
    new THREE.TorusGeometry(0.34, 0.03, 3, 8).rotateX(Math.PI / 2).translate(0, -0.9, 0),
    new THREE.TorusGeometry(0.34, 0.03, 3, 8).rotateX(Math.PI / 2).translate(0, -2.2, 0),
    new THREE.ConeGeometry(0.38, 0.3, 8).translate(0, -0.78, 0),
  ]), flat(IRON), gibbetSpots.length);
  const skull = pool(new THREE.IcosahedronGeometry(0.15, 0).scale(1, 1.1, 1.15).translate(0, -1.95, 0), flat(BONE), gibbetSpots.length);
  const gibbets = gibbetSpots.map(s => {
    // The arm (local +x) reaches towards the road: a y-rotation θ takes +x to (cos θ, 0, −sin θ).
    const n = nearestOn(samples, s), facing = Math.atan2(-(n.z - s.z), n.x - s.x);
    place(frame, s.x, 0, s.z, 0, facing, 0);
    reserved.push({ x: s.x, z: s.z, r: 3 });
    const pivot = new THREE.Vector3(1.55, 4.5, 0).applyAxisAngle(up, facing).add(new THREE.Vector3(s.x, 0, s.z));
    return { pivot, facing, phase: rand() * 6 };
  });
  objects.push(frame.done(), cage.mesh, skull.mesh); // cages and skulls are posed each frame in update()
  cage.mesh.count = skull.mesh.count = gibbets.length;

  // --- Rune banners: tall poles in pairs along the straights, tattered crimson cloth with a gold sigil ---
  const bannerSpots: ReturnType<typeof roadside> = [];
  for (const s of roadside(track, { step: 3, offset: half + 3, where: 'straights' })) // in pairs, ≥ 30 m apart along the road
    if (bannerSpots.length < 20 && !bannerSpots.some(b => (b.x - s.x) ** 2 + (b.z - s.z) ** 2 < 30 ** 2)) bannerSpots.push(s);
  const poleMesh = pool(new THREE.CylinderGeometry(0.08, 0.12, 1, 5).translate(0, 0.5, 0), flat(IRON), bannerSpots.length);
  const bar = pool(new THREE.BoxGeometry(0.06, 0.06, 1.3), flat(IRON), bannerSpots.length);
  const CW = 1.1, CH = 2.2, GX = 4, GY = 8; // cloth size and grid
  const grid = new THREE.PlaneGeometry(CW, CH, GX, GY).translate(0, -CH / 2, 0); // hangs down from its top edge
  const gp = grid.attributes.position;
  for (let i = 0; i < gp.count; i++) if (gp.getY(i) < -CH + 0.01) gp.setY(i, gp.getY(i) + (Math.round(gp.getX(i) / (CW / GX)) % 2 ? 0.35 : 0)); // tattered tails
  // Non-indexed before anything is stored: the merge un-indexes too, and the wave writes vertices by position in
  // that layout, so the saved rest shapes must use the same one.
  const cloth = grid.toNonIndexed();
  const bannerBase: Float32Array[] = [];
  const parts = bannerSpots.map(s => {
    const top = s.y + 5.6;
    place(poleMesh, s.x, 0, s.z, 0, 0, 0, sc.set(1, top + 0.2, 1));
    sc.set(1, 1, 1);
    // The cloth faces along the road (a y-rotation by yaw takes its +z normal to the road's direction), so you
    // see it head-on as you approach; it hangs from a crossbar, just in front of the pole.
    place(bar, s.x, top, s.z, 0, s.yaw + Math.PI / 2, 0);
    reserved.push({ x: s.x, z: s.z, r: 1.5 });
    const g = cloth.clone().rotateY(s.yaw).translate(s.x - Math.sin(s.yaw) * 0.2, top - 0.05, s.z - Math.cos(s.yaw) * 0.2);
    bannerBase.push(new Float32Array(g.attributes.position.array));
    return g;
  });
  objects.push(poleMesh.done(), bar.done());
  const banners = parts.length ? merge(parts) : null;
  if (banners) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const x2 = c.getContext('2d')!;
    x2.fillStyle = '#3d0c12'; x2.fillRect(0, 0, 64, 128);
    x2.strokeStyle = '#6b1a22'; x2.lineWidth = 4; x2.strokeRect(4, 2, 56, 124);
    x2.strokeStyle = '#b8892e'; x2.lineWidth = 3; // the sigil: a ring, an inverted triangle, a stroke through
    x2.beginPath(); x2.arc(32, 52, 18, 0, Math.PI * 2); x2.stroke();
    x2.beginPath(); x2.moveTo(16, 42); x2.lineTo(48, 42); x2.lineTo(32, 70); x2.closePath(); x2.stroke();
    x2.beginPath(); x2.moveTo(32, 24); x2.lineTo(32, 92); x2.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(banners, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, flatShading: true }));
    mesh.castShadow = true;
    objects.push(mesh);
  }
  const vertsPer = cloth.attributes.position.count;

  // --- Ruins: a broken wall, a stump of column and a toppled one, in small clusters ---
  const wallGeo = merge([2.6, 2.1, 1.3, 0.7, 1.7].map((h, i) => new THREE.BoxGeometry(0.82, h, 0.7).translate(-1.6 + i * 0.8, h / 2, 0)));
  const wall = pool(wallGeo, flat(0x3d3c44), 20);
  const stump = pool(merge([
    new THREE.BoxGeometry(1.3, 0.3, 1.3).translate(0, 0.15, 0),
    new THREE.CylinderGeometry(0.42, 0.48, 1.6, 8).translate(0, 1.1, 0),
  ]), flat(0x46444d), 30);
  const fallen = pool(new THREE.CylinderGeometry(0.42, 0.42, 4, 8).rotateZ(Math.PI / 2).translate(0, 0.42, 0), flat(0x46444d), 20);
  for (let r = 0; r < 9; r++) {
    const at = findSpot(5);
    if (!at) continue;
    reserved.push({ ...at, r: 5 });
    const rot = rand() * Math.PI * 2;
    place(wall, at.x, -0.05, at.z, 0, rot, (rand() - 0.5) * 0.06, sc.setScalar(0.8 + rand() * 0.5));
    sc.set(1, 1, 1);
    for (let k = 0; k < 1 + Math.floor(rand() * 2); k++)
      place(stump, at.x + (rand() - 0.5) * 6, 0, at.z + (rand() - 0.5) * 6, 0, rand() * 3, 0, sc.set(1, 0.6 + rand() * 0.8, 1));
    sc.set(1, 1, 1);
    place(fallen, at.x + (rand() - 0.5) * 6, 0, at.z + (rand() - 0.5) * 6, 0, rand() * Math.PI * 2, 0);
  }
  objects.push(wall.done(), stump.done(), fallen.done());

  /** Per frame: cages sway on their chains and the banners ripple, each in its own rhythm. */
  function update(time: number) {
    gibbets.forEach((g, i) => {
      const swing = Math.sin(time * 1.1 + g.phase) * 0.12, twist = Math.sin(time * 0.6 + g.phase) * 0.4;
      q.setFromEuler(e.set(Math.sin(time * 0.8 + g.phase * 2) * 0.06, g.facing + twist, swing));
      m.compose(g.pivot, q, sc.set(1, 1, 1));
      cage.mesh.setMatrixAt(i, m);
      skull.mesh.setMatrixAt(i, m);
    });
    cage.mesh.instanceMatrix.needsUpdate = skull.mesh.instanceMatrix.needsUpdate = true;
    if (banners) {
      const pos = banners.attributes.position as THREE.BufferAttribute;
      bannerBase.forEach((base, b) => {
        const s = bannerSpots[b], nx = Math.sin(s.yaw), nz = Math.cos(s.yaw); // the cloth's normal: along the road
        for (let v = 0; v < vertsPer; v++) {
          const o = v * 3, depth = (s.y + 5.55 - base[o + 1]) / CH; // 0 at the crossbar, 1 at the hem
          // Billows only forward, away from the pole it hangs in front of, so it never swings back through it.
          const wave = -(0.5 + 0.5 * Math.sin(time * 2.6 + depth * 3.2 + b * 1.7)) * 0.25 * depth;
          pos.setXYZ(b * vertsPer + v, base[o] + nx * wave, base[o + 1], base[o + 2] + nz * wave);
        }
      });
      pos.needsUpdate = true;
    }
  }

  return { objects, reserved, update };
}

/** The track sample nearest (x, z). */
function nearestOn(samples: { x: number; z: number }[], at: { x: number; z: number }) {
  let best = samples[0], bd = Infinity;
  for (const s of samples) { const d = (s.x - at.x) ** 2 + (s.z - at.z) ** 2; if (d < bd) { bd = d; best = s; } }
  return best;
}
