'use client';

import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[GlobalError]', error);

    // Report to Sentry if available
    if (
      typeof window !== 'undefined' &&
      (window as Record<string, unknown>).Sentry
    ) {
      (
        (window as Record<string, unknown>).Sentry as {
          captureException: (e: Error) => void;
        }
      ).captureException(error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <NextError statusCode={0} />
          <button
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              borderRadius: '0.375rem',
              border: '1px solid #ccc',
              background: '#fff',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
