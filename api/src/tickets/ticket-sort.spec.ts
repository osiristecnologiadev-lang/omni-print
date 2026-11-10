import { sortByUrgency } from './tickets.service';

const now = Date.parse('2026-11-10T12:00:00Z');
const t = (id: string, status: string, priority: string, slaHoursFromNow: number, createdDaysAgo = 1) => ({
  id,
  status,
  priority,
  slaDueAt: new Date(now + slaHoursFromNow * 3_600_000),
  createdAt: new Date(now - createdDaysAgo * 86_400_000),
});

describe('sortByUrgency', () => {
  it('puts open tickets past their SLA first, then by priority and deadline; finished ones last', () => {
    const list = [
      t('resolved-new', 'RESOLVED', 'URGENT', -50, 0),
      t('open-low-soon', 'OPEN', 'LOW', 1),
      t('open-urgent-late', 'OPEN', 'URGENT', -2),
      t('progress-high', 'IN_PROGRESS', 'HIGH', 10),
      t('open-high-sooner', 'OPEN', 'HIGH', 3),
      t('closed-old', 'CLOSED', 'LOW', -500, 30),
    ];
    expect(sortByUrgency(list, now).map((x) => x.id)).toEqual([
      'open-urgent-late',
      'open-high-sooner',
      'progress-high',
      'open-low-soon',
      'resolved-new',
      'closed-old',
    ]);
  });
});
