import { describe, expect, it } from 'vitest';
import {
  normalizeApiPrefix,
  normalizeAppBasePath,
  stripPathPrefix,
} from '../../config/base-path';

describe('frontend base path', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['mineru', '/mineru/'],
    ['/mineru', '/mineru/'],
    ['/mineru/', '/mineru/'],
    ['/mineru///admin/', '/mineru/admin/'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeAppBasePath(input)).toBe(expected);
  });

  it.each([
    'https://example.com/mineru',
    '//example.com/mineru',
    '/mineru?mode=1',
    '/mineru#section',
    '/mineru/../admin',
    '/mineru\\admin',
  ])('rejects invalid application base path %s', (input) => {
    expect(() => normalizeAppBasePath(input)).toThrow();
  });
});

describe('API prefix', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['api', '/api'],
    ['/mineru/api/', '/mineru/api'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeApiPrefix(input)).toBe(expected);
  });

  it('strips only the complete public prefix', () => {
    expect(stripPathPrefix('/mineru/api', '/mineru/api')).toBe('/');
    expect(stripPathPrefix('/mineru/api/tasks?limit=10', '/mineru/api')).toBe(
      '/tasks?limit=10',
    );
    expect(stripPathPrefix('/mineru/apis/tasks', '/mineru/api')).toBe(
      '/mineru/apis/tasks',
    );
  });
});
