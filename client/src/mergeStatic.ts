import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Identity of a material for merging: meshes whose materials look identical can share one draw call. */
function materialKey(m: THREE.Material) {
  const a = m as THREE.MeshBasicMaterial & THREE.MeshLambertMaterial;
  return [m.type, a.color?.getHexString(), a.color && `${a.color.r},${a.color.g},${a.color.b}`, a.emissive?.getHexString(),
    m.transparent, m.opacity, m.blending, m.side, m.depthWrite, a.vertexColors, a.flatShading, a.map?.uuid].join('|');
}

/**
 * Bake the static meshes directly under `group` into one mesh per distinct material, cutting draw calls
 * (and shadow-pass draw calls) a lot for models built from many primitives. Anything in `keep` — and any
 * child with children of its own — is left alone, so animated parts stay separate.
 */
export function mergeStatic(group: THREE.Object3D, keep: Iterable<THREE.Object3D> = []) {
  const skip = new Set(keep);
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  for (const child of [...group.children]) {
    if (skip.has(child) || child.children.length || !(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    if (!child.visible) continue;
    child.updateMatrix();
    let geo = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geo.applyMatrix4(child.matrix);
    // A mirrored transform flips triangle winding; swap two corners so faces still point outwards.
    if (child.matrix.determinant() < 0) {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        const x = pos.getX(i + 1), y = pos.getY(i + 1), z = pos.getZ(i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, x, y, z);
      }
    }
    const mat = child.material as THREE.Material & { vertexColors?: boolean };
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && !(name === 'color' && mat.vertexColors)) geo.deleteAttribute(name);
    }
    geo.computeVertexNormals();
    const key = materialKey(mat) + (geo.attributes.color ? `|c${geo.attributes.color.itemSize}` : '');
    const b = buckets.get(key) ?? { material: mat, geos: [], shadow: false };
    b.geos.push(geo);
    b.shadow ||= child.castShadow;
    buckets.set(key, b);
    group.remove(child);
    child.geometry.dispose();
    if (mat !== b.material) mat.dispose();
  }
  for (const { material, geos, shadow } of buckets.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos), material);
    merged.castShadow = shadow;
    group.add(merged);
    geos.forEach(g => g.dispose());
  }
}
