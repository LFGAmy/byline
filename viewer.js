// Byline PDF viewer. Renders document.pdf (or ?doc=) page by page with pdf.js, then
// burns the stamp into each canvas so the pixels themselves carry the attribution.
//
// pdf.js is vendored in /vendor rather than pulled from a CDN. Nothing third-party loads
// on a page that renders confidential documents, it keeps working behind corporate
// networks that block CDNs, and there is no integrity hash to rotate.

import { getDocument, GlobalWorkerOptions } from "./vendor/pdf.min.mjs";
import { recipient, stamp } from "./watermark.js";

GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const params = new URLSearchParams(location.search);
const wrap = document.getElementById("pages");
const msg = document.getElementById("msg");

if (recipient) document.getElementById("who").textContent = "Prepared for " + recipient;

// Only same-origin relative .pdf paths. Without this, ?doc=https://evil.com/x.pdf loads
// an attacker's file into the viewer, and a malicious PDF can execute script in this
// page. Restricting the source is the control; the renderer is not one.
let src = params.get("doc") || "document.pdf";
if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.pdf$/i.test(src) || src.includes("..")) src = "document.pdf";

// Sample the rendered page and pick an ink the stamp will actually show against.
// A dark deck with a black stamp is no stamp.
function pageIsDark(ctx, cv) {
  const step = Math.max(1, Math.floor(Math.min(cv.width, cv.height) / 24));
  let sum = 0, n = 0;
  const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  for (let y = 0; y < cv.height; y += step) {
    for (let x = 0; x < cv.width; x += step) {
      const i = (y * cv.width + x) * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
  }
  return n > 0 && sum / n < 128;
}

function burnStamp(ctx, cv) {
  if (!stamp) return;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = pageIsDark(ctx, cv) ? "#fff" : "#000";
  ctx.font = "600 " + Math.max(11, cv.width / 62) + "px sans-serif";
  ctx.rotate(-0.52);
  const step = ctx.measureText(stamp).width + 60;
  for (let y = -cv.width; y < cv.height * 1.6; y += 130) {
    for (let x = -cv.height; x < cv.width * 1.6; x += step) ctx.fillText(stamp, x, y);
  }
  ctx.restore();
}

// v6 removed the bare-string form of getDocument(); it takes a parameter object.
getDocument({ url: src }).promise.then(async (pdf) => {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(2, Math.max(1.2, (window.innerWidth - 40) / 700));
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: scale * dpr });
    const cv = document.createElement("canvas");
    cv.width = vp.width;
    cv.height = vp.height;
    cv.style.width = vp.width / dpr + "px";
    wrap.appendChild(cv);
    const ctx = cv.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    burnStamp(ctx, cv);
  }
}).catch(() => {
  msg.style.display = "block";
  msg.replaceChildren();
  msg.append("No document found. Drop your file in as ");
  const c1 = document.createElement("code"); c1.textContent = "document.pdf"; msg.append(c1);
  msg.append(", or point at another one with ");
  const c2 = document.createElement("code"); c2.textContent = "?doc=yourfile.pdf"; msg.append(c2, ".");
});
