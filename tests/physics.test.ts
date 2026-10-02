import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { initRapier, Physics, toRapierHeights } from '../src/physics/Physics';
import { generateWorld, sampleHeight } from '../src/world/generate';
import type { WorldData } from '../src/world/types';

let world: WorldData;

beforeAll(async () => {
  await initRapier();
  world = generateWorld(4242);
});

describe('physics heightfield', () => {
  it('matches the rendered terrain surface', () => {
    const R = world.res;
    const rw = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = rw.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(world.size / 2, 0, world.size / 2));
    rw.createCollider(RAPIER.ColliderDesc.heightfield(R - 1, R - 1, toRapierHeights(world.heights, R), { x: world.size, y: 1, z: world.size }), body);
    rw.step();
    const samples = [[101.3, 377.1], [world.size * 0.4, world.size * 0.55], [world.size * 0.62, world.size * 0.38], [250, 130]];
    for (const [x, z] of samples) {
      const hit = rw.castRay(new RAPIER.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 }), 500, true);
      expect(hit).not.toBeNull();
      const y = 200 - hit!.timeOfImpact;
      expect(Math.abs(y - sampleHeight(world.heights, R, world.cell, x, z))).toBeLessThan(0.6);
    }
    rw.free();
  });

  it('lets the player capsule land on the ground', () => {
    const [sx, sz] = world.spawn;
    const ground = sampleHeight(world.heights, world.res, world.cell, sx, sz);
    const physics = new Physics(world, { x: sx, y: ground + 3, z: sz });
    physics.world.step();
    let pos = physics.playerPosition;
    for (let i = 0; i < 240; i++) {
      pos = physics.movePlayer({ x: 0, y: -0.2, z: 0 });
      physics.world.step();
    }
    const feet = pos.y - physics.playerHalfHeight - physics.playerRadius;
    expect(Math.abs(feet - ground)).toBeLessThan(0.5);
    physics.destroy();
  });
});
