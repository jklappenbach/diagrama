// Gantt scheduler (spec §5.9): dependency graph -> earliest-start schedule, critical
// path, total duration. Units are working days (floats; 0.5 resolution). The implicit
// `start` node is the zero-cost root every task ultimately depends on.
//
// Pure + deterministic — no rendering, no dates required. test/schedule.test.js pins it.

/**
 * @param {object} model  built by model.js (uses model.tasks, model.start, model.calendar)
 * @returns {{ tasks: Map<string,{es,ef,critical,cost,slack}>, total:number, order:string[],
 *            cycle?:string[], dates?: (offset:number)=>string }}
 */
export function schedule(model) {
  const startId = model.start ? model.start.id : 'start';
  const cost = new Map([[startId, 0]]);
  const deps = new Map([[startId, []]]);
  for (const t of model.tasks) {
    cost.set(t.id, Number(t.cost) || 0);
    // a task with no declared deps still hangs off start (validation flags it separately)
    deps.set(t.id, t.deps && t.deps.length ? t.deps : [startId]);
  }

  const order = topoSort([...cost.keys()], deps);
  if (order.cycle) return { tasks: new Map(), total: 0, order: [], cycle: order.cycle };

  // Forward pass — earliest start/finish.
  const es = new Map();
  const ef = new Map();
  for (const id of order.list) {
    const s = Math.max(0, ...deps.get(id).map((d) => ef.get(d) ?? 0));
    es.set(id, s);
    ef.set(id, s + cost.get(id));
  }
  const total = Math.max(0, ...[...ef.values()]);

  // Backward pass — latest start/finish -> slack -> critical.
  const succ = new Map([...cost.keys()].map((id) => [id, []]));
  for (const [id, ds] of deps) for (const d of ds) succ.get(d)?.push(id);
  const lf = new Map();
  for (const id of [...order.list].reverse()) {
    const s = succ.get(id);
    lf.set(id, s.length ? Math.min(...s.map((x) => lf.get(x) - cost.get(x))) : total);
  }

  const tasks = new Map();
  for (const id of order.list) {
    const slack = lf.get(id) - cost.get(id) - es.get(id);
    tasks.set(id, {
      es: es.get(id), ef: ef.get(id), cost: cost.get(id),
      slack, critical: Math.abs(slack) < 1e-9,
    });
  }

  const result = { tasks, total, order: order.list };
  if (model.calendar?.start) result.dates = workingDayMapper(model.calendar);
  return result;
}

/** Kahn topological sort; returns {list} or {cycle} if not a DAG. */
function topoSort(ids, deps) {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map(ids.map((id) => [id, []]));
  for (const id of ids) for (const d of deps.get(id) || []) {
    if (!indeg.has(d)) continue;
    indeg.set(id, indeg.get(id) + 1);
    out.get(d).push(id);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const list = [];
  while (queue.length) {
    const id = queue.shift();
    list.push(id);
    for (const n of out.get(id)) {
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  if (list.length !== ids.length) return { cycle: ids.filter((id) => indeg.get(id) > 0) };
  return { list };
}

/** Map a working-day offset to an ISO date, skipping weekends (workweek mon-fri). */
function workingDayMapper(cal) {
  const skipWeekends = (cal.workweek ?? 'mon-fri') === 'mon-fri';
  const base = new Date(cal.start + 'T00:00:00Z');
  return (offset) => {
    const whole = Math.floor(offset);
    const d = new Date(base);
    let added = 0;
    while (added < whole) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (!skipWeekends || (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)) added++;
    }
    return d.toISOString().slice(0, 10);
  };
}
