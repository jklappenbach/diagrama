import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Packs, parsePack } from '../src/core/packs.js';
import { buildModel } from '../src/core/model.js';

const pack = (name) => fs.readFileSync(path.resolve(process.cwd(), 'packs', name), 'utf8');

describe('vendor packs', () => {
  const packs = new Packs()
    .addText(pack('aws.kdl'))
    .addText(pack('gcp.kdl'))
    .addText(pack('azure.kdl'))
    .addText(pack('cloudflare.kdl'))
    .addText(pack('cicd.kdl'));

  it('parses a manifest into a service map', () => {
    const p = parsePack(pack('aws.kdl'));
    expect(p.name).toBe('aws');
    expect(p.map.lambda.base).toBe('function');
    expect(p.map.lambda.icon).toBe('aws/lambda');
  });

  it('resolves vendor:service across packs', () => {
    expect(packs.resolve('aws:lambda').base).toBe('function');
    expect(packs.resolve('aws:s3').base).toBe('blob');
    expect(packs.resolve('gcp:cloudsql').base).toBe('sql');
    expect(packs.resolve('azure:eventhubs').base).toBe('topic');
    expect(packs.resolve('cf:workers').base).toBe('function');
    expect(packs.resolve('ci:argocd').base).toBe('deploy');
  });

  it('returns null for unknown vendor/service', () => {
    expect(packs.resolve('aws:nope')).toBeNull();
    expect(packs.resolve('nope:thing')).toBeNull();
    expect(packs.resolve('service')).toBeNull();
  });

  it('applies pack resolution through buildModel', () => {
    const m = buildModel('diagram type="system" {\n  node "f" label="Fn" kind="aws:lambda"\n}', { packs });
    expect(m.nodes[0].base).toBe('function');
    expect(m.nodes[0].icon).toBe('aws/lambda');
    expect(m.nodes[0].vendor).toBe('aws');
  });
});
