const { compile, response, settle, deferred } = require("./resource-library-helpers.cjs");
const tasks = compile("../lib/task-types.ts");
const contracts = compile("../lib/agent-connections.ts", { "./task-types": tasks });
const CONTRACT = contracts.CONNECTION_CONTRACT;
const now = 1793368800;
const binding = (kind = "watchlist") => ({
  ref: {
    kind,
    sourceService: kind === "holdings" ? "portfolio" : "user",
    resourceId: `${kind}_A`,
    incarnation: "incarnation_A",
  },
  sourceEpoch: 1,
});
const grant = (patch = {}) => ({
  taskId: "task_A",
  taskVersion: 1,
  executionEpoch: 1,
  resourceBindings: [binding()],
  grantId: "grant_A",
  grantEpoch: 1,
  status: "active",
  authorizedAt: now,
  readObserved: false,
  resultSaved: false,
  signedGrantPresent: true,
  ...patch,
});
const connection = (patch = {}) => ({
  connectionId: "connection_A",
  provider: "muse",
  clientId: "muse_client",
  authorizationId: "authorization_A",
  status: "active",
  authorizedAt: now,
  expiresAt: now + 3600,
  approvedScopes: ["tasks:read", "runs:read", "watchlist:read", "results:create"],
  grants: [grant()],
  ...patch,
});
const attempt = (patch = {}) => ({
  requestId: "request_A",
  clientId: "muse_client",
  connectionId: "connection_A",
  authorizationId: "authorization_A",
  status: "authorized",
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 3600,
  ...patch,
});
const list = (items = [connection()], authorizationAttempts = [attempt()]) => ({
  contractVersion: CONTRACT,
  items,
  authorizationAttempts,
});
function taskPacket(taskId = "task_A", version = 1) {
  return {
    contractVersion: CONTRACT,
    metadata: {
      contractVersion: CONTRACT,
      vaultId: "vault_A",
      taskId,
      taskVersion: version,
      executionEpoch: 1,
      status: "active",
      resourceBindings: [binding()],
      objectRevision: version,
      deliveryRevision: 1,
      envelopeFingerprint: "a".repeat(64),
      keyEpoch: 1,
      createdAt: "2026-10-30T10:00:00Z",
      updatedAt: "2026-10-30T10:00:00Z",
    },
    signedObject: { protected: "header", payload: "payload", signature: "signature" },
    keyProofs: {
      checkpoint: { protected: "header", payload: "payload", signature: "signature" },
      certificates: [],
    },
  };
}
function harness({ transport, openTask, active = true, configured = true } = {}) {
  let owner = "owner_A:1",
    visible = true,
    phase = "unlocked",
    vaultGeneration = 1,
    index = 0,
    dirty = false,
    mounted = true,
    timer = 0;
  const cells = [],
    effects = [],
    calls = [],
    events = new Map(),
    timers = new Map();
  let items = [
    connection(),
    connection({
      connectionId: "connection_B",
      authorizationId: "authorization_B",
      grants: [grant({ grantId: "grant_B" })],
    }),
  ];
  const changed = (before, after) =>
    !before || after.some((value, place) => value !== before[place]);
  const react = {
    useState(initial) {
      const slot = index++;
      cells[slot] ??= { state: typeof initial === "function" ? initial() : initial };
      return [
        cells[slot].state,
        (next) => {
          if (!mounted) return;
          const value = typeof next === "function" ? next(cells[slot].state) : next;
          dirty ||= value !== cells[slot].state;
          cells[slot].state = value;
        },
      ];
    },
    useRef(value) {
      const slot = index++;
      cells[slot] ??= { current: value };
      return cells[slot];
    },
    useCallback(value, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) cells[slot] = { value, deps };
      return cells[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || changed(cells[slot].deps, deps)) effects.push({ slot, effect, deps });
    },
  };
  const requestPrivate = async (service, route, key, options) => {
    const call = { service, route, key, options };
    calls.push(call);
    const custom = transport && (await transport(call));
    if (custom !== undefined) return custom;
    if (route === "/api/v2/agent-connections") return response(list(items));
    if (route.includes("/revoke")) {
      const conn = items.find((item) => route.includes(`/${item.connectionId}/`));
      const id = /\/grants\/([^/]+)/.exec(route)?.[1];
      if (id) conn.grants.find((g) => g.grantId === id).status = "revoked";
      else {
        conn.status = "revoked";
        conn.grants.forEach((g) => (g.status = "revoked"));
      }
      return response({ contractVersion: CONTRACT, connection: conn });
    }
    if (route.startsWith("/api/v2/tasks/")) return response(taskPacket());
    throw new Error("Unexpected route " + route);
  };
  const workspace = {
    get owner() {
      return owner;
    },
    get phase() {
      return phase;
    },
    get vaultGeneration() {
      return vaultGeneration;
    },
    get authenticated() {
      return Boolean(owner);
    },
    refreshVault: async () => {},
    openTask:
      openTask ??
      (async () => ({
        name: "PRIVATE_TASK_A",
        goal: "PRIVATE_GOAL_A",
        template: "brief",
        inputPolicy: { allowPartial: false, allowUnknownAsOf: false, maxFetchedAgeSeconds: 86400 },
        outputSpec: {
          label: "Report",
          sections: [
            { sectionId: "overview", title: "Overview", instructions: "Private instructions" },
          ],
          language: "en",
          verbosity: "standard",
        },
        deliveryExpectation: null,
      })),
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (name, cb) => events.set(name, cb),
    removeEventListener: (name) => events.delete(name),
  };
  const window = {
    setTimeout(cb) {
      timers.set(++timer, cb);
      return timer;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const { useAgentConnections } = compile(
    "../components/useAgentConnections.ts",
    {
      react,
      "./AuthProvider": {
        useAuth: () => ({
          status: owner ? "authenticated" : "anonymous",
          profile: owner ? { uid: owner } : null,
          sessionKey: owner,
          agentHubConfigured: configured,
          requestPrivate,
        }),
      },
      "@/lib/task-types": tasks,
      "@/lib/agent-connections": contracts,
    },
    { document, window },
  );
  const render = ({ flush = true } = {}) => {
    let output;
    do {
      index = 0;
      dirty = false;
      output = useAgentConnections(workspace, { active });
      if (flush)
        for (const e of effects.splice(0)) {
          cells[e.slot]?.cleanup?.();
          cells[e.slot] = { deps: e.deps, cleanup: e.effect() };
        }
    } while (flush && dirty);
    return output;
  };
  const drain = async () => {
    for (let i = 0; i < 5; i++) {
      await settle();
      render();
    }
    return render();
  };
  return {
    render,
    drain,
    calls,
    timers,
    workspace,
    items,
    owner: (value) => (owner = value),
    capability: (value) => (configured = value),
    active: (value) => (active = value),
    lock() {
      phase = "locked";
      vaultGeneration++;
    },
    visibility(value) {
      visible = value;
      events.get("visibilitychange")?.();
    },
    async ready() {
      render();
      return drain();
    },
    unmount() {
      mounted = false;
      cells.forEach((cell) => cell.cleanup?.());
    },
  };
}
module.exports = {
  compile,
  tasks,
  contracts,
  CONTRACT,
  now,
  binding,
  grant,
  connection,
  attempt,
  list,
  taskPacket,
  response,
  settle,
  deferred,
  harness,
};
