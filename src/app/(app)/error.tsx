"use client";

import { ErrorState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card padding">
      <ErrorState
        title="This page could not be loaded"
        action={
          <button type="button" className="btn primary" onClick={reset}>
            Try again
          </button>
        }
      >
        The server reported an error{error.digest ? ` (reference ${error.digest})` : ""}. Nothing was changed. If it keeps happening, check that the database is running.
      </ErrorState>
    </div>
  );
}
