// Synthetic test transport only. No production source imports this module.
export function fixtureFetch(fetcher, authPort = "55440") {
  if (!/^\d+$/.test(authPort) || Number(authPort) < 1024 || Number(authPort) > 65535) throw new Error("Invalid fixture port");
  const authOrigins = new Set([`http://127.0.0.1:${authPort}`, `http://localhost:${authPort}`]);
  return async (input, options) => {
    const source = input instanceof Request ? input.url : String(input), url = new URL(source);
    if (url.username || url.password || url.hash) throw new Error("Unexpected fixture request");
    let target;
    if (url.origin === "https://api.deepseek.com" && url.pathname === "/v1/chat/completions" && !url.search)
      target = "http://127.0.0.1:59999/v1/chat/completions";
    else if (authOrigins.has(url.origin)) target = source;
    else throw new Error("Unexpected fixture request");
    const request = input instanceof Request ? new Request(target, {
      method: input.method, headers: input.headers, body: input.body,
      duplex: "half", signal: input.signal, redirect: "error",
    }) : target;
    return fetcher(request, { ...options, redirect: "error" });
  };
}
