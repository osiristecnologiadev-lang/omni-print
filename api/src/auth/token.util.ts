import { createHash } from 'crypto';

// Agent tokens are stored only as a SHA-256 hash (see prisma/seed.ts) - never
// the raw value, so a database leak alone can't be used to authenticate.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
