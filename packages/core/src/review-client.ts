import type { Binding, RunView } from "./agent-contracts";
import type { Review, ReviewChange } from "./review-changes";

/**
 * Client side of the post-workout review (M2-4), shared by the web card and the
 * mobile card so both take the same steps through the approval ledger.
 */
export type ReviewOutcome =
  | { status: "proposed"; review: Review; run: RunView }
  | { status: "nochange"; review: Review }
  | { status: "invalid"; problems: string[] }
  | { status: "unavailable"; error: string };
/** The two endpoints a review card uses, bound to the platform's fetch and credentials; both throw on failure. */
export type ReviewApi = {
  review(action: "" | "accept" | "rollback", body: unknown): Promise<ReviewOutcome>;
  ledger(path: string, body?: unknown): Promise<unknown>;
};

export const reviewBinding = (r: RunView): Binding => ({ proposalId: r.proposal!.proposalId, contentHash: r.proposal!.contentHash, contextRevision: r.proposal!.contextRevision });

/** Approve and execute exactly the preview the user saw; a repeated call finds it already applied. */
export async function confirmPreview(api: ReviewApi, seen: RunView): Promise<RunView> {
  let run = await api.ledger(`/${seen.id}`) as RunView;
  if (run.proposal?.contentHash !== seen.proposal?.contentHash) throw new Error("VERSION_CONFLICT");
  if (run.status === "awaiting_approval")
    run = await api.ledger(`/${run.id}/user-events`, { action: "approve", expectedRevision: run.revision, binding: reviewBinding(run) }) as RunView;
  if (run.status === "approved") {
    await api.ledger(`/${run.id}/execute`, { binding: reviewBinding(run), approvalId: run.approvalId, idempotencyKey: run.proposal!.proposalId });
    run = await api.ledger(`/${run.id}`) as RunView;
  }
  if (run.status !== "applied") throw new Error(run.status === "stale" ? "CONTEXT_STALE" : "NEW_PREVIEW_REQUIRED");
  return run;
}

/** The changes recorded with a review run, newest note first; none when the run is not a review. */
export function reviewChanges(run: RunView | null): ReviewChange[] {
  const note = [...run?.events ?? []].reverse().find(e => e.type === "workout_review")?.data as { review?: Review } | undefined;
  return note?.review?.outcome === "changes" ? note.review.changes : [];
}

/** The preview a proposed outcome carries; unavailable and invalid outcomes throw their code, nochange gives null. */
export function previewOf(outcome: ReviewOutcome): RunView | null {
  if (outcome.status === "unavailable") throw new Error(outcome.error);
  if (outcome.status === "invalid") throw new Error("INVALID_REVIEW");
  return outcome.status === "proposed" ? outcome.run : null;
}
