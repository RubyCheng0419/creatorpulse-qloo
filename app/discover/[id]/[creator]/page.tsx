'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { CopyLinkButton } from '@/components/CopyLinkButton';
import { SiteHeader } from '@/components/SiteHeader';
import { EvidenceSummary, VERDICT_STYLE, roleKinds } from '@/components/discover/CandidateCard';
import { TasteComparison, formatAffinity } from '@/components/match/TasteComparison';
import type { CreatorCandidate } from '@/lib/discover';
import { type StoredDiscovery, useDiscoveries } from '@/lib/discoveries';
import { NO_DATA_NEXT_STEPS } from '@/lib/no-data';
import { VERDICT_LABELS, brandBasisNote } from '@/lib/report';
import { discoverShareLink } from '@/lib/share-link';
import { candidateUnverified } from '@/lib/unverified';

// One ranked creator from a ranking this browser found (lib/discoveries): the profile that
// was scored, the channel it maps to, every dimension and entity, and the confidence.
// The ids are only known at request time, so the content sits in a Suspense boundary.
export default function CreatorPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Suspense fallback={null}>
          <StoredCreator />
        </Suspense>
      </main>
    </>
  );
}

function StoredCreator() {
  const { id, creator } = useParams<{ id: string; creator: string }>();
  const discoveries = useDiscoveries();
  const discoveryId = decodeURIComponent(id);
  const qlooId = decodeURIComponent(creator);
  // undefined while storage is still unknown (server render), null when not found.
  const d = discoveries === null ? undefined : (discoveries.find((x) => x.id === discoveryId) ?? null);
  const c = d?.candidates.find((x) => x.qlooId === qlooId) ?? (d ? null : undefined);

  if (d === null || c === null) {
    return (
      <div className="text-slate-600">
        <p>This creator’s ranking is not in this browser. Rankings are stored only on the device that found them (the last five).</p>
        <Link href="/discover" className="mt-2 inline-block text-teal-700 underline">
          Find creators
        </Link>
      </div>
    );
  }
  return d && c ? <CreatorDetail d={d} c={c} /> : null;
}

function CreatorDetail({ d, c }: { d: StoredDiscovery; c: CreatorCandidate }) {
  const brand = d.brand.entity?.name || d.brand.name;
  const comp = c.compatibility;
  const scored = c.status === 'scored';
  const unverified = d.validation?.status === 'unverified';
  const reasons = candidateUnverified(c, d);
  const roles = roleKinds(c).length;
  const basisNote = brandBasisNote(d.brand);
  const entities = comp.dimensions
    .flatMap((dim) => [...dim.intersection, ...dim.weakLink, ...dim.divergence].map((e) => ({ e, dim: dim.label })))
    .sort((a, b) => b.e.brandAffinity - a.e.brandAffinity);
  const deepDive = (() => {
    if (!c.channel) return null;
    const q = new URLSearchParams({ videos: c.channel.url, brand: d.request.brandName });
    if (d.request.referenceBrands?.length) q.set('refs', d.request.referenceBrands.join('|'));
    if (d.request.brandDescription) q.set('desc', d.request.brandDescription);
    return `/?${q}`;
  })();

  return (
    <div className="space-y-4">
      {/* scroll={false}: the ranking page scrolls to its own results (Next would reset to the top). */}
      <Link href={`/discover?run=${encodeURIComponent(d.id)}`} scroll={false} className="text-sm font-medium text-teal-700 hover:underline">
        ← Ranking for {brand}
      </Link>

      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        {basisNote && (
          <p className="mb-4 rounded-md bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 ring-1 ring-violet-200">
            {basisNote} <span className="font-normal">Confidence is one level lower than the evidence alone would give.</span>
          </p>
        )}
        <p className="text-sm text-slate-500">
          Find creators · #{c.rank} of {d.candidates.length} for {brand} · {new Date(d.createdAt).toLocaleDateString('en-US')}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{c.name}</h1>
        {c.description && <p className="text-sm text-slate-500">{c.description}</p>}

        <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <p className="text-xs tracking-wide text-slate-500">Fit Score</p>
            <p className="text-6xl font-bold tabular-nums leading-none text-slate-900">
              {comp.fitScore ?? '—'}
              {comp.fitScore !== null && <span className="text-2xl font-medium text-slate-400">/100</span>}
            </p>
          </div>
          <div>
            <p className="text-xs tracking-wide text-slate-500">Confidence</p>
            <p className="text-3xl font-semibold text-slate-900">{comp.confidence ?? '—'}</p>
            {comp.confidenceBasis && (
              <p className="max-w-56 text-xs text-slate-500">
                Based on {comp.confidenceBasis.entities} audience-taste entities across {comp.confidenceBasis.dimensions} dimensions; at most
                Medium, since none were named in videos
              </p>
            )}
          </div>
          {scored && (
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${unverified || reasons.length ? 'text-rose-800 ring-rose-200' : VERDICT_STYLE[comp.verdict]}`}
            >
              {reasons.length ? 'Unverified: do not use for a decision' : unverified ? 'Unverified ranking: no verdict' : VERDICT_LABELS[comp.verdict]}
            </span>
          )}
        </div>
        {scored && reasons.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-sm text-rose-900">
            {reasons.map((r) => (
              <li key={r.code}>
                <span className="font-semibold">
                  {r.code} · {r.label}:
                </span>{' '}
                {r.detail} {r.next}
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-6 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
          <dt className="text-slate-500">Scored profile</dt>
          <dd className="text-slate-800">
            <span className="font-medium">Person-level</span>: the Qloo person {c.name} (<code className="text-xs">{c.qlooId}</code>), i.e. all of {c.name} in
            Qloo, not a single YouTube channel.
            {roles > 1 && (
              <span className="mt-1 block rounded-md bg-amber-50 px-2 py-1 text-amber-900 ring-1 ring-amber-200">
                <span className="font-semibold">Mixed roles.</span> Qloo describes {c.name} as “{c.description}”: {roles} different kinds of role,
                so this profile mixes their audiences.
              </span>
            )}
          </dd>
          <dt className="text-slate-500">YouTube channel</dt>
          <dd className="text-slate-800">
            {c.channel ? (
              <>
                <a href={c.channel.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">
                  {c.channel.handle}
                  <ExternalLink aria-hidden className="size-3" />
                </a>{' '}
                <span className="text-xs text-slate-500">({c.channel.title}; matched by name, used only for the video deep dive, not in this score)</span>
              </>
            ) : (
              <span className="text-slate-500">None matched this name, so no video deep dive.</span>
            )}
          </dd>
          <dt className="text-slate-500">Audience overlap</dt>
          <dd className="text-slate-800">
            {c.audienceOverlap !== null ? c.audienceOverlap.toFixed(2) : '—'}{' '}
            <span className="text-xs text-slate-500">(how strongly {brand}’s audience likes {c.name} in Qloo; shown, not scored)</span>
          </dd>
          <dt className="text-slate-500">Profile</dt>
          <dd className="text-slate-800">
            {c.profile.scored} of {c.profile.entities} audience-taste entities scored
            {c.profile.unsupportedTypes?.length ? ` · Qloo has no audience-taste data for: ${c.profile.unsupportedTypes.join(', ')}` : ''}
            {c.profile.failedTypes.length ? ` · Qloo didn’t answer this time for: ${c.profile.failedTypes.join(', ')}` : ''}
          </dd>
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
          {deepDive && (
            <Link
              href={deepDive}
              className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Analyze {c.channel!.handle}’s latest videos
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
          <Link
            href={`/compare?brand=${encodeURIComponent(d.request.brandName)}`}
            className="inline-flex items-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Compare creators
          </Link>
          <CopyLinkButton link={() => discoverShareLink(d.request, window.location.origin)} />
        </div>
      </section>

      {scored ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900">What the score rests on</h2>
            <div className="mt-2">
              <EvidenceSummary c={c} />
            </div>
          </section>
          <TasteComparison dimensions={comp.dimensions} brandName={brand} basis="audience" title={`Why ${c.name} scores ${comp.fitScore}`} />
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <h2 className="text-base font-semibold text-slate-900">Profile entities ({entities.length})</h2>
            <p className="mt-1 text-sm text-slate-500">
              What Qloo infers {c.name}’s audience likes, with {brand}’s audience affinity for each. All count half (Qloo inference, not named in
              videos).
            </p>
            <div className="mt-3">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <tr>
                    <th scope="col" className="py-1.5 pr-2 font-medium">Entity</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Dimension</th>
                    <th scope="col" className="py-1.5 pl-2 text-right font-medium">Affinity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entities.map(({ e, dim }) => (
                    <tr key={`${dim}:${e.id}`}>
                      <td className="py-1.5 pr-2 text-slate-800">
                        {e.name} <span className="text-xs text-slate-400">{e.type.replace('urn:entity:', '')}</span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-600 sm:text-sm">{dim}</td>
                      <td className="py-1.5 pl-2 text-right tabular-nums text-slate-800">{formatAffinity(e.brandAffinity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No score: Qloo scored only {c.profile.scored} of this creator’s audience-taste entities.{' '}
          {c.noDataReason ? NO_DATA_NEXT_STEPS[c.noDataReason][0] : ''}
        </p>
      )}
    </div>
  );
}
