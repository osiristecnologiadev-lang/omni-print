import { BadRequestException } from '@nestjs/common';

// Extra network ranges an agent sweeps for printers, configured per customer
// in the panel ("Redes adicionais" - see agent/internal/discovery's
// Options.ExtraRanges). Added for a real customer (Sabin, 2026-09) whose
// printers sit on routed subnets the agent can't see from its own.
//
// Deliberately bounded: private address space only (an agent must never be
// pointed at someone else's public network), and nothing wider than a /16
// (65k addresses - roughly an hour of sweeping at the agent's large-sweep
// concurrency; anything bigger is almost certainly a typo like /8).

export const MAX_DISCOVERY_RANGES = 32;
const MIN_PREFIX = 16;

// [network, prefix] pairs.
const PRIVATE_BLOCKS: Array<[number, number]> = [
  [ipToInt('10.0.0.0'), 8],
  [ipToInt('172.16.0.0'), 12],
  [ipToInt('192.168.0.0'), 16],
  [ipToInt('100.64.0.0'), 10], // carrier-grade NAT, used internally by some ISPs/SD-WANs
];

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join('.');
}

function networkOf(ip: number, prefix: number): number {
  // Unsigned arithmetic: JS bitwise ops are signed 32-bit.
  return ip - (ip % 2 ** (32 - prefix));
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

// Normalizes one entry to "a.b.c.d" (single address) or "a.b.c.0/nn"
// (network address, so "10.80.34.45/24" and "10.80.34.0/24" dedupe), or
// throws a Portuguese message naming the offending entry.
export function normalizeDiscoveryRange(raw: string): string {
  const entry = raw.trim();
  const [ip, prefixText, ...rest] = entry.split('/');
  if (rest.length > 0 || !IPV4.test(ip) || (prefixText !== undefined && !/^\d{1,2}$/.test(prefixText))) {
    throw new BadRequestException(`Faixa inválida: "${entry}". Use um IP (10.80.40.5) ou uma rede (10.80.40.0/24).`);
  }
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (prefix > 32) {
    throw new BadRequestException(`Faixa inválida: "${entry}". O número depois da barra vai até 32.`);
  }
  if (prefix < MIN_PREFIX) {
    throw new BadRequestException(`Faixa grande demais: "${entry}". O máximo é /${MIN_PREFIX} (65 mil endereços).`);
  }
  const network = networkOf(ipToInt(ip), prefix);
  const isPrivate = PRIVATE_BLOCKS.some(([block, blockPrefix]) => networkOf(network, blockPrefix) === block);
  if (!isPrivate) {
    throw new BadRequestException(
      `Faixa fora da rede interna: "${entry}". Só são aceitas faixas privadas (10.x, 172.16-31.x, 192.168.x).`,
    );
  }
  return prefix === 32 ? intToIp(network) : `${intToIp(network)}/${prefix}`;
}

export function normalizeDiscoveryRanges(raw: string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry.trim()) continue;
    const normalized = normalizeDiscoveryRange(entry);
    if (!out.includes(normalized)) out.push(normalized);
  }
  if (out.length > MAX_DISCOVERY_RANGES) {
    throw new BadRequestException(`No máximo ${MAX_DISCOVERY_RANGES} faixas por cliente.`);
  }
  return out;
}
