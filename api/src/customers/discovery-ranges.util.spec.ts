import { BadRequestException } from '@nestjs/common';
import { normalizeDiscoveryRange, normalizeDiscoveryRanges, MAX_DISCOVERY_RANGES } from './discovery-ranges.util';

describe('normalizeDiscoveryRange', () => {
  it.each([
    ['10.80.40.5', '10.80.40.5'],
    [' 10.80.40.5/32 ', '10.80.40.5'],
    ['10.80.34.45/24', '10.80.34.0/24'],
    ['10.80.0.0/16', '10.80.0.0/16'],
    ['172.20.1.1/20', '172.20.0.0/20'],
    ['192.168.1.0/24', '192.168.1.0/24'],
    ['100.64.3.0/24', '100.64.3.0/24'],
    ['10.255.255.255/25', '10.255.255.128/25'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeDiscoveryRange(input)).toBe(expected);
  });

  it.each([
    ['10.0.0.0/8', /grande demais/],
    ['10.80.0.0/15', /grande demais/],
    ['8.8.8.8', /fora da rede interna/],
    ['172.32.0.0/16', /fora da rede interna/],
    ['192.169.0.1', /fora da rede interna/],
    ['10.80.40', /inválida/],
    ['10.80.40.256', /inválida/],
    ['10.80.40.0/33', /até 32/],
    ['10.80.40.0/2a', /inválida/],
    ['impressora.local', /inválida/],
    ['10.0.0.1/24/1', /inválida/],
  ])('rejects %s', (input, message) => {
    expect(() => normalizeDiscoveryRange(input)).toThrow(BadRequestException);
    expect(() => normalizeDiscoveryRange(input)).toThrow(message);
  });
});

describe('normalizeDiscoveryRanges', () => {
  it('drops blanks and duplicates after normalizing', () => {
    expect(normalizeDiscoveryRanges(['10.80.34.45/24', '', '  ', '10.80.34.0/24', '10.80.40.5'])).toEqual([
      '10.80.34.0/24',
      '10.80.40.5',
    ]);
  });

  it('caps the number of ranges', () => {
    const many = Array.from({ length: MAX_DISCOVERY_RANGES + 1 }, (_, i) => `10.80.${i}.0/24`);
    expect(() => normalizeDiscoveryRanges(many)).toThrow(/No máximo/);
  });
});
