// Runs the actual browser auth boundary, Next route exports and owner proxies together.
// React/Firebase observation and upstream network replies are synthetic. This is not
// Cloud Run IAM or a backend database/authorization implementation.
const assert = require("node:assert/strict");
const {
  compile,
  contracts: resources,
  settle,
  deferred,
} = require("./resource-library-helpers.cjs");
const { contracts: connections } = require("./agent-connections-helpers.cjs");

const SITE = "https://workspace.synthetic.test";
const HUB = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const PORTFOLIO = "https://portfolio-api-123456789.northamerica-northeast2.run.app";
const USER = "https://user.synthetic.test";
const CONFIG = "https://config.synthetic.test";
const MARKET = "https://market.synthetic.test";
const CONTRACT = "folioview.agent-workspace.v2.0";
const JWKS =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const METADATA =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const NOW = Date.parse("2026-10-30T12:00:00Z");
const ENV = {
  FOLIOVIEW_OWNER_FIREBASE_PROJECT_ID: "synthetic-project",
  FOLIOVIEW_PORTFOLIO_OWNER_ENABLED: "true",
  FOLIOVIEW_PORTFOLIO_ORIGIN: PORTFOLIO,
  FOLIOVIEW_PORTFOLIO_AUDIENCE: PORTFOLIO,
  FOLIOVIEW_HUB_OWNER_ENABLED: "true",
  FOLIOVIEW_HUB_ORIGIN: HUB,
};

const response = (value, status = 200, headers = {}) => Response.json(value, { status, headers });
const failure = (code, status = 409) =>
  response(
    {
      contractVersion: CONTRACT,
      error: { code, retryable: status === 503, requestId: "synthetic_request" },
    },
    status,
  );

async function stack(options = {}) {
  const jose = await import("jose");
  const pair = await jose.generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
  const key = {
    ...(await jose.exportJWK(pair.publicKey)),
    kid: "synthetic-sign-in-key",
    alg: "RS256",
    use: "sig",
  };
  const tokens = new Map(),
    mounted = [],
    network = [],
    browser = [],
    logs = [];
  const env = { ...ENV, ...options.env };
  const consoleSpy = Object.fromEntries(
    ["log", "warn", "error", "info", "debug"].map((name) => [
      name,
      (...args) => logs.push(args.map(String).join(" ")),
    ]),
  );
  const globals = {
    process: { env: {} },
    fetch,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    AbortSignal,
    AbortController,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
    console: consoleSpy,
  };
  const server = (name, imports) => compile("../lib/server/" + name + ".ts", imports, globals);
  const transport = server("owner-transport", {
    "server-only": {},
    "node:crypto": require("node:crypto"),
    jose,
  });
  const contracts = server("hub-owner-contracts", {
    "server-only": {},
    "ajv/dist/2020": require("ajv/dist/2020"),
    "ajv-formats": require("ajv-formats"),
    "../encrypted-schemas.json": require("../lib/encrypted-schemas.json"),
    "./owner-transport": transport,
  });
  const hub = server("hub-owner", {
    "server-only": {},
    "./owner-transport": transport,
    "./hub-owner-contracts": contracts,
  });
  const portfolio = server("portfolio-owner", {
    "server-only": {},
    jose,
    "./owner-transport": transport,
  });
  const capabilities = server("owner-config", {
    "server-only": {},
    "./hub-owner": hub,
    "./portfolio-owner": portfolio,
  });
  const serviceToken = await new jose.SignJWT({
    iss: "https://accounts.google.com",
    aud: PORTFOLIO,
    sub: "synthetic_workload",
    iat: NOW / 1000,
    exp: NOW / 1000 + 3600,
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(pair.privateKey);
  let upstream = options.upstream,
    metadataStatus = 200;
  const send = async (input, init = {}) => {
    const url = String(input);
    network.push({ url, init });
    if (url === JWKS) return response({ keys: [key] });
    if (url.startsWith(METADATA + "?")) {
      const query = new URL(url).searchParams;
      assert.equal(query.get("audience"), PORTFOLIO);
      assert.equal(query.get("format"), "full");
      assert.equal(new Headers(init.headers).get("metadata-flavor"), "Google");
      return new Response(metadataStatus === 200 ? serviceToken : "SYNTHETIC_METADATA_PRIVATE", {
        status: metadataStatus,
        headers: { "Metadata-Flavor": "Google" },
      });
    }
    assert.ok(url.startsWith(HUB + "/api/v2/") || url.startsWith(PORTFOLIO + "/api/v2/"), url);
    assert.ok(upstream, "Every producer reply must be explicitly selected by the test");
    return upstream(url, init);
  };
  const proxyOptions = { env, fetch: send, now: () => NOW, deadlineMs: 2000 };
  const hubRoute = compile(
    "../app/api/private/agent-hub/[...path]/route.ts",
    { "@/lib/server/hub-owner": { hubProxy: hub.createHubProxy(proxyOptions) } },
    globals,
  );
  const portfolioRoute = compile(
    "../app/api/private/portfolio/[...path]/route.ts",
    {
      "@/lib/server/portfolio-owner": {
        portfolioProxy: portfolio.createPortfolioProxy(proxyOptions),
      },
    },
    globals,
  );
  const configRoute = compile(
    "../app/api/private/owner-config/route.ts",
    {
      "@/lib/server/owner-config": { ownerCapabilities: () => capabilities.ownerCapabilities(env) },
    },
    globals,
  );
  const bridge = compile(
    "../lib/owner-consent-bridge.ts",
    { "./agent-connections": connections },
    globals,
  );

  async function token(uid) {
    if (!tokens.has(uid))
      tokens.set(
        uid,
        await new jose.SignJWT({
          iss: "https://securetoken.google.com/synthetic-project",
          aud: "synthetic-project",
          sub: uid,
          iat: NOW / 1000 - 10,
          auth_time: NOW / 1000 - 20,
          exp: NOW / 1000 + 3600,
          firebase: { sign_in_provider: "google.com" },
        })
          .setProtectedHeader({ alg: "RS256", kid: key.kid })
          .sign(pair.privateKey),
      );
    return tokens.get(uid);
  }
  const subject = (init) =>
    jose.decodeJwt(new Headers(init.headers).get("authorization").slice(7)).sub;
  const browserFetch = async (input, init = {}) => {
    const value = String(input),
      url = new URL(value, SITE);
    browser.push({ url: value, init });
    if (url.origin === SITE && url.pathname === "/api/private/owner-config")
      return configRoute.GET();
    if (url.origin === SITE && url.pathname.startsWith("/api/private/")) {
      const routes = url.pathname.startsWith("/api/private/portfolio/") ? portfolioRoute : hubRoute;
      assert.equal(typeof routes[init.method || "GET"], "function");
      const headers = new Headers(init.headers);
      if (!["GET", "HEAD"].includes(init.method || "GET")) headers.set("Origin", SITE); // The browser adds its own origin to a same-origin write.
      return routes[init.method || "GET"](
        new Request(url, { ...init, headers, ...(init.body ? { duplex: "half" } : {}) }),
      );
    }
    if (url.origin === USER && url.pathname === "/api/v1/me")
      return response({ uid: subject(init), email: null, displayName: null, photoURL: null });
    if (url.origin === USER && url.pathname === "/api/v1/watchlist")
      return response({ items: [], limit: 50 });
    if (url.origin === CONFIG && url.pathname === "/api/v1/preferences")
      return response({ marker: "synthetic_config_reply" });
    assert.fail("Unexpected browser target " + value);
  };

  function mount() {
    let observer,
      index = 0,
      dirty = false;
    const cells = [],
      effects = [];
    const auth = { currentUser: null };
    const changed = (before, after) =>
      !before || after.some((value, i) => !Object.is(value, before[i]));
    const react = {
      createContext: () => ({ Provider: "provider" }),
      useState(initial) {
        const slot = index++;
        cells[slot] ??= { state: typeof initial === "function" ? initial() : initial };
        return [
          cells[slot].state,
          (next) => {
            const value = typeof next === "function" ? next(cells[slot].state) : next;
            dirty ||= !Object.is(cells[slot].state, value);
            cells[slot].state = value;
          },
        ];
      },
      useRef(current) {
        const slot = index++;
        cells[slot] ??= { current };
        return cells[slot];
      },
      useMemo(callback, deps) {
        const slot = index++;
        if (!cells[slot] || changed(cells[slot].deps, deps))
          cells[slot] = { value: callback(), deps };
        return cells[slot].value;
      },
      useCallback(callback, deps) {
        const slot = index++;
        if (!cells[slot] || changed(cells[slot].deps, deps))
          cells[slot] = { value: callback, deps };
        return cells[slot].value;
      },
      useEffect(effect, deps) {
        const slot = index++;
        if (!cells[slot] || changed(cells[slot].deps, deps)) effects.push({ slot, effect, deps });
      },
    };
    const module = compile(
      "../components/AuthProvider.tsx",
      {
        react,
        "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
        "firebase/auth": {
          onIdTokenChanged: (_, next) => {
            observer = next;
            return () => {};
          },
          signOut: async () => {
            auth.currentUser = null;
          },
          signInWithPopup: async () => {},
          GoogleAuthProvider: class {
            setCustomParameters() {}
          },
        },
        "@/lib/firebase-client": { getBrowserAuth: () => auth },
        "@/lib/resource-library": resources,
        "@/lib/agent-link": {
          loadAgentLinkConfiguration: async () => ({
            schemaVersion: 1,
            enabled: true,
            hubOrigin: HUB,
          }),
        },
        "@/lib/owner-consent-bridge": bridge,
      },
      {
        ...globals,
        process: {
          env: {
            NODE_ENV: "production",
            NEXT_PUBLIC_API_BASE_URL: MARKET,
            NEXT_PUBLIC_USER_API_BASE_URL: USER,
            NEXT_PUBLIC_CONFIG_API_BASE_URL: CONFIG,
          },
        },
        fetch: browserFetch,
        window: {
          location: { hostname: "workspace.synthetic.test" },
          setTimeout: () => 1,
          clearTimeout() {},
        },
      },
    );
    const render = () => {
      let tree;
      do {
        dirty = false;
        index = 0;
        tree = module.AuthProvider({ children: null });
        for (const { slot, effect, deps } of effects.splice(0)) {
          cells[slot]?.cleanup?.();
          cells[slot] = { deps, cleanup: effect() };
        }
      } while (dirty);
      return tree.props.value;
    };
    render();
    const mountedProvider = {
      get value() {
        return render();
      },
      auth,
      async login(uid, getToken) {
        if (!getToken) await token(uid);
        const account = { uid, getIdToken: getToken || (() => token(uid)) };
        auth.currentUser = account;
        observer(account);
        await settle();
        return render();
      },
      close() {
        cells.forEach((row) => row?.cleanup?.());
      },
    };
    mounted.push(mountedProvider);
    return mountedProvider;
  }
  return {
    mount,
    env,
    network,
    browser,
    logs,
    serviceToken,
    token,
    subject,
    setUpstream: (value) => {
      upstream = value;
    },
    metadataStatus: (status) => {
      metadataStatus = status;
    },
    producerCalls: () =>
      network.filter((row) => row.url.startsWith(HUB) || row.url.startsWith(PORTFOLIO)),
    close() {
      mounted.splice(0).forEach((provider) => provider.close());
    },
  };
}

module.exports = {
  stack,
  response,
  failure,
  settle,
  deferred,
  SITE,
  HUB,
  PORTFOLIO,
  USER,
  CONFIG,
  MARKET,
  CONTRACT,
};
