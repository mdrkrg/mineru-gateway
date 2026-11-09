import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../src/i18n/locale';
import {
  ACTIVE_TASK_STATUSES,
  ROUTES,
  TASK_STATUSES,
  isActiveTaskStatus,
  isTaskStatus,
} from '../../src/utils/constants';
import { MINERU_TIERS } from '../../src/api/schemas/mineru-options';
import { mineruTierLabel, taskStatusLabel, taskStatusShortLabel } from '../../src/i18n/labels';

// The compact labels differ only in en; pin it so the fallback assertions do
// not depend on the node environment's default locale.
beforeAll(() => setLocale('en'));

describe('constants', () => {
  it('provides a label for every task status', () => {
    for (const status of TASK_STATUSES) {
      expect(taskStatusLabel(status)).toBeTruthy();
      expect(taskStatusShortLabel(status)).toBeTruthy();
    }
  });

  it('reuses the full label unless a short override exists', () => {
    expect(taskStatusShortLabel('pending')).toBe(taskStatusLabel('pending'));
    expect(taskStatusShortLabel('retry_pending')).not.toBe(
      taskStatusLabel('retry_pending'),
    );
    expect(taskStatusShortLabel('partial')).not.toBe(taskStatusLabel('partial'));
  });

  it('active statuses are exactly the non-terminal ones', () => {
    expect([...ACTIVE_TASK_STATUSES].sort()).toEqual(
      ['pending', 'processing', 'retry_pending'].sort(),
    );
  });

  it('isActiveTaskStatus matches the active status list', () => {
    for (const status of TASK_STATUSES) {
      expect(isActiveTaskStatus(status)).toBe(ACTIVE_TASK_STATUSES.includes(status));
    }
    expect(isActiveTaskStatus('unknown')).toBe(false);
  });

  it('isTaskStatus guards the status union', () => {
    for (const status of TASK_STATUSES) {
      expect(isTaskStatus(status)).toBe(true);
    }
    expect(isTaskStatus('unknown')).toBe(false);
  });

  it('taskDetail builds the detail route path', () => {
    expect(ROUTES.taskDetail('abc-123')).toBe('/tasks/abc-123');
  });

  it('provides a label for every MinerU tier', () => {
    for (const tier of MINERU_TIERS) {
      expect(mineruTierLabel(tier)).toBeTruthy();
    }
  });
});
