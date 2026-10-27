import { test, expect } from "@playwright/test";

test("deletion cannot activate without server configuration and explicit confirmation", async ({ request, baseURL }) => {
  const availability = await request.get("/api/account/deletion");
  expect(availability.status()).toBe(200);
  expect(await availability.json()).toEqual({ available: false });
  expect(availability.headers()["cache-control"]).toContain("no-store");
  const body = { requestId: "123e4567-e89b-42d3-a456-426614174000", confirmed: true };
  const crossSite = await request.post("/api/account/deletion", { data: body, headers: { Origin: "https://untrusted.invalid" } });
  expect(crossSite.status()).toBe(401);
  const missingOrigin = await request.post("/api/account/deletion", { data: body });
  expect(missingOrigin.status()).toBe(401);
  const crossSiteHeader = await request.post("/api/account/deletion", { data: body, headers: { Origin: baseURL!, "Sec-Fetch-Site": "cross-site" } });
  expect(crossSiteHeader.status()).toBe(401);
  const unconfirmed = await request.post("/api/account/deletion", { data: { requestId: body.requestId }, headers: { Origin: baseURL! } });
  expect(unconfirmed.status()).toBe(400);
  const disabled = await request.post("/api/account/deletion", { data: body, headers: { Origin: baseURL! } });
  expect(disabled.status()).toBe(503);
  expect(await disabled.json()).toEqual({ error: "unavailable" });
});
