// @vitest-environment jsdom
//
// Executes the real fabric render path (not just "does it bundle") against a stubbed
// 2D canvas context, to catch fabric API misuse / runtime errors headlessly.

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.resolve(process.cwd(), 'examples', p), 'utf8');

function stubContext(canvasEl) {
  const noop = () => {};
  const handler = {
    get(_t, prop) {
      if (prop === 'measureText') return (s) => ({ width: (s ? String(s).length : 0) * 7,
        actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 });
      if (prop === 'createLinearGradient' || prop === 'createPattern' || prop === 'createRadialGradient')
        return () => ({ addColorStop: noop });
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'canvas') return canvasEl; // fabric reads ctx.canvas.setAttribute(...)
      if (prop === 'getContextAttributes') return () => ({});
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; },
  };
  return new Proxy({}, handler);
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function () { return stubContext(this); };
});

describe('render smoke (headless fabric)', () => {
  let renderKdl, buildModel;
  beforeAll(async () => {
    ({ renderKdl, buildModel } = await import('../src/app/index.js'));
  });

  for (const file of [
    'system-cajeta-layers.diagrama.kdl',
    'system-stores-icons.diagrama.kdl',
    'gantt-release-plan.diagrama.kdl',
    'class-shapes.diagrama.kdl',
    'state-order.diagrama.kdl',
    'sequence-distributed-chat.diagrama.kdl',
  ]) {
    it(`renders ${file} without throwing and draws objects`, () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const ctl = renderKdl(read(file), el, { readOnly: true });
      expect(ctl.canvas.getObjects().length).toBeGreaterThan(0);
      ctl.destroy();
    });
  }

  it('persists a drag as a minimal KDL diff', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const src = `diagram type="system" {
    node "a" label="A"
    node "b" label="B"
    edge "a" "b" kind="dependency"
}`;
    let saved;
    const model = buildModel(src);
    const ctl = renderKdl(src, el, { onPersist: (t) => { saved = t; } });
    // simulate a drag: move node "a" and fire object:modified
    const obj = ctl.canvas.getObjects().find((o) => o.data?.id === 'a');
    expect(obj).toBeTruthy();
    obj.set({ left: 321, top: 123 });
    ctl.canvas.fire('object:modified', { target: obj });
    expect(saved).toContain('pos x=321 y=123');
    ctl.destroy();
  });
});
