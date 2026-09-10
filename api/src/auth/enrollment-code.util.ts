import { randomInt } from 'crypto';

// Crockford-Base32-ish: excludes 0/O/1/I/L so a human reading this off a
// phone/WhatsApp screen can't confuse characters. 32^8 ≈ 1.1e12 possible
// codes - combined with @Throttle(5/min) on the exchange endpoint (see
// agent-enrollment.controller.ts) and the 24h/single-use expiry (see
// CustomersService.createEnrollmentCode), brute force is infeasible.
// crypto.randomInt, not Math.random - same reasoning as
// generateAgentTokenDigits.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ENROLLMENT_CODE_LENGTH = 8;

export function generateEnrollmentCode(): string {
  let code = '';
  for (let i = 0; i < ENROLLMENT_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}

// "XXXX-XXXX" - display convenience only, same idea as
// formatAgentTokenDigits. The stored/compared value has no dash.
export function formatEnrollmentCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

// Accepts whatever a human typed or pasted (lowercase, stray spaces, the
// display dash) and reduces it to the canonical form that was hashed at
// creation time. Deliberately does not validate length/alphabet here -
// AgentEnrollmentService checks length before hashing/lookup so a garbage
// string fails fast without a DB round-trip; this function's only job is
// normalization.
export function normalizeEnrollmentCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '');
}
