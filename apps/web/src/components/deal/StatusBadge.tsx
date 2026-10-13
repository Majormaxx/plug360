import type { Phase } from '@/lib/deal';
import { Badge, type Tone } from '../ui/Badge';

export const PHASE_LABEL: Record<Phase, { label: string; tone: Tone }> = {
  missing: { label: 'Not found', tone: 'neutral' },
  window: { label: 'Window open', tone: 'neutral' },
  payable: { label: 'Ready to pay out', tone: 'accent' },
  disputed: { label: 'In dispute', tone: 'accent' },
  'dispute-expired': { label: 'Deadline missed', tone: 'danger' },
  released: { label: 'Released', tone: 'mint' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  settled: { label: 'Paid out', tone: 'mint' },
};

export function StatusBadge({ phase }: { phase: Phase }) {
  const p = PHASE_LABEL[phase];
  return (
    <Badge tone={p.tone} dot>
      {p.label}
    </Badge>
  );
}
