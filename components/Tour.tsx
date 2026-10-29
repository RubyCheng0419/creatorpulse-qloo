'use client';

import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

// A spotlight tour: the page dims except the element a step is about, with a card beside it.
// Steps point at elements by their data-tour attribute; a step without a target, or whose
// target isn't on screen (e.g. hidden on a phone), shows its card in the middle instead.
// It starts once per browser on a page's first visit, and the Tour button replays it.

export interface TourStep {
  target?: string; // data-tour value
  title: string;
  body: ReactNode;
}

const PAD = 8; // spotlight padding around the element
const GAP = 12; // between the spotlight and the card
const GUTTER = 16; // card distance from the viewport edge
const CARD_WIDTH = 360;

const storageKey = (id: string) => `creatorpulse.tour.${id}`;

// A tour already finished or skipped in this browser. Unreadable storage counts as seen, so
// a private window isn't shown the tour on every visit; the Tour button still works.
function seen(id: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(id)) === 'done';
  } catch {
    return true;
  }
}

function markSeen(id: string) {
  try {
    window.localStorage.setItem(storageKey(id), 'done');
  } catch {
    // The tour may show again next visit; nothing else depends on it.
  }
}

function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Tour({ id, steps, autoStart = true }: { id: string; steps: TourStep[]; autoStart?: boolean }) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = index === null ? null : steps[index];

  const close = useCallback(() => {
    markSeen(id);
    setIndex(null);
  }, [id]);

  // First visit: start once the page has laid out.
  useEffect(() => {
    if (!autoStart || seen(id)) return;
    const t = setTimeout(() => setIndex(0), 400);
    return () => clearTimeout(t);
  }, [autoStart, id]);

  // Bring the step's element into view, then follow it while the page scrolls or resizes.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step.target);
    el?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setRect(findTarget(step.target)?.getBoundingClientRect() ?? null);
        setViewport({ w: window.innerWidth, h: window.innerHeight });
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [step, viewport.w]);

  useEffect(() => {
    if (step) primaryRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Keyboard: arrows move, Escape skips.
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setIndex((i) => (i !== null && i < steps.length - 1 ? i + 1 : i));
      else if (e.key === 'ArrowLeft') setIndex((i) => (i ? i - 1 : i));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, steps.length, close]);

  const replay = (
    <button
      type="button"
      onClick={() => setIndex(0)}
      className="fixed bottom-4 right-4 z-40 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-md hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 print:hidden"
    >
      ? Tour
    </button>
  );
  if (!step || index === null) return replay;

  const last = index === steps.length - 1;
  const vw = viewport.w || (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const vh = viewport.h || (typeof window !== 'undefined' ? window.innerHeight : 768);
  const width = Math.min(CARD_WIDTH, vw - 2 * GUTTER);

  // Below the element when it fits, else above, else over the bottom of the screen.
  let top: number;
  let left: number;
  if (rect) {
    const below = rect.bottom + PAD + GAP;
    const above = rect.top - PAD - GAP - cardHeight;
    top = below + cardHeight <= vh - GUTTER ? below : above >= GUTTER ? above : vh - GUTTER - cardHeight;
    left = Math.min(Math.max(rect.left, GUTTER), vw - GUTTER - width);
  } else {
    top = Math.max(GUTTER, (vh - cardHeight) / 2);
    left = (vw - width) / 2;
  }

  return (
    <div className="print:hidden">
      {/* Catches clicks so the page can't be used behind the tour. */}
      <div className={`fixed inset-0 z-[60] ${rect ? '' : 'bg-slate-900/60'}`} aria-hidden="true" />
      {rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[61] rounded-xl ring-2 ring-teal-400 motion-safe:transition-all motion-safe:duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + 2 * PAD,
            height: rect.height + 2 * PAD,
            boxShadow: '0 0 0 9999px rgb(15 23 42 / 0.6)',
          }}
        />
      )}
      {/* Keyed by step so each step gets a new card. Google Translate replaces text nodes with
          <font> elements; updating the old card's text in place makes React remove a node that is
          no longer there, and the page crashes. Replacing the card element avoids that. */}
      <div
        key={index}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="fixed z-[62] rounded-xl bg-white p-4 shadow-xl motion-safe:transition-[top,left] motion-safe:duration-200"
        style={{ top, left, width }}
      >
        <p className="text-xs font-medium text-teal-700">
          {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className="mt-1 text-base font-semibold text-slate-900">
          {step.title}
        </h2>
        <div id={bodyId} className="mt-1 text-sm leading-relaxed text-slate-600">
          {step.body}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <button type="button" onClick={close} className="mr-auto text-sm text-slate-500 hover:text-slate-800 hover:underline">
              Skip tour
            </button>
          )}
          {index > 0 && (
            <Button size="sm" variant="outline" onClick={() => setIndex(index - 1)} className={last ? 'mr-auto' : ''}>
              Back
            </Button>
          )}
          <Button ref={primaryRef} size="sm" onClick={() => (last ? close() : setIndex(index + 1))}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
