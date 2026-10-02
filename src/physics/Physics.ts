import RAPIER from '@dimforge/rapier3d-compat';
import { SOLID_VEG, VEG_STRIDE, VegType, type WorldData } from '../world/types';

let rapierReady: Promise<void> | null = null;

/** Load the Rapier WASM module once. */
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Convert row-major (z * R + x) heights to Rapier's column-major heightfield layout. */
export function toRapierHeights(heights: Float32Array, R: number): Float32Array {
  const out = new Float32Array(R * R);
  for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) out[x * R + z] = heights[z * R + x];
  return out;
}

const PROXY_COUNT = 40;
const PLAYER_GROUP = 0x0001;
const WORLD_GROUP = 0x0002;
const PROXY_GROUP = 0x0004;
const STONE_GROUP = 0x0008;
const groups = (member: number, filter: number) => (member << 16) | filter;

export interface Stone {
  body: RAPIER.RigidBody;
  age: number;
  landed: boolean;
  hit: boolean;
}

/**
 * Rapier physics world: heightfield terrain, static colliders for trees and
 * boulders, a kinematic character controller for the player, dynamic thrown
 * stones and kinematic proxies that let creatures block the player and stones.
 */
export class Physics {
  readonly world: RAPIER.World;
  readonly playerBody: RAPIER.RigidBody;
  readonly playerCollider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly stones: Stone[] = [];
  private proxies: RAPIER.RigidBody[] = [];
  private proxyColliders: RAPIER.Collider[] = [];
  private accumulator = 0;
  readonly step = 1 / 60;
  staticColliders = 0;
  readonly playerHalfHeight = 0.5;
  readonly playerRadius = 0.35;

  constructor(world: WorldData, spawn: Vec3Like) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.step;
    const R = world.res;
    const size = world.size;

    // terrain + static props share one fixed body
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(size / 2, 0, size / 2));
    const hf = RAPIER.ColliderDesc.heightfield(R - 1, R - 1, toRapierHeights(world.heights, R), { x: size, y: 1, z: size })
      .setFriction(0.9)
      .setCollisionGroups(groups(WORLD_GROUP, 0xffff));
    this.world.createCollider(hf, ground);
    this.staticColliders++;
    const veg = world.vegetation;
    for (let i = 0; i < veg.length; i += VEG_STRIDE) {
      const type = veg[i] as VegType;
      if (!SOLID_VEG.has(type)) continue;
      const s = veg[i + 4];
      const lx = veg[i + 1] - size / 2;
      const ly = veg[i + 2];
      const lz = veg[i + 3] - size / 2;
      let desc: RAPIER.ColliderDesc;
      if (type === VegType.Boulder) desc = RAPIER.ColliderDesc.ball(1.05 * s).setTranslation(lx, ly + 0.45 * s, lz);
      else {
        const r = (type === VegType.Birch ? 0.17 : 0.24) * s;
        desc = RAPIER.ColliderDesc.cylinder(2.2 * s, r).setTranslation(lx, ly + 2.2 * s, lz);
      }
      desc.setCollisionGroups(groups(WORLD_GROUP, 0xffff));
      this.world.createCollider(desc, ground);
      this.staticColliders++;
    }

    // player: kinematic capsule driven by the character controller
    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + 1.2, spawn.z)
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(this.playerHalfHeight, this.playerRadius).setCollisionGroups(groups(PLAYER_GROUP, WORLD_GROUP | PROXY_GROUP | STONE_GROUP)),
      this.playerBody
    );
    this.controller = this.world.createCharacterController(0.05);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.6);
    this.controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(70);

    // creature proxies (parked far below the world until assigned)
    for (let i = 0; i < PROXY_COUNT; i++) {
      const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500 - i * 5, 0));
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.ball(0.5).setCollisionGroups(groups(PROXY_GROUP, PLAYER_GROUP | STONE_GROUP)),
        b
      );
      this.proxies.push(b);
      this.proxyColliders.push(c);
    }
  }

  /** Move the player capsule, resolving collisions. Returns the corrected translation and grounded flag. */
  movePlayer(desired: Vec3Like): { x: number; y: number; z: number; grounded: boolean } {
    this.controller.computeColliderMovement(this.playerCollider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.controller.computedMovement();
    const p = this.playerBody.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    this.playerBody.setNextKinematicTranslation(next);
    return { ...next, grounded: this.controller.computedGrounded() };
  }

  teleportPlayer(p: Vec3Like): void {
    this.playerBody.setTranslation(p, true);
    this.playerBody.setNextKinematicTranslation(p);
  }

  get playerPosition(): Vec3Like {
    return this.playerBody.translation();
  }

  /** Place creature proxies (radius-scaled spheres) at the given positions. */
  setProxies(list: Array<{ x: number; y: number; z: number; r: number }>): void {
    for (let i = 0; i < this.proxies.length; i++) {
      const p = list[i];
      if (p) {
        this.proxyColliders[i].setRadius(p.r);
        this.proxies[i].setNextKinematicTranslation({ x: p.x, y: p.y + p.r, z: p.z });
      } else {
        this.proxies[i].setNextKinematicTranslation({ x: 0, y: -500 - i * 5, z: 0 });
      }
    }
  }

  throwStone(from: Vec3Like, velocity: Vec3Like): Stone {
    if (this.stones.length >= 24) this.removeStone(this.stones[0]);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngularDamping(0.8).setCcdEnabled(true)
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(0.13).setDensity(2.6).setRestitution(0.35).setFriction(0.8)
        .setCollisionGroups(groups(STONE_GROUP, WORLD_GROUP | PROXY_GROUP | STONE_GROUP | PLAYER_GROUP)),
      body
    );
    const stone: Stone = { body, age: 0, landed: false, hit: false };
    this.stones.push(stone);
    return stone;
  }

  removeStone(s: Stone): void {
    const i = this.stones.indexOf(s);
    if (i >= 0) this.stones.splice(i, 1);
    this.world.removeRigidBody(s.body);
  }

  /** Advance with a fixed timestep. Returns the number of substeps taken. */
  update(dt: number): number {
    this.accumulator = Math.min(this.accumulator + dt, this.step * 5);
    let n = 0;
    while (this.accumulator >= this.step) {
      this.world.step();
      this.accumulator -= this.step;
      n++;
    }
    for (const s of this.stones) s.age += dt;
    return n;
  }

  /** Distance along a ray to the first static/world hit, or maxToi. */
  castRay(origin: Vec3Like, dir: Vec3Like, maxToi: number): number {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, true, undefined, groups(0xffff, WORLD_GROUP));
    return hit ? hit.timeOfImpact : maxToi;
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  destroy(): void {
    this.world.free();
  }
}
