/**
 * config.js
 *
 * Central configuration for the Google SSO login page.
 * This file is plain JavaScript (not JSON) so it can be loaded with a
 * simple <script> tag on GitHub Pages with no build step, and so that
 * values can include comments explaining their purpose.
 *
 * SECURITY NOTE
 * -------------
 * This file is public. It is served as a static asset to every browser
 * that loads this site. NEVER put a Google OAuth client secret, API key
 * with write access, service account key, or any other server-side
 * credential in this file. Only the OAuth "Client ID" (which is public
 * by design for Google Identity Services / One Tap / Sign In With Google)
 * belongs here.
 */

window.SSO_CONFIG = {
  /**
   * Google OAuth 2.0 Client ID for this site, created in Google Cloud
   * Console under "APIs & Services" > "Credentials" > "OAuth client ID"
   * of type "Web application".
   *
   * Replace this placeholder before deploying. See README.md for the
   * full setup walkthrough (Authorized JavaScript origins, etc).
   */
  GOOGLE_CLIENT_ID: "226159739492-ln5c0lduc42svca1jo7hiiisn6rdghp7.apps.googleusercontent.com",

  /**
   * Default redirect_uri used when a consuming application does not pass
   * an explicit `redirect_uri` query parameter. Leave blank ("") to
   * require every request to specify its own redirect_uri instead.
   */
  DEFAULT_REDIRECT_URI: "",

  /**
   * Exact allowlist of redirect URIs this login page is permitted to
   * send authentication results to. A request's `redirect_uri` must
   * match one of these strings EXACTLY (scheme, host, port, path,
   * trailing slash, query string all included) to be accepted.
   *
   * Exact matching is the recommended, safest option. Prefer this list
   * over ALLOWED_REDIRECT_ORIGINS whenever possible.
   *
   * Example:
   *   "https://myapp.example.com/auth/google/callback"
   */
  ALLOWED_REDIRECT_URIS: [
    "http://localhost:4173/demo.html",
    "http://localhost:4173/callback.html",
    // "https://myapp.example.com/auth/google/callback",
    // "http://localhost:3000/auth/google/callback",
  ],

  /**
   * Origin-level allowlist (scheme + host + port only, no path).
   * A request's redirect_uri is accepted if its origin matches one of
   * these entries, REGARDLESS of path. This is more permissive than
   * ALLOWED_REDIRECT_URIS and should only be used for trusted use cases
   * (e.g. you control every route on that origin, or the origin hosts
   * many callback paths you don't want to enumerate individually).
   *
   * Leave empty to disable origin-based matching entirely and require
   * exact matches from ALLOWED_REDIRECT_URIS.
   *
   * Example:
   *   "https://myapp.example.com"
   */
  ALLOWED_REDIRECT_ORIGINS: [
    // "https://myapp.example.com",
  ],

  /**
   * Name of the parameter used to carry the raw Google ID token back to
   * the consuming application. Defaults to "id_token" per the
   * documented integration contract. Only change this if every
   * consuming application in your ecosystem agrees on a different name.
   */
  CREDENTIAL_PARAM_NAME: "id_token",

  /**
   * When true (default), the authentication result is appended to the
   * redirect URL as a URL fragment (#id_token=...&state=...). Fragments
   * are never sent to servers by browsers on subsequent navigation,
   * which keeps the ID token out of server access logs, proxy logs, and
   * Referer headers.
   *
   * When false, the result is appended as a query string
   * (?id_token=...&state=...) instead. Only disable fragment mode if
   * your consuming application specifically needs server-side access to
   * these values on the very first request (e.g. a server-rendered
   * callback route with no client-side JavaScript) and you understand
   * the logging tradeoffs.
   */
  USE_FRAGMENT_RESPONSE: true,

  /**
   * How long (in milliseconds) a pending sign-in request's state/nonce
   * pair remains valid after it is generated. Used to expire stale
   * sessionStorage entries left behind by abandoned sign-in attempts.
   */
  STATE_TTL_MS: 5 * 60 * 1000, // 5 minutes

  /**
   * Options passed to Google Identity Services when rendering the
   * sign-in button. See:
   * https://developers.google.com/identity/gsi/web/reference/js-reference#GsiButtonConfiguration
   */
  GIS_BUTTON_OPTIONS: {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "pill",
    logo_alignment: "left",
  },

  /**
   * Options passed to google.accounts.id.initialize(). `auto_select` and
   * `cancel_on_tap_outside` are left conservative by default so the
   * login page never signs a user in without an explicit click.
   * See:
   * https://developers.google.com/identity/gsi/web/reference/js-reference#IdConfiguration
   */
  GIS_INIT_OPTIONS: {
    auto_select: false,
    cancel_on_tap_outside: true,
    itp_support: true,
  },
};
