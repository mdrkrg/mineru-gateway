import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../src/api/schemas/tasks';
import {
  ACTIVE_TASK_STATUSES,
  ROUTES,
  TASK_STATUSES,
  isActiveTaskStatus,
} from '../../src/utils/constants';
import {
  mineruLanguageCoverage,
  mineruLanguageLabel,
  taskStatusLabel,
} from '../../src/i18n/labels';

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

  it('provides a label and coverage for every MinerU language', () => {
    const allLanguages = [
      'ch', 'ch_server', 'korean', 'ta', 'te', 'ka',
      'th', 'el', 'arabic', 'east_slavic', 'cyrillic', 'devanagari',
    ] as const;
    for (const lang of allLanguages) {
      expect(mineruLanguageLabel(lang)).toBeTruthy();
      expect(mineruLanguageCoverage(lang)).toBeTruthy();
    }
  });
});
