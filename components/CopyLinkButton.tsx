'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

// "Copy share link" on a result: a match (lib/share-link shareLink) or a ranking (discoverShareLink).
export function CopyLinkButton({ link }: { link: () => string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link());
          setState('copied');
        } catch {
          setState('failed'); // clipboard blocked: the link is still the page's own inputs
        }
        setTimeout(() => setState('idle'), 2500);
      }}
    >
      {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy failed' : 'Copy share link'}
    </Button>
  );
}
