// Byline: Vercel Edge Middleware.
//
// TWO MODES. Both keep attribution. Only one asks for a code.
//
//   OPEN MODE (default, BYLINE_TOKENS unset)
//     Anyone with the link can read it. No code, no friction.
//     You still get: per-recipient watermark, crawler blocking, noindex, no-store.
//     Send a different link per company:  /?for=Acme%20Team
//
//   GATED MODE (BYLINE_TOKENS set)
//     No valid key means the document is never sent. Not hidden, not blurred. Never sent.
//     The recipient's name comes from the key, not the URL, so it can't be edited off.
//
// OPTIONAL: set BYLINE_NOTIFY and you get a ping when a recipient opens the document.
// "Opens" means the page ran its script and reported in (POST /opened), not that the
// URL was fetched. Email scanners and link-preview bots fetch URLs with a browser's
// user agent and never run JavaScript, so counting the fetch would report them as
// readers. Counting the beacon reports people.
//     an email address        hello@you.com       (also set BYLINE_RESEND_KEY)
//     a Slack/Discord webhook https://hooks.slack.com/services/...
//
// Everything is built by createMiddleware(env, deps) so the tests can hand it a fake
// environment and a fake fetch and walk a real Request through the real code paths.

import {
  parseTokens, isBlockedUA, describeClient, isDocumentRequest, isEmailTarget,
  safeRecipient, parseRecipients, hasSeen, nextSeen, tokensMisconfigured, seenTag,
} from "./lib.js";

export const config = {
  matcher: "/((?!_vercel|favicon.ico).*)",
};

/**
 * Vercel continues to the static file when middleware returns a response carrying
 * `x-middleware-next: 1`. That header is the entirety of @vercel/edge's next(),
 * reproduced here so the project has no dependencies and the middleware is testable
 * with nothing installed. If Vercel ever changes the contract, this is the one line.
 */
export function next(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-middleware-next", "1");
  return new Response(null, { ...init, headers });
}

const SEEN_COOKIE = "; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax";
const KEY_COOKIE = "; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax";

export function createMiddleware(env = {}, deps = {}) {
  const proceed = deps.next || next;
  const fetchFn = deps.fetch || ((...a) => fetch(...a));
  const clock = deps.now || (() => new Date());

  // Configuration is read once, here. Environment variables are fixed for the life of
  // a deployment, so re-reading them per request would buy nothing.
  const RAW_TOKENS = env.BYLINE_TOKENS;
  const TOKENS = parseTokens(RAW_TOKENS);
  // Set but unparseable is a typo, not a request for open mode. Fail closed.
  const TOKENS_BROKEN = tokensMisconfigured(RAW_TOKENS, TOKENS);
  const GATED = Object.keys(TOKENS).length > 0;

  // Optional open-mode allowlist. Unset means any ?for= value can trigger a notification.
  const RECIPIENTS = parseRecipients(env.BYLINE_RECIPIENTS);

  // Printed under every watermark. Your name or your company.
  const OWNER = env.BYLINE_OWNER || "";

  // Where to ping you. Email address or webhook URL. Unset means no notifications.
  const NOTIFY = (env.BYLINE_NOTIFY || "").trim();
  const RESEND_KEY = env.BYLINE_RESEND_KEY || "";
  const IS_EMAIL = isEmailTarget(NOTIFY);

  // The seen-cookie is signed so a reader can't forge "already notified". Any secret the
  // operator already holds will do as key material; BYLINE_SECRET is there for people who
  // want one that rotates independently.
  const SEEN_SECRET = env.BYLINE_SECRET || RESEND_KEY || NOTIFY || "";

  // Fire-and-forget. Never blocks the page, never fails the request.
  function notify(ctx, recipient, ua, doc) {
    if (!NOTIFY) return;
    const now = clock();
    const when = now.toUTCString();
    const client = describeClient(ua);
    let send;

    if (IS_EMAIL) {
      if (!RESEND_KEY) return; // email requested but no key: stay silent rather than break
      // Written to be read by a person AND parsed by an agent watching the inbox.
      // The fenced block is stable: same keys, same order, every time. In open mode the
      // recipient field is typed by whoever holds the link; it is sanitized and capped,
      // and an agent should still treat it as untrusted text.
      const body =
        recipient + " opened your document.\n\n" +
        "When:   " + when + "\n" +
        "Client: " + client + "\n\n" +
        "--- byline ---\n" +
        "event: document_opened\n" +
        "recipient: " + recipient + "\n" +
        "document: " + doc + "\n" +
        "client: " + client + "\n" +
        "at: " + now.toISOString() + "\n" +
        "--- end ---\n\n" +
        "Sent by Byline. This email is the only record.";
      send = fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + RESEND_KEY },
        body: JSON.stringify({
          from: "Byline <onboarding@resend.dev>",
          to: [NOTIFY],
          subject: "Byline: " + recipient + " opened your document",
          text: body,
        }),
      }).then(logSendResult).catch(logSendError);
    } else {
      const line = "📄 *" + recipient + "* opened your document · " + client + " · " + when;
      send = fetchFn(NOTIFY, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `text` is Slack, `content` is Discord. Each ignores the other.
        body: JSON.stringify({ text: line, content: line }),
      }).then(logSendResult).catch(logSendError);
    }

    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(send);
    return send;
  }

  // The notification is the product's only record, so a failed send must at least be
  // visible in the deployment logs. The commonest cause: Resend's shared sender only
  // delivers to the address the Resend account was registered with.
  async function logSendResult(res) {
    if (res && !res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* body unreadable */ }
      console.error("Byline: notification rejected, HTTP " + res.status + ". " + detail);
    }
  }
  function logSendError(err) {
    console.error("Byline: notification failed to send. " + (err && err.message ? err.message : err));
  }

  // One notification per recipient per browser per day, keyed on a tag the reader can't
  // compute. Returns the Set-Cookie value to append, or null if already seen.
  async function markSeen(cookie, recipient) {
    if (!NOTIFY || !SEEN_SECRET) return null;
    const day = clock().toISOString().slice(0, 10);
    const tag = await seenTag(SEEN_SECRET, recipient, day);
    if (hasSeen(cookie, tag)) return null;
    return "bl_seen=" + nextSeen(cookie, tag) + SEEN_COOKIE;
  }

  // POST /opened: the page reports that it rendered. Notifies once per recipient per
  // browser per day and answers 204 either way, so the response tells a caller nothing
  // about whether an email went out. The document path comes from the page, checked
  // against the same allowlist as everything else.
  async function opened(ctx, recipient, ua, url, cookie) {
    const headers = new Headers({ "cache-control": "no-store" });
    if (recipient) {
      const doc = url.searchParams.get("doc") || "/";
      const setCookie = await markSeen(cookie, recipient);
      if (setCookie) {
        notify(ctx, recipient, ua, isDocumentRequest(doc.toLowerCase()) ? doc : "/");
        headers.append("set-cookie", setCookie);
      }
    }
    return new Response(null, { status: 204, headers });
  }

  return async function middleware(request, context) {
    const url = new URL(request.url);
    // url.pathname keeps percent-encoding, so /%69ndex.html would slip past every
    // string match below while the platform still serves index.html for it. Decode
    // once, here, and match on the decoded form. A malformed sequence is not a crash.
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
    // Match on a normalised form so //Index.html/ is treated as the document it would
    // resolve to. Serving is the platform's job; this only decides which rules apply.
    path = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    const rawPath = path;      // original spelling, for anything that becomes a filename
    path = path.toLowerCase(); // matching only
    const ua = request.headers.get("user-agent") || "";
    const cookie = request.headers.get("cookie") || "";

    if (TOKENS_BROKEN) {
      // Say nothing useful to a stranger. The detail is in the deployment logs.
      console.error("Byline: BYLINE_TOKENS is set but no key:Name pairs parsed. Refusing to serve.");
      return new Response("This document is not available right now.", {
        status: 503,
        headers: { "content-type": "text/plain", "x-robots-tag": "noindex, nofollow" },
      });
    }

    // robots.txt has to be reachable by the crawlers it addresses, or it is decoration.
    // It sits above the user-agent block for exactly that reason.
    if (path === "/robots.txt") return proceed();

    if (isBlockedUA(ua)) {
      return new Response("Not available.", {
        status: 403,
        headers: { "content-type": "text/plain", "x-robots-tag": "noindex, nofollow" },
      });
    }

    // The gate page and its script are the one thing an unauthenticated visitor must be
    // able to load, or the form they are sent to would redirect its own JavaScript.
    // vercel.json sets cleanUrls, so /gate.html is served as /gate; both spellings must
    // pass or the redirect below and the platform's own 308 chase each other forever.
    if (path === "/gate" || path === "/gate.html" || path === "/gate.js") return proceed();

    // Navigating straight to the .pdf bypasses the viewer and its stamp. Sec-Fetch-Dest
    // is "document" for a typed URL or a clicked link and "empty" for the viewer's own
    // fetch. Bounce navigations into the viewer. This only catches a browser navigating;
    // a script that omits the header gets the file. See README, Limitations.
    if (path.endsWith(".pdf") && request.headers.get("sec-fetch-dest") === "document") {
      const viewer = new URL(url.toString());
      viewer.pathname = "/viewer";
      viewer.searchParams.set("doc", rawPath.replace(/^\//, ""));
      return Response.redirect(viewer.toString(), 302);
    }

    // ---------------------------------------------------------------- OPEN MODE
    if (!GATED) {
      const headers = new Headers();
      headers.set("x-robots-tag", "noindex, nofollow, noarchive");

      // The owner's name comes from config, never from the link. Add or correct ?by= on
      // documents so a forwarded link can't attribute the work to a third party.
      if (isDocumentRequest(path) && OWNER && url.searchParams.get("for") && url.searchParams.get("by") !== OWNER) {
        url.searchParams.set("by", OWNER);
        headers.set("location", url.toString());
        return new Response(null, { status: 302, headers });
      }

      if (request.method === "POST" && path === "/opened") {
        // searchParams.get() has already percent-decoded this. Decoding it a second time
        // throws a URIError on input like ?for=100%25 and takes down the request.
        const who = safeRecipient(url.searchParams.get("for"));
        const allowed = who && (RECIPIENTS.length === 0 || RECIPIENTS.includes(who));
        return opened(context, allowed ? who : null, ua, url, cookie);
      }
      return proceed({ headers });
    }

    // --------------------------------------------------------------- GATED MODE
    const keyParam = url.searchParams.get("key");
    let cookieKey = null;
    const m = cookie.match(/(?:^|;\s*)bl_key=([^;]+)/);
    if (m) {
      // A malformed cookie is not a crash.
      try { cookieKey = decodeURIComponent(m[1]); } catch { cookieKey = null; }
    }

    const validKey =
      keyParam && TOKENS[keyParam] ? keyParam
      : cookieKey && TOKENS[cookieKey] ? cookieKey
      : null;

    if (!validKey) {
      // A bad ?key= only matters if there is no good cookie behind it. Someone with a
      // valid session who clicks an old link with a rotated key stays logged in.
      // Remember where they were headed, so a correct code lands on their document and
      // not on the site root. Only a same-origin path is ever accepted back.
      const gate = new URL("/gate", request.url);
      if (keyParam) gate.searchParams.set("invalid", "1");
      if (isDocumentRequest(path) && path !== "/") {
        // Carry ?doc= along so a reader sent to a second PDF lands on that PDF, not the default.
        const doc = url.searchParams.get("doc");
        const safeDoc = doc && /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.pdf$/i.test(doc) && !doc.includes("..") ? doc : null;
        gate.searchParams.set("next", path + (safeDoc ? "?doc=" + encodeURIComponent(safeDoc) : ""));
      }
      return Response.redirect(gate.toString(), 302);
    }

    const recipient = TOKENS[validKey];

    if (request.method === "POST" && path === "/opened") {
      return opened(context, recipient, ua, url, cookie);
    }

    const headers = new Headers();
    headers.append("set-cookie", "bl_key=" + encodeURIComponent(validKey) + KEY_COOKIE);
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");

    // The token decides whose name goes on the page, so ?for= is rewritten from the
    // token on every document request rather than only when it is absent. Trusting the
    // visitor's own ?for= would let a recipient stamp somebody else's name on it.
    // Documents only: redirecting assets would add a round trip to every file.
    if (isDocumentRequest(path)) {
      const byNow = url.searchParams.get("by");
      const canonical =
        url.searchParams.get("for") === recipient &&
        !url.searchParams.has("key") &&
        (OWNER ? byNow === OWNER : byNow === null);
      if (!canonical) {
        url.searchParams.set("for", recipient);
        if (OWNER) url.searchParams.set("by", OWNER);
        else url.searchParams.delete("by");
        url.searchParams.delete("key");
        headers.set("location", url.toString());
        return new Response(null, { status: 302, headers });
      }
    }

    return proceed({ headers });
  };
}

export default createMiddleware(process.env);
