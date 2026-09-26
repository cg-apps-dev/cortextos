import { describe, expect, it } from 'vitest';
import { chooseDashboardInstallCommand } from '../../../src/cli/dashboard';

describe('chooseDashboardInstallCommand', () => {
  it('uses npm ci when package-lock.json exists', () => {
    expect(chooseDashboardInstallCommand(true)).toBe('npm ci');
  });

  it('falls back to npm install when package-lock.json is missing', () => {
    expect(chooseDashboardInstallCommand(false)).toBe('npm install');
  });
});
