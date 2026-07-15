import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  confirmDaemonIdentity,
  decide,
  getCallerAncestry,
  resolveTarget,
} from '../../scripts/bounce-guard.mjs';

const repoRoot = resolve(__dirname, '..', '..');
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function target(overrides: Record<string, unknown>) {
  return {
    status: 'running',
    pid: 200,
    identityConfirmed: true,
    ...overrides,
  };
}

describe('bounce-guard decide', () => {
  it('passes for a running identity-confirmed daemon when the caller is external', () => {
    expect(decide({ target: target({ pid: 200 }), callerAncestry: { ancestry: [501, 400, 1], complete: true } })).toEqual({
      verdict: 'PASS',
      reason: 'caller is outside the cortextos-daemon process tree',
    });
  });

  it('passes for a positively stopped daemon', () => {
    expect(decide({ target: target({ status: 'stopped', pid: null }), callerAncestry: [501, 1] }).verdict).toBe('PASS');
  });

  it.each([
    ['missing target', null],
    ['ambiguous target', target({ status: 'ambiguous' })],
    ['malformed status', target({ status: 'maybe' })],
    ['unresolvable pid', target({ pid: 'not-a-pid' })],
    ['identity unconfirmed', target({ identityConfirmed: false })],
  ])('refuses fail-safe state: %s', (_label, unsafeTarget) => {
    expect(decide({ target: unsafeTarget, callerAncestry: { ancestry: [501, 1], complete: true } }).verdict).toBe('REFUSE');
  });

  it.each([
    ['direct parent', [200, 100, 1]],
    ['middle ancestor', [900, 200, 100, 1]],
    ['last before init', [900, 800, 200]],
  ])('refuses daemon-as-ancestor at %s depth', (_label, callerAncestry) => {
    expect(decide({ target: target({ pid: 200 }), callerAncestry: { ancestry: callerAncestry, complete: true } }).verdict).toBe('REFUSE');
  });

  it('refuses a running daemon when ancestry completeness is absent', () => {
    expect(decide({ target: target({ pid: 200 }), callerAncestry: [501, 400, 1] }).verdict).toBe('REFUSE');
  });
});

describe('bounce-guard resolver helpers', () => {
  it('refuses PID reuse or renamed processes by failing identity confirmation', () => {
    const deps = {
      execFileSync: () => 'node unrelated-worker.js\n',
      existsSync,
      readFileSync,
      homedir: () => '/unused',
    };

    expect(confirmDaemonIdentity(4321, deps)).toBe(false);
    expect(decide({ target: target({ pid: 4321, identityConfirmed: false }), callerAncestry: { ancestry: [99, 1], complete: true } }).verdict).toBe('REFUSE');
  });

  it('accepts the real daemon dist command line as identity-confirmed', () => {
    const operatorHome = '/Users/' + 'adam' + 'folker';
    const deps = {
      execFileSync: () => `node ${operatorHome}/cortextos/dist/daemon.js --instance default\n`,
      existsSync,
      readFileSync,
      homedir: () => '/unused',
    };

    expect(confirmDaemonIdentity(97844, deps)).toBe(true);
  });

  it('resolves a stale pid file as ambiguous instead of stopped', () => {
    const home = makeTempDir('bounce-home-');
    const pidDir = join(home, '.pm2', 'pids');
    mkdirSync(pidDir, { recursive: true });
    writeFileSync(join(pidDir, 'cortextos-daemon-0.pid'), '9876\n');

    const deps = {
      execFileSync: () => 'node renamed-process.js\n',
      existsSync,
      readFileSync,
      homedir: () => home,
    };

    expect(resolveTarget(deps).status).toBe('ambiguous');
  });

  it('uses pm2 jlist as a positive stopped signal only when jlist is non-empty', () => {
    const deps = {
      execFileSync: () => JSON.stringify([{ name: 'other-service', pid: 55, pm2_env: { status: 'online' } }]),
      existsSync: () => false,
      readFileSync,
      homedir: () => '/unused',
    };

    expect(resolveTarget(deps)).toMatchObject({ status: 'stopped', identityConfirmed: true });
  });

  it('treats empty or broken pm2 jlist as ambiguous', () => {
    const emptyDeps = {
      execFileSync: () => '[]',
      existsSync: () => false,
      readFileSync,
      homedir: () => '/unused',
    };
    const brokenDeps = {
      execFileSync: () => {
        throw new Error('pm2 unavailable');
      },
      existsSync: () => false,
      readFileSync,
      homedir: () => '/unused',
    };

    expect(resolveTarget(emptyDeps).status).toBe('ambiguous');
    expect(resolveTarget(brokenDeps).status).toBe('ambiguous');
  });

  it('treats resolve-then-walk races as ambiguous and therefore refused', () => {
    const targetState = { status: 'ambiguous', pid: null, identityConfirmed: false };
    expect(decide({ target: targetState, callerAncestry: { ancestry: [500, 1], complete: true } }).verdict).toBe('REFUSE');
  });

  it('walks caller ancestry to PID 1', () => {
    const parents = new Map([
      [90, 80],
      [80, 70],
      [70, 1],
    ]);
    const deps = {
      execFileSync: (_command: string, args: string[]) => {
        const pid = Number(args[args.length - 1]);
        return `${parents.get(pid) ?? 1}\n`;
      },
      existsSync,
      readFileSync,
      homedir: () => '/unused',
    };

    expect(getCallerAncestry(90, deps)).toEqual({ ancestry: [90, 80, 70, 1], complete: true });
  });

  it('refuses when ps throws before the walk reaches PID 1', () => {
    const deps = {
      execFileSync: (_command: string, args: string[]) => {
        const pid = Number(args[args.length - 1]);
        if (pid === 80) {
          throw new Error('ancestor vanished');
        }
        return '80\n';
      },
      existsSync,
      readFileSync,
      homedir: () => '/unused',
    };

    const callerAncestry = getCallerAncestry(90, deps);
    expect(callerAncestry).toEqual({ ancestry: [90, 80], complete: false });
    expect(decide({ target: target({ pid: 70 }), callerAncestry }).verdict).toBe('REFUSE');
  });

  it('refuses when ps returns an empty parent before the walk reaches PID 1', () => {
    const deps = {
      execFileSync: (_command: string, args: string[]) => {
        const pid = Number(args[args.length - 1]);
        return pid === 80 ? '\n' : '80\n';
      },
      existsSync,
      readFileSync,
      homedir: () => '/unused',
    };

    const callerAncestry = getCallerAncestry(90, deps);
    expect(callerAncestry).toEqual({ ancestry: [90, 80], complete: false });
    expect(decide({ target: target({ pid: 70 }), callerAncestry }).verdict).toBe('REFUSE');
  });

  it('still passes positive stopped targets when ancestry is incomplete', () => {
    const decision = decide({
      target: target({ status: 'stopped', pid: null }),
      callerAncestry: { ancestry: [90, 80], complete: false },
    });

    expect(decision.verdict).toBe('PASS');
  });
});

describe('daemon-bounce.sh wrapper', () => {
  function writeStub(file: string, body: string): void {
    writeFileSync(file, body, 'utf8');
    chmodSync(file, 0o700);
  }

  function writeWrapperFixture(scriptsDir: string): string {
    const wrapperPath = join(scriptsDir, 'daemon-bounce.sh');
    writeFileSync(wrapperPath, readFileSync(join(repoRoot, 'scripts', 'daemon-bounce.sh'), 'utf8'), 'utf8');
    chmodSync(wrapperPath, 0o700);
    return wrapperPath;
  }

  function writeAmbiguousPm2Stub(bin: string): void {
    writeStub(join(bin, 'pm2'), `#!/bin/sh
if [ "$1" = "jlist" ]; then echo '[]'; exit 0; fi
exit 1
`);
  }

  function runGuardExpectingMain(invocationPath: string, cwd: string) {
    const tmp = makeTempDir('bounce-main-path-');
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    writeAmbiguousPm2Stub(bin);

    let failure: { status?: number; stdout?: string; stderr?: string; message?: string } | null = null;
    try {
      execFileSync(process.execPath, [invocationPath], {
        cwd,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home },
        encoding: 'utf8',
        stdio: 'pipe',
      });
      throw new Error('expected guard invocation to refuse');
    } catch (error) {
      failure = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    }

    const combinedOutput = `${failure?.stdout ?? ''}${failure?.stderr ?? ''}`;
    expect(failure?.message).not.toBe('expected guard invocation to refuse');
    expect(failure?.status).not.toBe(0);
    expect(combinedOutput).toContain('REFUSED: caller is inside the cortextos-daemon process tree');
    expect(combinedOutput.length).toBeGreaterThan(0);
  }

  it('runs main for direct invocation', () => {
    runGuardExpectingMain(join(repoRoot, 'scripts', 'bounce-guard.mjs'), repoRoot);
  });

  it('runs main for symlinked invocation', () => {
    const tmp = makeTempDir('bounce-symlink-');
    const linkedGuard = join(tmp, 'linked-bounce-guard.mjs');
    symlinkSync(join(repoRoot, 'scripts', 'bounce-guard.mjs'), linkedGuard);

    runGuardExpectingMain(linkedGuard, repoRoot);
  });

  it('runs main for relative invocation from repo root', () => {
    runGuardExpectingMain('./scripts/bounce-guard.mjs', repoRoot);
  });

  it('runs main for dotdot invocation', () => {
    const scriptsDir = join(repoRoot, 'scripts');
    const dotdotPath = join('..', relative(dirname(scriptsDir), join(repoRoot, 'scripts', 'bounce-guard.mjs')));

    runGuardExpectingMain(dotdotPath, scriptsDir);
  });

  it('does not call pm2 restart when the guard refuses', () => {
    const tmp = makeTempDir('bounce-wrapper-refuse-');
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    const restartLog = join(tmp, 'restart.log');

    writeAmbiguousPm2Stub(bin);
    writeStub(join(bin, 'pm2'), `#!/bin/sh
if [ "$1" = "jlist" ]; then echo '[]'; exit 0; fi
if [ "$1" = "restart" ]; then echo "$*" >> "${restartLog}"; exit 0; fi
exit 1
`);

    expect(() =>
      execFileSync('bash', ['scripts/daemon-bounce.sh'], {
        cwd: repoRoot,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home },
        stdio: 'pipe',
      })
    ).toThrow();
    expect(existsSync(restartLog)).toBe(false);
  });

  function expectWrapperAbortForGuard(body: string): void {
    const tmp = makeTempDir('bounce-wrapper-abort-');
    const scriptsDir = join(tmp, 'scripts');
    const bin = join(tmp, 'bin');
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const restartLog = join(tmp, 'restart.log');
    const wrapperPath = writeWrapperFixture(scriptsDir);

    writeStub(join(scriptsDir, 'bounce-guard.mjs'), body);
    writeStub(join(bin, 'pm2'), `#!/bin/sh
if [ "$1" = "restart" ]; then echo "$*" >> "${restartLog}"; exit 0; fi
exit 1
`);

    expect(() =>
      execFileSync('bash', [wrapperPath], {
        cwd: repoRoot,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdio: 'pipe',
      })
    ).toThrow();
    expect(existsSync(restartLog)).toBe(false);
  }

  it('does not call pm2 restart when the guard exits 0 without a PASS token', () => {
    expectWrapperAbortForGuard(`process.exit(0);
`);
  });

  it('does not call pm2 restart when the guard emits an empty stdout and exits 0', () => {
    expectWrapperAbortForGuard(`console.log('');
process.exit(0);
`);
  });

  it('does not call pm2 restart when the guard emits a wrong token', () => {
    expectWrapperAbortForGuard(`console.log('BOUNCE-GUARD-VERDICT: ALLOW');
process.exit(0);
`);
  });

  it('does not call pm2 restart when the guard refuses on stderr', () => {
    expectWrapperAbortForGuard(`console.error('REFUSED: no');
process.exit(1);
`);
  });

  it('calls pm2 restart only after the guard passes', () => {
    const tmp = makeTempDir('bounce-wrapper-pass-');
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    const restartLog = join(tmp, 'restart.log');

    writeStub(join(bin, 'pm2'), `#!/bin/sh
if [ "$1" = "jlist" ]; then
  printf '%s\\n' '[{"name":"cortextos-daemon","pid":1234,"pm2_env":{"status":"online"}}]'
  exit 0
fi
if [ "$1" = "restart" ]; then echo "$*" >> "${restartLog}"; exit 0; fi
exit 1
`);
    writeStub(join(bin, 'ps'), `#!/bin/sh
if [ "$1" = "-p" ] && [ "$2" = "1234" ]; then
  echo 'node cortextos-daemon'
  exit 0
fi
if [ "$1" = "-o" ] && [ "$2" = "ppid=" ]; then
  echo '1'
  exit 0
fi
/bin/ps "$@"
`);

    execFileSync('bash', ['scripts/daemon-bounce.sh'], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home },
      stdio: 'pipe',
    });

    expect(readFileSync(restartLog, 'utf8').trim()).toBe('restart cortextos-daemon');
  });

  it('calls pm2 restart when the guard emits the positive PASS token', () => {
    const tmp = makeTempDir('bounce-wrapper-token-');
    const scriptsDir = join(tmp, 'scripts');
    const bin = join(tmp, 'bin');
    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const restartLog = join(tmp, 'restart.log');
    const wrapperPath = writeWrapperFixture(scriptsDir);

    writeStub(join(scriptsDir, 'bounce-guard.mjs'), `console.log('BOUNCE-GUARD-VERDICT: PASS');
process.exit(0);
`);
    writeStub(join(bin, 'pm2'), `#!/bin/sh
if [ "$1" = "restart" ]; then echo "$*" >> "${restartLog}"; exit 0; fi
exit 1
`);

    execFileSync('bash', [wrapperPath], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: 'pipe',
    });

    expect(readFileSync(restartLog, 'utf8').trim()).toBe('restart cortextos-daemon');
  });
});
