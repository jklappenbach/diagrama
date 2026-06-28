// diagrama embed entry (spec §8.1). Public bundle surface: Diagrama.*.
//   <div class="diagrama"></div>
//   <script type="application/diagrama+kdl"> diagram type="system" { … } </script>
//   <script src="diagrama.min.js"></script>
//   <script>Diagrama.renderAll()</script>

import { buildModel } from '../core/model.js';
import { render } from '../core/render.js';
import { renderTaskList, renderTaskDetail } from '../core/views.js';
import { parseDoc, emit, setPos, clearPos } from '../core/kdl.js';

export const version = '0.1.0';

/** Render KDL text into an element. opts forwarded to the renderer. */
export function renderKdl(text, el, opts = {}) {
  const model = buildModel(text);
  return render(el, model, opts);
}

/** Render every `.diagrama` container paired with a KDL `<script>` block. */
export function renderAll(root = document) {
  const out = [];
  for (const el of root.querySelectorAll('.diagrama')) {
    const script = el.querySelector('script[type="application/diagrama+kdl"]')
      || (el.nextElementSibling?.matches?.('script[type="application/diagrama+kdl"]')
        ? el.nextElementSibling : null);
    const text = script?.textContent;
    if (text) out.push(renderKdl(text, el, { readOnly: true }));
  }
  return out;
}

/** Fetch a `.diagrama.kdl` from `url` and render into `selector`. */
export async function load(url, selector, opts = {}) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
  const text = await (await fetch(url)).text();
  return renderKdl(text, el, opts);
}

export { buildModel, parseDoc, emit, setPos, clearPos, renderTaskList, renderTaskDetail };
export default { version, renderAll, renderKdl, load, buildModel, renderTaskList, renderTaskDetail };
