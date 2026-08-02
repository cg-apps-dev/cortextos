import { describe, expect, it } from 'vitest';
import {
  checkSkillDrift,
  formatSkillDriftReport,
  skillDriftExitCode,
  type SkillDriftDeps,
  type SkillSyncPair,
} from '../../../src/bus/skill-drift';

const pair: SkillSyncPair = {
  name: 'fixture-skill',
  tracked: 'agents/source/skills/fixture',
  live: 'orgs/acme/agents/source/skills/fixture',
};

function depsFor(main: Record<string, string>, live: Record<string, string>): SkillDriftDeps {
  return {
    listMainFiles: () => Object.keys(main).map(path => `${pair.tracked}/${path}`).sort(),
    readMainFile: (_projectRoot, path) => {
      const rel = path.slice(pair.tracked.length + 1);
      const content = main[rel];
      if (content === undefined) throw new Error(`missing main fixture ${rel}`);
      return Buffer.from(content);
    },
    listLiveFiles: () => Object.keys(live).sort(),
    readLiveFile: (_projectRoot, path) => {
      const rel = path.slice(pair.live.length + 1);
      const content = live[rel];
      return content === undefined ? undefined : Buffer.from(content);
    },
  };
}

function report(main: Record<string, string>, live: Record<string, string>) {
  return checkSkillDrift('/repo', { pairs: [pair] }, depsFor(main, live));
}

describe('skill drift detector', () => {
  it('reports an in-sync pair with exit code 0', () => {
    const r = report({ 'SKILL.md': 'same', 'engine.py': 'same engine' }, { 'SKILL.md': 'same', 'engine.py': 'same engine' });
    expect(r.driftCount).toBe(0);
    expect(r.pairs[0].inSync).toBe(2);
    expect(r.pairs[0].diff).toEqual([]);
    expect(skillDriftExitCode(r)).toBe(0);
  });

  it('flags same-name different-content files by hash', () => {
    const r = report({ 'engine.py': 'main implementation' }, { 'engine.py': 'live implementation with _max_attempts' });
    expect(r.driftCount).toBe(1);
    expect(r.pairs[0].diff).toMatchObject([{ path: 'engine.py', status: 'content-DIFF' }]);
    expect(r.pairs[0].diff[0].trackedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.pairs[0].diff[0].liveHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.pairs[0].diff[0].trackedHash).not.toBe(r.pairs[0].diff[0].liveHash);
    expect(skillDriftExitCode(r)).toBe(1);
  });

  it('flags files present only in the live copy', () => {
    const r = report({ 'SKILL.md': 'main' }, { 'SKILL.md': 'main', 'local-helper.py': 'live only' });
    expect(r.driftCount).toBe(1);
    expect(r.pairs[0].liveOnly).toMatchObject([{ path: 'local-helper.py', status: 'live-ONLY' }]);
    expect(skillDriftExitCode(r)).toBe(1);
  });

  it('flags files missing from the live copy', () => {
    const r = report({ 'SKILL.md': 'main', 'engine.py': 'tracked' }, { 'SKILL.md': 'main' });
    expect(r.driftCount).toBe(1);
    expect(r.pairs[0].liveMissing).toMatchObject([{ path: 'engine.py', status: 'live-MISSING' }]);
    expect(skillDriftExitCode(r)).toBe(1);
  });

  it('reports mixed drift classes in the same pair', () => {
    const r = report(
      { 'SKILL.md': 'same', 'engine.py': 'main', 'tracked-only.py': 'missing live' },
      { 'SKILL.md': 'same', 'engine.py': 'live', 'live-only.py': 'missing main' },
    );
    expect(r.driftCount).toBe(3);
    expect(r.pairs[0]).toMatchObject({
      inSync: 1,
      diff: [{ path: 'engine.py', status: 'content-DIFF' }],
      liveOnly: [{ path: 'live-only.py', status: 'live-ONLY' }],
      liveMissing: [{ path: 'tracked-only.py', status: 'live-MISSING' }],
    });
  });

  it('prints paths, hashes, and statuses without leaking file contents', () => {
    const secretContent = 'SUPER_SECRET_TOKEN=sk-ant-never-print-this';
    const r = report({ 'engine.py': secretContent }, { 'engine.py': `${secretContent}-changed` });
    const text = formatSkillDriftReport(r);
    expect(text).toContain('engine.py');
    expect(text).toContain('content-DIFF');
    expect(text).toMatch(/tracked=[a-f0-9]{12}/);
    expect(text).toMatch(/live=[a-f0-9]{12}/);
    expect(text).not.toContain(secretContent);
    expect(text).not.toContain('sk-ant-never-print-this');
  });

  it('filters leak-unsafe env and secret file paths from comparisons', () => {
    const r = checkSkillDrift('/repo', { pairs: [pair] }, {
      listMainFiles: () => [
        `${pair.tracked}/SKILL.md`,
        `${pair.tracked}/.env`,
        `${pair.tracked}/nested/secrets.env`,
      ],
      readMainFile: () => Buffer.from('main'),
      listLiveFiles: () => ['SKILL.md', '.env', 'nested/secrets.env'],
      readLiveFile: () => Buffer.from('main'),
    });
    const text = formatSkillDriftReport(r);
    expect(r.driftCount).toBe(0);
    expect(r.pairs[0].files.map(file => file.path)).toEqual(['SKILL.md']);
    expect(text).not.toContain('.env');
    expect(text).not.toContain('secrets.env');
  });

  it('filters generated build artifacts from live-only drift', () => {
    const r = checkSkillDrift('/repo', { pairs: [pair] }, {
      listMainFiles: () => [`${pair.tracked}/SKILL.md`],
      readMainFile: () => Buffer.from('main'),
      listLiveFiles: () => [
        'SKILL.md',
        '__pycache__/engine.cpython-313.pyc',
        'nested/__pycache__/helper.pyc',
        '.DS_Store',
      ],
      readLiveFile: (_projectRoot, path) => path.endsWith('SKILL.md') ? Buffer.from('main') : Buffer.from('bytecode'),
    });
    const text = formatSkillDriftReport(r);
    expect(r.driftCount).toBe(0);
    expect(r.pairs[0].files.map(file => file.path)).toEqual(['SKILL.md']);
    expect(text).not.toContain('__pycache__');
    expect(text).not.toContain('.pyc');
    expect(text).not.toContain('.DS_Store');
  });
});
