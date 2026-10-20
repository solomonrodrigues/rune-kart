// Arcane effects for karts: drift ribbons (Trail), rune rings that burst off a boost (RuneBurst), and the rune
// sigil at the exhaust (Sigil). Ribbons and rings live in world space so they stay behind a moving kart.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

/** A thin bar from (x1, y1) to (x2, y2) in the XY plane. */
function bar(x1: number, y1: number, x2: number, y2: number, w: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return new THREE.BoxGeometry(len, w, 0.01).rotateZ(Math.atan2(y2 - y1, x2 - x1)).translate((x1 + x2) / 2, (y1 + y2) / 2, 0);
}
const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

/** The sigil's two halves, in the XY plane: an outer ring of rune marks, and an inner ring around a hexagram. */
function sigilGeometry() {
  const outer: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.42, 0.034, 3, 32)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (i % 3 === 0) outer.push(bar(...polar(0.32, a), ...polar(0.4, a), 0.04));                               // a stroke
    else if (i % 3 === 1) outer.push(bar(...polar(0.33, a - 0.1), ...polar(0.39, a), 0.034), bar(...polar(0.39, a), ...polar(0.33, a + 0.1), 0.034)); // a chevron
    else outer.push(bar(...polar(0.345, a - 0.03), ...polar(0.375, a + 0.03), 0.05));                            // a dot
  }
  const inner: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.3, 0.028, 3, 28)];
  for (const start of [Math.PI / 2, -Math.PI / 2]) // two triangles: a hexagram
    for (let i = 0; i < 3; i++) {
      const a = start + (i / 3) * Math.PI * 2, b = start + ((i + 1) / 3) * Math.PI * 2;
      inner.push(bar(...polar(0.3, a), ...polar(0.3, b), 0.032));
    }
  const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
  return [merge(outer), merge(inner)];
}

/**
 * A rune sigil at the exhaust, the boost's magical source: it flares in when a boost fires, its two rings
 * counter-rotating, holds while the boost lasts, then lingers a moment after the blast and fades.
 */
export class Sigil {
  readonly group = new THREE.Group();
  private parts: THREE.Mesh[];
  private material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private pop = 1;      // 0 → 1 over the flare-in
  private after = 9;    // seconds since the boost ended
  static LINGER = 0.35; // held at full after the boost ends…
  static FADE = 0.3;    // …then fades over this

  constructor() {
    this.parts = sigilGeometry().map(g => new THREE.Mesh(g, this.material));
    this.group.add(...this.parts);
    this.group.visible = false;
  }

  /** A new boost fired: flare in from large. */
  fire() { this.pop = 0; }

  update(dt: number, boosting: boolean, colour: THREE.Color) {
    this.after = boosting ? 0 : this.after + dt;
    const fade = 1 - Math.min(1, Math.max(0, (this.after - Sigil.LINGER) / Sigil.FADE));
    this.group.visible = fade > 0;
    if (!this.group.visible) return;
    this.pop = Math.min(1, this.pop + dt / 0.18);
    const ease = 1 - (1 - this.pop) ** 3;
    this.group.scale.setScalar(0.9 * (1.4 - 0.4 * ease)); // ~0.75 m across
    // Kept just under the bloom threshold (0.55), so the glyph reads crisply instead of blooming into a disc;
    // it flares past it for a moment as it appears.
    this.material.color.copy(colour).multiplyScalar(fade * (0.17 + 0.25 * (1 - ease)));
    this.parts[0].rotation.z += dt * 1.2;
    this.parts[1].rotation.z -= dt * 2;
  }

  dispose() {
    for (const p of this.parts) p.geometry.dispose();
    this.material.dispose();
  }
}
