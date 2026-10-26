'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { CREATOR_CATEGORIES } from '@/lib/creator-categories';
import { deleteProject, useProjects } from '@/lib/projects';

// Projects for Find creators: each keeps its brand inputs and the rankings found with them.

export default function ProjectsPage() {
  const projects = useProjects();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
        <p className="mt-1 text-sm text-slate-500">
          One project per campaign or product line: its brand inputs and every ranking found with them. Stored in this browser only, up to 20
          projects.
        </p>

        {projects && projects.length === 0 && (
          <p className="mt-8 text-slate-600">
            No projects yet. In
            <Link href="/discover" className="mx-1 text-teal-700 underline">
              Find creators
            </Link>
            choose “New project…” to save your brand inputs.
          </p>
        )}

        <ul className="mt-6 space-y-4">
          {projects?.map((p) => (
            <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-slate-900">{p.name}</h2>
                  <p className="text-sm text-slate-500">
                    {p.inputs.brandName} · {CREATOR_CATEGORIES[p.inputs.creatorCategory]?.label ?? 'Any YouTuber'}
                    {p.inputs.referenceBrands.length ? ` · reference brands: ${p.inputs.referenceBrands.join(', ')}` : ''}
                    {p.inputs.brandDescription ? ' · with a description' : ''}
                  </p>
                  <p className="text-xs text-slate-400">Updated {new Date(p.updatedAt).toLocaleString('en-US')}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Link href={`/discover?project=${p.id}`} className="font-medium text-teal-700 hover:underline">
                    Open in Find creators
                  </Link>
                  {confirming === p.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          deleteProject(p.id);
                          setConfirming(null);
                        }}
                        className="font-medium text-rose-700 hover:underline"
                      >
                        Delete this project
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-slate-500 hover:underline">
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirming(p.id)} className="text-slate-500 hover:underline">
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {p.runs.length ? (
                <ol className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  {p.runs.map((r) => (
                    <li key={r.id} className="text-sm">
                      <p className="text-xs text-slate-500">
                        {new Date(r.createdAt).toLocaleString('en-US')} · {CREATOR_CATEGORIES[r.creatorCategory]?.label ?? 'Any YouTuber'}
                        {r.note ? ` · ${r.note}` : ''}
                      </p>
                      <p className="text-slate-800">
                        {r.status === 'completed'
                          ? r.top.map((c, i) => `${i + 1}. ${c.name} ${c.fitScore ?? '—'}`).join(' · ')
                          : 'No ranking (insufficient data)'}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500">No rankings yet.</p>
              )}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
