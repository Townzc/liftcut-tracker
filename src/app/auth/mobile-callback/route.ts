import { mobileEmailAppLink, parseMobileEmailParams } from "@liftcut/core/mobile-email-auth";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Raw HTML deliberately avoids the ordinary web AuthProvider and automatic code exchange. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const callback = parseMobileEmailParams([...params]), en = params.get("lang") === "en";
  const title = callback ? (en ? "Continue in LiftCut" : "返回 LiftCut 继续") : (en ? "This link cannot be used" : "此链接无法使用");
  const body = callback
    ? (en ? "Open LiftCut on the device where you started registration. The app will check your pending request before signing in. This page does not sign you in." : "请在发起注册的设备上打开 LiftCut. 应用会核对本机待完成的申请，再继续登录. 此页面不会替你登录.")
    : (en ? "Return to the app and start a new registration request. Do not paste access tokens into a URL." : "请返回应用，重新发起注册申请. 不要把登录令牌粘贴到网址中.");
  const action = callback ? `<a rel="noreferrer" href="${escapeHtml(mobileEmailAppLink(callback))}">${en ? "Open LiftCut" : "打开 LiftCut"}</a>` : "";
  return new Response(`<!doctype html><html lang="${en ? "en" : "zh-CN"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | LiftCut</title><style>body{margin:0;background:#fff;color:#171717;font:16px system-ui}main{max-width:28rem;margin:12vh auto;padding:24px}h1{font-size:28px;font-weight:600}p{line-height:1.7;color:#555}a{display:inline-flex;min-height:48px;align-items:center;color:inherit;text-underline-offset:4px}</style></head><body><main><p>liftcut.</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${action}</main></body></html>`, {
    status: callback ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
  });
}
