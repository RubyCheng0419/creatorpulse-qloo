'use client';

import { useState } from 'react';
import type { Match } from '@/lib/match';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MAX = 3;

// Shown when the brand isn't in Qloo: the user names 1–3 brands with a similar audience
// that are in Qloo. The server verifies each by exact name; any it can't find come back
// marked here, with Qloo's names that start with them, to be replaced.
export function ReferenceBrandsForm({ match, onSubmit }: { match: Match; onSubmit: (referenceBrands: string[]) => void }) {
  const previous = match.brand.referenceBrands ?? [];
  const [names, setNames] = useState<string[]>(() => Array.from({ length: MAX }, (_, i) => previous[i] ?? ''));
  const missing = new Map((match.brand.missingReferences ?? []).map((m) => [m.name, m.suggestions]));
  const filled = names.map((n) => n.trim()).filter(Boolean);

  const set = (i: number, value: string) => setNames((list) => list.map((n, j) => (j === i ? value : n)));

  return (
    <form
      className="mt-4 rounded-lg border border-amber-200 bg-white p-4 text-slate-900"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled.length) onSubmit(filled);
      }}
    >
      <h4 className="text-sm font-semibold">Score against reference brands</h4>
      <p className="mt-1 text-sm text-slate-600">
        Your brand isn’t in Qloo. Enter 1–{MAX} reference brands with a similar audience that are in Qloo. Each must match a Qloo brand
        exactly; the result is labelled as scored against them, with confidence one level lower.
      </p>
      <div className="mt-3 space-y-2">
        {names.map((n, i) => {
          const suggestions = missing.get(n.trim());
          return (
            <div key={i}>
              <Input
                aria-label={`Reference brand ${i + 1}`}
                value={n}
                onChange={(e) => set(i, e.target.value)}
                placeholder={i === 0 ? 'e.g. Byredo' : 'optional'}
                className={`max-w-sm ${suggestions ? 'border-rose-300' : ''}`}
              />
              {suggestions && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-rose-700">
                  Not in Qloo.
                  {suggestions.length ? (
                    suggestions.map((s) => (
                      <Button key={s} type="button" size="sm" variant="outline" onClick={() => set(i, s)}>
                        Use “{s}”
                      </Button>
                    ))
                  ) : (
                    <span>Replace it with another brand.</span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <Button type="submit" className="mt-3" disabled={!filled.length}>
        Score against {filled.length > 1 ? 'these brands' : 'this brand'}
      </Button>
    </form>
  );
}
