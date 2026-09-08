/**
 * worker.js
 *
 * Tiny request handler in front of the static assets. Its only job is to
 * redirect the bare root ("/") to "/index.html", since html_handling is
 * set to "none" (required so exact .html paths like /demo.html work for
 * the redirect_uri allowlist in config.js) and that mode does not
 * auto-resolve "/" to an index file the way other html_handling modes do.
 * Every other request falls straight through to static asset serving,
 * unchanged.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.redirect(new URL("/index.html", url), 302);
    }
    return env.ASSETS.fetch(request);
  },
};
