import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../src/api/schemas/tasks';
import {
  ACTIVE_TASK_STATUSES,
  ROUTES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
} from '../../src/utils/constants';

describe('constants', () => {
  it('provides a label for every task status', () => {
    const allStatuses: TaskStatus[] = [
      'pending',
      'processing',
      'retry_pending',
      'completed',
      'failed',
      'cancelled',
    ];
    for (const status of allStatuses) {
      expect(TASK_STATUSES).toContain(status);
      expect(TASK_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('active statuses are exactly the non-terminal ones', () => {
    expect([...ACTIVE_TASK_STATUSES].sort()).toEqual(
      ['pending', 'processing', 'retry_pending'].sort(),
    );
  });

  it('taskDetail builds the detail route path', () => {
    expect(ROUTES.taskDetail('abc-123')).toBe('/tasks/abc-123');
  });
});
