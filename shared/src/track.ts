// Greybox tracks generated from a closed spline of control points. The client renders these
// geometries and both sides collide against them, so they must be built identically everywhere.
// shortcut: procedural spline tracks only; when Blender .glb tracks arrive, feed their col_* meshes
// into the same Track shape (road / ground / walls + samples).
import {
  BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, PlaneGeometry, Vector3,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export interface TrackDef {
  name: string;
  points: [x: number, z: number, y: number][]; // closed loop, y = elevation
  width: number;
  wallHeight: number;
  samples: number; // segments around the loop
}

export interface TrackSample { x: number; y: number; z: number; yaw: number }

export interface Track {
  def: TrackDef;
  road: BufferGeometry;   // vertex colours: alternating stripes so speed reads on screen
  walls: BufferGeometry;  // outer wall + inner embankment where the road is raised
  trim: BufferGeometry;   // visual only: closes the gap between the embankment top and the road edge
  ground: BufferGeometry; // offroad grass
  roadBVH: MeshBVH;
  wallBVH: MeshBVH;
  groundBVH: MeshBVH;
  samples: TrackSample[]; // centreline, used for spawns and respawns
  outer: number;          // ±1: which side of the centreline (along the right vector) has the outer wall
}

export const GROUND_Y = -0.1;
const UP = new Vector3(0, 1, 0);

const yawOf = (t: Vector3) => Math.atan2(t.x, t.z);

export function createTrack(def: TrackDef): Track {
  const curve = new CatmullRomCurve3(def.points.map(([x, z, y]) => new Vector3(x, y, z)), true, 'centripetal');
  const n = def.samples;
  const half = def.width / 2;

  // Interior of the loop is on the right of travel when the (x,z) polygon winds positively.
  let area = 0;
  def.points.forEach(([x, z], i) => {
    const [x2, z2] = def.points[(i + 1) % def.points.length];
    area += x * z2 - x2 * z;
  });
  const outer = area > 0 ? -1 : 1; // multiplier on the right vector that points away from the infield

  const centres: Vector3[] = [], rights: Vector3[] = [], samples: TrackSample[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const c = curve.getPointAt(u), t = curve.getTangentAt(u);
    c.y = Math.max(0, c.y); // Catmull-Rom overshoots below ground where the track descends
    t.y = 0; t.normalize();
    centres.push(c);
    rights.push(new Vector3().crossVectors(t, UP).normalize());
    samples.push({ x: c.x, y: c.y, z: c.z, yaw: yawOf(t) });
  }

  const road: number[] = [], roadCol: number[] = [], walls: number[] = [], wallCol: number[] = [];
  const trim: number[] = [], trimCol: number[] = [];
  const quad = (out: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3) =>
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z, c.x, c.y, c.z);
  const colour = (out: number[], rgb: number[], verts: number) => { for (let v = 0; v < verts; v++) out.push(...rgb); };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const L = (k: number) => centres[k].clone().addScaledVector(rights[k], -half);
    const R = (k: number) => centres[k].clone().addScaledVector(rights[k], half);
    // a=L_i b=R_i c=L_j d=R_j → right × tangent = up-facing triangles
    quad(road, L(i), R(i), L(j), R(j));
    const stripe = Math.floor(i / 2) % 2;
    colour(roadCol, stripe ? [0.33, 0.31, 0.36] : [0.28, 0.27, 0.31], 6); // dark cobbles; stripes still show speed

    const edge = (k: number, side: number) => centres[k].clone().addScaledVector(rights[k], side * half);
    const at = (v: Vector3, y: number) => new Vector3(v.x, y, v.z);
    // Outer wall: ground to wallHeight above the road.
    const oi = edge(i, outer), oj = edge(j, outer);
    quad(walls, at(oi, GROUND_Y), at(oj, GROUND_Y), at(oi, oi.y + def.wallHeight), at(oj, oj.y + def.wallHeight));
    colour(wallCol, stripe ? [0.4, 0.38, 0.44] : [0.47, 0.45, 0.51], 6); // weathered stone blocks
    // Inner embankment, kept 0.3 below road level so karts can drive off the edge without snagging it.
    const ii = edge(i, -outer), ij = edge(j, -outer);
    if (ii.y > 0.3 || ij.y > 0.3) {
      quad(walls, at(ii, GROUND_Y), at(ij, GROUND_Y), at(ii, Math.max(GROUND_Y, ii.y - 0.3)), at(ij, Math.max(GROUND_Y, ij.y - 0.3)));
      colour(wallCol, [0.33, 0.29, 0.3], 6);
      quad(trim, at(ii, Math.max(GROUND_Y, ii.y - 0.3)), at(ij, Math.max(GROUND_Y, ij.y - 0.3)), ii, ij);
      colour(trimCol, [0.33, 0.29, 0.3], 6);
    }
  }

  const geo = (pos: number[], col: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  const roadGeo = geo(road, roadCol);
  const wallGeo = geo(walls, wallCol);
  const groundGeo = new PlaneGeometry(800, 800).rotateX(-Math.PI / 2).translate(0, GROUND_Y, 0);

  return {
    def, road: roadGeo, walls: wallGeo, trim: geo(trim, trimCol), ground: groundGeo,
    roadBVH: new MeshBVH(roadGeo), wallBVH: new MeshBVH(wallGeo), groundBVH: new MeshBVH(groundGeo),
    samples,
    outer,
  };
}

/** Grid slot `slot` behind the start line: two columns, staggered rows. */
export function spawnPoint(track: Track, slot: number): TrackSample {
  const { samples, def } = track;
  const s = samples[(samples.length - 2 - Math.floor(slot / 2) * 4) % samples.length]; // rows ~10 m apart: clear of the chase camera
  const side = (slot % 2 ? 1 : -1) * def.width * 0.22;
  return { x: s.x + Math.cos(s.yaw) * -side, y: s.y, z: s.z + Math.sin(s.yaw) * side, yaw: s.yaw };
}

export function nearestSample(track: Track, x: number, z: number): TrackSample {
  let best = track.samples[0], bestD = Infinity;
  for (const s of track.samples) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
