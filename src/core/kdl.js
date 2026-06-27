// KDL parse + format-preserving write-back (spec §2, §8.5).
//
// Wraps @bgotink/kdl. parse() keeps comments/order/slashdash; emit() is exact for
// untouched nodes, so a drag that updates a `pos` yields a minimal diff. Proven by
// test/kdl.test.js.

import { parse, format, Node, Document } from '@bgotink/kdl';

/** Parse KDL source into a format-preserving Document. Throws InvalidKdlError. */
export function parseDoc(text) {
  return parse(text);
}

/** Serialize a Document back to KDL text (exact for untouched nodes). */
export function emit(doc) {
  return format(doc);
}

/** Depth-first walk over every Node in a Document. */
export function walk(doc, fn) {
  const visit = (nodes) => {
    for (const n of nodes) {
      fn(n);
      if (n.children) visit(n.children.nodes);
    }
  };
  visit(doc.nodes);
  return doc;
}

/** A node's first positional argument — our element id (`node "http" …` → "http"). */
export function idOf(node) {
  const args = node.getArguments();
  return args.length ? args[0] : undefined;
}

/** The single top-level `diagram` node, or undefined. */
export function diagramNode(doc) {
  return doc.nodes.find((n) => n.name.name === 'diagram');
}

/** Find an element node of a given KDL name (node/task/step/…) by its id. */
export function findById(doc, name, id) {
  let found;
  walk(doc, (n) => {
    if (!found && n.name.name === name && idOf(n) === id) found = n;
  });
  return found;
}

function ensureChildren(node) {
  if (!node.children) node.children = new Document();
  return node.children;
}

/**
 * Write a node's position (the drag persist op). Updates an existing `pos x= y=`
 * child in place (minimal diff) or creates one. `name` is the element kind that
 * carries positions (default "node"). Returns true if the element was found.
 */
export function setPos(doc, id, x, y, name = 'node') {
  const node = findById(doc, name, id);
  if (!node) return false;
  let pos = node.children?.nodes.find((c) => c.name.name === 'pos');
  if (!pos) {
    pos = Node.create('pos');
    ensureChildren(node).nodes.push(pos);
  }
  pos.setProperty('x', x);
  pos.setProperty('y', y);
  return true;
}

/** Clear a node's `pos` (return it to auto-layout). Returns true if one was removed. */
export function clearPos(doc, id, name = 'node') {
  const node = findById(doc, name, id);
  if (!node?.children) return false;
  const before = node.children.nodes.length;
  node.children.nodes = node.children.nodes.filter((c) => c.name.name !== 'pos');
  return node.children.nodes.length !== before;
}
