"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card mx-auto max-w-lg p-6 text-center">
      <h1 className="h1">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">Nothing was changed. Try again, or contact IT if it keeps happening.</p>
      <button type="button" onClick={reset} className="btn-primary mt-4">Try again</button>
    </div>
  );
}
