import { test } from "node:test";
import assert from "node:assert/strict";
import { createMiddleware, next } from "../middleware.js";

// A fake environment, a fake fetch that records what it was asked to send, and a real
// Request. Nothing is mocked inside the middleware; these tests walk the actual paths.
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function harness(env) {
  const sent = [];
  const mw = createMiddleware(env, {
    fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 200 }); },
    now: () => new Date("2026-09-17T18:04:00Z"),
  });
  const run = (path, headers = {}, method = "GET") =>
    mw(new Request("https://byline.example" + path, { method, headers: { "user-agent": CHROME, ...headers } }), { waitUntil() {} });
  // what the page does after it renders the stamp
  const opened = (query, headers = {}) => run("/opened" + query, headers, "POST");
  return { run, opened, sent };
}

const passedThrough = (res) => res.status === 200 && res.headers.get("x-middleware-next") === "1";
const cookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(name + "=")) || null;
const cookieValue = (res, name) => { const c = cookieOf(res, name); return c ? c.split(";")[0].split("=").slice(1).join("=") : null; };

test("next() carries the header Vercel uses to continue to the static file", () => {
  const r = next({ headers: { "x-custom": "1" } });
  assert.equal(r.headers.get("x-middleware-next"), "1");
  assert.equal(r.headers.get("x-custom"), "1");
});

// ------------------------------------------------------------------ open mode

test("open mode serves the document and sets noindex", async () => {
  const { run } = harness({});
  const res = await run("/?for=Acme%20Team");
  assert.ok(passedThrough(res));
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
});

test("fetching the page never notifies; only the page's own beacon does", async () => {
  // Email scanners and link-preview bots fetch with a browser UA and never run script.
  const { run, opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  await run("/?for=Acme%20Team");
  await run("/viewer?for=Acme%20Team");
  assert.equal(sent.length, 0, "a GET is a fetch, not a read");
  const res = await opened("?for=Acme%20Team&doc=%2Fviewer");
  assert.equal(res.status, 204);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.subject, "Byline: Acme Team opened your document");
  assert.match(sent[0].body.text, /--- byline ---\nevent: document_opened\nrecipient: Acme Team\ndocument: \/viewer\n/);
});

test("open mode notifies once, then the signed cookie suppresses the repeat", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  const first = await opened("?for=Acme%20Team");
  assert.equal(sent.length, 1);
  const seen = cookieOf(first, "bl_seen");
  assert.ok(seen && /HttpOnly/.test(seen) && /Secure/.test(seen), "seen cookie must be HttpOnly and Secure");
  const second = await opened("?for=Acme%20Team", { cookie: "bl_seen=" + cookieValue(first, "bl_seen") });
  assert.equal(sent.length, 1, "no second email from the same browser");
  assert.equal(cookieOf(second, "bl_seen"), null);
  assert.equal(second.status, 204, "the response is the same either way");
});

test("a forged seen-cookie made from the recipient's name does not suppress the notification", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  await opened("?for=Acme%20Team", { cookie: "bl_seen=" + encodeURIComponent("Acme Team") });
  assert.equal(sent.length, 1, "plaintext name is not a valid tag");
});

test("two different recipients from one browser each notify once", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  const a = await opened("?for=Acme");
  const b = await opened("?for=Beta", { cookie: "bl_seen=" + cookieValue(a, "bl_seen") });
  await opened("?for=Acme", { cookie: "bl_seen=" + cookieValue(b, "bl_seen") });
  assert.equal(sent.length, 2);
});

test("the beacon's document path is checked, not trusted", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  await opened("?for=Acme&doc=" + encodeURIComponent("https://evil.example/x"));
  assert.match(sent[0].body.text, /document: \/\n/);
});

test("a malformed percent sequence in ?for= does not crash the request", async () => {
  const { run, opened } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  assert.ok(passedThrough(await run("/?for=100%25&by=A%25B")));
  assert.equal((await opened("?for=100%25")).status, 204);
});

test("the recipient name is sanitized before it reaches an email subject", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  await opened("?for=" + encodeURIComponent("Acme\r\nBcc: victim@example.com <script>"));
  assert.equal(sent[0].body.subject, "Byline: Acme Bcc victim example.com script opened your document");
});

test("the open-mode allowlist silences names that are not on it", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test", BYLINE_RECIPIENTS: "Acme Team" });
  await opened("?for=Random%20Stranger");
  assert.equal(sent.length, 0);
  await opened("?for=Acme%20Team");
  assert.equal(sent.length, 1);
});

test("a webhook target gets a JSON post instead of an email", async () => {
  const { opened, sent } = harness({ BYLINE_NOTIFY: "https://hooks.slack.com/services/T/B/x" });
  await opened("?for=Acme");
  assert.equal(sent[0].url, "https://hooks.slack.com/services/T/B/x");
  assert.match(sent[0].body.text, /Acme/);
});

test("with an owner set, a document link gets ?by= added; an asset does not", async () => {
  const { run } = harness({ BYLINE_OWNER: "Amy Mayernik" });
  const doc = await run("/?for=Acme");
  assert.equal(doc.status, 302);
  assert.equal(new URL(doc.headers.get("location")).searchParams.get("by"), "Amy Mayernik");
  const asset = await run("/vendor/pdf.min.mjs?for=Acme");
  assert.ok(passedThrough(asset));
});

// ----------------------------------------------------------- crawlers and plumbing

test("known crawlers get a 403 with noindex, and never a document", async () => {
  const { run } = harness({});
  for (const ua of ["Mozilla/5.0 (compatible; GPTBot/1.1)", "ClaudeBot/1.0", "curl/8.4.0", "python-requests/2.31"]) {
    const res = await run("/?for=Acme", { "user-agent": ua });
    assert.equal(res.status, 403);
    assert.match(res.headers.get("x-robots-tag"), /noindex/);
  }
});

test("robots.txt is served to the crawlers it names, in both modes", async () => {
  for (const env of [{}, { BYLINE_TOKENS: "k1:Acme" }]) {
    const { run } = harness(env);
    const res = await run("/robots.txt", { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.1)" });
    assert.ok(passedThrough(res), "robots.txt must be reachable or it is decoration");
  }
});

test("navigating straight to the PDF is bounced into the viewer; the viewer's own fetch is not", async () => {
  const { run } = harness({});
  const nav = await run("/document.pdf?for=Acme", { "sec-fetch-dest": "document" });
  assert.equal(nav.status, 302);
  const to = new URL(nav.headers.get("location"));
  assert.equal(to.pathname, "/viewer");
  assert.equal(to.searchParams.get("doc"), "document.pdf");
  assert.equal(to.searchParams.get("for"), "Acme");
  const fetched = await run("/document.pdf", { "sec-fetch-dest": "empty" });
  assert.ok(passedThrough(fetched));
});

test("a typo in BYLINE_TOKENS refuses to serve and leaks nothing about why", async () => {
  const orig = console.error; console.error = () => {};
  try {
    const { run } = harness({ BYLINE_TOKENS: "acme-key Acme Team" });
    const res = await run("/");
    assert.equal(res.status, 503);
    assert.doesNotMatch(await res.text(), /BYLINE_TOKENS|key:Name/);
  } finally { console.error = orig; }
});

// ------------------------------------------------------------------ gated mode

const GATED = { BYLINE_TOKENS: "acme-2026-realkey:Acme Team,beta-2026-realkey:Beta Co", BYLINE_OWNER: "Amy Mayernik" };

test("gated mode: no key means the gate, never the document", async () => {
  const { run } = harness(GATED);
  const res = await run("/");
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")).pathname, "/gate");
});

test("gated mode: a prototype-chain key can never open the gate", async () => {
  const { run } = harness(GATED);
  for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const res = await run("/?key=" + k);
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get("location")).pathname, "/gate");
  }
});

test("gated mode: a valid key sets an HttpOnly cookie and strips itself from the address", async () => {
  const { run } = harness(GATED);
  const res = await run("/?key=acme-2026-realkey");
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location"));
  assert.equal(to.searchParams.get("key"), null);
  assert.equal(to.searchParams.get("for"), "Acme Team");
  assert.equal(to.searchParams.get("by"), "Amy Mayernik");
  const c = cookieOf(res, "bl_key");
  assert.ok(c && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c));
});

test("gated mode: the recipient cannot put someone else's name on the page", async () => {
  const { run } = harness(GATED);
  const res = await run("/?for=Someone%20Else&by=Nobody", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location"));
  assert.equal(to.searchParams.get("for"), "Acme Team");
  assert.equal(to.searchParams.get("by"), "Amy Mayernik");
});

test("gated mode: stripping ?for= just puts it back", async () => {
  const { run } = harness(GATED);
  const res = await run("/", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")).searchParams.get("for"), "Acme Team");
});

test("gated mode: the canonical link is served without another redirect", async () => {
  const { run } = harness(GATED);
  const res = await run("/?for=Acme%20Team&by=Amy%20Mayernik", { cookie: "bl_key=acme-2026-realkey" });
  assert.ok(passedThrough(res));
});

test("gated mode: a valid cookie survives a bad ?key= on the link", async () => {
  const { run } = harness(GATED);
  const res = await run("/?key=rotated-old-key&for=Acme%20Team&by=Amy%20Mayernik", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(res.status, 302, "strips the stale key");
  const to = new URL(res.headers.get("location"));
  assert.equal(to.pathname, "/", "does not bounce a logged-in reader to the gate");
  assert.equal(to.searchParams.get("key"), null);
});

test("gated mode: a malformed bl_key cookie is not a crash", async () => {
  const { run } = harness(GATED);
  const res = await run("/", { cookie: "bl_key=%E0%A4%A" });
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")).pathname, "/gate");
});

test("gated mode: revoking a key locks out its cookie on the next request", async () => {
  const { run } = harness({ BYLINE_TOKENS: "beta-2026-realkey:Beta Co" });
  const res = await run("/", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(new URL(res.headers.get("location")).pathname, "/gate");
});

test("gated mode: assets are served to a valid session without being redirected", async () => {
  const { run } = harness(GATED);
  const res = await run("/vendor/pdf.min.mjs", { cookie: "bl_key=acme-2026-realkey" });
  assert.ok(passedThrough(res));
});

test("gated mode: the beacon notifies with the name from the token, never the URL", async () => {
  const { run, opened, sent } = harness({ ...GATED, BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" });
  await run("/?for=Acme%20Team&by=Amy%20Mayernik", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(sent.length, 0);
  await opened("?for=Someone%20Else", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.subject, "Byline: Acme Team opened your document");
  const anon = await opened("?for=Acme%20Team");
  assert.equal(anon.status, 302, "no key, no beacon: the gate, like everything else");
  assert.equal(sent.length, 1);
});

test("gated mode: the gate page loads without a key under both spellings cleanUrls produces", async () => {
  // vercel.json sets cleanUrls, so the platform serves /gate.html as /gate. If only one
  // spelling passed, the redirect here and Vercel's own 308 would loop forever.
  const { run } = harness(GATED);
  assert.ok(passedThrough(await run("/gate")));
  assert.ok(passedThrough(await run("/gate.html")));
  assert.ok(passedThrough(await run("/gate.js")));
});

test("gated mode: the gate remembers which document the reader was trying to open", async () => {
  const { run } = harness(GATED);
  const res = await run("/viewer?for=x");
  const to = new URL(res.headers.get("location"));
  assert.equal(to.pathname, "/gate");
  assert.equal(to.searchParams.get("next"), "/viewer");
  const root = await run("/");
  assert.equal(new URL(root.headers.get("location")).searchParams.get("next"), null);
});

test("gated mode: a percent-encoded document path is still canonicalized", async () => {
  // url.pathname keeps encoding; the platform still serves index.html for /%69ndex.html.
  const { run } = harness(GATED);
  const res = await run("/%69ndex.html?for=Someone%20Else", { cookie: "bl_key=acme-2026-realkey" });
  assert.equal(res.status, 302, "must not pass a spoofed ?for= through");
  assert.equal(new URL(res.headers.get("location")).searchParams.get("for"), "Acme Team");
});

test("open mode: yesterday's seen cookie notifies again today", async () => {
  const env = { BYLINE_NOTIFY: "me@example.com", BYLINE_RESEND_KEY: "re_test" };
  let day = new Date("2026-09-17T18:04:00Z");
  const sent = [];
  const mw = createMiddleware(env, { fetch: async (u, i) => { sent.push(i); return new Response(null); }, now: () => day });
  const go = (h = {}) => mw(new Request("https://x.test/opened?for=Acme", { method: "POST", headers: { "user-agent": CHROME, ...h } }), { waitUntil() {} });
  const first = await go();
  const c = cookieOf(first, "bl_seen").split(";")[0];
  await go({ cookie: c });
  assert.equal(sent.length, 1, "same day, same browser: quiet");
  day = new Date("2026-09-18T09:00:00Z");
  await go({ cookie: c });
  assert.equal(sent.length, 2, "next day: the kept cookie no longer matches");
});

test("gated mode: odd spellings of a document path are still canonicalized", async () => {
  // A valid reader must not be able to reach the document with a spoofed ?for= by
  // varying the path the router would still resolve: doubled slashes, case, trailing slash.
  const { run } = harness(GATED);
  for (const p of ["//index.html", "/Index.html", "/VIEWER", "/viewer/", "/index.html/"]) {
    const res = await run(p + "?for=Someone%20Else", { cookie: "bl_key=acme-2026-realkey" });
    assert.equal(res.status, 302, p + " must be canonicalized");
    assert.equal(new URL(res.headers.get("location")).searchParams.get("for"), "Acme Team", p);
  }
});

test("open mode: the owner's name comes from config, not the link", async () => {
  const { run } = harness({ BYLINE_OWNER: "Amy Mayernik" });
  const res = await run("/?for=Acme&by=Fake%20Owner");
  assert.equal(res.status, 302);
  assert.equal(new URL(res.headers.get("location")).searchParams.get("by"), "Amy Mayernik");
  const ok = await run("/?for=Acme&by=Amy%20Mayernik");
  assert.ok(passedThrough(ok), "already correct: no redirect");
});

test("a rejected notification is written to the log instead of vanishing", async () => {
  const logged = [];
  const orig = console.error; console.error = (m) => logged.push(String(m));
  try {
    const mw = createMiddleware(
      { BYLINE_NOTIFY: "someone-else@example.com", BYLINE_RESEND_KEY: "re_test" },
      { fetch: async () => new Response("{\"message\":\"You can only send testing emails to your own email address\"}", { status: 403 }) }
    );
    const waits = [];
    await mw(new Request("https://x.test/opened?for=Acme", { method: "POST", headers: { "user-agent": CHROME } }), { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /HTTP 403/);
    assert.match(logged[0], /own email address/);
  } finally { console.error = orig; }
});

test("gated mode: the gate carries a second document's ?doc= through, and only a safe one", async () => {
  const { run } = harness(GATED);
  const ok = await run("/viewer?doc=deck2.pdf");
  assert.equal(new URL(ok.headers.get("location")).searchParams.get("next"), "/viewer?doc=deck2.pdf");
  const bad = await run("/viewer?doc=" + encodeURIComponent("https://evil.example/x.pdf"));
  assert.equal(new URL(bad.headers.get("location")).searchParams.get("next"), "/viewer");
});

test("a mixed-case PDF filename keeps its spelling on the way to the viewer", async () => {
  const { run } = harness({});
  const res = await run("/Deck.PDF", { "sec-fetch-dest": "document" });
  assert.equal(new URL(res.headers.get("location")).searchParams.get("doc"), "Deck.PDF");
});
