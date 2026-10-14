export default function Loading() {
  return <div className="mx-auto max-w-2xl space-y-7 pt-12" aria-busy="true" aria-label="Loading">
    <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
    <div className="h-28 animate-pulse rounded-3xl bg-muted/60" />
  </div>;
}
