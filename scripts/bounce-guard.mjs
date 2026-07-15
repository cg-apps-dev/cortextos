#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAEMON_NAME = 'cortextos-daemon';
const PASS_TOKEN = 'BOUNCE-GUARD-VERDICT: PASS';
const REFUSE_MESSAGE =
  'REFUSED: caller is inside the cortextos-daemon process tree (or daemon state unconfirmable). A bounce from inside the tree kills its own executor before restart. Request the bounce from OUTSIDE - human / PM2 / launchd / out-of-fleet. See playbooks/fleet/daemon-bounce.md';

function normalizePid(pid) {
  const parsed = Number(pid);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStatus(status) {
  return status === 'running' || status === 'stopped' || status === 'ambiguous'
    ? status
    : 'ambiguous';
}

function ambiguous(reason = 'daemon state unconfirmable') {
  return { status: 'ambiguous', pid: null, identityConfirmed: false, reason };
}

export function decide({ target, callerAncestry }) {
  if (!target || typeof target !== 'object') {
    return { verdict: 'REFUSE', reason: 'daemon state unconfirmable' };
  }

  const status = normalizeStatus(target.status);
  if (status === 'stopped') {
    return { verdict: 'PASS', reason: 'cortextos-daemon is positively stopped' };
  }

  if (status !== 'running' || target.identityConfirmed !== true) {
    return { verdict: 'REFUSE', reason: 'daemon state unconfirmable' };
  }

  if (callerAncestry?.complete !== true) {
    return { verdict: 'REFUSE', reason: 'caller ancestry unconfirmable' };
  }

  const targetPid = normalizePid(target.pid);
  if (targetPid === null) {
    return { verdict: 'REFUSE', reason: 'daemon state unconfirmable' };
  }

  const ancestryInput = Array.isArray(callerAncestry)
    ? callerAncestry
    : Array.isArray(callerAncestry?.ancestry)
      ? callerAncestry.ancestry
      : [];
  const ancestry = ancestryInput
    .map(normalizePid)
    .filter((pid) => pid !== null);

  if (ancestry.includes(targetPid)) {
    return { verdict: 'REFUSE', reason: 'caller is inside the cortextos-daemon process tree' };
  }

  return { verdict: 'PASS', reason: 'caller is outside the cortextos-daemon process tree' };
}

function execText(command, args, deps) {
  return deps.execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readPidFile(deps) {
  const pidPath = join(deps.homedir(), '.pm2', 'pids', `${DAEMON_NAME}-0.pid`);
  if (!deps.existsSync(pidPath)) {
    return { found: false, pid: null };
  }

  const pid = normalizePid(deps.readFileSync(pidPath, 'utf8').trim());
  return { found: true, pid };
}

function readProcessCommand(pid, deps) {
  return execText('ps', ['-p', String(pid), '-o', 'command='], deps).trim();
}

function isDaemonCommand(command) {
  return (
    typeof command === 'string' &&
    (command.includes(DAEMON_NAME) || /(^|\s|\/)dist\/daemon\.js(\s|$)/.test(command))
  );
}

export function confirmDaemonIdentity(pid, deps = defaultDeps()) {
  const normalizedPid = normalizePid(pid);
  if (normalizedPid === null) {
    return false;
  }

  try {
    return isDaemonCommand(readProcessCommand(normalizedPid, deps));
  } catch {
    return false;
  }
}

function resolveFromPm2List(deps) {
  let entries;
  try {
    const raw = execText('pm2', ['jlist'], deps);
    entries = JSON.parse(raw);
  } catch {
    return ambiguous('pm2 jlist unavailable');
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return ambiguous('pm2 jlist returned no positive state');
  }

  const daemon = entries.find((entry) => entry && entry.name === DAEMON_NAME);
  if (!daemon) {
    return { status: 'stopped', pid: null, identityConfirmed: true, reason: 'daemon absent from non-empty pm2 list' };
  }

  const pm2Status = daemon.pm2_env?.status;
  if (pm2Status === 'stopped') {
    return { status: 'stopped', pid: null, identityConfirmed: true, reason: 'pm2 reports daemon stopped' };
  }

  const pid = normalizePid(daemon.pid);
  if (pid === null) {
    return ambiguous('pm2 daemon pid missing');
  }

  const identityConfirmed = confirmDaemonIdentity(pid, deps);
  return identityConfirmed
    ? { status: 'running', pid, identityConfirmed: true, reason: 'pm2 reports daemon running and identity confirmed' }
    : ambiguous('pm2 daemon pid identity unconfirmed');
}

export function resolveTarget(deps = defaultDeps()) {
  try {
    const pidFile = readPidFile(deps);
    if (pidFile.found) {
      if (pidFile.pid === null) {
        return ambiguous('pid file malformed');
      }

      const identityConfirmed = confirmDaemonIdentity(pidFile.pid, deps);
      return identityConfirmed
        ? { status: 'running', pid: pidFile.pid, identityConfirmed: true, reason: 'pid file identity confirmed' }
        : ambiguous('pid file identity unconfirmed');
    }

    return resolveFromPm2List(deps);
  } catch {
    return ambiguous('target resolver failed');
  }
}

export function getCallerAncestry(startPid = process.ppid, deps = defaultDeps()) {
  const ancestry = [];
  const seen = new Set();
  let current = normalizePid(startPid);
  let complete = false;

  while (current !== null && current > 1 && !seen.has(current)) {
    ancestry.push(current);
    seen.add(current);

    try {
      const parent = normalizePid(execText('ps', ['-o', 'ppid=', '-p', String(current)], deps).trim());
      if (parent === null) {
        return { ancestry, complete: false };
      }
      current = parent;
    } catch {
      return { ancestry, complete: false };
    }
  }

  if (current === 1) {
    ancestry.push(1);
    complete = true;
  }

  return { ancestry, complete };
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return '';
  }
}

function defaultDeps() {
  return {
    execFileSync,
    existsSync,
    readFileSync,
    homedir,
  };
}

export async function main() {
  const target = resolveTarget();
  const callerAncestry = getCallerAncestry(process.ppid);
  const decision = decide({ target, callerAncestry });

  if (decision.verdict === 'PASS') {
    console.log(PASS_TOKEN);
    console.log(`PASS: ${decision.reason}`);
    return 0;
  }

  console.error(`${REFUSE_MESSAGE} Reason: ${decision.reason}.`);
  return 1;
}

const invokedReal = process.argv[1] ? safeRealpath(resolve(process.argv[1])) : '';
const selfReal = safeRealpath(fileURLToPath(import.meta.url));
if (invokedReal && selfReal && invokedReal === selfReal) {
  const code = await main();
  process.exit(code);
}
