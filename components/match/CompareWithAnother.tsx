'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Match } from '@/lib/match';
import { CHANNEL_VIDEOS, MAX_VIDEOS, parseChannelRef, parseVideoId } from '@/lib/youtube-url';

// Compare this result with a second creator, on the same page: this result is creator A as it
// stands (no re-run), only creator B is analysed, for the same brand side.
export function CompareWithAnother({
  match,
  onCompare,
  onCancel,
  running,
}: {
  match: Match;
  onCompare: (videoUrls: string[]) => void;
  onCancel: () => void;
  running?: boolean;
}) {
  const [text, setText] = useState('');
  const brand = match.brand.entity?.name || match.brand.name;
  const creatorA = match.creator.channelName || match.creator.youtubeHandle || 'this creator';
  const lines = text.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  const channel = lines.length === 1 && !parseVideoId(lines[0]) ? parseChannelRef(lines[0]) : null;
  const invalid = channel ? [] : lines.filter((l) => !parseVideoId(l));
  const ok = lines.length > 0 && !invalid.length && lines.length <= MAX_VIDEOS;

  return (
    <form
      className="mt-3 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onCompare(lines);
      }}
    >
      <label htmlFor="compare-creator" className="text-sm font-semibold text-slate-900">
        Creator B: 1–{MAX_VIDEOS} video URLs, or one channel URL (its latest {CHANNEL_VIDEOS} videos)
      </label>
      <Textarea
        id="compare-creator"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'https://www.youtube.com/@channel\nor https://www.youtube.com/watch?v=…'}
        className="mt-2"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!ok || running}>
          Compare
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <p className={`text-xs ${invalid.length || lines.length > MAX_VIDEOS ? 'text-rose-700' : 'text-slate-600'}`}>
          {invalid.length
            ? `Not a video or channel URL: ${invalid[0]}`
            : lines.length > MAX_VIDEOS
              ? `At most ${MAX_VIDEOS} videos.`
              : `Brand: ${brand}, unchanged · creator A is ${creatorA} as scored here, not re-run · only creator B is analysed, then both are shown side by side.`}
        </p>
      </div>
    </form>
  );
}
