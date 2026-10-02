# Isle of Seeds

A playable 3D ecosystem demo built with **PlayCanvas Engine**, **TypeScript**, **Vite**, **Rapier** physics and **Web Workers**.

Every island is generated from a seed. The same seed always produces the same terrain, rivers, lakes, biomes, vegetation, starting wildlife and weather. Rabbits, deer, foxes and wolves live on it. They get hungry and thirsty, graze, hunt, flee, sleep, court, give birth, age and die. The ecosystem keeps simulating in its own thread whether or not you are watching.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build in dist/
npm test           # determinism, world-gen, ecosystem, save/load and physics tests
```

Add `?seed=12345` to the URL to choose a world, and `&autostart` to skip the title screen.

## Gameplay

You play a field researcher. Explore the island in third person and inspect creatures. Inspect one of each species to complete your **field journal**. You can also throw stones to startle the wildlife, swim across lakes, follow an animal with the camera, or speed up time and watch populations rise and fall.

| Input | Action |
| --- | --- |
| `W A S D` / `Shift` / `Space` | Move / sprint / jump (swim up in water) |
| Mouse, wheel | Look (click the view to capture the mouse), camera distance |
| Left click / `E` | Inspect the creature under the crosshair |
| Right click / `F` | Throw a stone (Rapier rigid body) |
| `Tab` | Cursor mode: click creatures directly, right-drag to look |
| `V` | Switch between third-person and free-fly camera (`Q`/`E` down/up) |
| `M` | Island map. Click a spot to fast-travel there |
| `0`–`6`, `[` `]` | Time speed: pause, 1×, 2×, 5×, 10×, 30×, 60× |
| `Esc` / `P` | Pause menu: save slots, export/import, regenerate, new seed, settings |
| `F5` / `F9` | Quick save / quick load (slot 1) |
| `F3` | Debug panel |
| `H` | Hide the HUD |

Sprinting near herbivores scares them. Predators ignore you.

## Architecture

```
src/
  core/      Game orchestrator, seeded RNG, math, binary heap
  world/     Procedural generation (pure), types, queries, worker client
  sim/       Ecosystem (pure, deterministic), species, weather, A*, worker protocol & client
  workers/   worldgen.worker.ts, sim.worker.ts
  physics/   Rapier world: heightfield, static props, character controller, stones, creature proxies
  render/    Terrain & water, instanced vegetation, instanced animated creatures, sky/day-night, particles
  player/    Input, character controller, procedural avatar, third-person/free/follow camera
  audio/     Procedural Web Audio soundscape (no audio assets)
  ui/        HUD, minimap, inspector, debug panel, menus
  save/      LocalStorage slots + JSON export/import
```

### Threads

* **World generation worker.** Builds the heightmap and everything derived from it, then returns the typed arrays as transferables:
  * Domain-warped simplex fBm with ridged mountains and a radial island falloff.
  * Lake basins, filled with priority-flood depression filling.
  * Rivers from the drainage tree of an epsilon priority flood, plus flow accumulation weighted by rainfall.
  * Distance fields, moisture, biomes and vertex colours.
  * Vegetation placement and the navigation grid, including a water-distance flow field.
* **Simulation worker.** Hosts the `Ecosystem` and advances it in fixed 0.1 s ticks, multiplied by the time scale. Each frame has a time budget so it can't fall into a catch-up spiral. About 20 times per second it streams compact `Float32Array` snapshots to the main thread, which interpolates them. Saving, loading, selection, scare events and player position all go through a typed message protocol (`sim/protocol.ts`).
* **Main thread.** Runs rendering, physics, input, audio and UI.

### Determinism

All randomness comes from seeded `Rng` instances (Mulberry32), forked per subsystem. World generation is bit-identical for a seed. The ecosystem is a pure function of its seed and tick count, and that includes the weather.

Save files store the complete simulation state, including the RNG state and the grazing grid as raw float bytes. Loading a save and stepping forward reproduces the original run exactly (see `tests/ecosystem.test.ts`). The one non-deterministic input is the player: scaring animals changes their behaviour.

### Rendering (PlayCanvas)

* **Terrain.** A single 66k-vertex mesh with baked biome vertex colours. The lake and river surfaces are generated from the water-level grid. Water materials scroll a procedural normal map with the wind.
* **Vegetation.** About 4–6k trees, rocks, grass, reeds and flowers, drawn with **hardware instancing**. Each vegetation type gets one draw call per world chunk, with custom AABBs for frustum culling and distance culling for small detail.
* **Creatures.** Built from merged primitives. Each species has four instanced parts (body, head, legs ×4, tail). The animation is procedural, computed on the CPU into dynamic instance buffers: trot and hop gaits, eating and drinking poses, sleeping with folded legs, death and decay, courtship, tail wagging and terrain-aligned pitch.
* **Sky and lighting.**
  * Sky dome with a per-vertex gradient, plus sun, moon and twinkling stars.
  * Instanced clouds that drift with the wind.
  * Directional sun and moon light with cascaded shadows.
  * Ambient light and fog driven by time of day and weather, plus lightning flashes.
* **Particles.** GPU particle systems for wind-slanted layered rain, snow at altitude and fireflies on calm nights.

### Physics (Rapier)

* A heightfield collider that matches the rendered triangulation (verified by tests).
* Static cylinder and ball colliders for trees and boulders.
* A kinematic character controller with autostep, slope limits and snap-to-ground. Buoyant swimming is built on top of it.
* Dynamic thrown stones with CCD.
* A pool of kinematic proxies that follow the nearest creatures, so they block the player and stones.
* The camera uses Rapier ray casts so it doesn't clip through the world.

### Ecosystem

Each animal has hunger, thirst, energy, health, age, sex and a lifespan. The decision loop works by priority:

1. Flee threats.
2. Keep sleeping during the species' sleep window.
3. Drink, by descending the water-distance flow field.
4. Graze the regrowing food grid, or hunt.
5. Rest.
6. Court a mate (which leads to pregnancy, then a litter).
7. Juveniles follow their mother.
8. Wander.

Movement uses steering with obstacle probing, and falls back to weighted A* with an expansion budget when an animal gets stuck. Predators stalk, then sprint, and tire during a chase. Prey get a burst of speed when they first flee. Carcasses can be eaten and decay over time. Births are capped by a carrying capacity. If a species dies out, a pair migrates ashore so the demo stays alive.

### Audio

Everything is synthesised at runtime from noise buffers and oscillators:

* Wind gusts, rain, surf that depends on distance to the ocean, and streams near fresh water.
* Birdsong in forests by day and crickets at night.
* Thunder delayed by the speed of sound.
* Footsteps that change with the surface.
* Stereo-panned wolf howls, fox barks, deer bellows and rabbit squeaks.

### Debug panel (`F3`)

Shows FPS and frame time, draw calls, terrain triangles, scene entity count, simulated agents, per-species populations, sim tick, ticks per second and ms per tick, time scale, seed, Rapier bodies and colliders, vegetation instances, active particle systems, grazing food level, births and deaths, and a live population graph.

It also has two buttons for showing off the demo: **Next weather** cycles the weather regime, and **Skip 3h** simulates three in-game hours instantly.

## Tests

`npm test` runs Vitest suites covering:

* RNG and heap behaviour.
* Deterministic world generation.
* Island sanity checks.
* Ecosystem determinism, survival of every species over several days, and bit-exact save/load continuation.
* Rapier heightfield alignment and character landing.

`npm run smoke` builds the game and runs two headless Chromium scenarios (`scripts/smoke.mjs` and `scripts/smoke-extra.mjs`). Between them they cover the title screen, third-person play, creature inspection and follow cam, stone throwing, quick save/load, the aerial view, night, rain and storm particles, swimming, the map and the pause menu. They save screenshots and fail if any console errors appear.
