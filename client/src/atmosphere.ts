// Atmosphere: iron braziers burning on the outside of corners, ground mist drifting around the player, crows
// circling overhead and over the castle, and silent lightning behind the mountains. Each builder returns its
// object(s) and a per-frame update; all instanced, lit by bloom rather than real lights, so they stay cheap.
import * as THREE from 'three';
import type { Track } from 'shared/track';

const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A soft blob texture, `w`×`h`, for mist puffs and the lightning glow. */
function softTexture(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.setTransform(w / h, 0, 0, 1, 0, 0); // stretch a round gradient into an ellipse
  const grad = g.createRadialGradient(h / 2, h / 2, 0, h / 2, h / 2, h / 2);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, '#fff8'); grad.addColorStop(1, '#fff0');
  g.fillStyle = grad;
  g.fillRect(0, 0, h, h);
  return new THREE.CanvasTexture(c);
}

/**
 * Spots beside the road, `offset` m from the centreline, every `step` samples from `start`: on the outside of
 * real corners, or on both sides of (near-)straights. Skips bridges and anywhere another stretch of road runs close.
 */
export function roadside(track: Track, opts: { step: number; offset: number; where: 'corners' | 'straights'; start?: number }) {
  const { samples, def } = track, half = def.width / 2, n = samples.length, bridges = new Set(track.bridges);
  const spots: { x: number; y: number; z: number; yaw: number }[] = []; // y: the road's height there
  for (let i = opts.start ?? 0; i < n; i += opts.step) {
    const s = samples[i];
    // Turn over ±15 m of road; a positive turn is to the left, so the outside of the corner is to the right.
    const turn = wrap(samples[(i + 5) % n].yaw - samples[(i - 5 + n) % n].yaw);
    if (bridges.has(i)) continue;
    const sides = opts.where === 'corners' ? (Math.abs(turn) >= 0.35 ? [Math.sign(turn)] : []) : (Math.abs(turn) < 0.2 ? [-1, 1] : []);
    for (const side of sides) {
      const x = s.x - Math.cos(s.yaw) * side * opts.offset, z = s.z + Math.sin(s.yaw) * side * opts.offset;
      if (samples.some(o => (o.x - x) ** 2 + (o.z - z) ** 2 < (half + 1.5) ** 2)) continue;
      spots.push({ x, y: Math.max(0, s.y), z, yaw: s.yaw });
    }
  }
  return spots;
}

// --- Braziers: on the outside of every real corner, marking the racing line with firelight ---
export function buildBraziers(track: Track) {
  // y: the bowl's height, level with the road beside it
  const spots = roadside(track, { step: 4, offset: track.def.width / 2 + 2.5, where: 'corners' }).slice(0, 60).map(s => ({ ...s, y: s.y + 1.5 }));
  // A pole from the ground up to the bowl (tall beside raised road, like a lamp post), a foot, and the bowl.
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x1e1b22, flatShading: true });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.15, 1, 5).translate(0, 0.5, 0), ironMat, spots.length);
  const bowls = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 0.3, 0.45, 7).translate(0, 0.22, 0), ironMat, spots.length);
  const feet = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 7).translate(0, 0.03, 0), ironMat, spots.length);
  for (const im of [poles, bowls, feet]) im.castShadow = true;
  // Two flames per brazier: an orange outer and a yellow core, over-bright so they bloom.
  const flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.55, 0),
    new THREE.MeshBasicMaterial(), spots.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    poles.setMatrixAt(i, m.compose(p.set(s.x, 0, s.z), q, sc.set(1, s.y, 1)));
    feet.setMatrixAt(i, m.compose(p.set(s.x, 0, s.z), q, sc.set(1, 1, 1)));
    bowls.setMatrixAt(i, m.compose(p.set(s.x, s.y, s.z), q, sc));
    flames.setColorAt(i * 2, hdr(0xff6a1e, 2.6));
    flames.setColorAt(i * 2 + 1, hdr(0xffd36a, 3));
  });
  const up = THREE.Object3D.DEFAULT_UP;
  return {
    objects: [poles, bowls, feet, flames],
    update(time: number) {
      spots.forEach((s, i) => {
        for (const core of [0, 1]) {
          const k = i * 7.3 + core * 2.1;
          const lick = 0.8 + 0.18 * Math.sin(time * 11 + k) + 0.12 * Math.sin(time * 17.3 + k * 1.9);
          q.setFromAxisAngle(up, time * 1.5 + k);
          sc.set(core ? 0.55 : 1, lick * (core ? 0.7 : 1), core ? 0.55 : 1);
          flames.setMatrixAt(i * 2 + core, m.compose(p.set(s.x, s.y + 0.38, s.z), q, sc));
        }
      });
      flames.instanceMatrix.needsUpdate = true;
    },
  };
}

// --- Ground mist: soft banks drifting low around the player, fading out up close and far away ---
export function buildMist() {
  const PUFFS = 50, BOX = 140;
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: softTexture(128, 64), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }), PUFFS);
  mist.frustumCulled = false;
  const puffs = Array.from({ length: PUFFS }, () => ({
    x: (Math.random() - 0.5) * BOX, z: (Math.random() - 0.5) * BOX, w: 14 + Math.random() * 14, h: 3 + Math.random() * 2.5,
    drift: 0.6 + Math.random() * 0.8,
  }));
  const tint = new THREE.Color(0x2c2840), c = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = THREE.Object3D.DEFAULT_UP;
  return {
    object: mist,
    update(camera: THREE.Camera, around: THREE.Vector3, dt: number) {
      puffs.forEach((f, i) => {
        f.x += f.drift * dt; // a slow breeze
        // Wrap into a box that follows the player, so there's always mist about.
        if (f.x - around.x > BOX / 2) f.x -= BOX; else if (f.x - around.x < -BOX / 2) f.x += BOX;
        if (f.z - around.z > BOX / 2) f.z -= BOX; else if (f.z - around.z < -BOX / 2) f.z += BOX;
        const dx = camera.position.x - f.x, dz = camera.position.z - f.z, dist = Math.hypot(dx, dz);
        q.setFromAxisAngle(up, Math.atan2(dx, dz)); // stand up and face the camera
        mist.setMatrixAt(i, m.compose(p.set(f.x, f.h * 0.35, f.z), q, sc.set(f.w, f.h, 1)));
        // Additive, so fading is just darkening: gone within 8 m (never a wall in your face) and past 65 m.
        mist.setColorAt(i, c.copy(tint).multiplyScalar(smooth(6, 18, dist) * (1 - smooth(50, 65, dist))));
      });
      mist.instanceMatrix.needsUpdate = true;
      mist.instanceColor!.needsUpdate = true;
    },
  };
}

// --- Crows: silhouettes circling and flapping, a flock over the road and a few over the castle ---
const crowGeometry = () => {
  // A body point at the front and tail, and two wing tips; flapping scales the tips up and down (y).
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.45, 0, 0, -0.35, -1, 1, -0.25,
    0, 0, 0.45, 1, 1, -0.25, 0, 0, -0.35,
  ], 3));
  return g;
};
interface Flock { centre: THREE.Vector3; radius: number; count: number; size: number; speed: number }

export function buildCrows(flocks: Flock[], fog: boolean) {
  const total = flocks.reduce((n, f) => n + f.count, 0);
  const crows = new THREE.InstancedMesh(crowGeometry(), new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.DoubleSide, fog }), total);
  crows.frustumCulled = false;
  const birds = flocks.flatMap(f => Array.from({ length: f.count }, () => ({
    f, phase: Math.random() * Math.PI * 2, r: f.radius * (0.6 + Math.random() * 0.6), h: (Math.random() - 0.5) * f.radius * 0.4,
    flap: 7 + Math.random() * 3,
  })));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = THREE.Object3D.DEFAULT_UP;
  return {
    object: crows,
    update(time: number) {
      birds.forEach((b, i) => {
        const a = b.phase + time * b.f.speed * (b.f.radius / b.r); // inner birds lap faster, so the flock churns
        p.set(b.f.centre.x + Math.cos(a) * b.r, b.f.centre.y + b.h + Math.sin(time * 0.7 + b.phase) * 1.5, b.f.centre.z + Math.sin(a) * b.r);
        q.setFromAxisAngle(up, -a); // heading along the circle
        // Flap in bursts, then glide.
        const beat = Math.sin(time * 0.9 + b.phase) > -0.2 ? Math.sin(time * b.flap + b.phase) : 0.15;
        crows.setMatrixAt(i, m.compose(p, q, sc.set(b.f.size, b.f.size * (0.2 + 0.6 * beat), b.f.size)));
      });
      crows.instanceMatrix.needsUpdate = true;
    },
  };
}

// --- Lightning: every so often a silent flash behind the mountains outlines the ridges and the castle ---
export function buildLightning(hemi: THREE.HemisphereLight) {
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(340, 200), new THREE.MeshBasicMaterial({
    map: softTexture(128, 80), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.visible = false;
  const colour = new THREE.Color(0xb8a8ff), mat = glow.material as THREE.MeshBasicMaterial;
  const baseHemi = hemi.intensity;
  let next = 6 + Math.random() * 8, start = -9;
  return {
    object: glow,
    update(time: number) {
      if (time > next) {
        start = time; next = time + 8 + Math.random() * 14;
        const a = Math.random() * Math.PI * 2; // somewhere on the horizon, behind the ranges (they sit at 390–470 m)
        glow.position.set(Math.cos(a) * 485, 40 + Math.random() * 30, Math.sin(a) * 485);
        glow.lookAt(0, glow.position.y, 0);
      }
      const t = time - start;
      // A flash, a flicker of dark, then a second, fading flash.
      const f = t < 0.08 ? 1 : t < 0.16 ? 0.12 : Math.max(0, 0.85 * (1 - (t - 0.16) / 0.4));
      glow.visible = f > 0;
      mat.color.copy(colour).multiplyScalar(f * 1.4);
      hemi.intensity = baseHemi * (1 + 0.5 * f); // the whole world lifts slightly in the flash
    },
  };
}
