import { defineConfig } from "@playwright/test";
import base from "./playwright.mobile.config";
// The 90-second demo (docs/product/DEMO_90S.md): the mobile end-to-end setup at phone size; the spec records it
// through Chrome's screencast and encodes it with the system ffmpeg. Run it on its own after the W1b build and the
// app's web export, like the mobile tests; it is not part of CI.
export default defineConfig({
  ...base, testDir: "tests/demo", outputDir: "node_modules/.cache/demo/browser", timeout: 240000,
  use: { ...base.use, launchOptions: { ...base.use?.launchOptions, slowMo: 60 } },
});
