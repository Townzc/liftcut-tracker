// Explicitly loaded only by the fixture Next subprocess, never by deployed code.
import { fixtureFetch } from "./model-transport.mjs";
globalThis.fetch = fixtureFetch(globalThis.fetch, process.env.AUTH_FIXTURE_PORT ?? "55440");
