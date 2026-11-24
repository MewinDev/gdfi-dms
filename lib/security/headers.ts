/**
 * D-055: the app's security headers, minimal and in one place (applied to every route by next.config.ts).
 *   CSP: the app's own origin only. Next.js needs 'unsafe-inline' for its inline scripts and styles without nonces
 *        (nonces would force every page to render dynamically: node_modules/next/dist/docs, "Content Security Policy");
 *        'unsafe-eval' only in development (React's error overlay). Images may be data:/blob: (previews); fonts are
 *        self-hosted (app/fonts, D-057), so font-src is 'self' only. frame-ancestors 'none': never framed. form-action allows Microsoft sign-in (Entra).
 *   HSTS: production only (a local or staging host may not have a certificate).
 *   nosniff, X-Frame-Options DENY, Referrer-Policy same-origin.
 * The file route sets its own stricter CSP (sandbox) on each file it serves.
 */
export function securityHeaders(env: { dev: boolean; production: boolean }): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${env.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://login.microsoftonline.com",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "same-origin" },
    ...(env.production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  ];
}
