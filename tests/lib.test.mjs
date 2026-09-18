import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTokens, isBlockedUA, describeClient, isDocumentRequest, isEmailTarget, safeRecipient, parseRecipients, hasSeen, nextSeen, tokensMisconfigured, seenTag } from "../lib.js";

test("parseTokens reads key:name pairs", () => {
  assert.deepStrictEqual({ ...parseTokens("a-1:Acme Team,b-2:Jane Doe") }, { "a-1": "Acme Team", "b-2": "Jane Doe" });
});

test("parseTokens ignores junk and empty input", () => {
  assert.deepStrictEqual({ ...parseTokens("") }, {});
  assert.deepStrictEqual({ ...parseTokens("nocolon,,:noname,key:") }, {});
  assert.deepStrictEqual({ ...parseTokens("  k : Padded Name  ") }, { k: "Padded Name" });
});

test("parseTokens empty means open mode", () => {
  assert.equal(Object.keys(parseTokens(undefined)).length, 0);
});

test("isBlockedUA catches AI and scraper agents", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)",
    "Mozilla/5.0 (compatible; ClaudeBot/1.0)",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "Mozilla/5.0 (compatible; PerplexityBot/1.0)",
  ]) assert.equal(isBlockedUA(ua), true, ua);
});

test("isBlockedUA lets real browsers through", () => {
  for (const ua of [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  ]) assert.equal(isBlockedUA(ua), false, ua);
});

test("isBlockedUA handles missing user-agent", () => {
  assert.equal(isBlockedUA(undefined), false);
  assert.equal(isBlockedUA(""), false);
});

test("describeClient names browser and OS without storing anything identifying", () => {
  assert.equal(describeClient("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0 Safari/537.36"), "Chrome, macOS");
  assert.equal(describeClient("Mozilla/5.0 (Windows NT 10.0) Firefox/121.0"), "Firefox, Windows");
  assert.equal(describeClient(""), "browser");
});

test("isDocumentRequest fires only for the two documents, with or without cleanUrls", () => {
  for (const p of ["/", "/index", "/index.html", "/viewer", "/viewer.html"]) assert.equal(isDocumentRequest(p), true, p);
  // anything else is an asset, the gate, or a path that does not exist: never a document view
  for (const p of ["/deck", "/aaa", "/styles.css", "/document.pdf", "/gate.html", "/vendor/pdf.min.mjs", "/robots.txt"]) {
    assert.equal(isDocumentRequest(p), false, p);
  }
});

test("isEmailTarget distinguishes an address from a webhook", () => {
  assert.equal(isEmailTarget("you@yourdomain.com"), true);
  assert.equal(isEmailTarget("https://hooks.slack.com/services/T/B/x"), false);
  assert.equal(isEmailTarget(""), false);
});

test("safeRecipient strips anything that could poison an email subject", () => {
  assert.equal(safeRecipient("Acme Team"), "Acme Team");
  assert.equal(safeRecipient("Acme\nBcc: someone@evil.com"), "Acme Bcc someone evil.com");
  assert.equal(safeRecipient("<script>alert(1)</script>"), "script alert 1 script");
  assert.equal(safeRecipient("   "), null);
  assert.equal(safeRecipient(undefined), null);
  assert.equal(safeRecipient("A".repeat(200)).length, 40);
  // names from any script survive; control characters and markup do not
  assert.equal(safeRecipient("José García & Söhne"), "José García & Söhne");
  assert.equal(safeRecipient("株式会社 Acme"), "株式会社 Acme");
  assert.equal(safeRecipient("Acme\u0000\u001f Team"), "Acme Team");
});

test("parseRecipients builds an allowlist and drops empties", () => {
  assert.deepEqual(parseRecipients("Acme Team, Beta Co"), ["Acme Team", "Beta Co"]);
  assert.deepEqual(parseRecipients(""), []);
  assert.deepEqual(parseRecipients(undefined), []);
});

test("seen-list is per recipient, not a single flag", () => {
  assert.equal(hasSeen("", "Acme Team"), false);
  const c1 = nextSeen("", "Acme Team");
  assert.equal(hasSeen("bl_seen=" + c1, "Acme Team"), true);
  // a different share link from the same browser still notifies
  assert.equal(hasSeen("bl_seen=" + c1, "Beta Co"), false);
  const c2 = nextSeen("bl_seen=" + c1, "Beta Co");
  assert.equal(hasSeen("bl_seen=" + c2, "Acme Team"), true);
  assert.equal(hasSeen("bl_seen=" + c2, "Beta Co"), true);
});

test("a malformed seen cookie is ignored, not thrown", () => {
  assert.equal(hasSeen("bl_seen=%E0%A4%A", "Acme Team"), false);
  assert.equal(decodeURIComponent(nextSeen("bl_seen=%E0%A4%A", "Acme Team")), "Acme Team", "a broken list is replaced, not appended to");
});

test("seen-list stays bounded", () => {
  let c = "";
  for (let i = 0; i < 25; i++) c = "bl_seen=" + nextSeen(c, "Person " + i);
  assert.equal(decodeURIComponent(c.slice("bl_seen=".length)).split("|").length, 8);
  assert.equal(hasSeen(c, "Person 24"), true);
  assert.equal(hasSeen(c, "Person 0"), false);
});

test("a prototype key can never open the gate", () => {
  const TOKENS = parseTokens("acme-2026-realkey:Acme Team");
  for (const probe of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"]) {
    assert.ok(!TOKENS[probe], `?key=${probe} must not resolve to anything`);
  }
  assert.equal(TOKENS["acme-2026-realkey"], "Acme Team");
  assert.equal(TOKENS["never-configured"], undefined);
});

test("robots.txt-only control tokens are not in the UA blocklist", () => {
  assert.equal(isBlockedUA("Google-Extended"), false);
  // Applebot-Extended still matches, but via the generic "bot" substring rule,
  // not because a robots.txt token was pasted into a user-agent list.
  assert.equal(isBlockedUA("Applebot-Extended"), true);
  assert.equal(isBlockedUA("Mozilla/5.0 (compatible; GPTBot/1.1)"), true);
  assert.equal(isBlockedUA("curl/8.4.0"), true);
});

test("a typo in BYLINE_TOKENS is a misconfiguration, not open mode", () => {
  for (const bad of ["acme-key Acme Team", "acme-key=Acme Team", "Acme Team", "nocolon"]) {
    assert.equal(tokensMisconfigured(bad, parseTokens(bad)), true, `${bad} should fail closed`);
  }
  // genuinely unset stays open mode, which is the documented default
  for (const empty of ["", "   ", undefined, null]) {
    assert.equal(tokensMisconfigured(empty, parseTokens(empty)), false);
  }
  const good = "acme-2026-realkey:Acme Team";
  assert.equal(tokensMisconfigured(good, parseTokens(good)), false);
});

test("seen tags are bound to the day, so a kept cookie does not read silently forever", async () => {
  const today = await seenTag("secret", "Acme Team", "2026-09-17");
  const sameDay = await seenTag("secret", "Acme Team", "2026-09-17");
  const nextDay = await seenTag("secret", "Acme Team", "2026-09-18");
  const otherSecret = await seenTag("other", "Acme Team", "2026-09-17");
  assert.equal(today, sameDay);
  assert.notEqual(today, nextDay);
  assert.notEqual(today, otherSecret);
  assert.match(today, /^[A-Za-z0-9_-]{22}$/);
});

test("describeClient names iOS and Chromium browsers correctly, since they all say Safari", () => {
  assert.equal(describeClient("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1"), "Chrome, iOS");
  assert.equal(describeClient("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0"), "Edge, Windows");
  assert.equal(describeClient("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"), "Safari, macOS");
});
