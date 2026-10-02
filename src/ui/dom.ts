export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

export function show(el: HTMLElement, visible: boolean): void {
  el.classList.toggle('hidden', !visible);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const CONTROLS: Array<[string, string]> = [
  ['W A S D', 'Move'],
  ['Shift', 'Sprint (scares wildlife)'],
  ['Space', 'Jump / swim up'],
  ['Mouse', 'Look (click the view to capture)'],
  ['Wheel', 'Camera distance'],
  ['Left click / E', 'Inspect creature under crosshair'],
  ['Right click / F', 'Throw a stone'],
  ['Tab', 'Toggle mouse cursor (click creatures, right-drag to look)'],
  ['V', 'Third-person / free camera'],
  ['M', 'Island map (click to fast-travel)'],
  ['0-6', 'Time speed (0 pauses the simulation)'],
  ['[ / ]', 'Slower / faster time'],
  ['Esc / P', 'Pause menu (save, load, new world)'],
  ['F5 / F9', 'Quick save / quick load (slot 1)'],
  ['F3', 'Debug panel'],
  ['H', 'Hide / show HUD']
];

export function renderHelp(el: HTMLElement): void {
  el.innerHTML = CONTROLS.map(([k, v]) => `<kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(v)}</span>`).join('');
}
