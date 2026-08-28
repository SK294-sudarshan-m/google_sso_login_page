/**
 * auth.js
 *
 * Reusable, application-agnostic Google SSO frontend logic.
 *
 * This module is intentionally framework-free and has no build step so it
 * can be dropped into any static site (GitHub Pages, S3, nginx, etc). It
 * exposes a single global namespace, `window.SSOAuth`, with functions used
 * by index.html (the login page), callback.html (diagnostic viewer), and
 * demo.html (example consuming application).
 *
 * SECURITY MODEL
 * ---------------
 * This script runs entirely in the browser and can therefore never be
 * fully trusted by a consuming application. It:
 *   - validates the requested redirect_uri against an allowlist before
 *     sending any data back to it,
 *   - generates its own CSRF-style `state` (sso_state) and a `nonce`
 *     using the Web Crypto API,
 *   - asks Google Identity Services to embed that nonce in the returned
 *     ID token,
 *   - and forwards Google's ID token, untouched, to the consuming
 *     application's redirect_uri.
 *
 * It does NOT verify the ID token's signature, and it must never be
 * treated as an authentication authority. Only a backend that verifies
 * the token against Google's public keys can establish that a user is
 * actually signed in. See README.md for the full checklist.
 */

(function (window) {
  "use strict";

  var CONFIG = window.SSO_CONFIG || {};
  var STORAGE_PREFIX = "sso_pending_";
  var GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
  var gisScriptPromise = null;

  // ---------------------------------------------------------------------
  // Low-level helpers
  // ---------------------------------------------------------------------

  /** Base64url-encodes a Uint8Array without any padding characters. */
  function base64UrlEncode(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    var base64 = window.btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * Generates a cryptographically secure random token suitable for use as
   * a CSRF state value or a nonce. Uses crypto.getRandomValues, which is
   * required for anything security-sensitive (Math.random() is NOT
   * cryptographically secure and must never be used for this purpose).
   */
  function generateRandomToken(byteLength) {
    byteLength = byteLength || 32;
    var bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }

  /** Parses a query-string-like string (with or without a leading separator) into a plain object. */
  function parseParamString(str) {
    var result = {};
    if (!str) return result;
    var usp = new URLSearchParams(str);
    usp.forEach(function (value, key) {
      result[key] = value;
    });
    return result;
  }

  /** Safely parses an absolute URL string, returning null instead of throwing. */
  function safeParseUrl(urlString) {
    try {
      return new URL(urlString);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Request parameter handling
  // ---------------------------------------------------------------------

  /**
   * Reads the parameters a consuming application passed to this login
   * page via the query string: redirect_uri, state, login_hint, prompt,
   * and context. Falls back to config.js's DEFAULT_REDIRECT_URI when no
   * redirect_uri is supplied.
   */
  function getRequestParams() {
    var query = parseParamString(window.location.search);
    return {
      redirect_uri: query.redirect_uri || CONFIG.DEFAULT_REDIRECT_URI || "",
      state: query.state || "",
      login_hint: query.login_hint || "",
      prompt: query.prompt || "",
      context: query.context || "",
    };
  }

  // ---------------------------------------------------------------------
  // Redirect URI allowlisting
  // ---------------------------------------------------------------------

  function isExactAllowed(uri) {
    var list = CONFIG.ALLOWED_REDIRECT_URIS || [];
    return list.indexOf(uri) !== -1;
  }

  function isOriginAllowed(uri) {
    var parsed = safeParseUrl(uri);
    if (!parsed) return false;
    var list = CONFIG.ALLOWED_REDIRECT_ORIGINS || [];
    return list.indexOf(parsed.origin) !== -1;
  }

  /**
   * Validates a candidate redirect_uri against config.js's allowlists.
   * Exact matches (ALLOWED_REDIRECT_URIS) are checked first and are the
   * recommended way to allowlist destinations. Origin matches
   * (ALLOWED_REDIRECT_ORIGINS) are checked second and should be reserved
   * for trusted use cases, since they permit any path on that origin.
   *
   * Only absolute http(s) URLs are ever accepted; this also rejects
   * dangerous schemes such as javascript: or data:.
   */
  function validateRedirectUri(uri) {
    if (!uri) return false;
    var parsed = safeParseUrl(uri);
    if (!parsed) return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return isExactAllowed(uri) || isOriginAllowed(uri);
  }

  // ---------------------------------------------------------------------
  // Pending request storage (sessionStorage)
  // ---------------------------------------------------------------------

  function pendingKey(ssoState) {
    return STORAGE_PREFIX + ssoState;
  }

  /** Persists metadata about an in-flight sign-in request, keyed by our own generated sso_state. */
  function storePendingRequest(ssoState, data) {
    var record = {
      redirect_uri: data.redirect_uri,
      app_state: data.app_state || "",
      nonce: data.nonce,
      login_hint: data.login_hint || "",
      prompt: data.prompt || "",
      context: data.context || "",
      created_at: Date.now(),
    };
    window.sessionStorage.setItem(pendingKey(ssoState), JSON.stringify(record));
  }

  /** Retrieves a pending request, returning null if missing, corrupt, or expired. */
  function getPendingRequest(ssoState) {
    var raw = window.sessionStorage.getItem(pendingKey(ssoState));
    if (!raw) return null;
    var record;
    try {
      record = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    var ttl = CONFIG.STATE_TTL_MS || 5 * 60 * 1000;
    if (typeof record.created_at !== "number" || Date.now() - record.created_at > ttl) {
      clearPendingRequest(ssoState);
      return null;
    }
    return record;
  }

  function clearPendingRequest(ssoState) {
    window.sessionStorage.removeItem(pendingKey(ssoState));
  }

  /** Removes any expired pending-request entries left behind by abandoned sign-in attempts. */
  function cleanupExpiredPendingRequests() {
    var ttl = CONFIG.STATE_TTL_MS || 5 * 60 * 1000;
    var toRemove = [];
    for (var i = 0; i < window.sessionStorage.length; i++) {
      var key = window.sessionStorage.key(i);
      if (key.indexOf(STORAGE_PREFIX) !== 0) continue;
      try {
        var record = JSON.parse(window.sessionStorage.getItem(key));
        if (!record || typeof record.created_at !== "number" || Date.now() - record.created_at > ttl) {
          toRemove.push(key);
        }
      } catch (e) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(function (key) {
      window.sessionStorage.removeItem(key);
    });
  }

  // ---------------------------------------------------------------------
  // Google Identity Services loading
  // ---------------------------------------------------------------------

  /** Injects the Google Identity Services script exactly once and resolves when it is ready. */
  function loadGisScript() {
    if (gisScriptPromise) return gisScriptPromise;
    gisScriptPromise = new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        resolve(window.google);
        return;
      }
      var script = document.createElement("script");
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = function () {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          resolve(window.google);
        } else {
          reject(new Error("Google Identity Services script loaded but window.google is unavailable."));
        }
      };
      script.onerror = function () {
        reject(new Error("Failed to load Google Identity Services script."));
      };
      document.head.appendChild(script);
    });
    return gisScriptPromise;
  }

  // ---------------------------------------------------------------------
  // Response construction (redirecting back to the consuming application)
  // ---------------------------------------------------------------------

  /**
   * Builds the final redirect URL back to the consuming application,
   * appending `params` either as a URL fragment (default, recommended)
   * or as a query string, per config.js's USE_FRAGMENT_RESPONSE.
   *
   * Fragments are used by default because browsers never send the URL
   * fragment to a server on navigation, keeping the ID token out of
   * server access logs, proxy logs, and Referer headers.
   */
  function buildResponseUrl(redirectUri, params, useFragment) {
    var usp = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value !== undefined && value !== null && value !== "") {
        usp.set(key, value);
      }
    });
    var serialized = usp.toString();
    if (useFragment) {
      return redirectUri + "#" + serialized;
    }
    var separator = redirectUri.indexOf("?") === -1 ? "?" : "&";
    return redirectUri + separator + serialized;
  }

  // ---------------------------------------------------------------------
  // Response parsing (used by callback.html and demo.html)
  // ---------------------------------------------------------------------

  /**
   * Parses returned SSO parameters from both the URL fragment and the
   * query string of the current page and merges them (fragment values
   * take precedence, since that is the default response format).
   */
  function parseReturnedParams() {
    var query = parseParamString(window.location.search);
    var hash = window.location.hash && window.location.hash.length > 1 ? window.location.hash.substring(1) : "";
    var fragment = parseParamString(hash);
    var merged = {};
    Object.keys(query).forEach(function (key) {
      merged[key] = query[key];
    });
    Object.keys(fragment).forEach(function (key) {
      merged[key] = fragment[key];
    });
    return merged;
  }

  /**
   * Decodes the payload of a JWT for DISPLAY PURPOSES ONLY.
   *
   * This performs NO signature verification whatsoever and must never be
   * used to make trust or authorization decisions. Anyone can construct
   * a JWT-shaped string with an arbitrary payload; only a backend that
   * verifies the signature against Google's public keys (and checks iss,
   * aud, exp, nonce, etc.) can establish that these claims are genuine.
   *
   * Returns null if the token is not a syntactically valid JWT.
   */
  function decodeJwtPayload(token) {
    if (typeof token !== "string") return null;
    var parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
      var payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      var padding = payload.length % 4 === 0 ? "" : "====".slice(payload.length % 4);
      var decoded = window.atob(payload + padding);
      var jsonString = decodeURIComponent(
        decoded
          .split("")
          .map(function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      );
      return JSON.parse(jsonString);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Firebase-backed user allowlist (list data lives OUTSIDE this repo,
  // and access to it is enforced by Firestore Security Rules, not by a
  // publicly-readable URL — see README.md's Firebase setup section)
  // ---------------------------------------------------------------------

  var FIREBASE_SDK_VERSION = "10.13.2";
  var firebaseSdkPromise = null;

  /** Loads the Firebase App/Auth/Firestore SDKs from Google's CDN exactly once. */
  function loadFirebaseSdk() {
    if (firebaseSdkPromise) return firebaseSdkPromise;
    var base = "https://www.gstatic.com/firebasejs/" + FIREBASE_SDK_VERSION + "/";
    firebaseSdkPromise = Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]).then(function (mods) {
      var appMod = mods[0];
      var authMod = mods[1];
      var fsMod = mods[2];
      var app = appMod.initializeApp(CONFIG.FIREBASE_CONFIG);
      return {
        auth: authMod.getAuth(app),
        db: fsMod.getFirestore(app),
        GoogleAuthProvider: authMod.GoogleAuthProvider,
        signInWithCredential: authMod.signInWithCredential,
        doc: fsMod.doc,
        getDoc: fsMod.getDoc,
      };
    });
    return firebaseSdkPromise;
  }

  /**
   * Checks whether a Google ID token belongs to an authorized user, by
   * signing in to Firebase with that same token and then attempting to
   * read a per-user document in Firestore (`authorizedUsers/{email}`).
   * Whether that read is even allowed is decided by Firestore Security
   * Rules running on Google's servers — not by anything in this repo —
   * so unauthorized visitors can't read the allowlist at all, let alone
   * bypass it locally the way a plain fetched list could be.
   *
   * Resolves to:
   *   - true if CONFIG.FIREBASE_CONFIG is not set (no restriction configured)
   *   - true if the matching document exists and the rules allow reading it
   *   - false otherwise (wrong account, no document, rules denied it,
   *     network/config error — all fail CLOSED)
   *
   * @param {string} idToken - the raw Google ID token (response.credential)
   * @param {Object} payload - that same token, already decoded for its `email`/`email_verified` claims
   */
  function isAuthorizedUser(idToken, payload) {
    if (!payload || typeof payload.email !== "string") return Promise.resolve(false);
    if (payload.email_verified === false) return Promise.resolve(false);
    if (!CONFIG.FIREBASE_CONFIG || !CONFIG.FIREBASE_CONFIG.apiKey) return Promise.resolve(true);

    var email = payload.email.toLowerCase();

    return loadFirebaseSdk()
      .then(function (fb) {
        var credential = fb.GoogleAuthProvider.credential(idToken);
        return fb.signInWithCredential(fb.auth, credential).then(function () {
          return fb.getDoc(fb.doc(fb.db, "authorizedUsers", email));
        });
      })
      .then(function (snap) {
        return snap.exists();
      })
      .catch(function (err) {
        console.error("SSOAuth: Firebase authorization check failed.", err);
        return false;
      });
  }

  // ---------------------------------------------------------------------
  // Login page controller
  // ---------------------------------------------------------------------

  /**
   * Wires up the login page: validates the incoming request, generates
   * state/nonce, initializes Google Identity Services, renders the
   * sign-in button, and redirects back to the consuming application once
   * Google returns a credential.
   *
   * @param {Object} options
   * @param {HTMLElement} options.buttonEl - element to render the Google button into
   * @param {HTMLElement} [options.statusEl] - element for transient status text
   * @param {HTMLElement} [options.errorEl] - element for error text
   */
  function initLoginPage(options) {
    options = options || {};
    var buttonEl = options.buttonEl;
    var statusEl = options.statusEl;
    var errorEl = options.errorEl;

    function setStatus(message) {
      if (statusEl) statusEl.textContent = message || "";
    }

    function setError(message) {
      if (errorEl) {
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
      }
      if (buttonEl) buttonEl.hidden = !!message;
    }

    cleanupExpiredPendingRequests();

    var req = getRequestParams();

    if (!req.redirect_uri) {
      setError(
        "This page was opened without a redirect_uri parameter. The requesting application must include one."
      );
      return;
    }

    if (!validateRedirectUri(req.redirect_uri)) {
      setError("The requested redirect_uri is not on this login page's allowlist. Sign-in cannot continue.");
      return;
    }

    if (!CONFIG.GOOGLE_CLIENT_ID || CONFIG.GOOGLE_CLIENT_ID.indexOf("YOUR_GOOGLE_OAUTH_CLIENT_ID") === 0) {
      setError("This login page has not been configured with a Google OAuth Client ID yet. See config.js.");
      return;
    }

    var ssoState = generateRandomToken(24);
    var nonce = generateRandomToken(24);
    if (CONFIG.FIREBASE_CONFIG && CONFIG.FIREBASE_CONFIG.apiKey) {
      loadFirebaseSdk(); // kick off in parallel with the GIS script below; ignore the promise here
    }

    storePendingRequest(ssoState, {
      redirect_uri: req.redirect_uri,
      app_state: req.state,
      nonce: nonce,
      login_hint: req.login_hint,
      prompt: req.prompt,
      context: req.context,
    });

    function handleCredentialResponse(response) {
      var pending = getPendingRequest(ssoState);
      if (!pending) {
        setError("This sign-in request has expired or was already used. Please return to the application and try again.");
        return;
      }

      var payload = decodeJwtPayload(response.credential);

      setStatus("Checking authorization…");

      isAuthorizedUser(response.credential, payload).then(function (authorized) {
        if (!authorized) {
          clearPendingRequest(ssoState);
          if (window.google && window.google.accounts && window.google.accounts.id) {
            window.google.accounts.id.disableAutoSelect();
          }
          setStatus("");
          var message =
            (payload && payload.email ? payload.email : "This account") +
            " is not authorized to use this application. Sign in with an authorized Google account, or contact the admin if you believe this is a mistake.";
          if (errorEl) {
            errorEl.textContent = message;
            errorEl.hidden = false;
          }
          // Unlike other errors, keep the button visible so the user can retry with a different account.
          return;
        }

        clearPendingRequest(ssoState);

        var responseParams = {};
        responseParams[CONFIG.CREDENTIAL_PARAM_NAME || "id_token"] = response.credential;
        responseParams.state = pending.app_state || "";
        responseParams.sso_state = ssoState;
        responseParams.nonce = pending.nonce;
        responseParams.provider = "google";
        responseParams.issued_at = String(Date.now());

        var useFragment = CONFIG.USE_FRAGMENT_RESPONSE !== false;
        var url = buildResponseUrl(pending.redirect_uri, responseParams, useFragment);

        setStatus("Signed in. Redirecting…");
        window.location.replace(url);
      });
    }

    setStatus("Loading Google Sign-In…");

    loadGisScript()
      .then(function (google) {
        var initOptions = Object.assign(
          {
            client_id: CONFIG.GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
            nonce: nonce,
          },
          CONFIG.GIS_INIT_OPTIONS || {}
        );
        google.accounts.id.initialize(initOptions);

        if (buttonEl) {
          google.accounts.id.renderButton(buttonEl, CONFIG.GIS_BUTTON_OPTIONS || {});
        }
        setStatus("");
      })
      .catch(function () {
        setError("Could not load Google Sign-In. Check your connection and try again.");
      });
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  window.SSOAuth = {
    generateRandomToken: generateRandomToken,
    getRequestParams: getRequestParams,
    validateRedirectUri: validateRedirectUri,
    loadFirebaseSdk: loadFirebaseSdk,
    isAuthorizedUser: isAuthorizedUser,
    storePendingRequest: storePendingRequest,
    getPendingRequest: getPendingRequest,
    clearPendingRequest: clearPendingRequest,
    cleanupExpiredPendingRequests: cleanupExpiredPendingRequests,
    buildResponseUrl: buildResponseUrl,
    parseReturnedParams: parseReturnedParams,
    decodeJwtPayload: decodeJwtPayload,
    initLoginPage: initLoginPage,
  };
})(window);
