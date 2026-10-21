// What the tyres leave behind: skid marks on the road in a hard drift, blades of grass flicked up off the grass,
// and a little tyre smoke on the road while drifting. World space, one draw call each per kart.
import * as THREE from 'three';

const SKID_LIFE = 6;      // seconds a mark takes to fade
const SKID_STEP = 0.5;    // metres between strip points
const SKID_WIDTH = 0.3;

/** Two strips of dark tyre marks (one per rear tyre), laid while `marking` and fading from the oldest. */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private static readonly CAP = 180; // segments per tyre
  private pos: Float32Array;
  private col: Float32Array;
  private born: Float32Array;        // per segment, the time it was laid (-Infinity: empty)
  private next = [0, 0];             // next segment slot per tyre
  private last: (THREE.Vector3 | null)[] = [null, null];
  private v = new THREE.Vector3();

  constructor() {
    const segs = SkidMarks.CAP * 2;
    this.pos = new Float32Array(segs * 6 * 3);
    this.col = new Float32Array(segs * 6 * 4);
    this.born = new Float32Array(segs).fill(-Infinity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    }));
    this.mesh.frustumCulled = false;
  }

  /** Per frame, per tyre: `at` is where it touches the road, `side` the kart's right vector. */
  lay(tyre: 0 | 1, at: THREE.Vector3, side: THREE.Vector3, marking: boolean, time: number) {
    if (!marking) { this.last[tyre] = null; return; } // a gap in the strip
    const prev = this.last[tyre];
    if (!prev) { this.last[tyre] = at.clone(); return; }
    if (prev.distanceToSquared(at) < SKID_STEP * SKID_STEP) return;
    const seg = tyre * SkidMarks.CAP + this.next[tyre];
    this.next[tyre] = (this.next[tyre] + 1) % SkidMarks.CAP;
    const w = SKID_WIDTH / 2, o = seg * 18;
    // A quad from the previous point to this one, both ends spread across the kart.
    const corners = [
      this.v.copy(prev).addScaledVector(side, -w).toArray(), this.v.copy(prev).addScaledVector(side, w).toArray(),
      this.v.copy(at).addScaledVector(side, -w).toArray(), this.v.copy(at).addScaledVector(side, w).toArray(),
    ];
    [0, 1, 2, 1, 3, 2].forEach((c, k) => this.pos.set(corners[c], o + k * 3));
    this.born[seg] = time;
    prev.copy(at);
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  update(time: number) {
    for (let seg = 0; seg < this.born.length; seg++) {
      const a = Math.max(0, 1 - (time - this.born[seg]) / SKID_LIFE) * 0.45; // subtle: a hint of rubber, not paint
      for (let k = 0; k < 6; k++) this.col.set([0, 0, 0.005, a], (seg * 6 + k) * 4);
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** A soft round puff, for the smoke. */
const PUFF = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, '#fff8'); grad.addColorStop(1, '#fff0');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();

export const SMOKE = new THREE.Color(0x9b97a8);

/** Puffs of tyre smoke that drift up, spread and fade. */
export class Dust {
  readonly points: THREE.Points;
  private static readonly CAP = 120;
  private pos = new Float32Array(Dust.CAP * 3);
  private col = new Float32Array(Dust.CAP * 4);
  private vel = new Float32Array(Dust.CAP * 3);
  private life = new Float32Array(Dust.CAP);
  private maxLife = new Float32Array(Dust.CAP).fill(1);
  private base = new Float32Array(Dust.CAP * 4); // colour and starting opacity
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1, map: PUFF, vertexColors: true, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
  }

  spawn(at: THREE.Vector3, vel: THREE.Vector3, colour: THREE.Color, opacity: number, life: number) {
    const i = this.next, o = i * 3;
    this.next = (this.next + 1) % Dust.CAP;
    this.pos.set([at.x, at.y, at.z], o);
    this.vel.set([vel.x, vel.y, vel.z], o);
    this.base.set([colour.r, colour.g, colour.b, opacity], i * 4);
    this.life[i] = this.maxLife[i] = life;
  }

  update(dt: number) {
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < Dust.CAP; i++) {
      const o = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; continue; }
      this.life[i] -= dt;
      for (let k = 0; k < 3; k++) { this.vel[o + k] *= drag; this.pos[o + k] += this.vel[o + k] * dt; }
      this.vel[o + 1] += 0.6 * dt; // a little lift as it billows
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col.set([this.base[c], this.base[c + 1], this.base[c + 2], this.base[c + 3] * t * (2 - t)], c); // swell, then fade
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}

// A blade of grass: a thin tapered triangle, rooted at the origin, pointing up.
const BLADE = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.035, 0, 0, 0.035, 0, 0, 0, 0.32, 0], 3));
BLADE.computeVertexNormals();
const GREENS = [0x4d6e38, 0x5f8442, 0x3a5530, 0x6a8a48].map(c => new THREE.Color(c));

/** Blades of grass flicked up by the tyres: thrown back and up, tumbling, falling, then shrinking away. */
export class GrassFlicks {
  readonly mesh: THREE.InstancedMesh;
  private static readonly CAP = 140;
  private pos = new Float32Array(GrassFlicks.CAP * 3);
  private vel = new Float32Array(GrassFlicks.CAP * 3);
  private rot = new Float32Array(GrassFlicks.CAP * 3);  // tumble angles
  private spin = new Float32Array(GrassFlicks.CAP * 3);
  private ground = new Float32Array(GrassFlicks.CAP);   // where it lands
  private life = new Float32Array(GrassFlicks.CAP);
  private next = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3();

  constructor() {
    this.mesh = new THREE.InstancedMesh(BLADE, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: true }), GrassFlicks.CAP);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < GrassFlicks.CAP; i++) { this.mesh.setColorAt(i, GREENS[i % GREENS.length]); this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); }
  }

  spawn(at: THREE.Vector3, vel: THREE.Vector3, groundY: number) {
    const i = this.next, o = i * 3, r = Math.random;
    this.next = (this.next + 1) % GrassFlicks.CAP;
    this.pos.set([at.x, at.y, at.z], o);
    this.vel.set([vel.x, vel.y, vel.z], o);
    this.rot.set([r() * 6, r() * 6, r() * 6], o);
    this.spin.set([(r() - 0.5) * 20, (r() - 0.5) * 20, (r() - 0.5) * 20], o);
    this.ground[i] = groundY;
    this.life[i] = 0.9 + r() * 0.5;
  }

  update(dt: number) {
    for (let i = 0; i < GrassFlicks.CAP; i++) {
      const o = i * 3;
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const airborne = this.pos[o + 1] > this.ground[i];
      if (airborne) {
        this.vel[o + 1] -= 14 * dt; // falls
        for (let k = 0; k < 3; k++) { this.pos[o + k] += this.vel[o + k] * dt; this.rot[o + k] += this.spin[o + k] * dt; }
        if (this.pos[o + 1] < this.ground[i]) this.pos[o + 1] = this.ground[i]; // lands, and lies there
      }
      const size = this.life[i] > 0 ? Math.min(1, this.life[i] / 0.3) : 0; // shrinks away at the end
      this.e.set(this.rot[o], this.rot[o + 1], this.rot[o + 2]);
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]), this.q.setFromEuler(this.e), this.s.setScalar(size)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { (this.mesh.material as THREE.Material).dispose(); }
}
