import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Low-poly monkey driver: shaggy dark fur, a big peach muzzle, wide eyes and a thin smile.
// Built from primitives in local space: +z is where he faces, y = 0 is the seat.
const FUR = 0x4a2418;
const FUR_TIP = 0x6b3423;
const SKIN = 0xe8a26e;
const EYE = 0xf6efe4;
const PUPIL = 0x1c1210;
const IRIS = 0x6e3b26;

const flat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

/** Repeatable noise in 0..1 from a position. Keyed on |x| so both sides of the model get the same shag. */
const mirroredNoise = (x: number, y: number, z: number, seed: number) => {
  const h = Math.sin(Math.abs(x) * 127.1 + y * 311.7 + z * 74.7 + seed * 12.9898) * 43758.5453;
  return h - Math.floor(h);
};

/** A low-poly ball with its vertices pushed in and out so the silhouette reads as shaggy fur. */
function furBall(base: THREE.BufferGeometry, shag: number, seed: number) {
  base.deleteAttribute('normal');
  base.deleteAttribute('uv');
  const geo = mergeVertices(base); // shared vertices, so jitter doesn't crack the faces apart
  const p = geo.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Round first so a vertex and its mirror image hash identically despite float noise.
    const r = (n: number) => Math.round(n * 1e4) / 1e4;
    v.multiplyScalar(1 + (mirroredNoise(r(v.x), r(v.y), r(v.z), seed) - 0.35) * shag);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * The muzzle: a single closed low-poly ellipsoid with a mouth sliced into the front, like a Muppet.
 * Built from latitude rings; the ring at mouth height is pulled deep inside, and the rings either side of
 * it are the lips. The slice fades out round the sides, and the whole shape bends up at the corners
 * (y += SMILE·x²) so the mouth smiles. Faces inside the slice are coloured dark.
 */
function muppetMuzzle(rx: number, ry: number, rz: number, skin: number, dark: number) {
  const SMILE = 0.3, DEPTH = 0.4, LIP = 0.055; // corner lift, how deep the slice goes, half-gap at the lips
  const mouth = 1.66; // latitude of the slice (radians from the top): just below the middle, leaving a full chin
  const lats = [0, 0.8, mouth - LIP, mouth, mouth + LIP, 2.4, Math.PI];
  const around = 8;
  // How strongly the slice applies at azimuth `a` (0 = straight ahead): full across the front, gone by the sides.
  const front = (a: number) => {
    const t = Math.min(1, Math.max(0, (Math.cos(a) - 0.15) / 0.55));
    return t * t * (3 - 2 * t);
  };
  const vert = (lat: number, a: number) => {
    const cut = lat === mouth ? 1 - DEPTH * front(a) : 1;
    const x = Math.sin(lat) * Math.sin(a) * rx * cut;
    return new THREE.Vector3(x, Math.cos(lat) * ry * cut + SMILE * x * x, Math.sin(lat) * Math.cos(a) * rz * cut);
  };
  const pos: number[] = [], col: number[] = [];
  const cSkin = new THREE.Color(skin), cDark = new THREE.Color(dark);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  for (let r = 0; r < lats.length - 1; r++) {
    const inSlice = lats[r] === mouth || lats[r + 1] === mouth;
    for (let i = 0; i < around; i++) {
      const a0 = (i / around) * Math.PI * 2, a1 = ((i + 1) / around) * Math.PI * 2;
      const color = inSlice && front((a0 + a1) / 2) > 0.3 ? cDark : cSkin;
      const p00 = vert(lats[r], a0), p01 = vert(lats[r], a1), p10 = vert(lats[r + 1], a0), p11 = vert(lats[r + 1], a1);
      if (r > 0) tri(p00, p10, p01, color);           // skip the degenerate triangle at the top pole
      if (r < lats.length - 2) tri(p01, p10, p11, color); // and at the bottom pole
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A cylinder spanning two points — used for the arms. */
function limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, mat: THREE.Material) {
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius, len, 4), mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return m;
}

export class Monkey {
  readonly root = new THREE.Group();
  readonly wheel = new THREE.Group(); // steering wheel + hands, turned with the kart's steer
  private head = new THREE.Group();

  constructor() {
    const fur = flat(FUR), furTip = flat(FUR_TIP), skin = flat(SKIN), pupil = flat(PUPIL);
    // Slightly self-lit so the eyes stay bright and cartoonish even on the shaded side.
    const eye = new THREE.MeshLambertMaterial({ color: EYE, emissive: 0x6a645c, flatShading: true });
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // Body: a broad, rounded mass with wide shoulders, like the reference (no neck; the head sinks into it).
    mesh(furBall(new THREE.SphereGeometry(0.4, 8, 5), 0.18, 7), fur, 0, 0.32, -0.04).scale.set(1.08, 1.0, 0.85);

    // Head (its own group so it can lean into corners).
    this.head.position.set(0, 0.78, 0.04);
    this.root.add(this.head);
    mesh(furBall(new THREE.SphereGeometry(0.4, 8, 5), 0.2, 11), fur, 0, 0, -0.04, this.head).scale.set(1, 0.98, 0.95);
    // Messy spiky hair on top, swept back (mirrored pairs plus a centre spike).
    [[0, 0.37, 0.04, -0.25, 0.26], [0.13, 0.33, 0, -0.45, 0.22], [0.07, 0.33, -0.15, -0.95, 0.24], [0.2, 0.25, -0.1, -0.7, 0.18]]
      .forEach(([x, y, z, tilt, len], i) => {
        for (const side of x ? [-1, 1] : [1]) {
          const tuft = mesh(new THREE.ConeGeometry(0.065, len, 4), i % 2 ? furTip : fur, side * x, y, z, this.head);
          tuft.rotation.set(tilt, 0, -side * x * 2.2);
        }
      });

    // Peach face: a mask that surrounds the eyes, and the big, wide muzzle that juts out below it.
    mesh(new THREE.IcosahedronGeometry(0.22, 0), skin, 0, 0.09, 0.22, this.head).scale.set(1.35, 0.95, 0.6);
    // One solid muzzle with a Muppet-style slice cut into it for the mouth.
    const muz = { y: -0.16, z: 0.28, rx: 0.345, ry: 0.25, rz: 0.27 };
    mesh(muppetMuzzle(muz.rx, muz.ry, muz.rz, SKIN, PUPIL), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 0, muz.y, muz.z, this.head);
    // Two round nostrils, set wide and high on the muzzle.
    for (const x of [-0.085, 0.085]) {
      const y = -0.03, surf = 1 - (x / muz.rx) ** 2 - ((y - muz.y) / muz.ry) ** 2;
      const z = muz.z + muz.rz * Math.sqrt(Math.max(0, surf)) - 0.006;
      mesh(new THREE.IcosahedronGeometry(0.028, 0), pupil, x, y, z, this.head).scale.set(1, 0.8, 0.5);
    }

    // Big eyes: white ball, large brown iris, black pupil, a glint, and heavy peach upper lids
    // that cover the top of each eye (the reference's sleepy look).
    for (const side of [-1, 1]) {
      const x = side * 0.115;
      mesh(new THREE.SphereGeometry(0.125, 6, 4), eye, x, 0.11, 0.345, this.head).scale.set(0.9, 1.1, 0.7);
      mesh(new THREE.IcosahedronGeometry(0.075, 0), flat(IRIS), x * 0.97, 0.085, 0.41, this.head).scale.set(0.85, 0.95, 0.45);
      mesh(new THREE.IcosahedronGeometry(0.048, 0), pupil, x * 0.97, 0.085, 0.43, this.head).scale.set(0.85, 0.95, 0.4);
      mesh(new THREE.IcosahedronGeometry(0.015, 0), eye, x * 0.97 - side * 0.018, 0.105, 0.45, this.head);
      // Same centre and scale as the eyeball, ~1.3× the radius: with this few segments a lid any tighter
      // lets the eyeball's corners poke through its flat faces.
      const lid = mesh(new THREE.SphereGeometry(0.125 * 1.3, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2), skin, x, 0.11, 0.345, this.head);
      lid.scale.set(0.9, 1.1, 0.7);
      lid.rotation.x = -0.15; // tipped back a little so it caps the top of the eye, not the front
    }
    // Fur brow coming down over the eyes in a V at the centre.
    for (const side of [-1, 1]) {
      const brow = mesh(furBall(new THREE.IcosahedronGeometry(0.13, 0), 0.2, 23), fur, side * 0.12, 0.3, 0.2, this.head);
      brow.scale.set(1.25 * side, 0.45, 0.6); // negative x scale mirrors the right brow exactly
      brow.rotation.z = side * 0.15;
    }
    // Round peach ears at eye level, half buried in the fur.
    for (const side of [-1, 1]) mesh(new THREE.IcosahedronGeometry(0.095, 0), skin, side * 0.39, 0.06, -0.02, this.head).scale.set(0.45, 1, 0.9);

    // Steering wheel out in front, with his hands on it.
    this.wheel.position.set(0, 0.3, 0.55);
    this.wheel.rotation.x = -1.1; // tilted towards him
    this.root.add(this.wheel);
    mesh(new THREE.TorusGeometry(0.2, 0.03, 3, 8), flat(0x222428), 0, 0, 0, this.wheel);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 4), flat(0x222428), 0, 0, -0.12, this.wheel).rotation.x = Math.PI / 2;
    for (const x of [-0.18, 0.18]) mesh(new THREE.IcosahedronGeometry(0.075, 0), skin, x, 0.02, 0.02, this.wheel);

    // Furry arms from the shoulders to where the hands grip the wheel.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.36, 0.5, 0.05);
      const hand = new THREE.Vector3(side * 0.18, 0.32, 0.52);
      const elbow = new THREE.Vector3(side * 0.37, 0.22, 0.3);
      for (const [a, b] of [[shoulder, elbow], [elbow, hand]]) {
        const arm = limb(a, b, 0.09, fur);
        arm.castShadow = true;
        this.root.add(arm);
      }
    }
  }

  /** Turn the wheel with the steering and lean the head into corners. */
  update(steer: number) {
    this.wheel.rotation.z = steer * 0.9;
    this.head.rotation.z = steer * 0.12;
    this.head.rotation.y = -steer * 0.15;
  }
}
