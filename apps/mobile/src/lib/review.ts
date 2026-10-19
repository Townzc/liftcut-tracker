import type { ReviewApi } from "@liftcut/core/review-client";
import { apiBase, apiHeaders } from "./api";

type Credentials = Parameters<typeof apiHeaders>[0];

/** The review card's two endpoints with the bearer token: the same routes and ledger steps as the web card. */
export function reviewApi(auth: () => Credentials | null, fetcher: typeof fetch = fetch): ReviewApi {
  const call = async (path: string, body?: unknown) => {
    const session = auth();
    if (!session) throw new Error("AUTH");
    const response = await fetcher(`${apiBase}${path}`, body === undefined ? { headers: apiHeaders(session), cache: "no-store" }
      : { method: "POST", headers: apiHeaders(session, true), body: JSON.stringify(body) });
    return { response, result: await response.json().catch(() => null) };
  };
  return {
    async review(action, body) {
      const { result } = await call(`/api/workout-review${action && `?action=${action}`}`, body);
      if (!result?.status) throw new Error(result?.error || "OUTCOME_UNKNOWN");
      return result;
    },
    async ledger(path, body) {
      const { response, result } = await call(`/api/agent/runs${path}`, body);
      if (!response.ok || !result?.ok) throw new Error(result?.error || "OUTCOME_UNKNOWN");
      return result.value;
    },
  };
}
