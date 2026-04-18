import { SharePayload } from './types';

/**
 * Encodes a SharePayload into a URL-safe base64 string.
 */
export function encodeSharePayload(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  // btoa works with ASCII; use encodeURIComponent to handle unicode
  return btoa(unescape(encodeURIComponent(json)));
}

/**
 * Decodes a base64 string back into a SharePayload.
 * Returns null if decoding fails.
 */
export function decodeSharePayload(encoded: string): SharePayload | null {
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    return JSON.parse(json) as SharePayload;
  } catch {
    return null;
  }
}

/**
 * Builds the full share URL for a given payload.
 */
export function buildShareUrl(payload: SharePayload): string {
  const encoded = encodeSharePayload(payload);
  const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
  return `${base}/share?r=${encoded}`;
}
