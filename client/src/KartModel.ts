import * as THREE from 'three';
import { driftTier, KART, type KartState } from 'shared/kart';
import { MANA, SPELLS } from 'shared/spells';
import { Monkey } from './Monkey';
import { mergeStatic } from './mergeStatic';
import { RuneBurst, Sigil, Trail } from './arcane';

const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
// Over-bright (HDR) colours: anything past the bloom threshold glows, so every spark tier, the boost
// flame and the headlights glow while keeping their hue.
const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
/** Spark and boost-flame colour per drift tier: 1 blue, 2 orange, 3 purple (index 0 unused). */
const TIER = [0, 0x4fc3ff, 0xff9d2e, 0xd65cff].map(c => hdr(c, 3));
const HASTE = hdr(SPELLS.find(s => s.id === 'haste')!.color, 3);
const TANK_R = 0.26;
const WARD_WARN = 1.5; // seconds before a ward expires that it starts blinking
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
  private flame: THREE.Mesh;               // boost: a flickering cone of flame out of the back
  /** World-space effects (wisps, comet tail, rune rings) — add this to the scene alongside `root`. */
  readonly fx = new THREE.Group();
  // Drift wisps: two continuous ribbons per rear tyre (left pair, right pair), twisting around each other.
  private trails = [0, 1, 2, 3].map(() => new Trail());
  private twist = 0;
  private burst = new RuneBurst();
  private sigil = new Sigil();             // the rune sigil at the exhaust, the boost's source
  private lastBoost = 0;
  private v1 = new THREE.Vector3();
  private fwdW = new THREE.Vector3();
  private rightW = new THREE.Vector3();
  private carryV = new THREE.Vector3();
  private ward: THREE.Mesh;
  private wardBlink = 0;
  private driver = new Monkey();
  private banner = new THREE.Group();
  private flag!: THREE.BufferAttribute;   // flag vertex positions, rewritten each frame to make it wave
  private flagBase!: Float32Array;        // the flat flag those waves are applied to
  // Mana tank on the back: the liquid is clipped by a world-horizontal plane, so it reads the kart's mana
  // and stays level however the kart tilts.
  private tank = new THREE.Group();
  private surface = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0); // keeps what's below the surface
  private liquidMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, clippingPlanes: [this.surface] });
  // The kart's own colour, over-bright so the tank glows (bloom); paler and brighter when full.
  private manaGlow = new THREE.Color();
  private manaFull = new THREE.Color();
  private tankPos = new THREE.Vector3();
  private slide = 0;
  private wheelSpin = 0;

  /**
   * `isLocal`: your own kart skips its glowing lamps and beams — from the chase camera (especially mid-drift)
   * they shine back at you, and your kart lights the road with a real spotlight instead.
   */
  constructor(color: number, isLocal = false) {
    // A dark-fantasy war cart: wooden deck, iron armour and spikes, a ram with bone horns, spiked wheels,
    // and the player's colour on its glowing runes and banner (so karts stay easy to tell apart).
    // Albedos are kept fairly light: the world is lit by moonlight, so true-dark materials vanish.
    const wood = flat(0x7a5638), iron = flat(0x5f6069), leather = flat(0x6b3428), bone = flat(0xece2c8);
    const rune = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5) });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(1.2, 0.3, 2.0), wood, 0, 0.45, 0);                           // deck
    add(new THREE.ConeGeometry(0.45, 0.8, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), flat(0x45464e), 0, 0.5, 1.2); // ram
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.08, 0.42, 1.9), iron, side * 0.64, 0.48, 0);            // side armour
      add(new THREE.BoxGeometry(0.02, 0.07, 1.3), rune, side * 0.69, 0.56, 0);            // rune strip
      for (const z of [-0.6, 0, 0.6]) {
        add(new THREE.ConeGeometry(0.06, 0.28, 4).rotateZ(-side * Math.PI / 2), iron, side * 0.8, 0.42, z); // spikes
      }
      // A bone horn curving out and up from each side of the ram.
      const horn = new THREE.ConeGeometry(0.13, 0.75, 5).translate(0, 0.375, 0);
      const hp = horn.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < hp.count; i++) {
        const t = hp.getY(i) / 0.75;
        hp.setXYZ(i, hp.getX(i) + side * 0.3 * t * t, hp.getY(i), hp.getZ(i) + 0.22 * t * t); // sweeps out, tip hooks forward
      }
      horn.computeVertexNormals();
      add(horn, bone, side * 0.3, 0.62, 1.1).rotation.set(0.35, 0, -side * 0.45); // stands up, splayed outwards
    }
    add(new THREE.BoxGeometry(0.6, 0.15, 0.5), leather, 0, 0.68, -0.3);                  // seat
    add(new THREE.BoxGeometry(0.66, 0.85, 0.16), leather, 0, 1.0, -0.66);               // high seat back
    this.driver.root.position.set(0, 0.75, -0.3);
    this.body.add(this.driver.root);

    // Tattered banner in the player's colour on a pole at the back.
    add(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 4), iron, -0.42, 1.3, -0.92);
    // Built as a strip of segments (x = distance from the pole) so it can ripple; the free end is notched.
    const flagGeo = new THREE.PlaneGeometry(0.75, 0.68, 6, 2).translate(0.375, -0.34, 0);
    this.flag = flagGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.flag.count; i++) {
      if (this.flag.getX(i) > 0.74 && Math.abs(this.flag.getY(i) + 0.34) < 0.01) this.flag.setX(i, 0.58);
    }
    this.flagBase = Float32Array.from(this.flag.array as Float32Array);
    this.banner.position.set(-0.42, 2.2, -0.92);
    this.body.add(this.banner);
    add(flagGeo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true }), 0, 0, 0, this.banner)
      .rotation.y = Math.PI / 2; // streams out behind the pole

    // Iron-rimmed wooden wheels with spiked hubs.
    const rimGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8).rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.27, 6).rotateZ(Math.PI / 2);
    for (const [x, z, front] of [[0.75, 0.75, 1], [-0.75, 0.75, 1], [0.8, -0.7, 0], [-0.8, -0.7, 0]] as const) {
      const w = add(rimGeo, iron, x, 0.34, z);
      w.rotation.order = 'YXZ';
      add(hubGeo, wood, 0, 0, 0, w);
      add(new THREE.ConeGeometry(0.07, 0.3, 4).rotateZ(-Math.sign(x) * Math.PI / 2), iron, Math.sign(x) * 0.27, 0, 0, w);
      this.wheels.push(w);
      if (front) this.frontWheels.push(w);
    }

    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 2, 6).rotateX(-Math.PI / 2).translate(0, 0, -1), // 2 m long at full boost
      new THREE.MeshBasicMaterial({ color: HASTE.clone(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flame.position.set(0, 0.62, -1.15); // out through the sigil's centre
    this.flame.visible = false;
    this.body.add(this.flame);
    this.sigil.group.position.set(0, 0.62, -1.3); // just behind the orb, so it glows in the sigil's centre
    this.body.add(this.sigil.group);
    this.fx.add(...this.trails.map(t => t.mesh), this.burst.group);

    // Headlights: glowing lamps and faint beams through the dusk. (Light on the road comes from your own
    // kart's spotlight, which follows ramps; a flat decal here would cut into them.)
    // Single-sided discs facing forward: they glow at whoever's in front, never back at the driver's camera.
    const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0xffe7b8, 2.2), side: THREE.FrontSide });
    const beamMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (const x of [-0.42, 0.42]) {
      // Iron lantern housings either side of the ram.
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.2), flat(0x5f6069));
      housing.position.set(x, 0.66, 0.98);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.1, 6), lampMat); // faces +z
      lamp.position.set(x, 0.66, 1.09); // just proud of the housing's front face
      this.body.add(housing);
      const ray = new THREE.Mesh(beam(12, 1.7), beamMat);
      ray.position.set(x, 0.66, 1.14);
      ray.rotation.set(0.07, x * 0.15, 0); // dipped slightly, splayed a touch outwards
      if (!isLocal) this.body.add(lamp, ray);
    }

    this.ward = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.9, 1),
      new THREE.MeshBasicMaterial({ color: SPELLS.find(s => s.id === 'ward')!.color, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.ward.position.y = 0.7;
    this.ward.visible = false;

    // Glass mana tank in an iron cage behind the seat, where the chase camera can see it.
    this.manaGlow.copy(hdr(color, 1.2));
    this.manaFull.set(color).lerp(new THREE.Color(0xffffff), 0.1).multiplyScalar(1.4); // only a touch brighter when full
    this.liquidMat.color.copy(this.manaGlow);
    const tankIron = flat(0x5f6069);
    this.tank.position.set(0, 0.98, -1.0);
    const liquid = new THREE.Mesh(new THREE.SphereGeometry(TANK_R, 12, 8), this.liquidMat);
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(TANK_R * 1.05, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xbfd0ff, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    const ring = (rx: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(TANK_R * 1.1, 0.025, 4, 14), tankIron);
      m.rotation.set(rx, ry, 0);
      m.castShadow = true;
      return m;
    };
    const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.2, 6), tankIron);
    cradle.position.y = -TANK_R - 0.06;
    this.tank.add(liquid, glass, ring(Math.PI / 2, 0), ring(0, 0), ring(0, Math.PI / 2), cradle);
    this.body.add(this.tank);

    this.root.add(this.body, this.ward);
    // ~40 primitives → a handful of draw calls; the animated parts stay separate.
    mergeStatic(this.body, [...this.wheels, this.flame]);
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
    // Ward: in its last WARD_WARN seconds it blinks, faster and faster, so everyone can see it's about to drop.
    if (k.wardTime > 0 && k.wardTime < WARD_WARN) {
      const urgency = 1 - k.wardTime / WARD_WARN;               // 0 → 1 as it runs out
      this.wardBlink += dt * (4 + 12 * urgency);                // blinks per second, accumulated so it never jumps
      this.ward.visible = Math.sin(this.wardBlink * Math.PI * 2) > -0.35; // mostly on, with short gaps
    } else {
      this.wardBlink = 0;
      this.ward.visible = k.wardTime > 0;
    }
    this.ward.rotation.y = time * 0.8;

    const speed = k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw);
    this.wheelSpin += (speed / 0.32) * dt;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const w of this.frontWheels) w.rotation.y = -k.steer * 0.4;
    this.driver.update(k.steer);
    // Banner streams back with speed and flutters.
    const pace = Math.abs(speed);
    // Ripple the flag along its length: nothing moves at the pole edge, more towards the free end and with speed.
    const amp = 0.04 + Math.min(0.1, pace * 0.005);
    for (let i = 0; i < this.flag.count; i++) {
      const u = this.flagBase[i * 3] / 0.75;
      this.flag.setZ(i, Math.sin(time * 8 + this.root.id - u * 5) * u * amp);
    }
    this.flag.needsUpdate = true;
    this.banner.rotation.y = Math.sin(time * 2.3 + this.root.id) * 0.12; // a slow swing about the pole itself

    this.root.updateMatrixWorld(true);
    this.fwdW.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    this.rightW.set(-1, 0, 0).applyQuaternion(this.root.quaternion);

    // Drift wisps: once a boost is banked, continuous ribbons of light stream off the rear tyres — blue,
    // orange, then purple. Each ribbon's emitter circles the tyre's rim, so the ribbon corkscrews as it
    // trails away; the two per tyre are half a turn apart, so they twist around each other. Higher tiers
    // twist faster. When the drift ends, nothing new is laid and the ribbons fade from the tail.
    const tier = driftTier(k);
    if (k.driftDir && tier > 0) {
      this.twist += dt * [0, 9, 13, 17][tier];
      this.carryV.set(k.vx, 0, k.vz); // ribbons ride along with the kart and slip back slowly
      this.trails.forEach((trail, i) => {
        const side = i < 2 ? -1 : 1, phase = this.twist + (i % 2) * Math.PI;
        // Rim of the rear tyre (centre (±0.8, 0.34, -0.7); right is -x locally), just outboard of it.
        const at = this.body.localToWorld(this.v1.set(-side * 0.95, 0.34 + Math.sin(phase) * 0.3, -0.7 - Math.cos(phase) * 0.3));
        trail.colour.copy(TIER[tier]);
        trail.push(at, this.carryV);
      });
    }

    // Boost: a flickering flame out of the back, and rune rings bursting off it when it fires — in the colour
    // of the sparks it was released on (Haste has its own).
    const colour = k.boostTier ? TIER[k.boostTier] : HASTE;
    const boost = Math.min(1, k.boostTime / KART.boostTimes[0]);
    this.flame.visible = boost > 0;
    (this.flame.material as THREE.MeshBasicMaterial).color.copy(colour);
    this.flame.scale.set(1, 1, boost * (0.8 + 0.4 * Math.abs(Math.sin(time * 30))));
    if (k.boostTime > this.lastBoost + 0.05) { // a new boost just fired
      this.burst.fire(this.flame.getWorldPosition(this.v1), this.fwdW, colour);
      this.sigil.fire();
    }
    this.lastBoost = k.boostTime;
    for (const t of this.trails) t.update(dt);
    this.burst.update(dt);
    this.sigil.update(dt, boost > 0, colour);

    // Mana tank level: a world-horizontal surface at the right height through the tank.
    this.tank.getWorldPosition(this.tankPos);
    const level = Math.min(1, Math.max(0, k.mana / MANA.max));
    this.surface.constant = this.tankPos.y - TANK_R + level * 2 * TANK_R + (level >= 1 ? 0.05 : 0);
    if (level >= 1) this.liquidMat.color.copy(this.manaFull).multiplyScalar(1 + 0.05 * Math.sin(time * 3)); // full: a gentle pulse
    else this.liquidMat.color.copy(this.manaGlow);
  }

  dispose() {
    for (const t of this.trails) t.dispose();
    this.burst.dispose();
    this.sigil.dispose();
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
  }
}
