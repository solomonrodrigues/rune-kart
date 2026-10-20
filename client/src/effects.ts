import * as THREE from 'three';
import { SPELLS, type Effect } from 'shared/spells';

const COLOR = { bolt: SPELLS.find(s => s.id === 'bolt')!.color, rune: SPELLS.find(s => s.id === 'rune')!.color };
const boltGeo = new THREE.OctahedronGeometry(0.45, 0);
const runeGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.08, 6);
const ringGeo = new THREE.TorusGeometry(1, 0.08, 4, 16).rotateX(Math.PI / 2);

/** Draws spell effects (bolts, runes) and one-off cast bursts. */
export class EffectsView {
  private meshes = new Map<number, THREE.Mesh>();
  private latest: { at: number; list: Effect[] } = { at: 0, list: [] };
  private bursts: { mesh: THREE.Mesh; age: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  /** A fresh copy of the replicated effects, stamped with when it arrived. */
  set(list: Effect[], at: number) { this.latest = { at, list }; }

  burst(x: number, y: number, z: number, color: number) {
    const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.set(x, y + 0.5, z);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0 });
  }

  update(now: number, dt: number) {
    const ahead = Math.min(0.1, (now - this.latest.at) / 1000); // bolts fly straight: extrapolate between patches
    const live = new Set<number>();
    for (const e of this.latest.list) {
      live.add(e.id);
      let m = this.meshes.get(e.id);
      if (!m) {
        m = new THREE.Mesh(e.kind === 'bolt' ? boltGeo : runeGeo, new THREE.MeshBasicMaterial({ color: COLOR[e.kind], transparent: true, opacity: 0.9 }));
        this.scene.add(m);
        this.meshes.set(e.id, m);
      }
      m.position.set(e.x + e.vx * ahead, e.y + (e.kind === 'rune' ? 0.06 : 0), e.z + e.vz * ahead);
      m.rotation.y = now / (e.kind === 'bolt' ? 80 : 600);
    }
    for (const [id, m] of this.meshes) {
      if (!live.has(id)) { this.scene.remove(m); (m.material as THREE.Material).dispose(); this.meshes.delete(id); }
    }
    this.bursts = this.bursts.filter(b => {
      b.age += dt;
      const t = b.age / 0.35;
      b.mesh.scale.setScalar(1 + t * 2.5);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      if (t < 1) return true;
      this.scene.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
      return false;
    });
  }
}
