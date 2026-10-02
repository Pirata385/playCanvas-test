import * as pc from 'playcanvas';
import type { RGB } from '../core/math';
import { VEG_STRIDE, VEG_TYPE_COUNT, VegType, type WorldData } from '../world/types';
import { buildMesh, vertexColorMaterial, type Part } from './meshFactory';

const BARK: RGB = [0.36, 0.25, 0.16];
const LEAF: RGB = [0.22, 0.45, 0.16];
const LEAF_DARK: RGB = [0.13, 0.3, 0.16];
const ROCK: RGB = [0.5, 0.49, 0.47];

/** Low-poly procedural models for each vegetation type. */
function vegParts(type: VegType): Part[] {
  switch (type) {
    case VegType.Oak:
      return [
        { kind: 'cylinder', color: BARK, pos: [0, 1.4, 0], scale: [0.42, 2.8, 0.42], segments: 6 },
        { kind: 'sphere', color: LEAF, pos: [0, 3.9, 0], scale: [3.6, 2.9, 3.6], segments: 7 },
        { kind: 'sphere', color: [0.26, 0.5, 0.18], pos: [0.9, 4.6, 0.4], scale: [2.4, 2.0, 2.4], segments: 6 },
        { kind: 'sphere', color: [0.2, 0.42, 0.15], pos: [-0.8, 4.4, -0.6], scale: [2.2, 1.9, 2.2], segments: 6 }
      ];
    case VegType.Pine:
      return [
        { kind: 'cylinder', color: BARK, pos: [0, 1.0, 0], scale: [0.36, 2.0, 0.36], segments: 6 },
        { kind: 'cone', color: LEAF_DARK, pos: [0, 2.6, 0], scale: [3.0, 2.6, 3.0], segments: 7 },
        { kind: 'cone', color: [0.15, 0.33, 0.18], pos: [0, 3.9, 0], scale: [2.3, 2.3, 2.3], segments: 7 },
        { kind: 'cone', color: [0.17, 0.36, 0.2], pos: [0, 5.1, 0], scale: [1.5, 2.0, 1.5], segments: 7 }
      ];
    case VegType.Palm: {
      const parts: Part[] = [
        { kind: 'cylinder', color: [0.55, 0.42, 0.28], pos: [0, 1.2, 0], scale: [0.32, 2.4, 0.32], rot: [0, 0, 5], segments: 6 },
        { kind: 'cylinder', color: [0.5, 0.38, 0.25], pos: [-0.25, 3.3, 0], scale: [0.28, 2.0, 0.28], rot: [0, 0, 12], segments: 6 },
        { kind: 'cylinder', color: [0.55, 0.42, 0.28], pos: [-0.65, 5.0, 0], scale: [0.24, 1.6, 0.24], rot: [0, 0, 20], segments: 6 },
        { kind: 'sphere', color: [0.35, 0.25, 0.12], pos: [-0.85, 5.75, 0], scale: [0.6, 0.5, 0.6], segments: 5 }
      ];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * 360;
        const rad = (a * Math.PI) / 180;
        parts.push({
          kind: 'box', color: [0.25, 0.55, 0.2],
          pos: [-0.85 + Math.sin(rad) * 1.3, 5.6, Math.cos(rad) * 1.3],
          rot: [-18, a, 0], scale: [0.7, 0.08, 2.8]
        });
      }
      return parts;
    }
    case VegType.Birch:
      return [
        { kind: 'cylinder', color: [0.88, 0.86, 0.8], pos: [0, 1.8, 0], scale: [0.3, 3.6, 0.3], segments: 6 },
        { kind: 'sphere', color: [0.45, 0.62, 0.22], pos: [0, 4.4, 0], scale: [2.4, 3.4, 2.4], segments: 7 },
        { kind: 'sphere', color: [0.5, 0.66, 0.25], pos: [0.4, 5.3, 0.2], scale: [1.6, 2.0, 1.6], segments: 6 }
      ];
    case VegType.Acacia:
      return [
        { kind: 'cylinder', color: [0.4, 0.3, 0.2], pos: [0, 1.5, 0], scale: [0.34, 3.0, 0.34], rot: [0, 0, 6], segments: 6 },
        { kind: 'cylinder', color: [0.4, 0.3, 0.2], pos: [0.5, 3.2, 0], scale: [0.2, 1.4, 0.2], rot: [0, 0, -35], segments: 5 },
        { kind: 'sphere', color: [0.38, 0.48, 0.18], pos: [0.3, 3.9, 0], scale: [5.0, 0.9, 4.4], segments: 8 },
        { kind: 'sphere', color: [0.42, 0.52, 0.2], pos: [0.6, 4.3, 0.3], scale: [3.0, 0.6, 2.6], segments: 7 }
      ];
    case VegType.Bush:
      return [
        { kind: 'sphere', color: [0.24, 0.44, 0.18], pos: [0, 0.45, 0], scale: [1.4, 1.0, 1.4], segments: 6 },
        { kind: 'sphere', color: [0.28, 0.5, 0.2], pos: [0.5, 0.4, 0.3], scale: [1.0, 0.8, 1.0], segments: 5 },
        { kind: 'sphere', color: [0.6, 0.15, 0.2], pos: [0.2, 0.85, 0.5], scale: [0.18, 0.18, 0.18], segments: 4 },
        { kind: 'sphere', color: [0.6, 0.15, 0.2], pos: [-0.4, 0.7, 0.3], scale: [0.16, 0.16, 0.16], segments: 4 }
      ];
    case VegType.Rock:
      return [
        { kind: 'sphere', color: ROCK, pos: [0, 0.15, 0], scale: [1.0, 0.6, 0.8], rot: [10, 20, 5], segments: 5 },
        { kind: 'sphere', color: [0.45, 0.44, 0.42], pos: [0.4, 0.1, 0.2], scale: [0.5, 0.35, 0.5], segments: 4 }
      ];
    case VegType.Boulder:
      return [
        { kind: 'sphere', color: ROCK, pos: [0, 0.6, 0], scale: [2.4, 1.8, 2.0], rot: [5, 30, 8], segments: 6 },
        { kind: 'sphere', color: [0.44, 0.43, 0.41], pos: [0.9, 0.4, 0.6], scale: [1.4, 1.1, 1.2], rot: [20, 0, 10], segments: 5 }
      ];
    case VegType.Grass: {
      const parts: Part[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = 0.15 + (i % 3) * 0.1;
        parts.push({
          kind: 'cone', color: i % 2 ? [0.55, 0.68, 0.25] : [0.42, 0.58, 0.2],
          pos: [Math.cos(a) * r, 0.4, Math.sin(a) * r],
          rot: [Math.sin(a) * 18, 0, Math.cos(a) * 18],
          scale: [0.12, 0.8 + (i % 3) * 0.2, 0.12], segments: 3
        });
      }
      return parts;
    }
    case VegType.Reed: {
      const parts: Part[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const h = 1.4 + (i % 3) * 0.35;
        parts.push({ kind: 'cylinder', color: [0.45, 0.55, 0.25], pos: [Math.cos(a) * 0.25, h / 2, Math.sin(a) * 0.25], scale: [0.04, h, 0.04], segments: 3 });
        if (i % 2 === 0) parts.push({ kind: 'cylinder', color: [0.4, 0.25, 0.13], pos: [Math.cos(a) * 0.25, h, Math.sin(a) * 0.25], scale: [0.09, 0.3, 0.09], segments: 4 });
      }
      return parts;
    }
    case VegType.Flower: {
      const colors: RGB[] = [[0.9, 0.25, 0.3], [0.95, 0.85, 0.2], [0.6, 0.35, 0.85], [0.95, 0.95, 0.95]];
      const parts: Part[] = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const x = Math.cos(a) * 0.25;
        const z = Math.sin(a) * 0.25;
        parts.push({ kind: 'cylinder', color: [0.3, 0.5, 0.2], pos: [x, 0.2, z], scale: [0.03, 0.4, 0.03], segments: 3 });
        parts.push({ kind: 'sphere', color: colors[i], pos: [x, 0.42, z], scale: [0.16, 0.1, 0.16], segments: 5 });
      }
      return parts;
    }
  }
}

const CHUNKS = 4;
/** Small detail vegetation is hidden beyond this distance. */
const DETAIL_TYPES = new Set([VegType.Grass, VegType.Flower, VegType.Reed, VegType.Rock]);
const DETAIL_DISTANCE = 150;

interface Chunk {
  mi: pc.MeshInstance;
  cx: number;
  cz: number;
  detail: boolean;
}

/**
 * Renders all vegetation with hardware instancing: one instanced draw call per
 * vegetation type per world chunk, with per-chunk frustum and distance culling.
 */
export class VegetationRenderer {
  readonly root: pc.Entity;
  private chunks: Chunk[] = [];
  private buffers: pc.VertexBuffer[] = [];
  private meshes: pc.Mesh[] = [];
  instanceCount = 0;

  constructor(app: pc.AppBase, world: WorldData) {
    this.root = new pc.Entity('Vegetation');
    app.root.addChild(this.root);
    const device = app.graphicsDevice;
    const material = vertexColorMaterial({ gloss: 0.12 });
    const veg = world.vegetation;
    const chunkSize = world.size / CHUNKS;
    // bucket instances by (type, chunk)
    const buckets: number[][] = Array.from({ length: VEG_TYPE_COUNT * CHUNKS * CHUNKS }, () => []);
    for (let i = 0; i < veg.length; i += VEG_STRIDE) {
      const type = veg[i];
      const cx = Math.min(CHUNKS - 1, Math.floor(veg[i + 1] / chunkSize));
      const cz = Math.min(CHUNKS - 1, Math.floor(veg[i + 3] / chunkSize));
      buckets[(type * CHUNKS + cz) * CHUNKS + cx].push(i);
    }
    const mat4 = new pc.Mat4();
    const q = new pc.Quat();
    const pos = new pc.Vec3();
    const scl = new pc.Vec3();
    const format = pc.VertexFormat.getDefaultInstancingFormat(device);
    for (let type = 0; type < VEG_TYPE_COUNT; type++) {
      const mesh = buildMesh(device, vegParts(type as VegType), 0.12);
      this.meshes.push(mesh);
      const shadows = !DETAIL_TYPES.has(type as VegType) || type === VegType.Rock;
      for (let cz = 0; cz < CHUNKS; cz++) {
        for (let cx = 0; cx < CHUNKS; cx++) {
          const list = buckets[(type * CHUNKS + cz) * CHUNKS + cx];
          if (!list.length) continue;
          const data = new Float32Array(list.length * 16);
          const min = new pc.Vec3(Infinity, Infinity, Infinity);
          const max = new pc.Vec3(-Infinity, -Infinity, -Infinity);
          list.forEach((vi, n) => {
            const s = veg[vi + 4];
            pos.set(veg[vi + 1], veg[vi + 2] - 0.05, veg[vi + 3]);
            q.setFromEulerAngles(0, (veg[vi + 5] * 180) / Math.PI, 0);
            scl.set(s, s, s);
            mat4.setTRS(pos, q, scl);
            data.set(mat4.data, n * 16);
            min.set(Math.min(min.x, pos.x - 4 * s), Math.min(min.y, pos.y), Math.min(min.z, pos.z - 4 * s));
            max.set(Math.max(max.x, pos.x + 4 * s), Math.max(max.y, pos.y + 8 * s), Math.max(max.z, pos.z + 4 * s));
          });
          const vb = new pc.VertexBuffer(device, format, list.length, { data });
          this.buffers.push(vb);
          const mi = new pc.MeshInstance(mesh, material);
          mi.setInstancing(vb, true);
          const aabb = new pc.BoundingBox();
          aabb.setMinMax(min, max);
          mi.setCustomAabb(aabb);
          mi.castShadow = shadows;
          const e = new pc.Entity(`veg-${type}-${cx}-${cz}`);
          e.addComponent('render', { meshInstances: [mi], castShadows: shadows, receiveShadows: true });
          this.root.addChild(e);
          this.chunks.push({ mi, cx: (cx + 0.5) * chunkSize, cz: (cz + 0.5) * chunkSize, detail: DETAIL_TYPES.has(type as VegType) });
          this.instanceCount += list.length;
        }
      }
    }
  }

  /** Distance-cull small detail chunks. */
  update(camX: number, camZ: number): void {
    for (const c of this.chunks) {
      if (!c.detail) continue;
      const d = Math.max(0, Math.hypot(c.cx - camX, c.cz - camZ) - 90);
      c.mi.visible = d < DETAIL_DISTANCE;
    }
  }

  destroy(): void {
    this.root.destroy();
    for (const b of this.buffers) b.destroy();
    for (const m of this.meshes) m.destroy();
  }
}
