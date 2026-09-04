import { randomInt } from 'crypto';

// A random 16-digit numeric string (~53 bits of entropy - not
// cryptographically huge, but this is copied/typed by a human into a
// client's config.yaml, not stored in a browser; see prisma/schema.prisma's
// AgentToken comment for the full trade-off and its mitigations). Never
// derived from a database id or any other sequential/predictable source.
export function generateAgentTokenDigits(): string {
  let digits = '';
  for (let i = 0; i < 16; i++) {
    digits += randomInt(0, 10).toString();
  }
  return digits;
}

// "1234 5678 9012 3456" - matches how people already read/type card-style
// numbers, purely a display convenience (the stored/compared value has no
// spaces).
export function formatAgentTokenDigits(digits: string): string {
  return digits.replace(/(.{4})(?=.)/g, '$1 ');
}
