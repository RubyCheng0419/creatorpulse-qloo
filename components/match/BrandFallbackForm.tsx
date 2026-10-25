'use client';

import { useState } from 'react';
import type { Match } from '@/lib/match';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const MAX = 3;

export type BrandFallbackInput = { referenceBrands?: string[]; brandDescription?: string };

// Shown when the brand isn't in Qloo. First choice: 1–3 reference brands with a similar
// audience that are in Qloo; the server verifies each by exact name, and any it can't find
// come back marked here, with Qloo's names that start with them. Otherwise: a short
// description or the brand's web page, whose named entities must match Qloo exactly.
export function BrandFallbackForm({ match, onSubmit }: { match: Match; onSubmit: (fallback: BrandFallbackInput) => void }) {
  const previous = match.brand.referenceBrands ?? [];
  const [names, setNames] = useState<string[]>(() => Array.from({ length: MAX }, (_, i) => previous[i] ?? ''));
  const [description, setDescription] = useState(match.brand.description ?? '');
  const missing = new Map((match.brand.missingReferences ?? []).map((m) => [m.name, m.suggestions]));
  const filled = names.map((n) => n.trim()).filter(Boolean);
  const described = description.trim();

  const set = (i: number, value: string) => setNames((list) => list.map((n, j) => (j === i ? value : n)));

  return (
    <form
      className="mt-4 space-y-5 rounded-lg border border-amber-200 bg-white p-4 text-slate-900"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled.length) onSubmit({ referenceBrands: filled, brandDescription: described || undefined });
        else if (described) onSubmit({ referenceBrands: undefined, brandDescription: described });
      }}
    >
      <div>
        <h4 className="text-sm font-semibold">Score against reference brands</h4>
        <p className="mt-1 text-sm text-slate-600">
          Your brand isn’t in Qloo. Enter 1–{MAX} reference brands with a similar audience that are in Qloo. Each must match a Qloo brand
          exactly.
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
      </div>

      <div>
        <label htmlFor="brand-description" className="text-sm font-semibold">
          {filled.length ? 'Brand description (optional)' : 'Or: describe your brand'}
        </label>
        <p className="mt-1 text-sm text-slate-600">
          Paste a short description or your brand’s https:// web page. Only names it explicitly mentions (brands, artists, shows,
          places…) count, and at least 3 must match Qloo exactly; slogans and adjectives don’t.
        </p>
        <Textarea
          id="brand-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. https://example.com/about, or: Small-batch perfumes inspired by Studio Ghibli films and Kyoto…"
          className="mt-2"
        />
      </div>

      <div>
        <Button type="submit" disabled={!filled.length && !described}>
          {filled.length ? `Score against ${filled.length > 1 ? 'these brands' : 'this brand'}` : 'Score from this description'}
        </Button>
        <p className="mt-2 text-xs text-slate-500">The result is labelled with what it was scored against, and confidence is one level lower.</p>
      </div>
    </form>
  );
}
