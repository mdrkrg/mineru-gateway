const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function normalizePublicPath(raw: string, variable: string): string {
  const value = raw.trim();
  if (!value) return '/';

  if (
    URL_SCHEME.test(value) ||
    value.startsWith('//') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\')
  ) {
    throw new Error(`${variable} must be a URL path, not a URL`);
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  const segments = withLeadingSlash.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${variable} must not contain dot segments`);
  }

  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Normalize the Vite and router mount path, including its trailing slash. */
export function normalizeAppBasePath(raw: string | undefined): string {
  const normalized = normalizePublicPath(raw ?? '/', 'VITE_APP_BASE_PATH');
  return normalized === '/' ? '/' : `${normalized}/`;
}

/** Normalize the browser-visible API prefix, excluding its trailing slash. */
export function normalizeApiPrefix(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return '';
  const normalized = normalizePublicPath(raw, 'VITE_API_PREFIX');
  return normalized === '/' ? '' : normalized;
}

/** Remove the public API prefix before forwarding through the dev proxy. */
export function stripPathPrefix(path: string, prefix: string): string {
  if (!prefix) return path;
  if (path === prefix) return '/';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
