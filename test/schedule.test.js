import { describe, it, expect } from 'vitest';
import { buildModel } from '../src/core/model.js';
import { schedule } from '../src/core/schedule.js';

const PLAN = `diagram type="gantt" title="t" mode="calendar" {
    calendar start="2026-07-01" unit="day" workweek="mon-fri"
    lane "be" label="Backend"
    start "start" label="Start"
    task "spec"  title="Spec" cost=2   { deps "start" }
    task "api"   title="API"  cost=5   { deps "spec" }
    task "ui"    title="UI"   cost=4.5 { deps "spec" }
    task "infra" title="Infra" cost=1.5 { deps "start" }
    task "integ" title="Integration" cost=2.5 { deps "api" "ui" "infra" }
    task "uat"   title="UAT" cost=3   { deps "integ" }
    task "ga"    title="GA"  cost=0.5 { deps "uat" }
}`;

describe('gantt scheduler', () => {
  const m = buildModel(PLAN);
  const s = schedule(m);

  it('parses the model with no validation errors', () => {
    expect(m.errors).toEqual([]);
    expect(m.tasks).toHaveLength(7);
  });

  it('computes earliest-start over fan-in', () => {
    expect(s.tasks.get('api').es).toBe(2);
    expect(s.tasks.get('integ').es).toBe(7); // max(api.ef=7, ui.ef=6.5, infra.ef=1.5)
    expect(s.tasks.get('integ').ef).toBe(9.5);
  });

  it('total duration is the critical path length', () => {
    expect(s.total).toBe(13); // start->spec->api->integ->uat->ga
  });

  it('marks the critical path and leaves slack off it', () => {
    expect(s.tasks.get('api').critical).toBe(true);
    expect(s.tasks.get('integ').critical).toBe(true);
    expect(s.tasks.get('ui').critical).toBe(false);
    expect(s.tasks.get('infra').critical).toBe(false);
    expect(s.tasks.get('ui').slack).toBeCloseTo(0.5);
  });

  it('maps offsets to weekend-skipping calendar dates', () => {
    expect(s.dates(0)).toBe('2026-07-01'); // Wed
    expect(s.dates(2)).toBe('2026-07-03'); // Fri (Wed +2 wd)
    expect(s.dates(3)).toBe('2026-07-06'); // Mon (skips Sat/Sun)
  });
});

describe('validation', () => {
  it('flags a task with no dependencies', () => {
    const m = buildModel(`diagram type="gantt" {
        task "x" title="X" cost=1
    }`);
    expect(m.errors.some((e) => /needs >= 1 dependency/.test(e.message))).toBe(true);
  });

  it('detects dependency cycles', () => {
    const m = buildModel(`diagram type="gantt" {
        task "a" cost=1 { deps "b" }
        task "b" cost=1 { deps "a" }
    }`);
    expect(schedule(m).cycle?.length).toBeGreaterThan(0);
  });
});
