// Cloudflare Pages Function — same-origin reverse proxy for the API.
//
// Cloudflare Pages ignores vercel.json, so the Vercel rewrites that used to proxy
// /auth, /kpi, etc. don't apply here. This middleware is the equivalent: any request
// whose first path segment is an API prefix is forwarded to TaxPlan's Django
// (api.taxplanadvisor.in/api/staff/*); everything else falls through to the static
// site / SPA.
//
// It's a *same-origin* proxy (the browser only ever talks to the Pages domain), so
// the httpOnly `access_token` cookie Django sets — no Domain, SameSite=Lax, Secure —
// is stored first-party for the Pages domain and returned on every call. No CORS and
// no SameSite=None needed, matching the app's original same-origin design.
//
// This instance is the ISOLATED TaxPlan system: it points only at TaxPlan's Django
// (its own Neon with the TaxPlan roster). The old shared glr.taxplanadvisor.in is
// untouched and still serves other companies.

const BACKEND = "https://api.taxplanadvisor.in/api/staff";

// Matches the prefixes the GLR frontend calls (was the vercel.json rewrite list).
const API_PREFIXES = new Set([
  "auth",
  "kpi",
  "dashboard",
  "attendance",
  "face",
  "locations",
  "export",
  "employees",
  "company",
  "leave",
  "payroll",
]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const firstSegment = url.pathname.split("/").filter(Boolean)[0];

  if (!firstSegment || !API_PREFIXES.has(firstSegment)) {
    // Static asset or client-side route — let Pages serve it (SPA fallback via _redirects).
    return next();
  }

  // Reverse-proxy to Django, preserving method, body, headers (incl. Cookie) and
  // returning the response verbatim so Set-Cookie flows back to the browser.
  const target = BACKEND + url.pathname + url.search;
  const proxied = new Request(target, request);
  return fetch(proxied);
}
