const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compile,
  contracts,
  tasks: taskContracts,
  response,
  settle,
  deferred,
  taskPacket,
  binding,
  connection,
  grant,
  list,
} = require("./agent-connections-helpers.cjs");
const resource = require("./resource-library-helpers.cjs");
const consent = compile(
  "../lib/agent-consent.ts",
  { "./agent-connections": contracts, "./task-types": taskContracts },
  { atob },
);
const CONTRACT = contracts.CONNECTION_CONTRACT;
const ORIGIN = "https://agent-hub-api-123456789.northamerica-northeast2.run.app";
const now = Math.floor(Date.now() / 1000);
const clone = (value) => structuredClone(value);
const phases = (before, after) => !before || after.some((value, index) => value !== before[index]);
function harness({
  resources = false,
  lostDecision = false,
  transport,
  decrypt,
  handoff: hasHandoff = true,
} = {}) {
  let owner = "owner_A:1",
    visible = true,
    active = true,
    phase = "unlocked",
    vaultGeneration = 1,
    configured = true,
    connectionEnabled,
    helperOpenCount = 0,
    index = 0,
    dirty = false,
    mounted = true,
    timer = 0;
  const cells = [],
    effects = [],
    requests = [],
    ownerCalls = [],
    cryptoCalls = [],
    helperCalls = [],
    timers = new Map(),
    intervals = new Map(),
    events = new Map(),
    saved = new Map();
  const selected = taskPacket();
  selected.metadata.resourceBindings = resources ? [binding()] : [];
  const privateContent = {
    name: "PRIVATE_TASK",
    goal: "PRIVATE_GOAL",
    template: resources ? "brief" : "custom",
    inputPolicy: { allowPartial: false, allowUnknownAsOf: true, maxFetchedAgeSeconds: 86400 },
    outputSpec: {
      label: "Report",
      sections: [
        { sectionId: "overview", title: "Overview", instructions: "PRIVATE_INSTRUCTIONS" },
      ],
      language: "en",
      verbosity: "standard",
    },
    deliveryExpectation: null,
  };
  let registered = false,
    approved = false,
    committed = false,
    helperLive = false;
  let authorization = {
    contractVersion: CONTRACT,
    provider: "muse",
    status: "pending",
    clientId: "muse_client",
    scopes: [
      "tasks:read",
      "runs:create",
      "runs:read",
      "results:create",
      "receipts:read",
      ...(resources ? ["watchlist:read"] : []),
    ],
    connectionId: "connection_A",
    authorizationId: "authorization_A",
    expiresAt: now + 600,
    prepared: null,
  };
  let offer, packet;
  const activeGrant = () => grant({ resourceBindings: selected.metadata.resourceBindings });
  const liveConnections = () =>
    list(
      approved
        ? [
            connection({
              approvedScopes: authorization.prepared.approvedScopes,
              grants: [activeGrant()],
            }),
          ]
        : [],
      [],
    );
  const descriptors = () => [
    {
      objectId: "task_A",
      objectType: "task",
      revision: 1,
      deliveryRevision: 2,
      priorEnvelopeFingerprint: "a".repeat(64),
      resourceRef: null,
      sourceRevision: null,
      sourceEpoch: null,
      producerSnapshotId: null,
      provenance: "task_reshare",
    },
    ...(resources
      ? [
          {
            objectId: "copy_watchlist_A",
            objectType: "watchlist_evidence",
            revision: 1,
            deliveryRevision: 1,
            priorEnvelopeFingerprint: null,
            resourceRef: binding().ref,
            sourceRevision: 1,
            sourceEpoch: 1,
            producerSnapshotId: null,
            provenance: "owner_attested_copy",
          },
        ]
      : []),
  ];
  const descriptorAcks = () =>
    descriptors().map((row, index) => ({
      ...row,
      envelopeFingerprint: (index ? "c" : "b").repeat(64),
      path: `/agent/v2/preparations/preparation_A/objects/${row.objectId}`,
    }));
  const intent = () => ({
    contractVersion: CONTRACT,
    profile: "folioview.agent-preparation.v1",
    preparationId: "preparation_A",
    objects: committed ? descriptorAcks() : descriptors(),
    taskMetadata: selected.metadata,
    connectionId: "connection_A",
    taskId: "task_A",
    grantId: "grant_A",
    grantEpoch: 1,
    registrySequence: 2,
    checkpointDigest: "d".repeat(64),
    taskDeliveryBase: { deliveryRevision: 1, envelopeFingerprint: "a".repeat(64) },
    status: committed ? "committed" : "staging",
  });
  const helperStatus = () => ({
    profile: "folioview.foreground-controller.v1",
    helperVersion: "1.2.0",
    state: helperLive ? "READY" : "LOCKED",
    sessionId: helperLive ? "session_helper" : null,
    generation: 1,
    expiresAt: helperLive ? now + 900 : null,
    foreground: true,
    authenticatedTransport: false,
    independentDeliveryConfirmed: committed,
    privateKeysPersistent: false,
  });
  const makeOffer = (anchor) => ({
    helperVersion: "1.2.0",
    sessionId: "session_helper",
    generation: 1,
    anchor,
    agentSigningPublicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    agentEncryptionPublicJwk: { kty: "EC", crv: "P-256", x: "q", y: "r" },
    agentSigningKeyId: "s".repeat(43),
    agentEncryptionKeyId: "e".repeat(43),
    keyExportRejected: true,
  });
  const helper = {
    isLive: () => helperLive,
    close: () => (helperLive = false),
    async request(op, args) {
      helperCalls.push({ op, args });
      if (op === "initialize") {
        offer = makeOffer(args.anchor);
        return clone(offer);
      }
      return helperStatus();
    },
  };
  const bridge = { isLive: () => true, close() {} };
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
      if (!cells[slot] || phases(cells[slot].deps, deps)) cells[slot] = { value, deps };
      return cells[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!cells[slot] || phases(cells[slot].deps, deps)) effects.push({ slot, effect, deps });
    },
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
    canWriteState: true,
    refreshVault: async () => {},
    openTask: decrypt ?? (async () => clone(privateContent)),
    async publicAgentAnchor(args) {
      return {
        ownerSubject: "o".repeat(43),
        vaultId: "vault_A",
        rootJwk: { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) },
        rootKeyId: "r".repeat(43),
        rootEpoch: 1,
        registrySequence: registered ? 2 : 1,
        checkpointDigest: (registered ? "d" : "a").repeat(64),
        ...args,
      };
    },
    async inspectAgentOffer({ offer: candidate }) {
      cryptoCalls.push("inspect");
      return {
        registered,
        registeredExpiresAt: registered ? now + 900 : null,
        offerFingerprint: "f".repeat(64),
        existingConnectionKeyIds: registered
          ? [candidate.agentEncryptionKeyId, candidate.agentSigningKeyId].sort()
          : [],
        agentSigningKeyEpoch: 1,
        agentEncryptionKeyEpoch: 1,
        registrySequence: registered ? 2 : 1,
        checkpointDigest: (registered ? "d" : "a").repeat(64),
      };
    },
    async prepareAgentRegistration({ offer: candidate }) {
      cryptoCalls.push("register");
      const value = {
        operationId: "registration_operation",
        expectedVersion: 1,
        registryBundle: {
          contractVersion: CONTRACT,
          checkpoint: { protected: "a", payload: "b", signature: "c" },
          entries: [],
        },
        offer: candidate,
        offerFingerprint: "f".repeat(64),
        expiresAt: now + 900,
        replacedKeyIds: [],
      };
      saved.set("registration", clone(value));
      return value;
    },
    async loadAgentRegistration() {
      return clone(saved.get("registration") ?? null);
    },
    async clearAgentRegistration() {
      saved.delete("registration");
    },
    async signAgentGrants({ authorization: auth, offer: candidate }) {
      cryptoCalls.push("sign");
      const value = {
        operationId: "approval_operation",
        authorization: clone(auth),
        offer: candidate,
        signedGrants: [{ protected: "a", payload: "b", signature: "c" }],
        writebackRecipientKeyIds: ["w".repeat(43)],
        offerFingerprint: "f".repeat(64),
      };
      saved.set("approval", clone(value));
      return value;
    },
    async loadAgentApproval() {
      return clone(saved.get("approval") ?? null);
    },
    async clearAgentApproval() {
      saved.delete("approval");
    },
    async sealAgentPreparation(args) {
      cryptoCalls.push("seal");
      packet = {
        preparationId: "preparation_A",
        connectionId: "connection_A",
        taskId: "task_A",
        registrySequence: 2,
        checkpointDigest: "d".repeat(64),
        keyEpoch: 1,
        objects: descriptors().map((row, index) => {
          const context = {
            ...row,
            binding: {
              taskId: index === 0 ? "task_A" : null,
              taskVersion: index === 0 ? 1 : null,
              resourceRef: row.resourceRef,
              sourceRevision: row.sourceRevision,
              sourceEpoch: row.sourceEpoch,
            },
          };
          return {
            objectId: row.objectId,
            operationId: `object_operation_${index}`,
            authorKeyId: "w".repeat(43),
            envelopeFingerprint: (index ? "c" : "b").repeat(64),
            envelope: {
              contractVersion: CONTRACT,
              signedObject: {
                protected: "a",
                payload: Buffer.from(
                  JSON.stringify({ context, ciphertext: "CIPHERTEXT_ONLY" }),
                ).toString("base64url"),
                signature: "c",
              },
            },
          };
        }),
        commit: {
          operationId: "commit_operation",
          body: {
            contractVersion: CONTRACT,
            objects: descriptors().map((row, index) => ({
              objectId: row.objectId,
              envelopeFingerprint: (index ? "c" : "b").repeat(64),
            })),
          },
        },
        deliveryPin: {
          preparationId: "preparation_A",
          taskVersion: 1,
          taskEnvelopeFingerprint: "a".repeat(64),
          taskDeliveryFingerprint: "b".repeat(64),
          objects: descriptors()
            .map((row, index) => ({
              objectId: row.objectId,
              envelopeFingerprint: (index ? "c" : "b").repeat(64),
            }))
            .sort((a, b) => a.objectId.localeCompare(b.objectId)),
          deliveryRevision: 2,
          priorEnvelopeFingerprint: "a".repeat(64),
          authorizationId: "authorization_A",
          grantId: "grant_A",
          grantEpoch: 1,
          executionEpoch: 1,
        },
      };
      saved.set("preparation", clone(packet));
      return clone(packet);
    },
    async loadAgentPreparation() {
      return clone(saved.get("preparation") ?? null);
    },
    async clearAgentPreparation() {
      saved.delete("preparation");
    },
    async listAgentOutbox() {
      return [...saved].map(([kind, value]) => ({
        kind,
        connectionId: "connection_A",
        taskId: "task_A",
        operationId: kind === "preparation" ? value.commit.operationId : value.operationId,
      }));
    },
  };
  const requestPrivate = async (service, route, key, options = {}) => {
    const call = { service, route, key, options: clone({ ...options, signal: undefined }) };
    requests.push(call);
    const custom = transport && (await transport(call));
    if (custom !== undefined) return custom;
    if (route === "/api/v2/tasks?limit=32")
      return response({ contractVersion: CONTRACT, items: [selected.metadata], nextCursor: null });
    if (route.startsWith("/api/v2/tasks/task_A")) return response(selected);
    if (route.endsWith("/registry")) {
      registered = true;
      return response({ contractVersion: CONTRACT, updated: true });
    }
    if (route === "/api/v2/agent-connections") return response(liveConnections());
    if (route === "/api/v2/resources/catalogue") {
      const data = resource.catalogue();
      data.groups.find((group) => group.kind === "watchlist").items[0].ref = binding().ref;
      return response(data);
    }
    if (route === "/api/v1/watchlist") return response(resource.stocks());
    if (route.endsWith("/preparation-intent")) return response(intent());
    if (route.includes("/preparation/objects/"))
      return response(descriptorAcks().find((row) => route.endsWith(`/${row.objectId}`)));
    if (route.endsWith("/preparation/commit")) {
      committed = true;
      return response({
        contractVersion: CONTRACT,
        profile: "folioview.agent-preparation.v1",
        preparationId: "preparation_A",
        status: "committed",
        objects: descriptorAcks(),
      });
    }
    throw Error("Unexpected request " + route);
  };
  const requestAgentConsent = async (_bridge, op, json, key) => {
    ownerCalls.push({ op, json: clone(json), key });
    if (op === "claim") return clone(authorization);
    if (op === "prepare_encrypted") {
      authorization = {
        ...authorization,
        prepared: {
          taskIds: ["task_A"],
          approvedScopes: json.approvedScopes.slice().sort(),
          tasks: [
            {
              taskId: "task_A",
              taskVersion: 1,
              executionEpoch: 1,
              resourceBindings: selected.metadata.resourceBindings,
              grantId: "grant_A",
              grantEpoch: 1,
              selectedResourceVersions: resources
                ? [{ ...binding(), revision: 1, producerSnapshotId: null }]
                : [],
            },
          ],
          authorizationCount: 1,
          keyEpoch: 1,
          registrySequence: 2,
          checkpointDigest: "d".repeat(64),
          authorizationExpiresAt: now + 3600,
          historyPolicy: "selected",
        },
      };
      return clone(authorization);
    }
    if (op === "decision") {
      if (json.decision === "approve") {
        approved = true;
        if (lostDecision) throw Error("lost decision acknowledgement");
      }
      return { completed: true };
    }
    throw Error("Unexpected consent operation");
  };
  const window = {
    setTimeout(cb) {
      timers.set(++timer, cb);
      return timer;
    },
    clearTimeout: (id) => timers.delete(id),
    setInterval(cb) {
      intervals.set(++timer, cb);
      return timer;
    },
    clearInterval: (id) => intervals.delete(id),
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (name, cb) => events.set(name, cb),
    removeEventListener: (name) => events.delete(name),
  };
  const { useAgentConsent } = compile(
    "../components/useAgentConsent.ts",
    {
      react,
      "./AuthProvider": {
        useAuth: () => ({
          status: owner ? "authenticated" : "anonymous",
          profile: owner ? { uid: owner } : null,
          sessionKey: owner,
          agentHubConfigured: configured,
          requestPrivate,
          requestAgentConsent,
        }),
      },
      "@/lib/agent-connections": contracts,
      "@/lib/agent-consent": consent,
      "@/lib/task-types": taskContracts,
      "@/lib/resource-library": resource.contracts,
      "@/lib/owner-consent-bridge": { connectOwnerConsentBridge: async () => bridge },
      "@/lib/helper-owner-bridge": {
        HELPER_VERSION: "1.2.0",
        HELPER_WORKER_SHA256: "9".repeat(64),
        openHelperOwnerBridge: async () => {
          helperOpenCount++;
          helperLive = true;
          return helper;
        },
      },
    },
    { window, document, crypto: require("node:crypto").webcrypto },
  );
  const configuration = { schemaVersion: 1, enabled: true, hubOrigin: ORIGIN };
  const handoff = hasHandoff ? { requestId: "request_A", nonce: "n".repeat(43) } : null;
  const render = ({ flush = true } = {}) => {
    let output;
    do {
      index = 0;
      dirty = false;
      output = useAgentConsent(workspace, configuration, handoff, active, connectionEnabled);
      if (flush)
        for (const entry of effects.splice(0)) {
          cells[entry.slot]?.cleanup?.();
          cells[entry.slot] = { deps: entry.deps, cleanup: entry.effect() };
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
    requests,
    ownerCalls,
    cryptoCalls,
    helperCalls,
    intervals,
    timers,
    saved,
    descriptorAcks,
    packet: () => packet,
    helper: () => helperLive,
    helperOpenings: () => helperOpenCount,
    connectionGate: (value) => (connectionEnabled = value),
    owner: (value) => (owner = value),
    active: (value) => (active = value),
    capability: (value) => (configured = value),
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
    async throughKeys({ paired = false } = {}) {
      let m = await this.ready();
      await m.claim();
      m = await drain();
      await m.selectTask("task_A");
      m = await drain();
      if (paired) await m.pairHelper();
      else {
        await m.createManualCard();
        m = await drain();
        offer = makeOffer(m.setupCard.anchor);
        await m.importOffer(JSON.stringify(offer));
      }
      m = await drain();
      m.confirmKeys(true, false);
      m = render();
      await m.registerKeys();
      return drain();
    },
    async throughGrant(options) {
      let m = await this.throughKeys(options);
      await m.prepareGrant();
      m = await drain();
      m.confirmGrant(true);
      return render();
    },
    unmount() {
      mounted = false;
      cells.forEach((cell) => cell.cleanup?.());
    },
  };
}

test("the complete one-task flow registers keys before freezing grant scope and posts encrypted packets only", async () => {
  const h = harness();
  let m = await h.throughGrant();
  assert.equal(m.stage, "grant");
  assert.equal(h.ownerCalls.filter((call) => call.op === "decision").length, 0);
  await m.approve();
  m = await h.drain();
  assert.equal(m.stage, "approved");
  await m.publish();
  m = await h.drain();
  assert.equal(m.stage, "published");
  assert.equal(m.helperConfirmed, false);
  assert.ok(m.published);
  assert.ok(h.saved.has("approval"));
  assert.ok(h.saved.has("preparation"));
  assert.ok(h.requests.findIndex((call) => call.route.endsWith("/registry")) >= 0);
  assert.equal(h.requests.filter((call) => call.route.includes("resources/catalogue")).length, 0);
  assert.doesNotMatch(JSON.stringify(h.requests), /PRIVATE_GOAL|PRIVATE_INSTRUCTIONS/);
  const write = h.requests.find((call) => call.route.includes("/preparation/objects/"));
  assert.equal(write.options.headers["Idempotency-Key"], "object_operation_0");
  h.unmount();
});
test("a lost decision acknowledgement is never resubmitted or resigned; original approval recovery uses owner reads", async () => {
  const h = harness({ lostDecision: true });
  let m = await h.throughGrant();
  await m.approve();
  m = await h.drain();
  assert.equal(m.decisionSent, true);
  assert.equal(m.error, "outcome_unknown");
  assert.ok(h.saved.has("approval"));
  await m.approve();
  m = await h.drain();
  assert.equal(h.ownerCalls.filter((call) => call.op === "decision").length, 1);
  assert.equal(h.cryptoCalls.filter((call) => call === "sign").length, 1);
  const entry = m.outbox.find((row) => row.kind === "approval");
  await m.recover(entry);
  m = await h.drain();
  assert.equal(m.stage, "approved");
  assert.equal(h.ownerCalls.filter((call) => call.op === "decision").length, 1);
  h.unmount();
});
test("paired helper confirmation clears exact persisted operations and receives public pins without an owner credential", async () => {
  const h = harness();
  let m = await h.throughGrant({ paired: true });
  await m.approve();
  m = await h.drain();
  await m.publish();
  m = await h.drain();
  assert.equal(m.helperConfirmed, true);
  assert.equal(h.saved.has("approval"), false);
  assert.equal(h.saved.has("preparation"), false);
  const confirm = h.helperCalls.find((call) => call.op === "confirm_delivery");
  assert.ok(confirm);
  assert.deepEqual(Object.keys(confirm.args.pin.objects[0]).sort(), [
    "envelopeFingerprint",
    "objectId",
  ]);
  assert.doesNotMatch(
    JSON.stringify(h.helperCalls),
    /"authorization":|Bearer|PRIVATE_GOAL|PRIVATE_INSTRUCTIONS/,
  );
  h.unmount();
});
test("helper metadata heartbeat continues while hidden, while lock ends the helper and masks private state", async () => {
  const h = harness();
  let m = await h.throughKeys({ paired: true });
  const before = h.ownerCalls.length;
  h.visibility(false);
  m = h.render();
  assert.equal(m.content, null);
  for (const beat of h.intervals.values()) beat();
  await h.drain();
  assert.ok(h.helperCalls.some((call) => call.op === "status"));
  assert.equal(h.ownerCalls.length, before);
  assert.equal(h.helper(), true);
  h.lock();
  m = h.render();
  assert.equal(m.content, null);
  assert.equal(h.helper(), false);
  h.unmount();
});
test("a changed manual source revision aborts before resource sealing or publication", async () => {
  let reads = 0;
  const h = harness({
    resources: true,
    transport: ({ route }) => {
      if (route === "/api/v2/resources/catalogue") {
        const data = resource.catalogue();
        if (++reads > 1)
          data.groups.find((group) => group.kind === "watchlist").items[0].revision = 2;
        return response(data);
      }
    },
  });
  let m = await h.throughGrant();
  await m.approve();
  m = await h.drain();
  await m.publish();
  m = await h.drain();
  assert.equal(m.error, "source_unavailable");
  assert.equal(h.cryptoCalls.includes("seal"), false);
  assert.equal(h.requests.filter((call) => call.route.includes("/preparation/objects/")).length, 0);
  assert.ok(h.saved.has("approval"));
  h.unmount();
});
test("wrong-object stage acknowledgements cannot advance publication or clear the sealed original packet", async () => {
  const h = harness({
    resources: true,
    transport: ({ route }) =>
      route.endsWith("/preparation/objects/task_A") ? response(h.descriptorAcks()[1]) : undefined,
  });
  let m = await h.throughGrant();
  await m.approve();
  m = await h.drain();
  await m.publish();
  m = await h.drain();
  assert.equal(m.error, "invalid_response");
  assert.ok(h.saved.has("preparation"));
  assert.equal(h.requests.filter((call) => call.route.endsWith("/preparation/commit")).length, 0);
  assert.equal(m.helperConfirmed, false);
  h.unmount();
});
test("account switches and late private decryption cannot restore old-owner consent content", async () => {
  const clear = deferred();
  const h = harness({ decrypt: () => clear.promise });
  let m = await h.ready();
  await m.claim();
  m = await h.drain();
  const opening = m.selectTask("task_A");
  await settle();
  h.owner("owner_B:2");
  m = h.render({ flush: false });
  assert.equal(m.content, null);
  assert.equal(m.authorization, null);
  h.render();
  clear.resolve({ name: "OLD_PRIVATE", goal: "OLD_GOAL" });
  await opening;
  m = await h.drain();
  assert.equal(m.content, null);
  assert.equal(m.owner, "owner_B:2");
  h.unmount();
});

test("rollout revalidation preserves an existing paired consent draft and pauses new steps", async () => {
  const h = harness();
  let m = await h.throughGrant({ paired: true });
  assert.equal(m.stage, "grant");
  assert.equal(m.grantConfirmed, true);
  assert.equal(h.helper(), true);
  const draft = clone({
    authorization: m.authorization,
    selected: m.selected,
    signedGrant: m.signedGrant,
  });
  const counts = [h.ownerCalls.length, h.requests.length, h.cryptoCalls.length, h.helperOpenings()];
  h.connectionGate(false);
  m = h.render();
  assert.equal(m.canWrite, false);
  assert.equal(m.grantConfirmed, true);
  assert.equal(m.stage, "grant");
  assert.deepEqual(
    clone({ authorization: m.authorization, selected: m.selected, signedGrant: m.signedGrant }),
    draft,
  );
  assert.equal(h.helper(), true);
  await m.claim();
  await m.prepareGrant();
  await m.approve();
  await m.pairHelper();
  m = await h.drain();
  assert.deepEqual(
    [h.ownerCalls.length, h.requests.length, h.cryptoCalls.length, h.helperOpenings()],
    counts,
  );
  assert.equal(h.helper(), true);
  h.connectionGate(true);
  m = h.render();
  assert.equal(m.canWrite, true);
  assert.equal(m.grantConfirmed, true);
  await m.approve();
  m = await h.drain();
  assert.equal(m.stage, "approved");
  assert.equal(h.ownerCalls.filter((call) => call.op === "decision").length, 1);
  h.owner("owner_B:2");
  m = h.render({ flush: false });
  assert.equal(m.authorization, null);
  assert.equal(m.selected, null);
  assert.equal(m.signedGrant, null);
  m = await h.drain();
  assert.equal(m.owner, "owner_B:2");
  assert.equal(h.helper(), false);
  h.unmount();
});

test("rollout revalidation retains original pending approval and resumes without another signature or write", async () => {
  const h = harness({ lostDecision: true });
  let m = await h.throughGrant();
  await m.approve();
  m = await h.drain();
  assert.equal(m.error, "outcome_unknown");
  const original = clone(h.saved.get("approval"));
  const pending = m.outbox.find((row) => row.kind === "approval");
  assert.ok(pending);
  h.connectionGate(false);
  m = h.render();
  assert.equal(m.decisionSent, true);
  assert.equal(m.error, "outcome_unknown");
  assert.ok(m.outbox.some((row) => row.kind === "approval"));
  await m.recover(pending);
  await m.discardPending(pending);
  m = await h.drain();
  assert.deepEqual(clone(h.saved.get("approval")), original);
  assert.equal(h.ownerCalls.filter((call) => call.op === "decision").length, 1);
  assert.equal(h.cryptoCalls.filter((call) => call === "sign").length, 1);
  h.connectionGate(true);
  m = h.render();
  await m.recover(pending);
  m = await h.drain();
  assert.equal(m.stage, "approved");
  assert.equal(h.ownerCalls.filter((call) => call.op === "decision").length, 1);
  assert.equal(h.cryptoCalls.filter((call) => call === "sign").length, 1);
  assert.deepEqual(clone(h.saved.get("approval")), original);
  h.unmount();
});
