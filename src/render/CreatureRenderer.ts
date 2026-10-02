import * as pc from 'playcanvas';
import { angleDiff, clamp, type RGB } from '../core/math';
import { SNAP_STRIDE } from '../sim/Ecosystem';
import { Anim, SPECIES, SPECIES_COUNT, Species } from '../sim/species';
import type { WorldQuery } from '../world/WorldQuery';
import { buildMesh, vertexColorMaterial, type Part } from './meshFactory';

type V3 = [number, number, number];

interface CreatureModel {
  body: Part[];
  head: Part[];
  leg: Part[];
  tail: Part[];
  /** Height of the body pivot above ground. */
  bodyY: number;
  headPivot: V3;
  tailPivot: V3;
  /** Hip/shoulder pivots: FL, FR, BL, BR. */
  legPivots: [V3, V3, V3, V3];
  legLength: number;
  /** Stride frequency multiplier (steps per metre). */
  stride: number;
  hop: boolean;
  /** Approximate pick radius and centre height (adult). */
  pickRadius: number;
}

const EYE: RGB = [0.05, 0.05, 0.05];

function models(): Record<Species, CreatureModel> {
  const rabbitFur: RGB = [0.62, 0.52, 0.4];
  const deerFur: RGB = [0.6, 0.38, 0.2];
  const foxFur: RGB = [0.85, 0.4, 0.14];
  const wolfFur: RGB = [0.5, 0.52, 0.55];
  return {
    [Species.Rabbit]: {
      body: [
        { kind: 'sphere', color: rabbitFur, scale: [0.3, 0.28, 0.44], segments: 7 },
        { kind: 'sphere', color: [0.85, 0.82, 0.76], pos: [0, -0.06, 0.04], scale: [0.22, 0.18, 0.32], segments: 6 }
      ],
      head: [
        { kind: 'sphere', color: rabbitFur, pos: [0, 0.06, 0.08], scale: [0.2, 0.19, 0.22], segments: 7 },
        { kind: 'box', color: rabbitFur, pos: [0.045, 0.24, 0.04], rot: [-12, 0, 8], scale: [0.05, 0.22, 0.03] },
        { kind: 'box', color: rabbitFur, pos: [-0.045, 0.24, 0.04], rot: [-12, 0, -8], scale: [0.05, 0.22, 0.03] },
        { kind: 'sphere', color: [0.9, 0.6, 0.6], pos: [0, 0.05, 0.19], scale: [0.04, 0.03, 0.03], segments: 4 },
        { kind: 'sphere', color: EYE, pos: [0.07, 0.09, 0.14], scale: [0.03, 0.03, 0.03], segments: 4 },
        { kind: 'sphere', color: EYE, pos: [-0.07, 0.09, 0.14], scale: [0.03, 0.03, 0.03], segments: 4 }
      ],
      leg: [{ kind: 'box', color: [0.55, 0.46, 0.35], pos: [0, -0.07, 0.02], scale: [0.07, 0.14, 0.12] }],
      tail: [{ kind: 'sphere', color: [0.95, 0.95, 0.93], scale: [0.1, 0.1, 0.1], segments: 5 }],
      bodyY: 0.2,
      headPivot: [0, 0.31, 0.18],
      tailPivot: [0, 0.24, -0.22],
      legPivots: [[0.07, 0.14, 0.13], [-0.07, 0.14, 0.13], [0.09, 0.14, -0.12], [-0.09, 0.14, -0.12]],
      legLength: 0.14,
      stride: 1.4,
      hop: true,
      pickRadius: 0.45
    },
    [Species.Deer]: {
      body: [
        { kind: 'sphere', color: deerFur, scale: [0.5, 0.55, 1.25], segments: 8 },
        { kind: 'sphere', color: [0.85, 0.75, 0.6], pos: [0, -0.15, 0], scale: [0.36, 0.3, 1.0], segments: 6 }
      ],
      head: [
        { kind: 'cylinder', color: deerFur, pos: [0, 0.25, 0.05], rot: [30, 0, 0], scale: [0.2, 0.6, 0.22], segments: 6 },
        { kind: 'box', color: deerFur, pos: [0, 0.55, 0.25], rot: [20, 0, 0], scale: [0.2, 0.22, 0.42] },
        { kind: 'box', color: [0.2, 0.15, 0.12], pos: [0, 0.48, 0.47], rot: [20, 0, 0], scale: [0.1, 0.08, 0.06] },
        { kind: 'box', color: deerFur, pos: [0.14, 0.7, 0.15], rot: [0, 0, -40], scale: [0.18, 0.06, 0.08] },
        { kind: 'box', color: deerFur, pos: [-0.14, 0.7, 0.15], rot: [0, 0, 40], scale: [0.18, 0.06, 0.08] },
        { kind: 'cylinder', color: [0.75, 0.68, 0.55], pos: [0.1, 0.85, 0.15], rot: [0, 0, -20], scale: [0.04, 0.4, 0.04], segments: 4 },
        { kind: 'cylinder', color: [0.75, 0.68, 0.55], pos: [-0.1, 0.85, 0.15], rot: [0, 0, 20], scale: [0.04, 0.4, 0.04], segments: 4 },
        { kind: 'cylinder', color: [0.75, 0.68, 0.55], pos: [0.16, 0.95, 0.2], rot: [40, 0, -10], scale: [0.03, 0.2, 0.03], segments: 4 },
        { kind: 'cylinder', color: [0.75, 0.68, 0.55], pos: [-0.16, 0.95, 0.2], rot: [40, 0, 10], scale: [0.03, 0.2, 0.03], segments: 4 },
        { kind: 'sphere', color: EYE, pos: [0.1, 0.6, 0.35], scale: [0.04, 0.04, 0.04], segments: 4 },
        { kind: 'sphere', color: EYE, pos: [-0.1, 0.6, 0.35], scale: [0.04, 0.04, 0.04], segments: 4 }
      ],
      leg: [
        { kind: 'cylinder', color: deerFur, pos: [0, -0.22, 0], scale: [0.12, 0.45, 0.12], segments: 5 },
        { kind: 'cylinder', color: [0.4, 0.26, 0.15], pos: [0, -0.65, 0], scale: [0.07, 0.45, 0.07], segments: 5 },
        { kind: 'box', color: [0.12, 0.1, 0.08], pos: [0, -0.88, 0.02], scale: [0.08, 0.05, 0.1] }
      ],
      tail: [{ kind: 'cone', color: [0.95, 0.93, 0.88], pos: [0, -0.06, -0.02], rot: [-150, 0, 0], scale: [0.12, 0.22, 0.08], segments: 5 }],
      bodyY: 1.05,
      headPivot: [0, 1.2, 0.5],
      tailPivot: [0, 1.25, -0.6],
      legPivots: [[0.16, 0.9, 0.42], [-0.16, 0.9, 0.42], [0.16, 0.9, -0.42], [-0.16, 0.9, -0.42]],
      legLength: 0.9,
      stride: 0.55,
      hop: false,
      pickRadius: 1.1
    },
    [Species.Fox]: {
      body: [
        { kind: 'sphere', color: foxFur, scale: [0.28, 0.28, 0.72], segments: 7 },
        { kind: 'sphere', color: [0.95, 0.9, 0.82], pos: [0, -0.06, 0.12], scale: [0.18, 0.18, 0.4], segments: 6 }
      ],
      head: [
        { kind: 'sphere', color: foxFur, pos: [0, 0.04, 0.06], scale: [0.24, 0.2, 0.22], segments: 7 },
        { kind: 'cone', color: [0.95, 0.9, 0.82], pos: [0, 0.0, 0.22], rot: [90, 0, 0], scale: [0.12, 0.2, 0.1], segments: 5 },
        { kind: 'sphere', color: EYE, pos: [0, 0.01, 0.33], scale: [0.04, 0.04, 0.04], segments: 4 },
        { kind: 'cone', color: [0.3, 0.15, 0.08], pos: [0.07, 0.18, 0.04], scale: [0.08, 0.14, 0.05], segments: 4 },
        { kind: 'cone', color: [0.3, 0.15, 0.08], pos: [-0.07, 0.18, 0.04], scale: [0.08, 0.14, 0.05], segments: 4 },
        { kind: 'sphere', color: EYE, pos: [0.07, 0.07, 0.15], scale: [0.03, 0.03, 0.03], segments: 4 },
        { kind: 'sphere', color: EYE, pos: [-0.07, 0.07, 0.15], scale: [0.03, 0.03, 0.03], segments: 4 }
      ],
      leg: [
        { kind: 'cylinder', color: [0.25, 0.14, 0.08], pos: [0, -0.15, 0], scale: [0.07, 0.3, 0.07], segments: 5 }
      ],
      tail: [
        { kind: 'sphere', color: foxFur, pos: [0, -0.04, -0.22], rot: [-25, 0, 0], scale: [0.16, 0.16, 0.48], segments: 6 },
        { kind: 'sphere', color: [0.97, 0.95, 0.9], pos: [0, -0.15, -0.44], rot: [-25, 0, 0], scale: [0.1, 0.1, 0.14], segments: 5 }
      ],
      bodyY: 0.42,
      headPivot: [0, 0.52, 0.34],
      tailPivot: [0, 0.48, -0.32],
      legPivots: [[0.09, 0.32, 0.22], [-0.09, 0.32, 0.22], [0.09, 0.32, -0.22], [-0.09, 0.32, -0.22]],
      legLength: 0.3,
      stride: 1.0,
      hop: false,
      pickRadius: 0.6
    },
    [Species.Wolf]: {
      body: [
        { kind: 'sphere', color: wolfFur, scale: [0.44, 0.48, 1.1], segments: 8 },
        { kind: 'sphere', color: [0.38, 0.4, 0.42], pos: [0, 0.12, 0.25], scale: [0.4, 0.38, 0.5], segments: 6 },
        { kind: 'sphere', color: [0.75, 0.75, 0.73], pos: [0, -0.1, 0.1], scale: [0.3, 0.28, 0.7], segments: 6 }
      ],
      head: [
        { kind: 'sphere', color: wolfFur, pos: [0, 0.05, 0.08], scale: [0.32, 0.28, 0.32], segments: 7 },
        { kind: 'box', color: [0.62, 0.62, 0.6], pos: [0, -0.03, 0.3], scale: [0.14, 0.12, 0.26] },
        { kind: 'box', color: EYE, pos: [0, 0.0, 0.44], scale: [0.06, 0.05, 0.04] },
        { kind: 'cone', color: [0.4, 0.42, 0.45], pos: [0.09, 0.24, 0.04], scale: [0.1, 0.16, 0.06], segments: 4 },
        { kind: 'cone', color: [0.4, 0.42, 0.45], pos: [-0.09, 0.24, 0.04], scale: [0.1, 0.16, 0.06], segments: 4 },
        { kind: 'sphere', color: [0.85, 0.75, 0.2], pos: [0.09, 0.1, 0.2], scale: [0.04, 0.04, 0.04], segments: 4 },
        { kind: 'sphere', color: [0.85, 0.75, 0.2], pos: [-0.09, 0.1, 0.2], scale: [0.04, 0.04, 0.04], segments: 4 }
      ],
      leg: [
        { kind: 'cylinder', color: wolfFur, pos: [0, -0.25, 0], scale: [0.11, 0.5, 0.11], segments: 5 },
        { kind: 'box', color: [0.3, 0.3, 0.32], pos: [0, -0.53, 0.03], scale: [0.1, 0.06, 0.14] }
      ],
      tail: [{ kind: 'sphere', color: [0.45, 0.47, 0.5], pos: [0, -0.12, -0.24], rot: [-35, 0, 0], scale: [0.14, 0.14, 0.55], segments: 6 }],
      bodyY: 0.78,
      headPivot: [0, 0.95, 0.55],
      tailPivot: [0, 0.88, -0.5],
      legPivots: [[0.15, 0.56, 0.36], [-0.15, 0.56, 0.36], [0.15, 0.56, -0.36], [-0.15, 0.56, -0.36]],
      legLength: 0.56,
      stride: 0.7,
      hop: false,
      pickRadius: 0.9
    }
  };
}

interface PartBatch {
  mi: pc.MeshInstance;
  vb: pc.VertexBuffer;
  data: Float32Array;
  count: number;
  perCreature: number;
}

interface SpeciesBatch {
  model: CreatureModel;
  body: PartBatch;
  head: PartBatch;
  legs: PartBatch;
  tail: PartBatch;
}

/** Interpolated, render-side state for one creature. */
export interface RenderCreature {
  id: number;
  species: Species;
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  anim: Anim;
  growth: number;
  ageOrDeath: number;
  fromX: number;
  fromZ: number;
  fromH: number;
  toX: number;
  toZ: number;
  toH: number;
  phase: number;
  seen: number;
  pitch: number;
}

const MAX_PER_SPECIES = 400;

/**
 * Draws every creature with instanced, procedurally animated body parts:
 * 4 draw calls per species regardless of population.
 */
export class CreatureRenderer {
  readonly root: pc.Entity;
  readonly creatures = new Map<number, RenderCreature>();
  private batches: SpeciesBatch[] = [];
  private material: pc.StandardMaterial;
  private ring: pc.Entity;
  private snapshotSeq = 0;
  private interp = 0;
  private interval = 0.05;
  private lastSnapshotAt = 0;
  private time = 0;
  selectedId: number | null = null;

  // scratch
  private root4 = new pc.Mat4();
  private tmp = new pc.Mat4();
  private local = new pc.Mat4();
  private q = new pc.Quat();
  private v = new pc.Vec3();
  private s = new pc.Vec3();

  constructor(app: pc.AppBase, private world: WorldQuery) {
    this.root = new pc.Entity('Creatures');
    app.root.addChild(this.root);
    this.material = vertexColorMaterial({ gloss: 0.25 });
    const device = app.graphicsDevice;
    const all = models();
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const model = all[s as Species];
      const mk = (parts: Part[], perCreature: number, name: string): PartBatch => {
        const mesh = buildMesh(device, parts, 0.05);
        const data = new Float32Array(MAX_PER_SPECIES * perCreature * 16);
        const vb = new pc.VertexBuffer(device, pc.VertexFormat.getDefaultInstancingFormat(device), MAX_PER_SPECIES * perCreature, {
          data, usage: pc.BUFFER_DYNAMIC
        });
        const mi = new pc.MeshInstance(mesh, this.material);
        mi.setInstancing(vb);
        mi.instancingCount = 0;
        const e = new pc.Entity(`${SPECIES[s as Species].name}-${name}`);
        e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
        this.root.addChild(e);
        return { mi, vb, data, count: 0, perCreature };
      };
      this.batches.push({
        model,
        body: mk(model.body, 1, 'body'),
        head: mk(model.head, 1, 'head'),
        legs: mk(model.leg, 4, 'legs'),
        tail: mk(model.tail, 1, 'tail')
      });
    }
    const ringMat = new pc.StandardMaterial();
    ringMat.emissive = new pc.Color(1, 0.85, 0.3);
    ringMat.diffuse = new pc.Color(0, 0, 0);
    ringMat.useLighting = false;
    ringMat.opacity = 0.85;
    ringMat.blendType = pc.BLEND_NORMAL;
    ringMat.update();
    this.ring = new pc.Entity('SelectionRing');
    const ringMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({ tubeRadius: 0.035, ringRadius: 0.5, segments: 40, sides: 6 }));
    this.ring.addComponent('render', { meshInstances: [new pc.MeshInstance(ringMesh, ringMat)], castShadows: false });
    this.ring.enabled = false;
    app.root.addChild(this.ring);
  }

  /** Ingest a new simulation snapshot. */
  applySnapshot(buffer: Float32Array, count: number, now: number): void {
    this.snapshotSeq++;
    if (this.lastSnapshotAt > 0) this.interval = clamp(this.interval * 0.8 + (now - this.lastSnapshotAt) * 0.2, 0.02, 0.2);
    this.lastSnapshotAt = now;
    this.interp = 0;
    for (let i = 0; i < count; i++) {
      const o = i * SNAP_STRIDE;
      const id = buffer[o];
      let c = this.creatures.get(id);
      const x = buffer[o + 2];
      const z = buffer[o + 3];
      const h = buffer[o + 4];
      if (!c) {
        c = {
          id, species: buffer[o + 1] as Species, x, z, y: this.world.heightAt(x, z), heading: h, speed: 0, anim: Anim.Move,
          growth: 1, ageOrDeath: 0, fromX: x, fromZ: z, fromH: h, toX: x, toZ: z, toH: h, phase: (id * 1.37) % 6.28, seen: 0, pitch: 0
        };
        this.creatures.set(id, c);
      }
      const teleport = (x - c.x) ** 2 + (z - c.z) ** 2 > 400;
      c.fromX = teleport ? x : c.x;
      c.fromZ = teleport ? z : c.z;
      c.fromH = teleport ? h : c.heading;
      c.toX = x;
      c.toZ = z;
      c.toH = h;
      c.speed = buffer[o + 5];
      c.anim = buffer[o + 6] as Anim;
      c.growth = buffer[o + 7];
      c.ageOrDeath = buffer[o + 11];
      c.seen = this.snapshotSeq;
    }
    for (const [id, c] of this.creatures) if (c.seen !== this.snapshotSeq) this.creatures.delete(id);
  }

  update(dt: number, camX: number, camZ: number, simScale: number): void {
    if (simScale > 0) this.time += dt;
    this.interp = Math.min(1, this.interp + dt / this.interval);
    const t = this.interp;
    for (const b of this.batches) b.body.count = b.head.count = b.legs.count = b.tail.count = 0;
    const maxDist2 = 240 * 240;
    for (const c of this.creatures.values()) {
      c.x = c.fromX + (c.toX - c.fromX) * t;
      c.z = c.fromZ + (c.toZ - c.fromZ) * t;
      c.heading = c.fromH + angleDiff(c.fromH, c.toH) * t;
      c.y = this.world.heightAt(c.x, c.z);
      const model = this.batches[c.species].model;
      c.phase += c.speed * dt * model.stride * Math.PI * Math.min(4, simScale);
      if ((c.x - camX) ** 2 + (c.z - camZ) ** 2 > maxDist2) continue;
      this.writeCreature(c);
    }
    for (const b of this.batches) {
      for (const p of [b.body, b.head, b.legs, b.tail]) {
        p.mi.instancingCount = p.count;
        p.mi.visible = p.count > 0;
        if (p.count > 0) p.vb.setData(p.data);
      }
    }
    // selection ring
    const sel = this.selectedId !== null ? this.creatures.get(this.selectedId) : undefined;
    this.ring.enabled = !!sel;
    if (sel) {
      const r = this.batches[sel.species].model.pickRadius * sel.growth * 1.2;
      this.ring.setPosition(sel.x, sel.y + 0.08, sel.z);
      this.ring.setLocalScale(r * 2, r * 2, r * 2);
      this.ring.setEulerAngles(0, this.time * 60, 0);
    }
  }

  private writeCreature(c: RenderCreature): void {
    const b = this.batches[c.species];
    if (b.body.count >= MAX_PER_SPECIES) return;
    const m = b.model;
    const moving = c.anim === Anim.Move && c.speed > 0.05;
    const def = SPECIES[c.species];
    const gait = Math.min(1.2, c.speed / def.walkSpeed);
    const running = c.speed > def.walkSpeed * 1.6;

    // terrain-aligned pitch, smoothed
    const fx = Math.sin(c.heading);
    const fz = Math.cos(c.heading);
    const len = m.pickRadius;
    const targetPitch = Math.atan2(this.world.heightAt(c.x + fx * len, c.z + fz * len) - this.world.heightAt(c.x - fx * len, c.z - fz * len), len * 2);
    c.pitch += (clamp(targetPitch, -0.6, 0.6) - c.pitch) * 0.2;

    let lift = 0;
    let roll = 0;
    let bodyPitch = 0;
    let headPitch = 0;
    let headYaw = 0;
    let legFold = 0;
    let breathe = 1;
    let sink = 0;
    switch (c.anim) {
      case Anim.Move:
        if (moving) {
          lift = m.hop ? Math.abs(Math.sin(c.phase)) * 0.18 * gait : Math.abs(Math.sin(c.phase * 2)) * 0.03 * (running ? 2 : 1);
          bodyPitch = m.hop ? Math.cos(c.phase) * 0.15 * gait : 0;
          headPitch = running ? 0.15 : -0.05 + Math.sin(c.phase * 2) * 0.04;
        } else {
          headYaw = Math.sin(this.time * 0.6 + c.id) * 0.5;
          headPitch = Math.sin(this.time * 0.4 + c.id * 2) * 0.1;
        }
        break;
      case Anim.Eat:
      case Anim.Drink:
        headPitch = 0.9 + Math.sin(this.time * 5 + c.id) * 0.08;
        bodyPitch = 0.08;
        break;
      case Anim.Sleep:
        legFold = 1;
        lift = -m.legLength * 0.75;
        headPitch = 0.5;
        headYaw = 0.6;
        breathe = 1 + Math.sin(this.time * 2 + c.id) * 0.03;
        break;
      case Anim.Dead:
        roll = Math.PI / 2;
        lift = m.bodyY * 0.25;
        legFold = 0.3;
        sink = Math.max(0, (c.ageOrDeath - 30) / 30) * m.bodyY;
        break;
      case Anim.Mate:
        lift = Math.abs(Math.sin(this.time * 6)) * 0.05;
        headYaw = Math.sin(this.time * 3) * 0.3;
        break;
    }

    const g = c.growth;
    // root: ground position, heading, terrain pitch, growth scale
    this.q.setFromEulerAngles(0, (c.heading * 180) / Math.PI, 0);
    this.v.set(c.x, c.y - sink, c.z);
    this.s.set(g, g * breathe, g);
    this.root4.setTRS(this.v, this.q, this.s);
    this.compose(-c.pitch + bodyPitch, 0, roll, 0, lift, 0);
    this.root4.mul2(this.root4, this.local);

    // body
    this.compose(0, 0, 0, 0, m.bodyY, 0);
    this.emit(b.body, this.local);
    // head
    this.compose(headPitch, headYaw, 0, ...m.headPivot);
    this.emit(b.head, this.local);
    // tail
    const wag = c.anim === Anim.Move && !moving ? Math.sin(this.time * 7 + c.id) * 0.4 : Math.sin(c.phase * 2) * 0.15;
    this.compose(running ? -0.4 : 0, wag, 0, ...m.tailPivot);
    this.emit(b.tail, this.local);
    // legs: diagonal pairs in phase (trot); hopping animals move front and back pairs together
    for (let k = 0; k < 4; k++) {
      const front = k < 2;
      let swing = 0;
      if (moving) {
        const phaseOffset = m.hop ? (front ? 0 : Math.PI) : (k === 0 || k === 3 ? 0 : Math.PI);
        swing = Math.sin(c.phase + phaseOffset) * (running ? 0.9 : 0.5) * Math.min(1, gait);
      }
      if (legFold > 0) swing = (front ? -1.4 : 1.4) * legFold;
      this.compose(swing, 0, 0, ...m.legPivots[k]);
      this.emit(b.legs, this.local);
    }
    b.body.count++;
    b.head.count++;
    b.tail.count++;
  }

  /** local = T(x,y,z) * R(pitch about X, yaw about Y, roll about Z) */
  private compose(pitch: number, yaw: number, roll: number, x: number, y: number, z: number): void {
    this.q.setFromEulerAngles((pitch * 180) / Math.PI, (yaw * 180) / Math.PI, (roll * 180) / Math.PI);
    this.v.set(x, y, z);
    this.s.set(1, 1, 1);
    this.local.setTRS(this.v, this.q, this.s);
  }

  private emit(p: PartBatch, local: pc.Mat4): void {
    const idx = p.perCreature === 4 ? p.count++ : p.count;
    this.tmp.mul2(this.root4, local);
    p.data.set(this.tmp.data, idx * 16);
  }

  /** Comfortable camera distance for viewing a creature. */
  viewDistance(id: number): number {
    const c = this.creatures.get(id);
    if (!c) return 6;
    return Math.min(9, Math.max(2.5, this.batches[c.species].model.pickRadius * 6));
  }

  /** Ray-pick the closest creature. Returns its id or null. */
  pick(origin: pc.Vec3, dir: pc.Vec3, maxDist = 80): number | null {
    let best: number | null = null;
    let bestT = maxDist;
    for (const c of this.creatures.values()) {
      const m = this.batches[c.species].model;
      const r = m.pickRadius * c.growth + 0.25;
      const cy = c.y + m.bodyY * c.growth;
      const ox = c.x - origin.x;
      const oy = cy - origin.y;
      const oz = c.z - origin.z;
      const tca = ox * dir.x + oy * dir.y + oz * dir.z;
      if (tca < 0 || tca > bestT) continue;
      const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
      if (d2 > r * r) continue;
      bestT = tca;
      best = c.id;
    }
    return best;
  }

  destroy(): void {
    this.root.destroy();
    this.ring.destroy();
    for (const b of this.batches) for (const p of [b.body, b.head, b.legs, b.tail]) p.vb.destroy();
  }
}
