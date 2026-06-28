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
  let renderKdl, buildModel, renderAll, renderTaskList, renderTaskDetail;
  beforeAll(async () => {
    ({ renderKdl, buildModel, renderAll, renderTaskList, renderTaskDetail } = await import('../src/app/index.js'));
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

  it('renders the organize (timeless) gantt as a dependency graph', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ctl = renderKdl(`diagram type="gantt" mode="timeless" {
      palette "earth"
      task "a" cost=8 { deps "start" }
      task "b" cost=8 { deps "a" }
      task "c" cost=8 { deps "a" }
    }`, el, { readOnly: true });
    expect(ctl.canvas.getObjects().length).toBeGreaterThan(0);
    ctl.destroy();
  });

  it('renders the isometric system view', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ctl = renderKdl(`diagram type="system" view="iso" {
      node "gw" label="GW" kind="gateway"
      node "lb" label="LB" kind="lb"
      node "fw" label="FW" kind="firewall"
      node "s1" label="s1" kind="service"
      node "db" label="DB" kind="sql"
      edge "gw" "lb"
      edge "lb" "s1"
      edge "s1" "db"
    }`, el, { readOnly: true });
    expect(ctl.canvas.getObjects().length).toBeGreaterThan(0);
    ctl.destroy();
  });

  it('renders task list + task detail HTML', () => {
    const src = `diagram type="gantt" {
      calendar start="2026-07-01" unit="hour" hours-per-day=8
      task "a" title="Alpha" cost=8 ticket="T-1" { deps "start" }
      task "b" title="Beta" cost=8 { deps "a" }
    }`;
    const list = document.createElement('div');
    renderTaskList(src, list);
    expect(list.innerHTML).toContain('Alpha');
    expect(list.innerHTML).toContain('<table');
    const det = document.createElement('div');
    renderTaskDetail(src, det, 'b');
    expect(det.innerHTML).toContain('Beta');
    expect(det.innerHTML).toContain('depends on');
  });

  it('renderAll() renders an inline embed block (the embedded-demo path)', () => {
    const div = document.createElement('div');
    div.className = 'diagrama';
    const s = document.createElement('script');
    s.type = 'application/diagrama+kdl';
    s.textContent = 'diagram type="system" {\n  node "a" label="A"\n  node "b" label="B"\n  edge "a" "b" kind="dependency"\n}';
    div.appendChild(s);
    document.body.appendChild(div);
    const ctls = renderAll();
    expect(ctls.length).toBe(1);
    expect(ctls[0].canvas.getObjects().length).toBeGreaterThan(0);
    ctls[0].destroy();
  });

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
