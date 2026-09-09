import { describe, expect, it } from 'vitest';
import { deriveHealth } from './health';
import type { LatestMetric } from './api';

function metric(overrides: Partial<LatestMetric>): LatestMetric {
  return {
    id: 'm1',
    device_id: 'd1',
    collected_at: '2026-09-01T00:00:00Z',
    online: true,
    printer_status: 'idle',
    device_status: 'running',
    page_count: '100',
    mono_page_count: null,
    color_page_count: null,
    error_state: null,
    alerts: null,
    supplies: null,
    ...overrides,
  };
}

describe('deriveHealth', () => {
  it('returns "Sem dados" for a null/undefined metric', () => {
    expect(deriveHealth(null)).toEqual({ tone: 'neutral', label: 'Sem dados' });
    expect(deriveHealth(undefined)).toEqual({ tone: 'neutral', label: 'Sem dados' });
  });

  it('offline takes priority over everything else', () => {
    const m = metric({
      online: false,
      error_state: { lowToner: true },
      alerts: [{ severity: 'critical' }],
      supplies: [{ description: 'Black', level: 1, max_level: 100, class: 'supply' }],
    });
    expect(deriveHealth(m)).toEqual({ tone: 'critical', label: 'Offline' });
  });

  it('an active error flag beats alerts and low supply', () => {
    const m = metric({
      error_state: { lowToner: false, jammed: true },
      alerts: [{ severity: 'critical' }],
    });
    const health = deriveHealth(m);
    expect(health.tone).toBe('critical');
    expect(health.label).toBe('jammed');
  });

  it('critical alert beats a plain warning alert and low supply', () => {
    const m = metric({ alerts: [{ severity: 'warning' }, { severity: 'critical' }] });
    expect(deriveHealth(m)).toEqual({ tone: 'critical', label: '2 alerta(s)' });
  });

  it('only warning-severity alerts produce a warning tone, not critical', () => {
    const m = metric({ alerts: [{ severity: 'warning' }] });
    expect(deriveHealth(m)).toEqual({ tone: 'warning', label: '1 alerta(s)' });
  });

  it('a supply under 10% is critical', () => {
    const m = metric({ supplies: [{ description: 'Black', level: 5, max_level: 100, class: 'supply' }] });
    expect(deriveHealth(m)).toEqual({ tone: 'critical', label: 'Suprimento crítico (5%)' });
  });

  it('a supply under 25% but at/above 10% is a warning', () => {
    const m = metric({ supplies: [{ description: 'Black', level: 20, max_level: 100, class: 'supply' }] });
    expect(deriveHealth(m)).toEqual({ tone: 'warning', label: 'Suprimento baixo (20%)' });
  });

  it('a healthy supply falls through to printer status', () => {
    const m = metric({
      printer_status: 'idle',
      supplies: [{ description: 'Black', level: 80, max_level: 100, class: 'supply' }],
    });
    expect(deriveHealth(m)).toEqual({ tone: 'ok', label: 'Ociosa' });
  });

  it('printing status gets an info tone, not ok', () => {
    const m = metric({ printer_status: 'printing' });
    expect(deriveHealth(m)).toEqual({ tone: 'info', label: 'Imprimindo' });
  });

  it('an unrecognized printer status string passes through as its own label', () => {
    const m = metric({ printer_status: 'some_new_vendor_status' });
    expect(deriveHealth(m)).toEqual({ tone: 'ok', label: 'some_new_vendor_status' });
  });

  it('no printer status at all falls back to "OK"', () => {
    const m = metric({ printer_status: null });
    expect(deriveHealth(m)).toEqual({ tone: 'ok', label: 'OK' });
  });

  it('a non-"supply"-class item (e.g. a receptacle) does not count toward the lowest level', () => {
    const m = metric({
      supplies: [{ description: 'Waste box', level: 2, max_level: 100, class: 'receptacle' }],
    });
    // The waste receptacle at 2% must NOT trigger the critical-supply path -
    // only class: 'supply' items should (see lowestSupplyPercent's filter).
    expect(deriveHealth(m).label).not.toContain('crítico');
  });
});
