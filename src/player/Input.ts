/** Keyboard + mouse state with per-frame edge detection and pointer-lock handling. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseX = 0;
  mouseY = 0;
  rightDrag = false;
  clicks: Array<{ button: number; x: number; y: number }> = [];
  onLockChange: (locked: boolean) => void = () => {};
  private disposers: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | Document | HTMLElement, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
      if (['Space', 'Tab', 'F3', 'F5', 'F9', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e: KeyboardEvent) => this.down.delete(e.code));
    on(window, 'blur', () => this.down.clear());
    on(document, 'mousemove', (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.locked || this.rightDrag) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (e.button === 2) this.rightDrag = true;
      this.clicks.push({ button: e.button, x: e.clientX, y: e.clientY });
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 2) this.rightDrag = false;
    });
    on(canvas, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    on(canvas, 'wheel', (e: WheelEvent) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    on(document, 'pointerlockchange', () => this.onLockChange(this.locked));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock() as unknown;
    if (p instanceof Promise) p.catch(() => {});
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  axis(neg: string, pos: string): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.clicks.length = 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
