export const DEFAULT_FLOOR_HANDOFF_PATH = '/work-orders/my-queue';
export const FLOOR_HANDOFF_NEXT_KEY = 'gg_floor_handoff_next';
export const FLOOR_HANDOFF_RETURN_KEY = 'gg_floor_handoff_return_to';

const FLOOR_ORIGIN = 'https://floor.golfingarage.local';
const DEFAULT_ERP_RETURN_ORIGINS = [
  'https://golfingarage.m4nos.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

export function sanitizeFloorNextPath(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return DEFAULT_FLOOR_HANDOFF_PATH;
  }

  try {
    const parsed = new URL(raw, FLOOR_ORIGIN);
    if (parsed.origin !== FLOOR_ORIGIN) {
      return DEFAULT_FLOOR_HANDOFF_PATH;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || DEFAULT_FLOOR_HANDOFF_PATH;
  } catch {
    return DEFAULT_FLOOR_HANDOFF_PATH;
  }
}

export function sanitizeErpReturnUrl(
  value: string | null | undefined,
  extraAllowedOrigins: string[] = [],
): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const allowedOrigins = new Set([
    ...DEFAULT_ERP_RETURN_ORIGINS,
    ...extraAllowedOrigins.filter(Boolean),
  ]);

  try {
    const parsed = new URL(raw);
    if (!allowedOrigins.has(parsed.origin)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
