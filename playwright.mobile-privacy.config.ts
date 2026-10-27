import { defineConfig } from "@playwright/test";
import rendering from "./playwright.mobile-deletion.config";

export default defineConfig({ ...rendering, testMatch: "privacy.spec.ts", outputDir: "node_modules/.cache/mobile-privacy" });
