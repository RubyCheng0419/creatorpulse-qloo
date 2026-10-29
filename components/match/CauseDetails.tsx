import type { NameResolution } from '@/lib/creator';
import { type InsufficientCause, causeCounts } from '@/lib/no-data-cause';

// The one cause of an insufficient-data result, with the counts and the per-name evidence the
// Agent Trace logged (lib/no-data-cause): what was extracted, what Qloo confirmed, what was
// dropped and why, and which LLM extracted.
const FATE: Record<NameResolution['status'], string> = {
  exact: 'confirmed (exact name or alias)',
  maker: 'confirmed as its maker',
  alias: 'confirmed under a Qloo alias',
  'no-match': 'dropped',
  failed: 'dropped',
  skipped: 'dropped',
  unverified: 'dropped',
};

export function CauseDetails({ cause }: { cause: InsufficientCause }) {
  const confirmed = cause.names.filter((n) => n.entity && ['exact', 'maker', 'alias'].includes(n.status));
  const dropped = cause.names.filter((n) => !confirmed.includes(n));
  return (
    <div className="mt-3 space-y-2 text-amber-900">
      <p>
        <span className="font-semibold">Cause: {cause.title}.</span> {cause.detail}
      </p>
      <p className="text-xs">{causeCounts(cause)}</p>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline font-medium">LLM used: </dt>
          <dd className="inline">{cause.llm}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Extracted names ({cause.proposed}): </dt>
          <dd className="inline">{cause.names.filter((n) => n.status !== 'skipped').map((n) => n.name).join(', ') || 'none'}</dd>
        </div>
        <div>
          <dt className="inline font-medium">
            Qloo-confirmed ({cause.confirmed} entit{cause.confirmed === 1 ? 'y' : 'ies'}):{' '}
          </dt>
          <dd className="inline">
            {confirmed.length
              ? confirmed
                  .map((n) => `${n.name}${n.entity!.name !== n.name ? ` → ${n.entity!.name}` : ''} (${FATE[n.status]}${cause.brandIds.includes(n.entity!.id) ? '; the brand itself, not scored' : ''})`)
                  .join(', ')
              : 'none'}
          </dd>
        </div>
        {dropped.length > 0 && (
          <div>
            <dt className="inline font-medium">Dropped ({dropped.length}): </dt>
            <dd className="inline">{dropped.map((n) => `${n.name} (${n.note || n.status})`).join(', ')}</dd>
          </div>
        )}
        {cause.failedCalls.length > 0 && (
          <div>
            <dt className="inline font-medium">Failed calls ({cause.failedCalls.length}): </dt>
            <dd className="inline">{cause.failedCalls.join('; ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
