// Pure helpers, kept out of the middleware so they can be tested without an edge runtime.

/** "key:Name,key2:Name 2" -> { key: "Name", key2: "Name 2" } */
export function parseTokens(raw) {
  // Object.create(null), not {}. A plain object inherits from Object.prototype, so
  // TOKENS["constructor"] returns a truthy function and ?key=constructor walks straight
  // through the gate. Same for toString, valueOf, __proto__ and friends. A null-prototype
  // map has no inherited keys, so only configured tokens can ever match.
  const map = Object.create(null);
  for (const pair of String(raw || "").split(",")) {
    const i = pair.indexOf(":");
    if (i === -1) continue;
    const key = pair.slice(0, i).trim();
    const name = pair.slice(i + 1).trim();
    if (key && name) map[key] = name;
  }
  return map;
}

export const BLOCKED_UA = [
  "gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-web",
  // Google-Extended and Applebot-Extended are deliberately NOT here. They are
  // robots.txt control tokens, not user agents: nothing ever sends them in a
  // User-Agent header, so matching them here would do nothing. They belong in
  // robots.txt, which is where they are.
  "anthropic-ai", "ccbot", "perplexitybot", "bytespider",
  "amazonbot", "diffbot", "imagesiftbot", "omgili",
  "dataforseo", "semrushbot", "ahrefsbot", "mj12bot", "dotbot", "petalbot",
  "bot", "crawler", "spider", "scraper", "scrape",
  "python-requests", "python-httpx", "aiohttp", "curl/", "wget/", "libwww",
  "scrapy", "node-fetch", "go-http-client",
];

export function isBlockedUA(ua) {
  const u = String(ua || "").toLowerCase();
  return BLOCKED_UA.some((sig) => u.includes(sig));
}

/** Coarse client description. No IP, no fingerprint, nothing stored. */
export function describeClient(ua) {
  const u = String(ua || "");
  // Order matters: every iOS browser and every Chromium browser also says "Safari".
  const browser = /edg(?:e|ios|a)?\//i.test(u) ? "Edge" : /crios\//i.test(u) ? "Chrome"
    : /fxios\//i.test(u) ? "Firefox" : /chrome\//i.test(u) ? "Chrome"
    : /firefox\//i.test(u) ? "Firefox" : /safari\//i.test(u) ? "Safari" : "browser";
  const os = /iphone|ipad/i.test(u) ? "iOS" : /android/i.test(u) ? "Android"
    : /mac os/i.test(u) ? "macOS" : /windows/i.test(u) ? "Windows" : "";
  return os ? browser + ", " + os : browser;
}

/**
 * The two documents this project serves, with and without the extension because
 * vercel.json sets cleanUrls. Everything else (assets, the gate, paths that do not
 * exist) is not a document view and never triggers a notification. Without this,
 * a loop over /aaa, /aab, /aac... would fire one email per request.
 */
export function isDocumentRequest(pathname) {
  return /^\/(?:index|viewer)?(?:\.html)?$/.test(String(pathname || ""));
}

/** An email address, versus a webhook URL. */
export function isEmailTarget(target) {
  const t = String(target || "").trim();
  return t.includes("@") && !t.includes("://");
}

/**
 * In open mode the recipient name comes from a URL anyone can type, and it ends up
 * in an email subject line and in the machine-readable block an agent may act on.
 * Clamp it: safe charset, collapsed whitespace, hard length cap.
 */
export function safeRecipient(raw) {
  // Letters and combining marks from any script, digits, and a few name characters.
  // "José García" and "株式会社" survive; angle brackets, newlines and control
  // characters do not. The cap is a company name, not a sentence: in open mode this
  // string is typed by whoever holds the link, and it lands in an email subject and
  // in a block an inbox agent may read, so it is treated as untrusted end to end.
  // Forty characters still fits an imperative sentence; the README says so.
  const s = String(raw || "")
    .replace(/[^\p{L}\p{M}\p{N} .,'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, 40) : null;
}

/** Optional open-mode allowlist: "Acme Team,Beta Co" -> ["Acme Team", "Beta Co"] */
export function parseRecipients(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => safeRecipient(x))
    .filter(Boolean);
}

/**
 * The "already notified" cookie holds the recipients seen on this browser, not a
 * bare flag, so two different share links from the same browser each notify once.
 */
export function hasSeen(cookieHeader, recipient) {
  return seenList(cookieHeader).includes(String(recipient));
}

/** Cookie value for the seen-list with `recipient` added. Bounded so it can't grow forever. */
export function nextSeen(cookieHeader, recipient) {
  const list = seenList(cookieHeader);
  const who = String(recipient);
  if (!list.includes(who)) list.push(who);
  return encodeURIComponent(list.slice(-8).join("|"));
}

function seenList(cookieHeader) {
  const m = String(cookieHeader || "").match(/(?:^|;\s*)bl_seen=([^;]*)/);
  if (!m) return [];
  try {
    return decodeURIComponent(m[1]).split("|").filter(Boolean);
  } catch {
    return []; // malformed cookie is not a crash
  }
}

/**
 * True when BYLINE_TOKENS was set to something but nothing parsed out of it.
 * That means a typo (a space instead of a colon, say), and the safe reading of a
 * broken lock is "locked". Without this, a malformed value parses to zero pairs,
 * looks identical to "unset", and silently serves a confidential document to everyone.
 */
export function tokensMisconfigured(raw, parsed) {
  const hasValue = String(raw || "").trim().length > 0;
  return hasValue && Object.keys(parsed).length === 0;
}

/**
 * HMAC tag for a recipient, used as the value stored in the seen-cookie. The cookie is
 * on the reader's machine and a reader is the one party motivated to forge it, since
 * "already notified" means "read it silently". A tag they cannot compute closes that.
 * Uses Web Crypto, which both the Vercel edge runtime and Node 20+ provide.
 */
export async function seenTag(secret, recipient, day = new Date().toISOString().slice(0, 10)) {
  // The UTC date is part of the signed message, so a tag issued yesterday is not valid
  // today. Without it, a reader who keeps the cookie reads silently forever, and
  // "once per day" would be whatever Max-Age the reader's browser felt like honouring.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(day + "|" + String(recipient))));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}
