// Non-canvas gantt views: a task LIST (table) and a task DETAIL panel, derived from the
// same model + scheduler. Plain HTML so they drop into any element (incl. the embed).

import { buildModel } from './model.js';
import { schedule } from './schedule.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ctx(textOrModel) {
  const m = typeof textOrModel === 'string' ? buildModel(textOrModel) : textOrModel;
  const s = schedule(m);
  const unit = m.calendar?.unit === 'day' ? 'd' : 'h';
  const at = (off) => (s.dates ? s.dates(off) : off);
  return { m, s, unit, at };
}

const STYLE = `<style>
.dgv { font: 13px system-ui, sans-serif; color: #1c2030; }
.dgv table { border-collapse: collapse; width: 100%; }
.dgv th, .dgv td { text-align: left; padding: 5px 9px; border-bottom: 1px solid #e6e8f0; }
.dgv th { color: #6b7185; font-weight: 600; font-size: 12px; }
.dgv tr.crit td { font-weight: 600; }
.dgv .dot { color: #d23b3b; }
.dgv .det { padding: 10px 12px; max-width: 520px; }
.dgv .det h3 { margin: 0 0 8px; font-size: 15px; }
.dgv .det .tag { font-size: 11px; color: #fff; background: #d23b3b; border-radius: 4px; padding: 1px 6px; }
.dgv .det dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 12px; margin: 0; }
.dgv .det dt { color: #6b7185; }
.dgv .det dd { margin: 0; }
</style>`;

/** Render a sortable-by-schedule task table into `el`. */
export function renderTaskList(textOrModel, el) {
  const { m, s, unit, at } = ctx(textOrModel);
  const startId = m.start ? m.start.id : 'start';
  const rows = m.tasks.map((t) => {
    const sc = s.tasks.get(t.id) || {};
    const deps = (t.deps || []).filter((d) => d !== startId).join(', ');
    const ticket = t.ticket ? (t.ticketUrl ? `<a href="${esc(t.ticketUrl)}">${esc(t.ticket)}</a>` : esc(t.ticket)) : '';
    return `<tr class="${sc.critical ? 'crit' : ''}">
      <td>${esc(t.title || t.id)}</td><td>${t.cost ?? ''}${unit}</td>
      <td>${esc(at(sc.es))}</td><td>${esc(at(sc.ef))}</td><td>${esc(t.lane || '')}</td>
      <td>${sc.critical ? '<span class="dot">●</span>' : ''}</td><td>${esc(deps)}</td><td>${ticket}</td></tr>`;
  }).join('');
  el.innerHTML = `${STYLE}<div class="dgv"><table>
    <thead><tr><th>Task</th><th>Cost</th><th>Start</th><th>End</th><th>Lane</th><th>Crit</th><th>Depends on</th><th>Ticket</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="color:#6b7185;font-size:12px;margin:8px 9px">Total: ${s.total} working ${unit === 'h' ? 'hours' : 'days'}${s.cycle ? ' — cycle!' : ''}</p></div>`;
}

/** Render a single task's detail panel into `el` (defaults to the first task). */
export function renderTaskDetail(textOrModel, el, taskId) {
  const { m, s, unit, at } = ctx(textOrModel);
  const startId = m.start ? m.start.id : 'start';
  const t = m.tasks.find((x) => x.id === taskId) || m.tasks[0];
  if (!t) { el.innerHTML = `${STYLE}<div class="dgv det">no tasks</div>`; return; }
  const sc = s.tasks.get(t.id) || {};
  const deps = (t.deps || []).filter((d) => d !== startId);
  const dependents = m.tasks.filter((x) => (x.deps || []).includes(t.id)).map((x) => x.id);
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  el.innerHTML = `${STYLE}<div class="dgv det">
    <h3>${esc(t.title || t.id)} ${sc.critical ? '<span class="tag">critical path</span>' : ''}</h3>
    <dl>
      ${row('id', esc(t.id))}
      ${row('cost', `${t.cost ?? '?'}${unit}`)}
      ${row('start', esc(at(sc.es)))}
      ${row('end', esc(at(sc.ef)))}
      ${row('lane', esc(t.lane || '—'))}
      ${t.ticket ? row('ticket', t.ticketUrl ? `<a href="${esc(t.ticketUrl)}">${esc(t.ticket)}</a>` : esc(t.ticket)) : ''}
      ${row('depends on', deps.length ? esc(deps.join(', ')) : '—')}
      ${row('blocks', dependents.length ? esc(dependents.join(', ')) : '—')}
      ${t.desc ? row('notes', esc(t.desc)) : ''}
    </dl></div>`;
}
