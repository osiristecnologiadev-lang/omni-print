const NUL = String.fromCharCode(0);

// Postgres rejects NUL bytes anywhere in a text or jsonb value - confirmed
// against real hardware: an HP printer's SNMP response contained a
// NUL-padded field, the Go agent forwarded it as-is, and every Postgres
// write touching that string failed with "invalid byte sequence for
// encoding UTF8: 0x00", 500ing the whole batch.
//
// The agent was fixed at the source for its structured fields, but this
// endpoint accepts payloads from whatever agent version is actually
// installed in the field, and the `raw` field is an intentionally-unfiltered
// passthrough of every OID a device returns - so the backend needs its own
// defense here regardless of what the agent does.
export function deepStripNul<T>(value: T): T {
  if (typeof value === 'string') {
    return value.split(NUL).join('') as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepStripNul(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepStripNul(v);
    }
    return out as T;
  }
  return value;
}
