// SECURITY-AGENT external two-touch adversarial fixtures.
// Authored independently (not reused from claude-dev/codex). Scratch file - deleted after run.
// Goal: try to slip a command-substitution in a bus-send BODY past decideSendGuard,
// and confirm three-way discipline (known-bad FIRES, known-good PASSES).
import { describe, it, expect } from 'vitest';
import { decideSendGuard } from '../../../src/hooks/hook-send-guard';

const isDeny = (cmd: string) => decideSendGuard(cmd).permissionDecision === 'deny';
const decision = (cmd: string) => JSON.stringify(decideSendGuard(cmd));

// Build tricky literals unambiguously.
const BT = String.fromCharCode(96);        // backtick `
const SQ = String.fromCharCode(39);        // single quote '
const DQ = String.fromCharCode(34);        // double quote "
const SUB = '$(id)';                        // command substitution
const BTSUB = BT + 'id' + BT;               // backtick substitution

describe('SEC three-way discipline', () => {
  it('KNOWN-GOOD canonical safe body -> allow', () => {
    expect(isDeny('cortextos bus send-message a normal "$BODY"')).toBe(false);
  });
  it('KNOWN-BAD obvious $() in body -> deny', () => {
    expect(isDeny(`cortextos bus send-message a normal "${SUB}"`)).toBe(true);
  });
});

describe('SEC invariant 1: compound shapes with body substitution must DENY', () => {
  const ops: [string, string][] = [
    ['semicolon', ' ; echo hi'],
    ['pipe', ' | cat'],
    ['and', ' && echo hi'],
    ['or', ' || echo hi'],
    ['background', ' & echo hi'],
    ['newline', '\necho hi'],
    ['comment', ' # trailing'],
    ['redirect-out', ' > /tmp/x'],
    ['redirect-in', ' < /tmp/x'],
    ['append', ' >> /tmp/x'],
  ];
  for (const [name, tail] of ops) {
    it(`$() body before ${name} -> deny`, () => {
      expect(isDeny(`cortextos bus send-message a normal "${SUB}"${tail}`)).toBe(true);
    });
    it(`backtick body before ${name} -> deny`, () => {
      expect(isDeny(`cortextos bus send-message a normal "${BTSUB}"${tail}`)).toBe(true);
    });
  }
});

describe('SEC invariant 2: glued-to-command-name substitution', () => {
  it('unquoted glued $() -> deny', () => {
    expect(isDeny(`cortextos bus send-message${SUB} a normal "hi"`)).toBe(true);
  });
  it('double-quoted glued $() -> deny', () => {
    expect(isDeny(`cortextos bus send-message${DQ}${SUB}${DQ} a normal "hi"`)).toBe(true);
  });
  it('single-quoted glued $() -> allow (does not execute)', () => {
    expect(isDeny(`cortextos bus send-message${SQ}${SUB}${SQ} a normal "hi"`)).toBe(false);
  });
  it('glued backtick -> deny', () => {
    expect(isDeny(`cortextos bus send-message${BTSUB} a normal "hi"`)).toBe(true);
  });
});

describe('SEC invariant 3: no false positive on legit content', () => {
  it('single-quoted literal $() and backtick in body -> allow', () => {
    expect(isDeny(`cortextos bus send-message a normal ${SQ}literal ${SUB} and ${BTSUB} text${SQ}`)).toBe(false);
  });
  it('dollar-amount escaped in double-quote body -> allow', () => {
    expect(isDeny('cortextos bus send-message a normal "costs \\$5 today"')).toBe(false);
  });
  it('substitution in UNRELATED earlier chained command -> allow', () => {
    expect(isDeny(`echo ${SUB} ; cortextos bus send-message a normal "$BODY"`)).toBe(false);
  });
  it('substitution in UNRELATED later chained command -> allow', () => {
    expect(isDeny(`cortextos bus send-message a normal "$BODY" ; echo ${SUB}`)).toBe(false);
  });
});

describe('SEC ANSI-C quoting desync hypothesis (the primary attack)', () => {
  // $'\'' at the shell = a literal single-quote char, BALANCED. If the guard's
  // quote tracker miscounts it, a following "$(id)" could evade the body scan.
  const ANSIC = '$' + SQ + '\\' + SQ + SQ; // $'\''
  it('$\'\\\'\' then double-quoted $() as a later arg -> must DENY (real shell executes $(id))', () => {
    const cmd = `cortextos bus send-message a normal ${ANSIC} "${SUB}"`;
    // If this ALLOWs, print the decision for forensics.
    if (!isDeny(cmd)) console.error('DESYNC-SLIP-A:', decision(cmd), 'CMD=', JSON.stringify(cmd));
    expect(isDeny(cmd)).toBe(true);
  });
  it('$\'\\\'\' as the body position itself with glued $() -> must DENY', () => {
    const cmd = `cortextos bus send-message a normal ${ANSIC}${SUB}`;
    if (!isDeny(cmd)) console.error('DESYNC-SLIP-B:', decision(cmd), 'CMD=', JSON.stringify(cmd));
    expect(isDeny(cmd)).toBe(true);
  });
});

describe('SEC escaped-quote / backslash desync shapes', () => {
  it('escaped double-quote inside body then real $() -> DENY', () => {
    // "he said \" $(id)"  -> the \" is escaped, quote stays open, $(id) is inside -> executes
    const cmd = `cortextos bus send-message a normal "he said \\" ${SUB}"`;
    if (!isDeny(cmd)) console.error('ESC-SLIP-A:', decision(cmd), 'CMD=', JSON.stringify(cmd));
    expect(isDeny(cmd)).toBe(true);
  });
  it('trailing-backslash line-continuation before $() body -> DENY', () => {
    const cmd = `cortextos bus send-message a normal \\\n"${SUB}"`;
    if (!isDeny(cmd)) console.error('ESC-SLIP-B:', decision(cmd), 'CMD=', JSON.stringify(cmd));
    expect(isDeny(cmd)).toBe(true);
  });
});

describe('SEC bounded-predicate completeness (executing forms)', () => {
  const execForms: [string, string][] = [
    ['dollar-paren', '$(id)'],
    ['backtick', BT + 'id' + BT],
    ['brace-param', '${x}'],
    ['arith', '$((1+1))'],
    ['procsub-in', '<(id)'],
    ['procsub-out', '>(id)'],
    ['bash52-funsub-pipe', '${| id; }'],
    ['bash52-funsub', '${ id; }'],
  ];
  for (const [name, form] of execForms) {
    it(`double-quoted ${name} in body -> deny`, () => {
      const cmd = `cortextos bus send-message a normal "x${form}x"`;
      if (!isDeny(cmd)) console.error('PREDICATE-MISS:', name, decision(cmd));
      expect(isDeny(cmd)).toBe(true);
    });
  }
});

describe('SEC other body-guarded commands + send-telegram', () => {
  it('send-telegram body $() -> deny', () => {
    expect(isDeny(`cortextos bus send-telegram 123 "${SUB}"`)).toBe(true);
  });
  it('create-task --desc $() -> deny', () => {
    expect(isDeny(`cortextos bus create-task "t" --desc "${SUB}"`)).toBe(true);
  });
  it('log-event --meta $() -> deny', () => {
    expect(isDeny(`cortextos bus log-event a b info --meta "${SUB}"`)).toBe(true);
  });
  it('create-approval context $() -> deny', () => {
    expect(isDeny(`cortextos bus create-approval "title" cat "${SUB}"`)).toBe(true);
  });
  it('send-telegram $() before pipe -> deny (compound)', () => {
    expect(isDeny(`cortextos bus send-telegram 123 "${SUB}" | cat`)).toBe(true);
  });
});
