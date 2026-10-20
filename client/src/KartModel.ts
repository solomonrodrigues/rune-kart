import * as THREE from 'three';
import { driftTier, KART, type KartState } from 'shared/kart';

const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const TIER_COLOURS = [0x000000, 0x4fc3ff, 0xff9d2e, 0xd65cff];

/** Low-poly kart built from primitives. +z is forward, +y up. */
export class KartModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // takes the drift slide offset
  private frontWheels: THREE.Mesh[] = [];
  private wheels: THREE.Mesh[] = [];
  private sparks: THREE.Mesh[] = [];
  private flame: THREE.Mesh;
  private slide = 0;
  private wheelSpin = 0;

  constructor(color: number) {
    const paint = flat(color), dark = flat(0x222428), skin = flat(0xf1c27d);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(1.3, 0.35, 2.1), paint, 0, 0.45, 0);            // chassis
    add(new THREE.BoxGeometry(0.9, 0.3, 0.7), paint, 0, 0.55, 0.85);          // nose
    add(new THREE.BoxGeometry(1.5, 0.12, 0.4), dark, 0, 0.75, -1.05);         // rear wing
    add(new THREE.BoxGeometry(0.6, 0.5, 0.5), dark, 0, 0.85, -0.3);           // seat
    add(new THREE.IcosahedronGeometry(0.32, 0), skin, 0, 1.3, -0.25);         // driver head
    add(new THREE.CylinderGeometry(0.33, 0.33, 0.2, 6), dark, 0, 1.1, -0.25); // collar

    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.3, 8).rotateZ(Math.PI / 2);
    for (const [x, z, front] of [[0.75, 0.75, 1], [-0.75, 0.75, 1], [0.8, -0.7, 0], [-0.8, -0.7, 0]] as const) {
      const w = add(wheelGeo, dark, x, 0.32, z);
      w.rotation.order = 'YXZ';
      this.wheels.push(w);
      if (front) this.frontWheels.push(w);
    }

    const sparkGeo = new THREE.OctahedronGeometry(0.18, 0);
    for (const x of [0.8, -0.8]) {
      const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      s.position.set(x, 0.15, -1.0);
      s.visible = false;
      this.sparks.push(s);
      this.body.add(s);
    }

    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 1, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
      new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.85 }),
    );
    this.flame.position.set(0, 0.5, -1.15);
    this.body.add(this.flame);

    this.root.add(this.body);
  }

  private basis = new THREE.Matrix4();
  private up = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private left = new THREE.Vector3();

  update(k: KartState, dt: number, time: number) {
    this.root.position.set(k.x, k.y, k.z);
    // Orient to the ground normal, keeping the heading.
    this.up.set(k.nx, k.ny, k.nz).normalize();
    this.fwd.set(Math.sin(k.yaw), 0, Math.cos(k.yaw)).addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.left.crossVectors(this.up, this.fwd);
    this.root.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.left, this.up, this.fwd));

    // Slide the body into the drift so it visibly hangs out.
    this.slide += (-k.driftDir * 0.35 - this.slide) * (1 - Math.exp(-10 * dt));
    this.body.rotation.y = this.slide;

    const speed = k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw);
    this.wheelSpin += (speed / 0.32) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const w of this.frontWheels) w.rotation.y = -k.steer * 0.4;

    const tier = driftTier(k);
    for (const s of this.sparks) {
      s.visible = !!k.driftDir && k.driftCharge > 0.25;
      (s.material as THREE.MeshBasicMaterial).color.setHex(tier ? TIER_COLOURS[tier] : 0xffffff);
      s.scale.setScalar(0.6 + 0.5 * Math.abs(Math.sin(time * 40 + s.position.x)));
    }

    const boost = Math.min(1, k.boostTime / KART.boostTimes[0]);
    this.flame.visible = boost > 0;
    this.flame.scale.set(1, 1, boost * (0.8 + 0.4 * Math.abs(Math.sin(time * 30))));
  }

  dispose() {
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
