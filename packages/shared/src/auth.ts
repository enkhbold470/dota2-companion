import type { GsiPayload } from './types';

export function isAuthorized(payload: GsiPayload, expectedToken: string): boolean {
  if (!expectedToken) return false;             // refuse to run without a configured token
  return payload.auth?.token === expectedToken;
}
