'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Match } from '@/lib/match';
import { CHANNEL_VIDEOS, MAX_VIDEOS, channelLabel, parseChannelRef, parseVideoId } from '@/lib/youtube-url';

// The two next steps of a "too few entities" result, on the same page: read the channel's
// latest uploads, or add videos. The brand side of the failed run is kept as it was; only the
// creator's videos change, and the score is computed again from scratch (same formula, same
// minimum of 3 entities, the brand itself still not scored).
export function CreatorRetryForm({ match, onRerun, running }: { match: Match; onRerun: (videoUrls: string[]) => void; running?: boolean }) {
  const brand = match.brand.entity?.name || match.brand.name;
  const previous = match.creator.videoUrls;
  const fromChannel = previous.length === 1 && !parseVideoId(previous[0]);
  const handle = match.creator.youtubeHandle;
  const [channel, setChannel] = useState(fromChannel ? '' : handle.startsWith('@') ? `https://www.youtube.com/${handle}` : '');
  const [keep, setKeep] = useState<string[]>(fromChannel ? [] : previous);
  const [added, setAdded] = useState('');

  const channelRef = parseChannelRef(channel);
  const newLines = added.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  const invalid = newLines.filter((l) => !parseVideoId(l));
  const keptIds = new Set(keep.map(parseVideoId));
  const fresh = newLines.filter((l) => parseVideoId(l) && !keptIds.has(parseVideoId(l)));
  const total = keep.length + fresh.length;
  const tooMany = total > MAX_VIDEOS;
  const ready = fresh.length > 0 && !tooMany && !invalid.length; // the same videos again would fail the same way
  const sample = fromChannel ? `the channel’s latest ${CHANNEL_VIDEOS} uploads` : `${previous.length} video${previous.length === 1 ? '' : 's'}`;
  const same = `Brand: ${brand}, unchanged · the score is computed again from scratch.`;

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-amber-200 bg-white p-4 text-slate-900 print:hidden">
      {!fromChannel && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (channelRef) onRerun([channel.trim()]);
          }}
        >
          <label htmlFor="retry-channel" className="text-sm font-semibold">
            Read the channel’s latest {CHANNEL_VIDEOS} videos
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              id="retry-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="https://www.youtube.com/@channel"
              className="max-w-sm"
            />
            <Button type="submit" disabled={!channelRef || running}>
              Re-run with the channel’s latest {CHANNEL_VIDEOS} videos
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {channel.trim() && !channelRef
              ? 'Not a channel URL: use youtube.com/@handle or youtube.com/channel/UC…'
              : `Sample: ${sample} → ${channelRef ? channelLabel(channelRef) : 'the channel'}’s latest ${CHANNEL_VIDEOS} videos. ${same}`}
          </p>
        </form>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onRerun([...keep, ...fresh]);
        }}
      >
        <label htmlFor="retry-videos" className="text-sm font-semibold">
          {fromChannel ? 'Or pick 2–3 videos instead' : 'Or add 2–3 videos'}
        </label>
        <p className="mt-1 text-sm text-slate-600">
          Videos whose titles or descriptions name other brands, products or topics, not {brand}’s own products. One URL per line.
        </p>
        {!fromChannel && (
          <fieldset className="mt-2 space-y-1">
            <legend className="text-xs text-slate-500">Kept from this run (untick to drop one):</legend>
            {previous.map((url) => (
              <label key={url} className="flex items-center gap-2 text-xs break-all text-slate-700">
                <input
                  type="checkbox"
                  checked={keep.includes(url)}
                  onChange={(e) => setKeep((k) => (e.target.checked ? [...k, url] : k.filter((x) => x !== url)))}
                />
                {match.creator.videos.find((v) => v.videoId === parseVideoId(url))?.title || url}
              </label>
            ))}
          </fieldset>
        )}
        <Textarea
          id="retry-videos"
          rows={3}
          value={added}
          onChange={(e) => setAdded(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="mt-2"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!ready || running}>
            {fresh.length ? `Re-run with ${total} video${total === 1 ? '' : 's'}` : 'Re-run with the added videos'}
          </Button>
          <p className={`text-xs ${tooMany || invalid.length ? 'text-rose-700' : 'text-slate-600'}`}>
            {invalid.length
              ? `Not a video URL: ${invalid[0]}`
              : tooMany
                ? `At most ${MAX_VIDEOS} videos: untick ${total - MAX_VIDEOS} above or add fewer.`
                : `Sample: ${sample} → ${fromChannel ? '' : `${keep.length} kept + `}${fresh.length} new = ${total} of at most ${MAX_VIDEOS} videos${
                    fromChannel ? ', instead of the channel' : ''
                  }. ${same}`}
          </p>
        </div>
      </form>
    </div>
  );
}
