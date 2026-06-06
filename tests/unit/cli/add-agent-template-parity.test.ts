/**
 * Skill-tree parity between the claude and codex agent templates.
 *
 * Bug context: PR 02 added the codex-agent template under
 * templates/agent-codex/plugins/cortextos-agent-skills/skills/, but the
 * template's .gitignore matched a bare `memory/` rule, which silently dropped
 * the memory skill from the committed tree. Fresh codex agents booted without
 * a memory skill — invisible breakage with no failing test.
 *
 * The fix anchored the .gitignore to agent-instance memory dirs only and
 * restored the template's memory/ skill. This test pins the invariant: every
 * skill that ships in the claude template must also ship in the codex
 * template, by directory name.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';

const CLAUDE_SKILLS = join(__dirname, '..', '..', '..', 'templates', 'agent', '.claude', 'skills');
const CODEX_SKILLS = join(
  __dirname,
  '..',
  '..',
  '..',
  'templates',
  'agent-codex',
  'plugins',
  'cortextos-agent-skills',
  'skills',
);

function listSkillDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// The codex template INTENTIONALLY omits the `codex` skill: that skill is
// "invoke Codex as a peer" (a Claude-Code agent getting a second opinion from
// Codex), which is self-referential and useless on a codex-based agent. This is
// a by-design divergence, not a missing skill. Every OTHER claude skill must
// still ship in the codex template — this allowlist is the ONLY permitted gap,
// so a different dropped skill (e.g. `memory`, the original bug this test was
// written for) still fails.
const INTENTIONAL_CODEX_OMISSIONS = ['codex'];

describe('agent template skill-tree parity', () => {
  it('codex template ships every claude skill except the intentional codex-peer omission', () => {
    const claudeSkills = listSkillDirs(CLAUDE_SKILLS);
    const codexSkills = listSkillDirs(CODEX_SKILLS);

    const missingInCodex = claudeSkills.filter((skill) => !codexSkills.includes(skill));
    // Only the documented intentional omission(s) may be missing; any OTHER
    // dropped skill still fails this assertion. Sort both sides so the check is
    // order-independent if the allowlist ever grows beyond one entry.
    expect([...missingInCodex].sort()).toEqual([...INTENTIONAL_CODEX_OMISSIONS].sort());
  });

  it('codex template does not ship skills that the claude template lacks', () => {
    const claudeSkills = listSkillDirs(CLAUDE_SKILLS);
    const codexSkills = listSkillDirs(CODEX_SKILLS);

    const extraInCodex = codexSkills.filter((skill) => !claudeSkills.includes(skill));
    expect(extraInCodex).toEqual([]);
  });

  it('skill counts match (allowing the intentional codex-peer omission)', () => {
    expect(listSkillDirs(CODEX_SKILLS).length).toBe(
      listSkillDirs(CLAUDE_SKILLS).length - INTENTIONAL_CODEX_OMISSIONS.length,
    );
  });
});
