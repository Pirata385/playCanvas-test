import * as pc from 'playcanvas';

function mat(r: number, g: number, b: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(r, g, b);
  m.gloss = 0.2;
  m.update();
  return m;
}

/** Procedural explorer figure built from primitives, animated by gait phase. */
export class PlayerAvatar {
  readonly root: pc.Entity;
  private body: pc.Entity;
  private head: pc.Entity;
  private armL: pc.Entity;
  private armR: pc.Entity;
  private legL: pc.Entity;
  private legR: pc.Entity;
  private phase = 0;
  /** Fires once per footfall with the current speed. */
  onFootstep: (speed: number) => void = () => {};

  constructor(app: pc.AppBase) {
    this.root = new pc.Entity('PlayerAvatar');
    app.root.addChild(this.root);
    const shirt = mat(0.72, 0.62, 0.42);
    const pants = mat(0.32, 0.28, 0.22);
    const skin = mat(0.9, 0.72, 0.58);
    const hat = mat(0.45, 0.33, 0.2);
    const pack = mat(0.25, 0.38, 0.3);

    const part = (parent: pc.Entity, type: 'box' | 'sphere' | 'cylinder', m: pc.Material, pos: [number, number, number], scale: [number, number, number]) => {
      const e = new pc.Entity();
      e.addComponent('render', { type, material: m, castShadows: true, receiveShadows: true });
      e.setLocalPosition(...pos);
      e.setLocalScale(...scale);
      parent.addChild(e);
      return e;
    };
    const pivot = (parent: pc.Entity, pos: [number, number, number]) => {
      const e = new pc.Entity();
      e.setLocalPosition(...pos);
      parent.addChild(e);
      return e;
    };

    this.body = pivot(this.root, [0, 0.95, 0]);
    part(this.body, 'box', shirt, [0, 0.32, 0], [0.44, 0.62, 0.26]);
    part(this.body, 'box', pack, [0, 0.36, -0.2], [0.34, 0.44, 0.16]);
    this.head = pivot(this.body, [0, 0.66, 0]);
    part(this.head, 'sphere', skin, [0, 0.13, 0], [0.26, 0.28, 0.26]);
    part(this.head, 'cylinder', hat, [0, 0.27, 0], [0.42, 0.03, 0.42]);
    part(this.head, 'cylinder', hat, [0, 0.33, 0], [0.24, 0.12, 0.24]);
    part(this.head, 'box', mat(0.1, 0.1, 0.1), [0.06, 0.15, 0.125], [0.04, 0.04, 0.02]);
    part(this.head, 'box', mat(0.1, 0.1, 0.1), [-0.06, 0.15, 0.125], [0.04, 0.04, 0.02]);
    this.armL = pivot(this.body, [0.29, 0.58, 0]);
    part(this.armL, 'box', shirt, [0, -0.25, 0], [0.12, 0.52, 0.13]);
    part(this.armL, 'sphere', skin, [0, -0.54, 0], [0.11, 0.11, 0.11]);
    this.armR = pivot(this.body, [-0.29, 0.58, 0]);
    part(this.armR, 'box', shirt, [0, -0.25, 0], [0.12, 0.52, 0.13]);
    part(this.armR, 'sphere', skin, [0, -0.54, 0], [0.11, 0.11, 0.11]);
    this.legL = pivot(this.root, [0.11, 0.95, 0]);
    part(this.legL, 'box', pants, [0, -0.44, 0], [0.16, 0.88, 0.18]);
    part(this.legL, 'box', hat, [0, -0.9, 0.05], [0.17, 0.1, 0.28]);
    this.legR = pivot(this.root, [-0.11, 0.95, 0]);
    part(this.legR, 'box', pants, [0, -0.44, 0], [0.16, 0.88, 0.18]);
    part(this.legR, 'box', hat, [0, -0.9, 0.05], [0.17, 0.1, 0.28]);
  }

  update(dt: number, x: number, y: number, z: number, facing: number, speed: number, grounded: boolean, swimming: boolean, throwing: number): void {
    this.root.setPosition(x, y, z);
    this.root.setEulerAngles(0, (facing * 180) / Math.PI, 0);
    const prev = this.phase;
    this.phase += dt * (swimming ? 4 : Math.min(speed, 9) * 1.9);
    if (grounded && !swimming && speed > 0.5 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      this.onFootstep(speed);
    }
    const amp = swimming ? 0.9 : Math.min(1, speed / 4) * (speed > 6 ? 0.9 : 0.6);
    const s = Math.sin(this.phase);
    const air = !grounded && !swimming;
    this.legL.setLocalEulerAngles(air ? -25 : s * amp * 45, 0, 0);
    this.legR.setLocalEulerAngles(air ? 15 : -s * amp * 45, 0, 0);
    const throwAngle = throwing > 0 ? -150 * Math.sin(Math.min(1, throwing) * Math.PI) : 0;
    this.armL.setLocalEulerAngles(swimming ? -150 + s * 40 : -s * amp * 40, 0, swimming ? 0 : 4);
    this.armR.setLocalEulerAngles(swimming ? -150 - s * 40 : s * amp * 40 + throwAngle, 0, swimming ? 0 : -4);
    this.body.setLocalPosition(0, 0.95 + (grounded ? Math.abs(Math.cos(this.phase)) * 0.04 * amp : 0) - (swimming ? 0.1 : 0), 0);
    this.body.setLocalEulerAngles(swimming ? 70 : speed > 6 ? 10 : 0, 0, 0);
  }

  set visible(v: boolean) {
    this.root.enabled = v;
  }

  destroy(): void {
    this.root.destroy();
  }
}
