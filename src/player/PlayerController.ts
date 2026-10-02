import { clamp, damp } from '../core/math';
import type { Physics } from '../physics/Physics';
import type { WorldQuery } from '../world/WorldQuery';
import type { Input } from './Input';

const WALK = 4.2;
const SPRINT = 8.5;
const SWIM = 2.6;
const GRAVITY = 22;
const JUMP = 7.5;

/** Third-person character movement on top of Rapier's kinematic character controller. */
export class PlayerController {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  facing = 0;
  grounded = false;
  swimming = false;
  speed = 0;
  sprinting = false;
  private jumpBuffer = 0;
  /** Fired when the player jumps, splashes in, etc. */
  onEvent: (kind: 'jump' | 'splash') => void = () => {};

  constructor(private physics: Physics, private world: WorldQuery) {
    const p = physics.playerPosition;
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
  }

  /** Feet height of the capsule. */
  get feetY(): number {
    return this.y - this.physics.playerHalfHeight - this.physics.playerRadius;
  }

  update(dt: number, input: Input, camYaw: number, enabled: boolean): void {
    const fwd = enabled ? input.axis('KeyS', 'KeyW') : 0;
    const strafe = enabled ? input.axis('KeyA', 'KeyD') : 0;
    this.sprinting = enabled && input.isDown('ShiftLeft') && fwd > 0;
    // camera-relative movement (camera looks down -Z at yaw 0)
    const sy = Math.sin(camYaw);
    const cy = Math.cos(camYaw);
    let dx = -sy * fwd + cy * strafe;
    let dz = -cy * fwd - sy * strafe;
    const len = Math.hypot(dx, dz);
    if (len > 1e-3) {
      dx /= len;
      dz /= len;
    }
    const water = this.world.waterAt(this.x, this.z);
    const depth = water - this.feetY;
    const wasSwimming = this.swimming;
    // hysteresis so floating at the surface stays in the swimming state
    this.swimming = depth > (wasSwimming ? 0.8 : 1.05);
    if (this.swimming && !wasSwimming && this.vy < -3) this.onEvent('splash');
    const wading = !this.swimming && depth > 0.3;
    const target = this.swimming ? SWIM : this.sprinting ? SPRINT : wading ? WALK * 0.6 : WALK;
    const k = damp(this.grounded || this.swimming ? 12 : 2.5, dt);
    this.vx += (dx * target * (len > 0 ? 1 : 0) - this.vx) * k;
    this.vz += (dz * target * (len > 0 ? 1 : 0) - this.vz) * k;

    if (enabled && input.pressed('Space')) this.jumpBuffer = 0.15;
    this.jumpBuffer -= dt;
    if (this.swimming) {
      // buoyancy: float with the head above water
      const targetY = water - 0.35;
      this.vy += ((targetY - this.y) * 6 - this.vy) * damp(4, dt);
      if (enabled && input.isDown('Space')) this.vy = Math.max(this.vy, 2.5);
    } else {
      this.vy -= GRAVITY * dt;
      if (this.grounded && this.jumpBuffer > 0) {
        this.vy = JUMP;
        this.jumpBuffer = 0;
        this.grounded = false;
        this.onEvent('jump');
      }
    }
    this.vy = Math.max(this.vy, -40);

    const res = this.physics.movePlayer({ x: this.vx * dt, y: this.vy * dt, z: this.vz * dt });
    // keep the explorer on the island's ocean margin
    const size = this.world.size;
    res.x = clamp(res.x, -60, size + 60);
    res.z = clamp(res.z, -60, size + 60);
    if (res.grounded && this.vy < 0) this.vy = 0;
    // safety net: never fall through the terrain
    const ground = this.world.heightAt(res.x, res.z);
    const minY = ground + this.physics.playerHalfHeight + this.physics.playerRadius - 0.05;
    if (res.y < minY - 0.5) {
      res.y = minY;
      this.vy = 0;
      this.physics.teleportPlayer(res);
    }
    const moved = Math.hypot(res.x - this.x, res.z - this.z) / Math.max(dt, 1e-4);
    this.speed += (moved - this.speed) * damp(10, dt);
    this.x = res.x;
    this.y = res.y;
    this.z = res.z;
    this.grounded = res.grounded;
    if (len > 1e-3) {
      const want = Math.atan2(dx, dz);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * damp(12, dt);
    }
  }

  teleport(x: number, z: number): void {
    const y = Math.max(this.world.heightAt(x, z), this.world.waterAt(x, z) - 1) + 1.6;
    this.physics.teleportPlayer({ x, y, z });
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
  }
}
