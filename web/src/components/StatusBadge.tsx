import { Health } from '@/lib/health';
import { Badge } from './Badge';

export function StatusBadge({ health }: { health: Health }) {
  return <Badge tone={health.tone}>{health.label}</Badge>;
}
