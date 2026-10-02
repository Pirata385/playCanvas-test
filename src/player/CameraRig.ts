import * as pc from 'playcanvas';
import { clamp, damp } from '../core/math';
import type { Physics } from '../physics/Physics';
import type { WorldQuery } from '../world/WorldQuery';
import type { Input } from './Input';

export type CameraMode = 'third' | 'free' | 'follow';

/** Third-person orbit, free-fly and creature-follow camera with collision against the world. */
export class CameraRig {
  readonly entity: pc.Entity;
  mode: CameraMode = 'third';
  yaw = 0;
  pitch = -15;
  distance = 6;
  sensitivity = 0.12;
  private pos = new pc.Vec3();
  private pivot = new pc.Vec3();
  private q = new pc.Quat();
  private tmp = new pc.Vec3();
  private dir = new pc.Vec3();

  constructor(app: pc.AppBase) {
    this.entity = new pc.Entity('Camera');
    this.entity.addComponent('camera', {
      clearColor: new pc.Color(0.5, 0.65, 0.85),
      farClip: 3000,
      nearClip: 0.1,
      fov: 65,
      toneMapping: pc.TONEMAP_ACES,
      gammaCorrection: pc.GAMMA_SRGB
    });
    app.root.addChild(this.entity);
  }

  /** Yaw in radians (for camera-relative movement). */
  get yawRad(): number {
    return (this.yaw * Math.PI) / 180;
  }

  get position(): pc.Vec3 {
    return this.pos;
  }

  forward(out: pc.Vec3): pc.Vec3 {
    return out.copy(this.entity.forward);
  }

  setMode(mode: CameraMode): void {
    if (mode === 'free') this.pos.copy(this.entity.getPosition());
    this.mode = mode;
  }

  update(dt: number, input: Input, target: pc.Vec3, physics: Physics, world: WorldQuery, look: boolean): void {
    if (look) {
      this.yaw -= input.mouseDX * this.sensitivity;
      this.pitch = clamp(this.pitch - input.mouseDY * this.sensitivity, -85, 70);
    }
    if (this.mode !== 'free') this.distance = clamp(this.distance + input.wheel * 0.8, 1.2, 22);

    if (this.mode === 'free') {
      this.q.setFromEulerAngles(this.pitch, this.yaw, 0);
      const speed = (input.isDown('ShiftLeft') ? 70 : 18) * dt;
      const f = input.axis('KeyS', 'KeyW');
      const r = input.axis('KeyA', 'KeyD');
      const u = input.axis('KeyQ', 'KeyE');
      this.q.transformVector(this.tmp.set(r, 0, -f), this.dir);
      this.pos.add(this.dir.mulScalar(speed));
      this.pos.y += u * speed;
      if (input.wheel) this.pos.y -= input.wheel * 2;
      const floor = Math.max(world.heightAt(this.pos.x, this.pos.z), world.waterAt(this.pos.x, this.pos.z)) + 0.6;
      this.pos.y = clamp(this.pos.y, floor, 400);
      this.pos.x = clamp(this.pos.x, -400, world.size + 400);
      this.pos.z = clamp(this.pos.z, -400, world.size + 400);
      this.entity.setPosition(this.pos);
      this.entity.setEulerAngles(this.pitch, this.yaw, 0);
      return;
    }

    // orbit around the pivot
    this.pivot.lerp(this.pivot, target, this.pivot.lengthSq() === 0 ? 1 : damp(18, dt));
    if (this.pivot.distance(target) > 20) this.pivot.copy(target);
    this.q.setFromEulerAngles(this.pitch, this.yaw, 0);
    this.q.transformVector(this.tmp.set(0, 0, 1), this.dir);
    // shoulder offset for the third-person view
    const shoulder = this.mode === 'third' ? 0.45 : 0;
    const right = new pc.Vec3();
    this.q.transformVector(new pc.Vec3(1, 0, 0), right);
    const origin = new pc.Vec3(this.pivot.x + right.x * shoulder, this.pivot.y, this.pivot.z + right.z * shoulder);
    let dist = this.distance;
    const hit = physics.castRay(origin, this.dir, dist + 0.3);
    if (hit < dist + 0.3) dist = Math.max(0.6, hit - 0.3);
    this.pos.set(origin.x + this.dir.x * dist, origin.y + this.dir.y * dist, origin.z + this.dir.z * dist);
    const floor = Math.max(world.heightAt(this.pos.x, this.pos.z) + 0.35, world.waterAt(this.pos.x, this.pos.z) + 0.25);
    if (this.pos.y < floor) this.pos.y = floor;
    this.entity.setPosition(this.pos);
    this.entity.lookAt(origin);
  }
}
