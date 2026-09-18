// Byline watermark. One implementation, shared by index.html and viewer.html.
//
// Reads ?for= (the recipient) and ?by= (the owner) from the address, sanitizes both
// through the same function the server uses, and tiles the stamp across a fixed layer.
// Built with createElement and textContent, never innerHTML, so there is no HTML sink
// for a URL parameter to reach even if the allowed character set is widened later.

import { safeRecipient } from "./lib.js";

const params = new URLSearchParams(location.search);
export const recipient = safeRecipient(params.get("for"));
export const owner = safeRecipient(params.get("by"));

/** The stamp text, or null when there is no recipient and therefore nothing to stamp. */
export const stamp = recipient
  ? "CONFIDENTIAL · PREPARED FOR " + recipient.toUpperCase() +
    (owner ? " · BY " + owner.toUpperCase() : "")
  : null;

const layer = document.getElementById("wm-layer");
if (stamp && layer) {
  // Pick an ink the reader can see. data-ink="dark" or "light" overrides; otherwise read
  // the page's own background, because most documents are white and a white stamp on
  // white is not a stamp.
  let dark = layer.dataset.ink === "dark";
  if (!layer.dataset.ink) {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) || [];
    const [r, g, b, a] = m.map(Number);
    const opaque = m.length < 4 || a > 0.5;
    dark = !opaque || (0.299 * r + 0.587 * g + 0.114 * b) > 128;
  }
  for (let r = 0; r < 7; r++) {
    const off = r % 2 ? 21 : 0;
    for (let c = -1; c < 3; c++) {
      const span = document.createElement("span");
      span.textContent = stamp;
      Object.assign(span.style, {
        position: "absolute",
        top: r * 14 + "%",
        left: c * 42 + off + "%",
        transform: "rotate(-30deg)",
        transformOrigin: "left center",
        color: dark ? "rgba(0,0,0,0.13)" : "rgba(255,255,255,0.11)",
        fontSize: "12px",
        fontWeight: "600",
        letterSpacing: "1px",
        whiteSpace: "nowrap",
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      });
      layer.appendChild(span);
    }
  }
  layer.style.display = "block";

  // Report the open. This runs only in a real browser that executed the page, which is
  // the point: email scanners and link-preview bots fetch the URL and never get here,
  // so they are never counted as readers. In gated mode the server ignores ?for= and
  // uses the name behind the cookie; in open mode ?for= is all it has.
  try {
    fetch("/opened?for=" + encodeURIComponent(recipient) + "&doc=" + encodeURIComponent(location.pathname), {
      method: "POST", keepalive: true, credentials: "same-origin",
    }).catch(() => {});
  } catch { /* nothing to do if fetch itself is unavailable */ }
}

// Speed bumps, not security. The gate and the stamp are the real controls.
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
  if ((e.ctrlKey || e.metaKey) && (k === "s" || k === "p" || k === "u")) e.preventDefault();
});
