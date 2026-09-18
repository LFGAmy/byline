// The gate page. Shows the "invalid code" line when the middleware sent us here with
// ?invalid=1, and turns the form into a ?key= link back to where the reader was going.
// Kept out of the HTML so the site can ship a Content-Security-Policy with no inline script.
const params = new URLSearchParams(location.search);
if (params.get("invalid")) document.getElementById("err").style.display = "block";

// Only a same-origin path is accepted as a destination. Anything else goes to the root.
const next = params.get("next") || "/";
const dest = /^\/(?:index|viewer)?(?:\.html)?(?:\?doc=[A-Za-z0-9._%-]+)?$/.test(next) ? next : "/";

document.querySelector("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const k = document.getElementById("k").value.trim();
  if (k) location.href = dest + (dest.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(k);
});
