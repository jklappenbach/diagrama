import { describe, it, expect } from 'vitest';
import { parseDoc, emit, setPos, clearPos, findById, idOf } from '../src/core/kdl.js';

const SRC = `diagram type="system" title="t" {
    // a comment that must survive
    node "http" label="cajeta-http" kind="service" {
        pos x=120 y=140
    }
    /- node "disabled" label="off"
    node "ionet" label="transport" kind="service"
    edge "http" "ionet" kind="dependency"
}
`;

describe('kdl round-trip', () => {
  it('emits untouched input byte-for-byte', () => {
    expect(emit(parseDoc(SRC))).toBe(SRC);
  });

  it('updates an existing pos as a minimal diff (comment + slashdash survive)', () => {
    const doc = parseDoc(SRC);
    expect(setPos(doc, 'http', 200, 99)).toBe(true);
    const out = emit(doc);
    expect(out).toContain('pos x=200 y=99');
    expect(out).toContain('// a comment that must survive');
    expect(out).toContain('/- node "disabled" label="off"');
    // only the pos line changed
    const diff = SRC.split('\n').filter((l, i) => l !== out.split('\n')[i]);
    expect(diff).toEqual(['        pos x=120 y=140']);
  });

  it('creates a pos when absent', () => {
    const doc = parseDoc(SRC);
    expect(setPos(doc, 'ionet', 10, 20)).toBe(true);
    const node = findById(doc, 'node', 'ionet');
    const pos = node.children.nodes.find((c) => c.name.name === 'pos');
    expect(idOf(node)).toBe('ionet');
    expect(pos.getProperty('x')).toBe(10);
    expect(pos.getProperty('y')).toBe(20);
  });

  it('clears a pos (re-layout)', () => {
    const doc = parseDoc(SRC);
    expect(clearPos(doc, 'http')).toBe(true);
    expect(emit(doc)).not.toContain('pos x=');
  });

  it('reports missing ids', () => {
    expect(setPos(parseDoc(SRC), 'nope', 1, 2)).toBe(false);
  });
});
