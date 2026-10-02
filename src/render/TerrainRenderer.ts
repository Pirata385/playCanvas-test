import * as pc from 'playcanvas';
import { WaterType, type WorldData } from '../world/types';
import { vertexColorMaterial } from './meshFactory';

/** Builds the terrain mesh, lake/river water surfaces, ocean and seabed. */
export class TerrainRenderer {
  readonly root: pc.Entity;
  private waterMaterial: pc.StandardMaterial;
  private oceanMaterial: pc.StandardMaterial;
  private normalTex: pc.Texture;
  private ocean: pc.Entity;
  private t = 0;
  triangles = 0;

  constructor(private app: pc.AppBase, world: WorldData) {
    this.root = new pc.Entity('Terrain');
    app.root.addChild(this.root);
    this.normalTex = createWaterNormalTexture(app.graphicsDevice);

    const terrain = new pc.Entity('TerrainMesh');
    const mesh = this.buildTerrainMesh(world);
    const mat = vertexColorMaterial({ gloss: 0.1 });
    const mi = new pc.MeshInstance(mesh, mat);
    terrain.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
    this.root.addChild(terrain);

    this.waterMaterial = this.makeWaterMaterial(new pc.Color(0.16, 0.38, 0.45), 0.78, 60);
    this.oceanMaterial = this.makeWaterMaterial(new pc.Color(0.07, 0.27, 0.42), 0.86, 450);

    const water = this.buildWaterMesh(world);
    if (water) {
      const e = new pc.Entity('FreshWater');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(water, this.waterMaterial)], castShadows: false, receiveShadows: true });
      this.root.addChild(e);
    }

    // Ocean: a large plane at sea level, plus a dark seabed to hide the world edge.
    const size = world.size;
    this.ocean = new pc.Entity('Ocean');
    this.ocean.addComponent('render', { type: 'plane', material: this.oceanMaterial, castShadows: false, receiveShadows: true });
    this.ocean.setLocalScale(size * 8, 1, size * 8);
    this.ocean.setPosition(size / 2, 0, size / 2);
    this.root.addChild(this.ocean);

    const seabedMat = new pc.StandardMaterial();
    seabedMat.diffuse = new pc.Color(0.25, 0.28, 0.25);
    seabedMat.update();
    const seabed = new pc.Entity('Seabed');
    seabed.addComponent('render', { type: 'plane', material: seabedMat, castShadows: false });
    seabed.setLocalScale(size * 8, 1, size * 8);
    seabed.setPosition(size / 2, -20.5, size / 2);
    this.root.addChild(seabed);
  }

  private makeWaterMaterial(color: pc.Color, opacity: number, tiling: number): pc.StandardMaterial {
    const m = new pc.StandardMaterial();
    m.diffuse = color;
    m.useMetalness = true;
    m.metalness = 0.1;
    m.gloss = 0.88;
    m.opacity = opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
    m.normalMap = this.normalTex;
    m.bumpiness = 0.35;
    m.normalMapTiling = new pc.Vec2(tiling, tiling);
    m.update();
    return m;
  }

  private buildTerrainMesh(w: WorldData): pc.Mesh {
    const R = w.res;
    const positions = new Float32Array(R * R * 3);
    for (let z = 0; z < R; z++) {
      for (let x = 0; x < R; x++) {
        const i = z * R + x;
        positions[i * 3] = x * w.cell;
        positions[i * 3 + 1] = w.heights[i];
        positions[i * 3 + 2] = z * w.cell;
      }
    }
    const indices = new Uint32Array((R - 1) * (R - 1) * 6);
    let k = 0;
    for (let z = 0; z < R - 1; z++) {
      for (let x = 0; x < R - 1; x++) {
        const a = z * R + x;
        const b = a + 1;
        const c = a + R;
        const d = c + 1;
        // diagonal a-d, counter-clockwise when viewed from above (+y)
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
        indices[k++] = a; indices[k++] = c; indices[k++] = d;
      }
    }
    this.triangles += indices.length / 3;
    const mesh = new pc.Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setNormals(w.normals);
    mesh.setColors32(w.colors);
    mesh.setIndices(indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return mesh;
  }

  /**
   * Lakes and rivers: a grid mesh over wet samples. Dry samples bordering water
   * take the average neighbouring water level so the surface meets the banks cleanly.
   */
  private buildWaterMesh(w: WorldData): pc.Mesh | null {
    const R = w.res;
    const N = R * R;
    const level = new Float32Array(N).fill(NaN);
    const fresh = (i: number) => w.waterType[i] === WaterType.Lake || w.waterType[i] === WaterType.River;
    for (let i = 0; i < N; i++) if (fresh(i)) level[i] = w.waterLevel[i];
    const ext = level.slice();
    for (let z = 0; z < R; z++) {
      for (let x = 0; x < R; x++) {
        const i = z * R + x;
        if (!Number.isNaN(level[i])) continue;
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= R || nz >= R) continue;
            const v = level[nz * R + nx];
            if (!Number.isNaN(v)) { sum += v; n++; }
          }
        }
        if (n) ext[i] = sum / n;
      }
    }
    const vmap = new Int32Array(N).fill(-1);
    const positions: number[] = [];
    const indices: number[] = [];
    const vert = (i: number) => {
      if (vmap[i] < 0) {
        vmap[i] = positions.length / 3;
        positions.push((i % R) * w.cell, ext[i] + 0.02, ((i / R) | 0) * w.cell);
      }
      return vmap[i];
    };
    for (let z = 0; z < R - 1; z++) {
      for (let x = 0; x < R - 1; x++) {
        const a = z * R + x, b = a + 1, c = a + R, d = c + 1;
        if (!(fresh(a) || fresh(b) || fresh(c) || fresh(d))) continue;
        if (Number.isNaN(ext[a]) || Number.isNaN(ext[b]) || Number.isNaN(ext[c]) || Number.isNaN(ext[d])) continue;
        const va = vert(a), vb = vert(b), vc = vert(c), vd = vert(d);
        indices.push(va, vd, vb, va, vc, vd);
      }
    }
    if (!indices.length) return null;
    this.triangles += indices.length / 3;
    const normals = new Array(positions.length).fill(0);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    const uvs: number[] = [];
    for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] / w.size, positions[i + 2] / w.size);
    const mesh = new pc.Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setUvs(0, uvs);
    mesh.setIndices(positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices));
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return mesh;
  }

  /** Scroll water normals with the wind. */
  update(dt: number, wind: number, windDir: number): void {
    this.t += dt * (0.4 + wind);
    const ox = Math.sin(windDir) * this.t * 0.01;
    const oz = Math.cos(windDir) * this.t * 0.01;
    this.waterMaterial.normalMapOffset = new pc.Vec2(ox, oz);
    this.waterMaterial.bumpiness = 0.25 + wind * 0.4;
    this.waterMaterial.update();
    this.oceanMaterial.normalMapOffset = new pc.Vec2(ox * 0.5 + this.t * 0.002, oz * 0.5);
    this.oceanMaterial.bumpiness = 0.3 + wind * 0.6;
    this.oceanMaterial.update();
  }

  /** Ocean should follow the camera horizontally so its edge is never visible. */
  followCamera(x: number, z: number): void {
    this.ocean.setPosition(x, 0, z);
  }

  destroy(): void {
    this.root.destroy();
    this.normalTex.destroy();
  }
}

/** Tileable procedural normal map built from a sum of sine waves. */
function createWaterNormalTexture(device: pc.GraphicsDevice): pc.Texture {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const waves = [
    [1, 2, 0.6, 0.3], [3, -1, 0.35, 1.1], [-2, 5, 0.2, 2.2], [6, 3, 0.12, 0.7], [-7, -4, 0.08, 1.9]
  ];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, a, ph] of waves) {
        const p = ((kx * x + ky * y) / S) * Math.PI * 2 + ph;
        const c = Math.cos(p) * a;
        dx += c * kx * 0.25;
        dy += c * ky * 0.25;
      }
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * S + x) * 4;
      data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new pc.Texture(device, {
    width: S, height: S, format: pc.PIXELFORMAT_RGBA8, mipmaps: true,
    addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, name: 'water-normal'
  });
  const pixels = tex.lock();
  (pixels as Uint8Array).set(data);
  tex.unlock();
  return tex;
}
