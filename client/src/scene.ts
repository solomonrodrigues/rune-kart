import * as THREE from 'three';
import type { Track } from 'shared/track';

const SKY = 0x9cc9e8;

/** Lights, track meshes and scattered low-poly scenery (visual only — no collision). */
export function buildScene(track: Track) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 90, 320);
  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x5a7a3a, 1.4));

  // The sun follows the player so a small shadow camera stays sharp.
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 150 });
  scene.add(sun, sun.target);

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const vcol = (side: THREE.Side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side });
  mesh(track.road, vcol());
  mesh(track.walls, vcol(THREE.DoubleSide)).castShadow = true;
  mesh(track.ground, new THREE.MeshLambertMaterial({ color: 0x6aa84f }));

  // Deterministic scatter so every client sees the same trees; keep them clear of the road.
  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clearance = track.def.width / 2 + 5;
  const nearRoad = (x: number, z: number) =>
    track.samples.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < clearance * clearance);

  const trunk = new THREE.CylinderGeometry(0.3, 0.4, 2, 5).translate(0, 1, 0);
  const leaves = new THREE.ConeGeometry(2, 5, 6).translate(0, 4.2, 0);
  const rock = new THREE.DodecahedronGeometry(1.4, 0);
  const COUNT = 260;
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x7a5233, flatShading: true }), COUNT);
  const crowns = new THREE.InstancedMesh(leaves, new THREE.MeshLambertMaterial({ color: 0x2f7d3b, flatShading: true }), COUNT);
  const rocks = new THREE.InstancedMesh(rock, new THREE.MeshLambertMaterial({ color: 0x8d8f93, flatShading: true }), COUNT);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let trees = 0, stones = 0;
  for (let i = 0; i < COUNT * 4 && (trees < COUNT || stones < COUNT); i++) {
    const x = (rand() - 0.5) * 360, z = (rand() - 0.5) * 300 + 50;
    if (nearRoad(x, z)) continue;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
    const s = 0.7 + rand() * 0.8;
    m.compose(p.set(x, -0.1, z), q, sc.set(s, s, s));
    if (rand() < 0.75 && trees < COUNT) { trunks.setMatrixAt(trees, m); crowns.setMatrixAt(trees++, m); }
    else if (stones < COUNT) rocks.setMatrixAt(stones++, m);
  }
  trunks.count = crowns.count = trees;
  rocks.count = stones;
  for (const im of [trunks, crowns, rocks]) { im.castShadow = true; scene.add(im); }

  return { scene, sun };
}
