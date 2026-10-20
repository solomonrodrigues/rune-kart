// Arcane effects for karts: drift ribbons (Trail), glowing motes for the boost comet tail, and rune rings that burst off a boost.
// Everything lives in world space so trails stay behind a moving kart. One draw call for all of a kart's motes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A soft round dot; additive blending makes overlapping motes bloom together. */
const DOT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.3, '#ffffffc0'); grad.addColorStop(1, '#fff0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();

/** A ring-buffer particle system: spawn motes with a colour and lifetime; they drift, swirl and fade out. */
export class Motes {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;  // spawn colour (faded towards 0 over life)
  private life: Float32Array;
  private maxLife: Float32Array;
  private spin: Float32Array;  // swirl rate around the vertical axis through the spawn point
  private origin: Float32Array;
  private next = 0;

  constructor(private capacity = 220) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.origin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.spin = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.32, map: DOT, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false; // positions change every frame; not worth recomputing bounds
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, colour: THREE.Color, life: number, spin = 0) {
    const i = this.next, o = i * 3;
    this.next = (this.next + 1) % this.capacity;
    this.pos[o] = this.origin[o] = p.x; this.pos[o + 1] = this.origin[o + 1] = p.y; this.pos[o + 2] = this.origin[o + 2] = p.z;
    this.vel[o] = v.x; this.vel[o + 1] = v.y; this.vel[o + 2] = v.z;
    this.base[o] = colour.r; this.base[o + 1] = colour.g; this.base[o + 2] = colour.b;
    this.life[i] = this.maxLife[i] = life;
    this.spin[i] = spin;
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      const o = i * 3;
      if (this.life[i] <= 0) { this.col[o] = this.col[o + 1] = this.col[o + 2] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]); // 1 → 0
      // Swirl: rotate the horizontal velocity, so motes spiral as they rise.
      const s = this.spin[i] * dt, c = Math.cos(s), sn = Math.sin(s);
      const vx = this.vel[o], vz = this.vel[o + 2];
      this.vel[o] = vx * c - vz * sn;
      this.vel[o + 2] = vx * sn + vz * c;
      const drag = Math.exp(-2.2 * dt);
      this.vel[o] *= drag; this.vel[o + 2] *= drag;
      this.vel[o + 1] = this.vel[o + 1] * drag + 0.8 * dt; // drift upwards
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const fade = t * t * (3 - 2 * t);
      this.col[o] = this.base[o] * fade; this.col[o + 1] = this.base[o + 1] * fade; this.col[o + 2] = this.base[o + 2] * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Where the camera is, so wisp ribbons can turn to face it. Set once per frame by the game loop. */
export const fxCamera = new THREE.Vector3();

/**
 * One continuous ribbon of light. While `active`, a new point is laid at the emitter every frame; points
 * ride along with the kart (`carry`, slowly fading so they slip behind) and age out, so the ribbon tapers
 * and fades from its tail. Drawn camera-facing, wide and bright at the newest end. One draw call.
 */
export class Trail {
  readonly mesh: THREE.Mesh;
  readonly colour = new THREE.Color();
  private static readonly N = 40;     // points kept
  private x = new Float32Array(Trail.N); private y = new Float32Array(Trail.N); private z = new Float32Array(Trail.N);
  private vx = new Float32Array(Trail.N); private vz = new Float32Array(Trail.N);
  private age = new Float32Array(Trail.N);
  private count = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private a = new THREE.Vector3(); private b = new THREE.Vector3(); private side = new THREE.Vector3(); private v = new THREE.Vector3();

  constructor(private life = 0.5, private width = 0.07) {
    const verts = (Trail.N - 1) * 6;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
  }

  /** Lay a new point at the head of the ribbon. */
  push(p: THREE.Vector3, carry: THREE.Vector3) {
    const N = Trail.N;
    for (const arr of [this.x, this.y, this.z, this.vx, this.vz, this.age]) arr.copyWithin(1, 0, N - 1);
    this.x[0] = p.x; this.y[0] = p.y; this.z[0] = p.z;
    this.vx[0] = carry.x; this.vz[0] = carry.z;
    this.age[0] = 0;
    this.count = Math.min(N, this.count + 1);
  }

  update(dt: number) {
    const keep = Math.exp(-1.2 * dt); // carried speed fades, so the ribbon slips gently behind the kart
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      this.vx[i] *= keep; this.vz[i] *= keep;
      this.x[i] += this.vx[i] * dt; this.z[i] += this.vz[i] * dt; this.y[i] += 0.25 * dt;
    }
    while (this.count > 0 && this.age[this.count - 1] > this.life) this.count--; // tail ages out
    const { r, g, b } = this.colour;
    let o = 0;
    for (let i = 0; i < Trail.N - 1; i++) {
      if (i >= this.count - 1) { this.col.fill(0, o, o + 18); o += 18; continue; }
      this.a.set(this.x[i], this.y[i], this.z[i]);
      this.b.set(this.x[i + 1], this.y[i + 1], this.z[i + 1]);
      this.side.subVectors(this.b, this.a).cross(this.v.subVectors(this.a, fxCamera)).normalize();
      // Brightest and widest at the newest end, fading with age and towards the tail.
      const k0 = Math.max(0, 1 - this.age[i] / this.life), k1 = Math.max(0, 1 - this.age[i + 1] / this.life);
      const w0 = this.width * k0, w1 = this.width * k1;
      o = this.put(o, this.a, w0, k0, r, g, b); o = this.put(o, this.a, -w0, k0, r, g, b); o = this.put(o, this.b, w1, k1, r, g, b);
      o = this.put(o, this.a, -w0, k0, r, g, b); o = this.put(o, this.b, -w1, k1, r, g, b); o = this.put(o, this.b, w1, k1, r, g, b);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  private put(o: number, pt: THREE.Vector3, w: number, k: number, r: number, g: number, b: number) {
    this.pos[o] = pt.x + this.side.x * w; this.pos[o + 1] = pt.y + this.side.y * w; this.pos[o + 2] = pt.z + this.side.z * w;
    this.col[o] = r * k; this.col[o + 1] = g * k; this.col[o + 2] = b * k;
    return o + 3;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** A thin ring with rune ticks around it, in the XY plane (faces +z). */
function runeRingGeometry() {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.5, 0.025, 3, 24)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tick = new THREE.BoxGeometry(i % 2 ? 0.05 : 0.09, 0.16, 0.02);
    tick.rotateZ(a).translate(Math.cos(a + Math.PI / 2) * 0.62, Math.sin(a + Math.PI / 2) * 0.62, 0);
    parts.push(tick);
  }
  const geo = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
  return geo;
}

/** Three reusable rune rings that burst backwards off a kart when a boost fires. */
export class RuneBurst {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; age: number; delay: number; vel: THREE.Vector3; active: boolean }[] = [];

  constructor() {
    const geo = runeRingGeometry();
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, age: 0, delay: 0, vel: new THREE.Vector3(), active: false });
    }
  }

  /** Fire from `at`, facing `forward` (the rings stand across the kart's path), in `colour`. */
  fire(at: THREE.Vector3, forward: THREE.Vector3, colour: THREE.Color) {
    this.rings.forEach((r, i) => {
      r.mesh.position.copy(at);
      r.mesh.lookAt(at.clone().add(forward));
      // Much dimmer than the motes: rings are big, and additive + bloom adds up fast right in front of the camera.
      (r.mesh.material as THREE.MeshBasicMaterial).color.copy(colour).multiplyScalar(0.35);
      r.vel.copy(forward).multiplyScalar(-1.5 - i * 0.8); // drift off backwards, staying close to the cart
      r.age = 0;
      r.delay = i * 0.07;
      r.active = true;
    });
  }

  update(dt: number) {
    const LIFE = 0.45;
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = (r.age - r.delay) / LIFE;
      if (t < 0) { r.mesh.visible = false; continue; }
      if (t >= 1) { r.active = false; r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      r.mesh.position.addScaledVector(r.vel, dt);
      r.mesh.scale.setScalar(0.6 + t * 0.7);
      r.mesh.rotateZ(dt * 6);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t * t);
    }
  }

  dispose() {
    this.rings[0].mesh.geometry.dispose();
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
  }
}
