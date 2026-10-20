import * as THREE from 'three';
import { driftTier, KART, type KartState } from 'shared/kart';
import { SPELLS } from 'shared/spells';
import { Monkey } from './Monkey';

const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
// Over-bright (HDR) colours: anything past the bloom threshold glows, so every spark tier, the boost
// flame and the headlights glow while keeping their hue.
const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
/** Spark and boost-flame colour per drift tier: 1 blue, 2 orange, 3 purple (index 0 unused). */
const TIER = [0, 0x4fc3ff, 0xff9d2e, 0xd65cff].map(c => hdr(c, 3));
const SURGE = hdr(SPELLS.find(s => s.id === 'surge')!.color, 3);
const HEADLIGHT = 0xffe2b0;

/** A faint cone of light from a lamp, brightest at the lamp and fading to nothing (vertex alpha). */
function beam(length: number, radius: number) {
  const geo = new THREE.ConeGeometry(radius, length, 10, 4, true).rotateX(-Math.PI / 2).translate(0, 0, length / 2);
  const p = geo.attributes.position, colour = new THREE.Color(HEADLIGHT), rgba: number[] = [];
  for (let i = 0; i < p.count; i++) rgba.push(colour.r, colour.g, colour.b, 0.07 * (1 - p.getZ(i) / length) ** 1.5);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
  return geo;
}

/** Low-poly kart built from primitives. +z is forward, +y up. */
export class KartModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // takes the drift slide offset
  private frontWheels: THREE.Mesh[] = [];
  private wheels: THREE.Mesh[] = [];
  private sparks: THREE.Mesh[] = [];
  private flame: THREE.Mesh;
  private ward: THREE.Mesh;
  private driver = new Monkey();
  private slide = 0;
  private wheelSpin = 0;

  /** `beams`: off for your own kart — seen from the chase camera they wash out the view, and it has a real spotlight. */
  constructor(color: number, beams = true) {
    const paint = flat(color), dark = flat(0x222428);
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
    this.driver.root.position.set(0, 0.75, -0.3);
    this.body.add(this.driver.root);

    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.3, 8).rotateZ(Math.PI / 2);
    for (const [x, z, front] of [[0.75, 0.75, 1], [-0.75, 0.75, 1], [0.8, -0.7, 0], [-0.8, -0.7, 0]] as const) {
      const w = add(wheelGeo, dark, x, 0.32, z);
      w.rotation.order = 'YXZ';
      this.wheels.push(w);
      if (front) this.frontWheels.push(w);
    }

    const sparkGeo = new THREE.OctahedronGeometry(0.18, 0);
    for (const x of [0.8, -0.8]) {
      const s = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: TIER[1] }));
      s.position.set(x, 0.15, -1.0);
      s.visible = false;
      this.sparks.push(s);
      this.body.add(s);
    }

    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 1, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
      new THREE.MeshBasicMaterial({ color: SURGE.clone(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flame.position.set(0, 0.5, -1.15);
    this.body.add(this.flame);

    // Headlights: glowing lamps and faint beams through the dusk. (Light on the road comes from your own
    // kart's spotlight, which follows ramps; a flat decal here would cut into them.)
    const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0xffe7b8, 2.2) });
    const beamMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const x of [-0.3, 0.3]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 6).rotateX(Math.PI / 2), lampMat);
      lamp.position.set(x, 0.6, 1.21);
      const ray = new THREE.Mesh(beam(12, 1.7), beamMat);
      ray.position.set(x, 0.6, 1.25);
      ray.rotation.set(0.07, x * 0.15, 0); // dipped slightly, splayed a touch outwards
      this.body.add(lamp);
      if (beams) this.body.add(ray);
    }

    this.ward = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.9, 1),
      new THREE.MeshBasicMaterial({ color: SPELLS.find(s => s.id === 'ward')!.color, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.ward.position.y = 0.7;
    this.ward.visible = false;

    this.root.add(this.body, this.ward);
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
    // Spun out: whirl the body until the stun wears off.
    this.body.rotation.y = this.slide + (k.stunTime > 0 ? k.stunTime * 14 : 0);
    this.ward.visible = k.wardTime > 0;
    this.ward.rotation.y = time * 0.8;

    const speed = k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw);
    this.wheelSpin += (speed / 0.32) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const w of this.frontWheels) w.rotation.y = -k.steer * 0.4;
    this.driver.update(k.steer);

    // Sparks only once a boost is banked: blue, orange, then purple.
    const tier = driftTier(k);
    for (const s of this.sparks) {
      s.visible = !!k.driftDir && tier > 0;
      if (tier) (s.material as THREE.MeshBasicMaterial).color.copy(TIER[tier]);
      s.scale.setScalar(0.6 + 0.5 * Math.abs(Math.sin(time * 40 + s.position.x)));
    }

    const boost = Math.min(1, k.boostTime / KART.boostTimes[0]);
    this.flame.visible = boost > 0;
    // The flame burns the colour of the sparks it was released on (Surge has its own).
    (this.flame.material as THREE.MeshBasicMaterial).color.copy(k.boostTier ? TIER[k.boostTier] : SURGE);
    this.flame.scale.set(1, 1, boost * (0.8 + 0.4 * Math.abs(Math.sin(time * 30))));
  }

  dispose() {
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
