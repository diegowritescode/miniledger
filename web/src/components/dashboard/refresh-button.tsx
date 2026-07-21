'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Spinner } from '@/components/ui';

export function RefreshButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);
  const busy = pending || clicked;

  function refresh() {
    setClicked(true);
    startTransition(() => {
      router.refresh();
      setClicked(false);
    });
  }

  return (
    <Button type="button" variant="secondary" onClick={refresh} disabled={busy}>
      {busy ? (
        <>
          <Spinner className="h-4 w-4" /> {busyLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}
