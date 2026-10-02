import * as pc from 'playcanvas';
import type { RGB } from '../core/math';

export type PrimKind = 'box' | 'sphere' | 'cone' | 'cylinder';

export interface Part {
  kind: PrimKind;
  color: RGB;
  /** Translation of the part. */
  pos?: [number, number, number];
  /** Euler rotation in degrees. */
  rot?: [number, number, number];
  /** Non-uniform scale applied to a unit primitive. */
  scale?: [number, number, number];
  /** Segments around the circumference for round primitives (low poly look). */
  segments?: number;
  /** Cone top radius relative to base (0 = point). */
  peak?: number;
}

function primitive(kind: PrimKind, segments: number, peak: number): pc.Geometry {
  switch (kind) {
    case 'box':
      return new pc.BoxGeometry({ halfExtents: new pc.Vec3(0.5, 0.5, 0.5) });
    case 'sphere':
      return new pc.SphereGeometry({ radius: 0.5, latitudeBands: Math.max(3, Math.round(segments / 2)), longitudeBands: segments });
    case 'cone':
      return new pc.ConeGeometry({ baseRadius: 0.5, peakRadius: 0.5 * peak, height: 1, heightSegments: 1, capSegments: segments });
    case 'cylinder':
      return new pc.CylinderGeometry({ radius: 0.5, height: 1, heightSegments: 1, capSegments: segments });
  }
}

/**
 * Merge several transformed, vertex-coloured primitives into one mesh. Used for
 * vegetation and creature body parts so each renders in a single (instanced) draw call.
 */
export function buildMesh(device: pc.GraphicsDevice, parts: Part[], jitter = 0): pc.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const m = new pc.Mat4();
  const nm = new pc.Mat3();
  const v = new pc.Vec3();
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (const p of parts) {
    const g = primitive(p.kind, p.segments ?? 8, p.peak ?? 0);
    const pos = p.pos ?? [0, 0, 0];
    const rot = p.rot ?? [0, 0, 0];
    const scl = p.scale ?? [1, 1, 1];
    m.setTRS(new pc.Vec3(...pos), new pc.Quat().setFromEulerAngles(rot[0], rot[1], rot[2]), new pc.Vec3(...scl));
    nm.invertMat4(m).transpose();
    const base = positions.length / 3;
    const gp = g.positions!;
    const gn = g.normals!;
    for (let i = 0; i < gp.length; i += 3) {
      v.set(gp[i], gp[i + 1], gp[i + 2]);
      m.transformPoint(v, v);
      positions.push(v.x, v.y, v.z);
      v.set(gn[i], gn[i + 1], gn[i + 2]);
      nm.transformVector(v, v).normalize();
      normals.push(v.x, v.y, v.z);
      const j = 1 + (rand() - 0.5) * jitter;
      colors.push(
        Math.min(255, p.color[0] * j * 255),
        Math.min(255, p.color[1] * j * 255),
        Math.min(255, p.color[2] * j * 255),
        255
      );
    }
    const gi = g.indices!;
    for (let i = 0; i < gi.length; i++) indices.push(base + gi[i]);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setColors32(colors);
  mesh.setIndices(positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/** A lit material that takes its albedo from vertex colours. */
export function vertexColorMaterial(opts: { gloss?: number; cull?: number } = {}): pc.StandardMaterial {
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(1, 1, 1);
  mat.diffuseVertexColor = true;
  mat.useMetalness = true;
  mat.metalness = 0;
  mat.gloss = opts.gloss ?? 0.15;
  if (opts.cull !== undefined) mat.cull = opts.cull;
  mat.update();
  return mat;
}
