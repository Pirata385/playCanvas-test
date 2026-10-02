import * as pc from 'playcanvas';
import { clamp, lerp, mixRgb, smoothstep, type RGB } from '../core/math';
import { Rng } from '../core/rng';
import { hourOfDay } from '../sim/time';
import type { WeatherState } from '../sim/Weather';
import { buildMesh } from './meshFactory';

const SKY_RADIUS = 1400;
const CLOUD_COUNT = 46;

const ZENITH_DAY: RGB = [0.22, 0.45, 0.85];
const HORIZON_DAY: RGB = [0.68, 0.82, 0.96];
const ZENITH_DUSK: RGB = [0.22, 0.25, 0.5];
const HORIZON_DUSK: RGB = [0.98, 0.52, 0.28];
const ZENITH_NIGHT: RGB = [0.008, 0.015, 0.05];
const HORIZON_NIGHT: RGB = [0.03, 0.05, 0.11];
const OVERCAST: RGB = [0.55, 0.58, 0.62];

export interface EnvState {
  sunDir: pc.Vec3;
  daylight: number;
  horizon: RGB;
  isNight: boolean;
}

/**
 * Day/night cycle and weather presentation: sun & moon light, sky dome
 * gradient, stars, drifting clouds, fog and lightning flashes.
 */
export class Environment {
  readonly root: pc.Entity;
  readonly light: pc.Entity;
  private skyMesh: pc.Mesh;
  private skyColors: Uint8Array;
  private skyHeights: Float32Array;
  private sky: pc.Entity;
  private sun: pc.Entity;
  private moon: pc.Entity;
  private stars: pc.Entity;
  private starMat: pc.StandardMaterial;
  private cloudMat: pc.StandardMaterial;
  private cloudMi: pc.MeshInstance;
  private cloudVb: pc.VertexBuffer;
  private cloudData: Float32Array;
  private clouds: Array<{ x: number; z: number; y: number; s: number; rot: number }> = [];
  private skyTimer = 0;
  private flash = 0;
  private cloudOffset = new pc.Vec2();
  readonly state: EnvState = { sunDir: new pc.Vec3(0, 1, 0), daylight: 1, horizon: HORIZON_DAY, isNight: false };
  shadowsEnabled = true;

  constructor(private app: pc.AppBase, private worldSize: number, seed: number) {
    this.root = new pc.Entity('Environment');
    app.root.addChild(this.root);
    const device = app.graphicsDevice;

    // --- sun light with cascaded shadows
    this.light = new pc.Entity('Sun');
    this.light.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.96, 0.9),
      intensity: 1.5,
      castShadows: true,
      shadowDistance: 140,
      shadowResolution: 2048,
      numCascades: 2,
      cascadeDistribution: 0.6,
      shadowBias: 0.25,
      normalOffsetBias: 0.06,
      shadowType: pc.SHADOW_PCF3_32F
    });
    this.root.addChild(this.light);

    // --- sky dome with per-vertex gradient
    const g = new pc.SphereGeometry({ radius: 1, latitudeBands: 16, longitudeBands: 24 });
    const nv = g.positions!.length / 3;
    this.skyColors = new Uint8Array(nv * 4);
    this.skyHeights = new Float32Array(nv);
    for (let i = 0; i < nv; i++) this.skyHeights[i] = g.positions![i * 3 + 1];
    this.skyMesh = new pc.Mesh(device);
    this.skyMesh.setPositions(g.positions!);
    this.skyMesh.setNormals(g.normals!);
    this.skyMesh.setColors32(this.skyColors);
    this.skyMesh.setIndices(g.indices as number[]);
    this.skyMesh.update(pc.PRIMITIVE_TRIANGLES);
    const skyMat = new pc.StandardMaterial();
    skyMat.useLighting = false;
    skyMat.useFog = false;
    skyMat.diffuse = new pc.Color(0, 0, 0);
    skyMat.emissive = new pc.Color(1, 1, 1);
    skyMat.emissiveVertexColor = true;
    skyMat.cull = pc.CULLFACE_FRONT;
    skyMat.depthWrite = false;
    skyMat.update();
    this.sky = new pc.Entity('SkyDome');
    const skyMi = new pc.MeshInstance(this.skyMesh, skyMat);
    skyMi.cull = false;
    this.sky.addComponent('render', { meshInstances: [skyMi], castShadows: false, receiveShadows: false });
    this.sky.setLocalScale(SKY_RADIUS, SKY_RADIUS, SKY_RADIUS);
    this.root.addChild(this.sky);

    const disc = (name: string, color: pc.Color, size: number) => {
      const m = new pc.StandardMaterial();
      m.useLighting = false;
      m.useFog = false;
      m.diffuse = new pc.Color(0, 0, 0);
      m.emissive = color;
      m.update();
      const e = new pc.Entity(name);
      e.addComponent('render', { type: 'sphere', material: m, castShadows: false, receiveShadows: false });
      e.setLocalScale(size, size, size);
      this.root.addChild(e);
      return e;
    };
    this.sun = disc('SunDisc', new pc.Color(1.6, 1.4, 1.0), 70);
    this.moon = disc('MoonDisc', new pc.Color(0.85, 0.9, 1.0), 45);

    // --- stars: random small quads on the upper hemisphere, additive
    const rng = new Rng(seed).fork('stars');
    const sp: number[] = [];
    const si: number[] = [];
    for (let i = 0; i < 700; i++) {
      const u = rng.next() * Math.PI * 2;
      const v = Math.acos(rng.range(0.05, 1));
      const d = new pc.Vec3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
      const right = new pc.Vec3().cross(d, pc.Vec3.UP).normalize();
      const up = new pc.Vec3().cross(right, d).normalize();
      const s = rng.range(0.0012, 0.0035);
      const base = sp.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        sp.push(d.x + (right.x * a + up.x * b) * s, d.y + (right.y * a + up.y * b) * s, d.z + (right.z * a + up.z * b) * s);
      }
      si.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const starMesh = new pc.Mesh(device);
    starMesh.setPositions(sp);
    starMesh.setIndices(si);
    starMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.starMat = new pc.StandardMaterial();
    this.starMat.useLighting = false;
    this.starMat.useFog = false;
    this.starMat.diffuse = new pc.Color(0, 0, 0);
    this.starMat.emissive = new pc.Color(1, 1, 1);
    this.starMat.blendType = pc.BLEND_ADDITIVE;
    this.starMat.cull = pc.CULLFACE_NONE;
    this.starMat.depthWrite = false;
    this.starMat.opacity = 0;
    this.starMat.update();
    this.stars = new pc.Entity('Stars');
    const starMi = new pc.MeshInstance(starMesh, this.starMat);
    starMi.cull = false;
    this.stars.addComponent('render', { meshInstances: [starMi], castShadows: false, receiveShadows: false });
    this.stars.setLocalScale(SKY_RADIUS * 0.95, SKY_RADIUS * 0.95, SKY_RADIUS * 0.95);
    this.root.addChild(this.stars);

    // --- clouds: instanced puffy clusters
    const cloudMesh = buildMesh(device, [
      { kind: 'sphere', color: [1, 1, 1], scale: [30, 12, 22], segments: 7 },
      { kind: 'sphere', color: [0.94, 0.94, 0.96], pos: [16, -2, 4], scale: [22, 9, 16], segments: 6 },
      { kind: 'sphere', color: [0.96, 0.96, 0.98], pos: [-15, -1, -3], scale: [20, 10, 18], segments: 6 },
      { kind: 'sphere', color: [0.9, 0.9, 0.93], pos: [4, 4, -6], scale: [18, 9, 14], segments: 6 }
    ]);
    this.cloudMat = new pc.StandardMaterial();
    this.cloudMat.useLighting = false;
    this.cloudMat.diffuse = new pc.Color(0, 0, 0);
    this.cloudMat.emissive = new pc.Color(1, 1, 1);
    this.cloudMat.emissiveVertexColor = true;
    this.cloudMat.opacity = 0.92;
    this.cloudMat.blendType = pc.BLEND_NORMAL;
    this.cloudMat.depthWrite = false;
    this.cloudMat.update();
    this.cloudData = new Float32Array(CLOUD_COUNT * 16);
    this.cloudVb = new pc.VertexBuffer(device, pc.VertexFormat.getDefaultInstancingFormat(device), CLOUD_COUNT, {
      data: this.cloudData, usage: pc.BUFFER_DYNAMIC
    });
    this.cloudMi = new pc.MeshInstance(cloudMesh, this.cloudMat);
    this.cloudMi.setInstancing(this.cloudVb);
    const cloudEntity = new pc.Entity('Clouds');
    cloudEntity.addComponent('render', { meshInstances: [this.cloudMi], castShadows: false, receiveShadows: false });
    this.root.addChild(cloudEntity);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this.clouds.push({
        x: rng.range(-600, worldSize + 600), z: rng.range(-600, worldSize + 600),
        y: rng.range(150, 210), s: rng.range(0.7, 1.8), rot: rng.range(0, 360)
      });
    }

    app.scene.fog.type = pc.FOG_LINEAR;
  }

  /** Trigger a lightning flash. */
  lightning(): void {
    this.flash = 1;
  }

  update(dt: number, simTime: number, weather: WeatherState, cam: pc.Vec3): void {
    const hour = hourOfDay(simTime);
    const theta = ((hour - 6) / 24) * Math.PI * 2;
    const sunDir = this.state.sunDir.set(Math.cos(theta), Math.sin(theta), 0.32).normalize();
    const sunY = sunDir.y;
    const daylight = smoothstep(-0.12, 0.25, sunY);
    const dusk = clamp(1 - Math.abs(sunY) / 0.3, 0, 1) * smoothstep(-0.25, -0.02, sunY + 0.1);
    const cloud = weather.cloud;
    this.flash = Math.max(0, this.flash - dt * 5);
    const flash = this.flash > 0 ? (Math.sin(this.flash * 40) * 0.5 + 0.5) * this.flash : 0;

    // sky colours
    let zenith = mixRgb(ZENITH_NIGHT, ZENITH_DAY, daylight);
    let horizon = mixRgb(HORIZON_NIGHT, HORIZON_DAY, daylight);
    zenith = mixRgb(zenith, ZENITH_DUSK, dusk * 0.6);
    horizon = mixRgb(horizon, HORIZON_DUSK, dusk * 0.85);
    const overcast: RGB = [OVERCAST[0] * (0.08 + daylight * 0.92), OVERCAST[1] * (0.08 + daylight * 0.92), OVERCAST[2] * (0.1 + daylight * 0.9)];
    const oc = clamp(cloud * 0.85 + weather.fog * 0.5, 0, 0.95);
    zenith = mixRgb(zenith, overcast, oc);
    horizon = mixRgb(horizon, overcast, oc * 0.9);
    if (flash > 0) {
      zenith = mixRgb(zenith, [0.8, 0.85, 1], flash * 0.7);
      horizon = mixRgb(horizon, [0.8, 0.85, 1], flash * 0.7);
    }
    this.state.daylight = daylight;
    this.state.horizon = horizon;
    this.state.isNight = daylight < 0.2;

    this.skyTimer -= dt;
    if (this.skyTimer <= 0 || flash > 0) {
      this.skyTimer = 0.1;
      const c = this.skyColors;
      for (let i = 0; i < this.skyHeights.length; i++) {
        const y = this.skyHeights[i];
        const t = Math.pow(clamp(y, 0, 1), 0.55);
        const col = y < 0 ? horizon : mixRgb(horizon, zenith, t);
        c[i * 4] = clamp(col[0] * 255, 0, 255);
        c[i * 4 + 1] = clamp(col[1] * 255, 0, 255);
        c[i * 4 + 2] = clamp(col[2] * 255, 0, 255);
        c[i * 4 + 3] = 255;
      }
      this.skyMesh.setColors32(c);
      this.skyMesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    this.sky.setPosition(cam.x, cam.y, cam.z);
    this.stars.setPosition(cam.x, cam.y, cam.z);
    this.stars.setEulerAngles(0, 0, (simTime * 0.02) % 360);
    this.starMat.opacity = clamp((1 - daylight * 1.6) * (1 - cloud * 1.1), 0, 1);
    this.starMat.update();

    // sun & moon discs
    const dist = SKY_RADIUS * 0.9;
    this.sun.setPosition(cam.x + sunDir.x * dist, cam.y + sunDir.y * dist, cam.z + sunDir.z * dist);
    this.sun.enabled = sunY > -0.1 && cloud < 0.85;
    this.moon.setPosition(cam.x - sunDir.x * dist, cam.y - sunDir.y * dist, cam.z - sunDir.z * dist);
    this.moon.enabled = sunY < 0.1 && cloud < 0.85;

    // directional light: sun by day, moon by night
    const light = this.light.light!;
    const dayI = smoothstep(-0.02, 0.15, sunY);
    const nightI = smoothstep(0.02, -0.15, sunY);
    const covered = 1 - cloud * 0.6 - weather.fog * 0.2;
    let lightDir: pc.Vec3;
    if (sunY >= 0) {
      lightDir = sunDir;
      const warm = smoothstep(0.45, 0.05, sunY);
      light.color = new pc.Color(1, lerp(0.95, 0.62, warm), lerp(0.88, 0.38, warm));
      light.intensity = dayI * 1.7 * covered + flash * 2;
    } else {
      lightDir = new pc.Vec3(-sunDir.x, -sunDir.y, -sunDir.z);
      light.color = new pc.Color(0.5, 0.6, 0.9);
      light.intensity = nightI * 0.35 * covered + flash * 2;
    }
    light.castShadows = this.shadowsEnabled && light.intensity > 0.08;
    // light shines down its -Y axis: aim -Y along -lightDir
    this.light.setPosition(cam.x + lightDir.x * 100, cam.y + lightDir.y * 100, cam.z + lightDir.z * 100);
    this.light.lookAt(cam.x, cam.y, cam.z);
    this.light.rotateLocal(90, 0, 0);

    // ambient
    const amb = mixRgb([0.07, 0.08, 0.14], [0.42, 0.46, 0.52], daylight);
    const ambK = 1 - cloud * 0.15;
    this.app.scene.ambientLight = new pc.Color(amb[0] * ambK + flash * 0.6, amb[1] * ambK + flash * 0.6, amb[2] * ambK + flash * 0.7);

    // fog
    const fog = this.app.scene.fog;
    fog.color = new pc.Color(horizon[0], horizon[1], horizon[2]);
    const fogStart = lerp(lerp(180, 50, weather.rain), 6, weather.fog);
    const fogEnd = lerp(lerp(900, 320, weather.rain), 95, weather.fog);
    fog.start = fogStart;
    fog.end = fogEnd;

    // clouds drift with the wind
    const wind = 2 + weather.wind * 10;
    this.cloudOffset.x += Math.sin(weather.windDir) * wind * dt;
    this.cloudOffset.y += Math.cos(weather.windDir) * wind * dt;
    const visible = Math.round(CLOUD_COUNT * clamp(0.15 + cloud * 0.95, 0, 1));
    const span = this.worldSize + 1200;
    const m = new pc.Mat4();
    const q = new pc.Quat();
    const p = new pc.Vec3();
    const s = new pc.Vec3();
    for (let i = 0; i < visible; i++) {
      const c = this.clouds[i];
      const x = ((((c.x + this.cloudOffset.x + 600) % span) + span) % span) - 600;
      const z = ((((c.z + this.cloudOffset.y + 600) % span) + span) % span) - 600;
      const thick = 1 + cloud * 0.6;
      p.set(x, c.y - cloud * 40, z);
      q.setFromEulerAngles(0, c.rot, 0);
      s.set(c.s * thick, c.s * thick * (0.8 + cloud * 0.5), c.s * thick);
      m.setTRS(p, q, s);
      this.cloudData.set(m.data, i * 16);
    }
    this.cloudVb.setData(this.cloudData);
    this.cloudMi.instancingCount = visible;
    const cBright = (0.25 + daylight * 0.8) * (1 - cloud * 0.45) + flash;
    const cc = mixRgb([cBright, cBright, cBright * 1.05], [horizon[0] * 1.2, horizon[1] * 1.1, horizon[2]], dusk * 0.6);
    this.cloudMat.emissive = new pc.Color(cc[0], cc[1], cc[2]);
    this.cloudMat.opacity = 0.75 + cloud * 0.2;
    this.cloudMat.update();
  }

  destroy(): void {
    this.root.destroy();
    this.cloudVb.destroy();
  }
}
