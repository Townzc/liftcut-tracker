"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { aiRecipientSchema, hasRecipientConsent, recipientConsentValue } from "@liftcut/core/ai-recipient";
import { COACH_CONSENT_VERSION, type CoachStatus } from "@/lib/coach-model";

const changed = "liftcut-ai-consent-changed";
export const recipientConsentFailure = (code: unknown) => code === "AI_CONSENT_REQUIRED" || code === "AI_RECIPIENT_UNREVIEWED";
export const recipientNotice = (en: boolean) => en ? "Review the AI recipient and enable sharing before sending. This request was not resent." : "请核对 AI 接收方并同意发送. 本次请求不会自动重发.";
async function readStatus(): Promise<CoachStatus | null> {
  try {
    const response = await fetch("/api/ai/coach", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    return response.ok ? await response.json() as CoachStatus : null;
  } catch { return null; }
}

/** Only the public descriptor is fetched. History and local/manual records do not depend on consent. */
export function useRecipientConsent(key: string | null, initialStatus?: CoachStatus, requireCoachAvailability = true) {
  const [status, setStatus] = useState<CoachStatus | null>(initialStatus ?? null);
  const [saved, setSaved] = useState<{ key: string | null; value: string | null }>({ key: null, value: null });
  const [error, setError] = useState(false), sequence = useRef(0);
  const parsed = aiRecipientSchema.safeParse(status?.recipient);
  const recipient = parsed.success ? parsed.data : null;
  const available = (!requireCoachAvailability || status?.available === true) && status?.consentVersion === COACH_CONSENT_VERSION;
  const enabled = !error && !!key && saved.key === key && available && hasRecipientConsent(saved.value, recipient);
  const refresh = useCallback(() => {
    const request = ++sequence.current;
    return readStatus().then(value => {
      if (sequence.current === request) setStatus(value);
    });
  }, []);
  useEffect(() => {
    const read = () => { try { setSaved({ key, value: key ? localStorage.getItem(key) : null }); } catch { setSaved({ key, value: null }); } };
    read();
    window.addEventListener("storage", read); window.addEventListener(changed, read);
    if (!initialStatus) void refresh();
    return () => { window.removeEventListener("storage", read); window.removeEventListener(changed, read); };
  }, [key, initialStatus, refresh]);
  const setEnabled = (on: boolean) => {
    if (!key || on && (!recipient || !available)) return false;
    try {
      if (on) localStorage.setItem(key, recipientConsentValue(recipient!)); else localStorage.removeItem(key);
      setSaved({ key, value: on ? recipientConsentValue(recipient!) : null }); setError(false);
      window.dispatchEvent(new Event(changed)); return true;
    } catch { setSaved({ key, value: null }); setError(true); return false; }
  };
  const invalidate = (code: unknown) => {
    if (!recipientConsentFailure(code)) return false;
    setEnabled(false); setStatus(null); void refresh(); return true;
  };
  const authorizedRecipient = () => {
    try { return enabled && key && hasRecipientConsent(localStorage.getItem(key), recipient) ? recipient : null; }
    catch { return null; }
  };
  return { status, recipient, enabled, error, setEnabled, invalidate, authorizedRecipient };
}
