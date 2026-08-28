# Google SSO Login Page (Static, GitHub Pages)

A reusable, application-agnostic "Sign in with Google" page built with plain
HTML, CSS, and JavaScript — no build step, no backend, no framework. Any
number of separate applications can redirect their users to this page for
Google sign-in and receive the result back through a documented redirect
contract.

The page uses [Google Identity Services](https://developers.google.com/identity/gsi/web)
directly in the browser. It never touches, stores, or requires a Google
OAuth **client secret** — which is exactly why it's safe to host as static
files on GitHub Pages.

---

## Table of contents

- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [1. Google Cloud Console setup](#1-google-cloud-console-setup)
- [2. Configure `config.js`](#2-configure-configjs)
- [3. Deploy to GitHub Pages](#3-deploy-to-github-pages)
- [Integration contract](#integration-contract)
  - [Starting a sign-in request](#starting-a-sign-in-request)
  - [Request parameters](#request-parameters)
  - [Response format](#response-format)
  - [Returned fields](#returned-fields)
- [How a consuming application should validate the result](#how-a-consuming-application-should-validate-the-result)
- [Security model](#security-model)
- [Managing the authorized user list without touching the codebase](#managing-the-authorized-user-list-without-touching-the-codebase)
- [Local development / testing](#local-development--testing)
- [FAQ](#faq)

---

## How it works

1. A consuming application redirects the user's browser to this page
   (`index.html`) with a `redirect_uri` and a `state` value of its own.
2. This page validates `redirect_uri` against an allowlist in
   [`config.js`](config.js). If it isn't allowlisted, sign-in stops with an
   error — nothing is ever sent to an unapproved destination.
3. This page generates its own random `sso_state` and `nonce` using
   `crypto.getRandomValues` and stores them in `sessionStorage`.
4. Google Identity Services renders the official "Sign in with Google"
   button and, on click, returns a signed **Google ID token** (a JWT)
   directly to the browser — the token embeds the `nonce` this page
   generated.
5. This page redirects the browser back to the consuming application's
   `redirect_uri`, appending the ID token and related fields (by default as
   a URL fragment, so they are never sent to any server automatically).
6. The consuming application's **backend** independently verifies the ID
   token's signature and claims before treating the user as signed in.

The frontend never asserts "this user is authenticated." It only relays a
token that Google issued. Trust is established later, server-side.

## Project structure

```
.
├── index.html              # The login page (this is what users see)
├── callback.html            # Neutral diagnostic page to inspect returned params
├── demo.html                 # Example consuming application
├── config.js                  # All integration/config settings (no secrets)
├── assets/
│   ├── js/
│   │   └── auth.js            # Reusable auth module (state/nonce, GIS, redirect logic)
│   └── css/
│       └── styles.css         # Shared styling for all pages
└── README.md
```

## 1. Google Cloud Console setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   select or create a project.
2. Navigate to **APIs & Services → OAuth consent screen** and configure it
   (External user type is typical; fill in app name, support email, etc).
3. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**.
4. Choose **Application type: Web application**.
5. Under **Authorized JavaScript origins**, add the exact origin(s) this
   page will be served from, for example:
   - `https://YOUR_GITHUB_USERNAME.github.io`
   - `http://localhost:3000` (only if you test locally with a dev server)

   Do **not** add a path — origins only (scheme + host + port).
6. You do **not** need to add an "Authorized redirect URI" for this OAuth
   client, because Google Identity Services' token flow used here
   (`google.accounts.id`) returns the credential directly to the page via a
   JavaScript callback, not through a server redirect.
7. Save, then copy the generated **Client ID** — it looks like
   `1234567890-abc123.apps.googleusercontent.com`. This is safe to publish
   in client-side code. Do **not** copy or use the "Client secret"
   anywhere in this project; it does not belong in a static site.

## 2. Configure `config.js`

Open [`config.js`](config.js) and edit:

```js
window.SSO_CONFIG = {
  GOOGLE_CLIENT_ID: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  DEFAULT_REDIRECT_URI: "",
  ALLOWED_REDIRECT_URIS: [
    "https://myapp.example.com/auth/google/callback",
  ],
  ALLOWED_REDIRECT_ORIGINS: [
    // "https://myapp.example.com",
  ],
  FIREBASE_CONFIG: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },
  CREDENTIAL_PARAM_NAME: "id_token",
  USE_FRAGMENT_RESPONSE: true,
  STATE_TTL_MS: 5 * 60 * 1000,
  GIS_BUTTON_OPTIONS: { /* ... */ },
  GIS_INIT_OPTIONS: { /* ... */ },
};
```

| Setting | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | The public OAuth Client ID from step 1. Never put a client secret here. |
| `DEFAULT_REDIRECT_URI` | Used only if a request omits `redirect_uri`. Leave `""` to require every caller to pass one explicitly. |
| `ALLOWED_REDIRECT_URIS` | **Exact** allowlist. Preferred. A request's `redirect_uri` must match one of these strings byte-for-byte. |
| `ALLOWED_REDIRECT_ORIGINS` | Origin-only allowlist (any path allowed). Use sparingly, only for origins you fully trust/control. |
| `FIREBASE_CONFIG` | Points at a Firebase project used to check each signer-in against a per-user Firestore document. The allowlist itself is **not** stored in this repo — see [Managing the authorized user list](#managing-the-authorized-user-list-without-touching-the-codebase). Leave `apiKey: ""` to allow any Google account. |
| `CREDENTIAL_PARAM_NAME` | Name of the field carrying the raw Google ID token in the response. Defaults to `id_token`. |
| `USE_FRAGMENT_RESPONSE` | `true` (default) returns results as a URL fragment (`#...`), which browsers never send to servers. Set `false` to use a query string (`?...`) instead — only if your callback needs server-side access on first load. |
| `STATE_TTL_MS` | How long a generated `state`/`nonce` pair stays valid before being treated as expired. |
| `GIS_BUTTON_OPTIONS` | Passed to `google.accounts.id.renderButton()` — controls the button's look. |
| `GIS_INIT_OPTIONS` | Passed to `google.accounts.id.initialize()` — controls sign-in behavior (auto-select, etc). |

You must add every application's callback URL to `ALLOWED_REDIRECT_URIS`
(or its origin to `ALLOWED_REDIRECT_ORIGINS`) before that application can
receive sign-in results.

## 3. Deploy to GitHub Pages

1. Create a new GitHub repository and push these files to it (root of the
   repo, or any subfolder you configure Pages to serve from).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a
   branch`, pick your branch (e.g. `main`) and folder (e.g. `/root`).
4. Save. GitHub will publish the site at:
   ```
   https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO/
   ```
5. Make sure this exact origin (`https://YOUR_GITHUB_USERNAME.github.io`)
   is in your OAuth client's **Authorized JavaScript origins** (step 1.5
   above) — Google will reject sign-in attempts from origins it doesn't
   recognize.

All paths in this project are **relative** (`assets/css/styles.css`,
`config.js`, `index.html`, etc.), so it works identically whether it's
served from the root of a GitHub Pages user/org site or from a project
subpath like `/YOUR_REPO/`. No path rewriting is needed.

## Integration contract

### Starting a sign-in request

A consuming application starts sign-in by redirecting the user's browser
(a full navigation, or a link/button — not an XHR/fetch) to:

```
https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO/?redirect_uri=ENCODED_CALLBACK_URL&state=APP_GENERATED_STATE
```

`redirect_uri` must be URL-encoded and must exactly match (or match the
origin of, if using origin allowlisting) an entry in `config.js`.

### Request parameters

| Parameter | Required | Description |
|---|---|---|
| `redirect_uri` | Yes (unless `DEFAULT_REDIRECT_URI` is set) | Where to send the user back after sign-in. Must be allowlisted. |
| `state` | Recommended | An opaque value generated and owned by the **consuming application**, used for its own CSRF protection. Echoed back unchanged. |
| `login_hint` | No | A Google account email/identifier to pre-fill, if supported by the current Google Identity Services session. |
| `prompt` | No | e.g. `select_account` to hint that the account chooser should be shown. |
| `context` | No | Free-form hint such as `signin` or `signup`, useful if your app wants to show different copy after redirect. |

### Response format

By default (fragment mode):

```
https://your-app.example.com/auth/google/callback#id_token=GOOGLE_ID_TOKEN&state=APP_GENERATED_STATE&sso_state=PAGE_GENERATED_STATE&nonce=PAGE_GENERATED_NONCE&provider=google&issued_at=TIMESTAMP
```

If `USE_FRAGMENT_RESPONSE` is set to `false`, the same fields are appended
as a query string instead:

```
https://your-app.example.com/auth/google/callback?id_token=GOOGLE_ID_TOKEN&state=APP_GENERATED_STATE&sso_state=PAGE_GENERATED_STATE&nonce=PAGE_GENERATED_NONCE&provider=google&issued_at=TIMESTAMP
```

### Returned fields

| Field | Description |
|---|---|
| `id_token` | The raw Google-issued ID token (JWT). Must be verified server-side before use. |
| `state` | The exact `state` value the consuming application originally sent. Compare it against what you stored before redirecting. |
| `sso_state` | A separate CSRF-style value generated by *this login page* for its own internal bookkeeping. Informational for the consuming app. |
| `nonce` | The nonce this login page generated and asked Google to embed in the ID token's `nonce` claim. Compare against the token's decoded `nonce` claim as part of verification. |
| `provider` | Always the literal string `google`. Present so a consuming app that supports multiple SSO providers can branch on it. |
| `issued_at` | Client-side timestamp (epoch milliseconds) of when this login page produced the response. Not a substitute for the token's own `iat`/`exp` claims. |

`assets/js/auth.js` exposes `SSOAuth.parseReturnedParams()` to parse both
fragment and query forms of this response, and `demo.html` /
`callback.html` show working examples of consuming it.

## How a consuming application should validate the result

**The frontend of this project is not an authentication authority.** A
Google ID token arriving in the browser proves nothing on its own — it
must be verified by your **backend** before you treat the user as signed
in. At minimum, your backend must verify:

- **Signature** — using Google's public keys (JWKS) or an official Google
  auth library (e.g. `google-auth-library` for Node.js,
  `google-auth` for Python, etc). Never trust a token whose signature you
  have not checked.
- **`iss`** — must be exactly `https://accounts.google.com` or
  `accounts.google.com`.
- **`aud`** — must exactly equal your `GOOGLE_CLIENT_ID`.
- **`exp`** — must not be in the past.
- **`nonce`** — if you generate/track one end-to-end, it must match what
  you expect (this page's generated `nonce` is embedded in the token by
  Google Identity Services for this purpose).
- **`email_verified`** — check this claim before treating the email
  address as confirmed, if your application relies on the email.
- **`state`** — the returned `state` must match the value your
  application generated and stored *before* redirecting the user to this
  login page. Reject the response outright on any mismatch — this is your
  application's CSRF defense.
- **Redirect target** — confirm the response arrived at the exact route
  your application expects; don't infer trust from the URL alone.

Only after all of the above pass should your backend issue your
application's own session (cookie, JWT, etc). The decoding helpers in this
project (`SSOAuth.decodeJwtPayload`, used in `demo.html` and
`callback.html`) are explicitly for **display purposes only** in the demo
UI — they perform no verification and are clearly labeled as untrusted.

## Security model

- **No client secret, ever.** This project contains no OAuth client
  secret, private key, service account file, production token, or other
  server credential. Only the public OAuth Client ID appears in
  `config.js`, which is exactly what Google Identity Services'
  browser-side flow expects.
- **Redirect allowlisting.** `SSOAuth.validateRedirectUri()` rejects any
  `redirect_uri` that isn't an exact match in `ALLOWED_REDIRECT_URIS` (or,
  optionally, whose origin isn't in `ALLOWED_REDIRECT_ORIGINS`). Sign-in
  simply does not proceed for unapproved destinations — no token is ever
  generated or sent.
- **CSRF-resistant state/nonce.** Both this login page's `sso_state` and
  the `nonce` embedded in the ID token are generated with
  `crypto.getRandomValues` (never `Math.random`), which is the Web
  Crypto API's cryptographically secure random source.
- **Short-lived pending requests.** Generated state/nonce pairs are kept
  in `sessionStorage` (not `localStorage`, so they don't persist across
  browser sessions) and expire after `STATE_TTL_MS`.
- **Fragment-based responses by default.** `USE_FRAGMENT_RESPONSE: true`
  ensures the ID token and related fields are appended after a `#`, so
  browsers never include them in requests to a server — keeping them out
  of server access logs, reverse proxy logs, and `Referer` headers.
- **No trust claimed by the frontend.** This page's job ends at "Google
  issued this token and here it is." Identity is only established once a
  backend verifies it, as detailed above.
- **Client-side user allowlist, enforced by Firestore Security Rules.**
  `SSOAuth.isAuthorizedUser()` signs the user's existing Google ID token
  into Firebase Authentication, then tries to read a per-user Firestore
  document (`authorizedUsers/{email}`). Whether that read is even
  *allowed* is decided by Firestore Security Rules running on Google's
  servers, not by anything in this repo — so an unauthorized visitor
  can't read the allowlist at all (not even to see who else is on it),
  unlike a plain fetched file. This is a real access-control boundary on
  the *list*, not just a UX gate — but the follow-on decision to proceed
  with the redirect is still made in this page's own JavaScript, so it
  still complements, and does not replace, a backend verifying the ID
  token if you add one later for whatever this login page feeds into.

## Managing the authorized user list without touching the codebase

The list of who's allowed to sign in is never stored in this repo — not
in `config.js`, not anywhere else. It lives in a Firebase project's
Firestore database, gated by Firestore Security Rules configured in the
Firebase console, and `assets/js/auth.js` checks against it at sign-in
time via the Firebase JS SDK (loaded from Google's CDN, no build step).

**Setup:**

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   → **Add project**. You can attach it to the same Google Cloud project
   your `GOOGLE_CLIENT_ID` already lives in, or make a new one.
2. **Build → Authentication → Get started → Sign-in method → enable
   Google.**
3. **Build → Firestore Database → Create database** → production mode →
   pick a region.
4. In Firestore, create a collection named `authorizedUsers`. For each
   person you want to allow, add one document whose **Document ID is
   their lowercase Google account email** (e.g. `teammate@example.com`),
   with any single field, e.g. `allowed: true`. This is the actual
   allowlist — entered by hand in the console, never in code.
5. **Firestore → Rules**, replace the contents with:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /authorizedUsers/{email} {
         allow read: if request.auth != null
                      && request.auth.token.email.lower() == email;
       }
     }
   }
   ```
   This is what actually enforces the restriction: Firebase's own servers
   refuse the read unless the signed-in account's email matches the
   document being requested. Publish the rules.
6. **Project settings → General → Your apps → Add app → Web**, then copy
   the `firebaseConfig` object it gives you into `config.js`'s
   `FIREBASE_CONFIG`. These values are meant to be public, the same
   category as `GOOGLE_CLIENT_ID` — they identify which Firebase project
   to talk to, they are not a credential.
7. Deploy. From then on, adding or removing a teammate is just adding or
   deleting a document in Firestore — no code change, no redeploy.

Leave `FIREBASE_CONFIG.apiKey` as `""` to disable the check entirely and
allow any Google account to sign in (useful for local testing before you
set Firebase up).

**Notes:**

- Firebase's free "Spark" plan covers this comfortably at no cost: free
  Google sign-ins, and Firestore's free tier (50,000 reads/day, 1 GiB
  storage) is far more than a small team's login volume. No credit card
  is required for Spark, and Google doesn't silently start billing you —
  that only happens if you deliberately upgrade to the paid "Blaze" plan.
- This **fails closed**: if Firestore is unreachable, misconfigured, or
  the signed-in account has no matching document, the user is treated as
  not authorized. Check the browser console for the specific error if
  sign-in unexpectedly blocks everyone.
- To allow a whole domain instead of listing every person individually,
  extend the rule to also check
  `request.auth.token.email.lower().matches('.*@yourdomain[.]com$')`.

## Local development / testing

Because this project fetches the Google Identity Services script and
performs `URL`/`sessionStorage` operations, serve it over `http://` rather
than opening files directly via `file://`. Any static file server works,
for example:

```bash
npx serve .
```

Then add `http://localhost:PORT` to your OAuth client's Authorized
JavaScript origins, and set `ALLOWED_REDIRECT_URIS` in `config.js` to
include your local callback (e.g.
`http://localhost:PORT/demo.html`) while testing.

Try the flow via [`demo.html`](demo.html), which acts as a stand-in
consuming application: it starts a sign-in request, receives the redirect
response, and displays the returned fields (including a clearly-labeled,
untrusted client-side decode of the ID token).

## FAQ

**Can I use this with any backend language/framework?**
Yes. This project only produces a redirect back to your application with
an ID token attached. Verification is a standard JWT/OAuth operation
available in essentially every backend ecosystem via Google's official
libraries or general-purpose JWT + JWKS libraries.

**Why not use the full OAuth 2.0 Authorization Code flow instead?**
That flow requires a client secret and a server-side token exchange,
which cannot be done safely from a static site with no backend of its
own. This project uses Google Identity Services' ID token flow instead,
which is designed to run entirely in the browser without a secret, and
defers all trust decisions to each consuming application's own backend.

**Can multiple, unrelated applications use the same deployment of this
page?**
Yes — that's the intended use case. Add each application's callback URL to
`ALLOWED_REDIRECT_URIS` (or its origin to `ALLOWED_REDIRECT_ORIGINS`), and
each application only needs to link to this page with its own
`redirect_uri` and `state`.

**Is `state` the same as `sso_state`?**
No. `state` is generated and owned by the *consuming application* and is
simply echoed back unchanged — the app should validate it. `sso_state` is
a separate value generated internally by *this login page* for its own
bookkeeping and is returned for transparency/debugging.
