// Distant mountains ringing the horizon: three low-poly ranges, the farthest hazy purple and the nearest
// near-black with jagged spires, plus a ruined castle with a few lit windows. Unlit and unfogged (coloured by
// hand for atmosphere), parented to the sky so they always sit on the horizon.
import * as THREE from 'three';

interface Range { radius: number; segments: number; base: number; amp: number; spikes: number; bottom: number; top: number; notch?: number }

const RANGES: Range[] = [
  // far: tall, soft, hazy violet
  { radius: 470, segments: 70, base: 45, amp: 70, spikes: 0.1, bottom: 0x2a2136, top: 0x3d3054 },
  // mid
  { radius: 430, segments: 90, base: 28, amp: 55, spikes: 0.18, bottom: 0x221b2c, top: 0x2b2238 },
  // near: lower, darker, jagged spires
  { radius: 390, segments: 120, base: 14, amp: 38, spikes: 0.3, bottom: 0x15111c, top: 0x191422, notch: 0.15 }, // saddle for the castle
];
const FOOT = -40; // well below the horizon so the ground's fog meets them

/** Height of a range at angle `a`: a few overlapping waves plus the odd sharp spike. */
function heightFn(r: Range, rand: () => number) {
  const waves = [1, 2, 3, 5].map(f => ({ f: f + rand() * 0.5, p: rand() * Math.PI * 2, w: rand() }));
  const total = waves.reduce((n, w) => n + w.w, 0);
  // An optional saddle: the range dips around `notch` (radians) so whatever stands behind shows through.
  const dip = (a: number) => r.notch === undefined ? 1 : 1 - 0.75 * Math.exp(-((Math.atan2(Math.sin(a - r.notch), Math.cos(a - r.notch)) / 0.09) ** 2));
  return (a: number, spike: number) =>
    (r.base + r.amp * waves.reduce((n, w) => n + w.w * (0.5 + 0.5 * Math.sin(a * w.f + w.p)), 0) / total + spike) * dip(a);
}

function range(r: Range, rand: () => number) {
  const h = heightFn(r, rand);
  const pos: number[] = [], col: number[] = [];
  const bottom = new THREE.Color(r.bottom), top = new THREE.Color(r.top), c = new THREE.Color();
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= r.segments; i++) {
    const a = (i / r.segments) * Math.PI * 2;
    const spike = i % r.segments && rand() < r.spikes ? rand() * r.amp * 0.8 : 0; // keep the seam (i = 0/N) matched
    // (spikes are scaled down by the saddle too, since they're added before the dip)
    pts.push([Math.cos(a) * r.radius, h(a, spike), Math.sin(a) * r.radius]);
  }
  pts[r.segments] = pts[0];
  const maxH = r.base + r.amp * 1.8;
  const push = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    c.lerpColors(bottom, top, Math.max(0, Math.min(1, y / maxH))); // a faint lift towards the peaks
    col.push(c.r, c.g, c.b);
  };
  for (let i = 0; i < r.segments; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
    push(x0, FOOT, z0); push(x0, y0, z0); push(x1, FOOT, z1);
    push(x1, FOOT, z1); push(x0, y0, z0); push(x1, y1, z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })), h };
}

/** A ruined keep on a far peak: a tall tower, a broken one, a wall, spires, and three lit windows. */
function castle(at: THREE.Vector3, facing: number) {
  const g = new THREE.Group();
  const stone = new THREE.MeshBasicMaterial({ color: 0x0c0a11, fog: false });
  const lit = new THREE.MeshBasicMaterial({ color: 0xb8742e, fog: false }); // dim candlelight: below the bloom threshold
  const box = (w: number, h: number, d: number, x: number, y: number, m = stone) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y + h / 2, 0);
    g.add(mesh);
    return mesh;
  };
  const spire = (r: number, h: number, x: number, y: number) => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, 4), stone);
    mesh.position.set(x, y + h / 2, 0);
    g.add(mesh);
  };
  box(7, 34, 7, 0, 0); spire(5.5, 16, 0, 34);            // main tower
  box(5, 20, 5, -12, 0); spire(4, 10, -12, 20);          // side tower
  box(5, 13, 5, 13, 0);                                   // broken tower (no roof)
  box(26, 9, 4, 0, 0);                                    // curtain wall
  box(1.4, 2.6, 0.5, 0, 24, lit).position.z = -3.6;       // windows, on the face towards the track
  box(1.4, 2.6, 0.5, 0, 17, lit).position.z = -3.6;
  box(1.2, 2, 0.5, -12, 13, lit).position.z = -2.6;
  g.position.copy(at);
  g.rotation.y = facing;
  g.scale.setScalar(1.35); // reads as a landmark from the track
  return g;
}

export function buildMountains(rand: () => number) {
  const g = new THREE.Group();
  let near: ReturnType<typeof range> | null = null;
  for (const r of RANGES) {
    const built = range(r, rand);
    g.add(built.mesh);
    near = built;
  }
  // The castle stands between the near and middle ranges, past the far end of the start straight, with its
  // foot sunk below the near ridge so the nearer mountains hide its base.
  const a = RANGES[2].notch!, between = (RANGES[1].radius + RANGES[2].radius) / 2;
  const ridge = near!.h(a, 0);
  g.add(castle(new THREE.Vector3(Math.cos(a) * between, ridge - 6, Math.sin(a) * between), Math.PI / 2 - a)); // windows (−z) face the track
  return g;
}
