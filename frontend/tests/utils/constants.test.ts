import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../src/api/schemas/tasks';
import {
  ACTIVE_TASK_STATUSES,
  ROUTES,
  TASK_STATUSES,
  isActiveTaskStatus,
} from '../../src/utils/constants';
import { MINERU_TIERS } from '../../src/api/schemas/mineru-options';
import { mineruTierLabel, taskStatusLabel } from '../../src/i18n/labels';

describe('constants', () => {
  it('provides a label for every task status', () => {
    const allStatuses: TaskStatus[] = [
      'pending',
      'processing',
      'retry_pending',
      'completed',
      'partial',
      'failed',
      'cancelled',
    ];
    for (const status of allStatuses) {
      expect(TASK_STATUSES).toContain(status);
      expect(taskStatusLabel(status)).toBeTruthy();
    }
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

  it('taskDetail builds the detail route path', () => {
    expect(ROUTES.taskDetail('abc-123')).toBe('/tasks/abc-123');
  });

  it('provides a label for every MinerU tier', () => {
    for (const tier of MINERU_TIERS) {
      expect(mineruTierLabel(tier)).toBeTruthy();
    }
  });
});
