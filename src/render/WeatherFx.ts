import * as pc from 'playcanvas';
import { clamp } from '../core/math';
import type { WeatherState } from '../sim/Weather';

interface Layer {
  entity: pc.Entity;
  threshold: number;
}

function dotTexture(device: pc.GraphicsDevice, soft: boolean): pc.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(soft ? 0.25 : 0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new pc.Texture(device, { width: 32, height: 32, format: pc.PIXELFORMAT_RGBA8, mipmaps: true });
  tex.setSource(c);
  return tex;
}

/**
 * GPU particle effects bound to the camera: layered rain (density follows
 * intensity), snow at altitude, and fireflies on calm nights.
 */
export class WeatherFx {
  readonly root: pc.Entity;
  private rain: Layer[] = [];
  private snow: Layer[] = [];
  private fireflies: pc.Entity;
  private textures: pc.Texture[] = [];

  constructor(app: pc.AppBase) {
    this.root = new pc.Entity('WeatherFx');
    app.root.addChild(this.root);
    const streak = dotTexture(app.graphicsDevice, false);
    const soft = dotTexture(app.graphicsDevice, true);
    this.textures.push(streak, soft);

    for (const [i, threshold] of [0.04, 0.35, 0.7].entries()) {
      const e = new pc.Entity(`Rain${i}`);
      e.addComponent('particlesystem', {
        numParticles: 1800,
        lifetime: 1.1,
        rate: 1.1 / 1800,
        rate2: 1.1 / 1800,
        emitterShape: pc.EMITTERSHAPE_BOX,
        emitterExtents: new pc.Vec3(70, 4, 70),
        localVelocityGraph: new pc.CurveSet([[0, 0], [0, -30], [0, 0]]),
        localVelocityGraph2: new pc.CurveSet([[0, 0], [0, -36], [0, 0]]),
        scaleGraph: new pc.Curve([0, 0.045]),
        alphaGraph: new pc.Curve([0, 0.45, 1, 0.35]),
        colorGraph: new pc.CurveSet([[0, 0.75], [0, 0.82], [0, 0.95]]),
        colorMap: streak,
        stretch: 0.6,
        alignToMotion: true,
        localSpace: false,
        lighting: false,
        depthWrite: false,
        blendType: pc.BLEND_NORMAL,
        loop: true,
        autoPlay: true,
        preWarm: true
      });
      e.enabled = false;
      this.root.addChild(e);
      this.rain.push({ entity: e, threshold });
    }

    for (const [i, threshold] of [0.04, 0.5].entries()) {
      const e = new pc.Entity(`Snow${i}`);
      e.addComponent('particlesystem', {
        numParticles: 1500,
        lifetime: 6,
        rate: 6 / 1500,
        rate2: 6 / 1500,
        emitterShape: pc.EMITTERSHAPE_BOX,
        emitterExtents: new pc.Vec3(60, 4, 60),
        localVelocityGraph: new pc.CurveSet([[0, -0.6, 1, 0.6], [0, -2.5], [0, 0.4, 1, -0.4]]),
        localVelocityGraph2: new pc.CurveSet([[0, 0.6, 1, -0.6], [0, -3.5], [0, -0.4, 1, 0.4]]),
        scaleGraph: new pc.Curve([0, 0.09]),
        alphaGraph: new pc.Curve([0, 0, 0.1, 0.9, 0.9, 0.9, 1, 0]),
        colorMap: soft,
        localSpace: false,
        lighting: false,
        depthWrite: false,
        blendType: pc.BLEND_NORMAL,
        loop: true,
        autoPlay: true,
        preWarm: true
      });
      e.enabled = false;
      this.root.addChild(e);
      this.snow.push({ entity: e, threshold });
    }

    this.fireflies = new pc.Entity('Fireflies');
    this.fireflies.addComponent('particlesystem', {
      numParticles: 160,
      lifetime: 5,
      rate: 0.03,
      rate2: 0.05,
      emitterShape: pc.EMITTERSHAPE_BOX,
      emitterExtents: new pc.Vec3(40, 2.5, 40),
      velocityGraph: new pc.CurveSet([[0, -0.4, 0.5, 0.4, 1, -0.2], [0, 0.1, 0.5, -0.15, 1, 0.1], [0, 0.3, 0.5, -0.4, 1, 0.2]]),
      velocityGraph2: new pc.CurveSet([[0, 0.4, 0.5, -0.4, 1, 0.3], [0, -0.1, 0.5, 0.2, 1, -0.1], [0, -0.3, 0.5, 0.4, 1, -0.3]]),
      scaleGraph: new pc.Curve([0, 0.12]),
      alphaGraph: new pc.Curve([0, 0, 0.2, 1, 0.5, 0.3, 0.8, 1, 1, 0]),
      colorGraph: new pc.CurveSet([[0, 0.8], [0, 1], [0, 0.35]]),
      colorMap: soft,
      localSpace: false,
      lighting: false,
      depthWrite: false,
      blendType: pc.BLEND_ADDITIVE,
      loop: true,
      autoPlay: true
    });
    this.fireflies.enabled = false;
    this.root.addChild(this.fireflies);
  }

  update(cam: pc.Vec3, ground: number, weather: WeatherState, night: boolean, nearGrass: boolean): void {
    const cold = cam.y > 42;
    const precip = weather.rain;
    // tilt emitters with the wind so rain slants
    const tilt = clamp(weather.wind, 0, 1) * 22;
    const yaw = (weather.windDir * 180) / Math.PI;
    for (const l of this.rain) {
      l.entity.enabled = !cold && precip > l.threshold;
      if (l.entity.enabled) {
        l.entity.setPosition(cam.x, cam.y + 18, cam.z);
        l.entity.setEulerAngles(tilt, yaw, 0);
      }
    }
    for (const l of this.snow) {
      l.entity.enabled = cold && precip > l.threshold;
      if (l.entity.enabled) {
        l.entity.setPosition(cam.x, cam.y + 14, cam.z);
        l.entity.setEulerAngles(tilt * 0.5, yaw, 0);
      }
    }
    const ff = night && precip < 0.05 && weather.fog < 0.5 && nearGrass;
    this.fireflies.enabled = ff;
    if (ff) this.fireflies.setPosition(cam.x, ground + 1.5, cam.z);
  }

  get activeParticleSystems(): number {
    let n = 0;
    for (const l of [...this.rain, ...this.snow]) if (l.entity.enabled) n++;
    return n + (this.fireflies.enabled ? 1 : 0);
  }

  destroy(): void {
    this.root.destroy();
    for (const t of this.textures) t.destroy();
  }
}
