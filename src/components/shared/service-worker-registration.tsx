"use client";
import { useEffect } from "react";

/** Production only. The worker caches the static shell, never pages, API responses or user data. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Without it the site behaves exactly as before.
    });
  }, []);
  return null;
}
