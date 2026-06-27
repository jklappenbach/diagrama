import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildModel } from '../src/core/model.js';
import { layoutGraph, layoutGantt, layoutSequence } from '../src/core/layout.js';

const read = (p) => fs.readFileSync(new URL(`../examples/${p}`, import.meta.url), 'utf8');

describe('layout on real examples', () => {
  it('lays out system-stores-icons with no errors', () => {
    const m = buildModel(read('system-stores-icons.diagrama.kdl'));
    expect(m.errors).toEqual([]);
    const lo = layoutGraph(m);
    expect(Object.keys(lo.nodes).length).toBe(m.nodes.length);
    expect(Object.keys(lo.groups).length).toBe(m.groups.length);
    for (const id in lo.nodes) expect(Number.isFinite(lo.nodes[id].x)).toBe(true);
  });

  it('lays out system-cajeta-layers (7 nodes, 4 groups)', () => {
    const m = buildModel(read('system-cajeta-layers.diagrama.kdl'));
    expect(m.errors).toEqual([]);
    expect(m.nodes).toHaveLength(7);
    const lo = layoutGraph(m);
    expect(lo.width).toBeGreaterThan(0);
    expect(lo.height).toBeGreaterThan(0);
  });

  it('schedules + lays out the gantt release plan', () => {
    const m = buildModel(read('gantt-release-plan.diagrama.kdl'));
    expect(m.errors).toEqual([]);
    const lo = layoutGantt(m);
    expect(lo.bars.length).toBe(m.tasks.length);
    expect(lo.total).toBeGreaterThan(0);
    expect(lo.bars.some((b) => b.critical)).toBe(true);
  });

  it('parses + lays out the sequence example (fragments flatten in order)', () => {
    const m = buildModel(read('sequence-distributed-chat.diagrama.kdl'));
    expect(m.participants).toHaveLength(5);
    expect(m.messages).toHaveLength(8); // 3 top-level + 4 in branches + 1 return
    expect(m.fragments).toHaveLength(1);
    expect(m.fragments[0].branches).toHaveLength(2);
    const lo = layoutSequence(m);
    expect(lo.participants[0].x).toBeLessThan(lo.participants[4].x);
    expect(lo.messages.every((mm) => Number.isFinite(mm.y))).toBe(true);
  });

  it('lays out the pipeline example as a graph', () => {
    const m = buildModel(read('pipeline-build-deploy.diagrama.kdl'));
    const lo = layoutGraph({ ...m, nodes: m.steps, groups: m.groups });
    expect(Object.keys(lo.nodes).length).toBe(m.steps.length);
  });
});
