import * as THREE from 'three';
import { SPELLS, type Effect } from 'shared/spells';

const SMITE = SPELLS.find(s => s.id === 'smite')!.color;
const SNARE = SPELLS.find(s => s.id === 'snare')!.color;
// Over-bright colours so bloom makes them glow (see KartModel for the same trick).
const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

// --- Smite: a purple bolt. Shared geometry/materials; only the crackle is per bolt. ---
const coreGeo = new THREE.OctahedronGeometry(0.28, 0).scale(1, 1, 2.6);  // stretched along its flight (+z)
const glowGeo = new THREE.OctahedronGeometry(0.6, 1).scale(1, 1, 1.8);
const tailGeo = (() => {
  // A cone trailing behind the bolt, fading to nothing at its tip (vertex alpha).
  const geo = new THREE.ConeGeometry(0.42, 3.2, 8, 3, true).rotateX(Math.PI / 2).translate(0, 0, -1.6);
  const p = geo.attributes.position, c = new THREE.Color(SMITE), rgba: number[] = [];
  for (let i = 0; i < p.count; i++) rgba.push(c.r, c.g, c.b, 0.7 * Math.max(0, 1 + p.getZ(i) / 3.2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
  return geo;
})();
const coreMat = new THREE.MeshBasicMaterial({ color: hdr(0xf0d8ff, 3.5) });
const glowMat = new THREE.MeshBasicMaterial({ color: hdr(SMITE, 1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const crackleMat = new THREE.LineBasicMaterial({ color: hdr(0xe2c4ff, 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const ARCS = 5, ARC_SEGS = 4;

function smiteMesh() {
  const g = new THREE.Group();
  const crackle = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARCS * ARC_SEGS * 2 * 3), 3)),
    crackleMat,
  );
  crackle.frustumCulled = false;
  g.add(new THREE.Mesh(tailGeo, tailMat), new THREE.Mesh(glowGeo, glowMat), new THREE.Mesh(coreGeo, coreMat), crackle);
  return { group: g, crackle };
}

/** Re-randomise the lightning arcs jumping off the bolt — called every frame so it flickers. */
function crackle(lines: THREE.LineSegments) {
  const pos = lines.geometry.attributes.position as THREE.BufferAttribute;
  let o = 0;
  for (let a = 0; a < ARCS; a++) {
    let x = 0, y = 0, z = (Math.random() - 0.5) * 0.8;
    const dir = Math.random() * Math.PI * 2;
    for (let s = 0; s < ARC_SEGS; s++) {
      const nx = x + Math.cos(dir) * 0.22 + (Math.random() - 0.5) * 0.2;
      const ny = y + Math.sin(dir) * 0.22 + (Math.random() - 0.5) * 0.2;
      const nz = z - 0.15 - Math.random() * 0.25;
      pos.setXYZ(o++, x, y, z);
      pos.setXYZ(o++, nx, ny, nz);
      x = nx; y = ny; z = nz;
    }
  }
  pos.needsUpdate = true;
}

const snareGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.08, 6);
const ringGeo = new THREE.TorusGeometry(1, 0.08, 4, 16).rotateX(Math.PI / 2);
const flashGeo = new THREE.IcosahedronGeometry(0.8, 1);

type Live = { kind: Effect['kind']; obj: THREE.Object3D; crackle?: THREE.LineSegments; mat?: THREE.Material };

/** Draws spell effects (smites, snares) and one-off bursts. */
export class EffectsView {
  private live = new Map<number, Live>();
  private latest: { at: number; list: Effect[] } = { at: 0, list: [] };
  private bursts: { mesh: THREE.Mesh; age: number; grow: number }[] = [];
  // A fixed pool of lights that follow the nearest smites (a fixed count avoids shader recompiles).
  private lights = [0, 1].map(() => new THREE.PointLight(SMITE, 0, 14, 1.5));

  constructor(private scene: THREE.Scene) {
    for (const l of this.lights) scene.add(l);
  }

  /** A fresh copy of the replicated effects, stamped with when it arrived. */
  set(list: Effect[], at: number) { this.latest = { at, list }; }

  burst(x: number, y: number, z: number, color: number) {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hdr(color, 2), transparent: true }));
    mesh.position.set(x, y + 0.5, z);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, grow: 2.5 });
  }

  /** Smite impact: a purple flash plus a ring. */
  private impact(p: THREE.Vector3) {
    const flash = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: hdr(SMITE, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.copy(p);
    this.scene.add(flash);
    this.bursts.push({ mesh: flash, age: 0, grow: 3 });
    this.burst(p.x, p.y - 0.5, p.z, SMITE);
  }

  update(now: number, dt: number, camera: THREE.Vector3) {
    const ahead = Math.min(0.1, (now - this.latest.at) / 1000); // extrapolate between patches
    const seen = new Set<number>();
    for (const e of this.latest.list) {
      seen.add(e.id);
      let v = this.live.get(e.id);
      if (!v) {
        if (e.kind === 'smite') {
          const { group, crackle } = smiteMesh();
          v = { kind: e.kind, obj: group, crackle };
        } else {
          const mat = new THREE.MeshBasicMaterial({ color: hdr(SNARE, 1.4), transparent: true, opacity: 0.9 });
          v = { kind: e.kind, obj: new THREE.Mesh(snareGeo, mat), mat };
        }
        this.scene.add(v.obj);
        this.live.set(e.id, v);
      }
      v.obj.position.set(e.x + e.vx * ahead, e.y + (e.kind === 'snare' ? 0.06 : 0), e.z + e.vz * ahead);
      if (e.kind === 'smite') {
        v.obj.rotation.set(0, Math.atan2(e.vx, e.vz), now / 60); // point along its flight, spinning
        crackle(v.crackle!);
      } else {
        v.obj.rotation.y = now / 600;
      }
    }
    for (const [id, v] of this.live) {
      if (seen.has(id)) continue;
      if (v.kind === 'smite') this.impact(v.obj.position);
      this.scene.remove(v.obj);
      v.crackle?.geometry.dispose();
      v.mat?.dispose();
      this.live.delete(id);
    }

    // Light the road under the smites nearest the camera.
    const smites = [...this.live.values()].filter(v => v.kind === 'smite')
      .sort((a, b) => a.obj.position.distanceToSquared(camera) - b.obj.position.distanceToSquared(camera));
    this.lights.forEach((l, i) => {
      const s = smites[i];
      l.intensity = s ? 18 : 0;
      if (s) l.position.copy(s.obj.position);
    });

    this.bursts = this.bursts.filter(b => {
      b.age += dt;
      const t = b.age / 0.35;
      b.mesh.scale.setScalar(1 + t * b.grow);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      if (t < 1) return true;
      this.scene.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
      return false;
    });
  }
}
