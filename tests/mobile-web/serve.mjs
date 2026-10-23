// Loopback-only host for Expo's web.output=single test artifact, including deep-link reloads.
// https://docs.expo.dev/guides/publishing-websites/#hosting-on-third-party-services
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("apps/mobile/dist");
const mime = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".wasm": "application/wasm" };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost:8099").pathname);
    const file = resolve(root, `.${extname(pathname) ? pathname : "/index.html"}`);
    if (!file.startsWith(root + sep) || !["GET", "HEAD"].includes(req.method)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file); res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(404); res.end("Not Found"); }
}).listen(8099, "127.0.0.1");
