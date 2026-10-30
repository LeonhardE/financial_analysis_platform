const assert = require("node:assert/strict");
const test = require("node:test");
const {
  compile,
  contracts,
  catalogue,
  channels,
  stocks,
  response,
  settle,
  deferred,
} = require("./resource-library-helpers.cjs");
function harness({ transport, active = true, configured = true } = {}) {
  let owner = "owner_A:1",
    visible = true,
    index = 0,
    dirty = false,
    mounted = true,
    timer = 0;
  const cells = [],
    effects = [],
    calls = [],
    events = new Map(),
    timers = new Map();
  const changed = (before, after) =>
    !before || after.some((value, place) => value !== before[place]);
  const react = {
    useState(value) {
      const slot = index++;
      cells[slot] ??= { state: typeof value === "function" ? value() : value };
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
    if (route === "/api/v2/resources/catalogue") return response(catalogue());
    if (route === "/api/v1/watchlist") return response(stocks());
    if (route === "/api/v1/channel-follows")
      return response(
        channels(
          key.startsWith("owner_A") ? "CREATOR_A" : "CREATOR_B",
          options.method === "PUT" ? options.json.expectedRevision + 1 : 1,
        ),
      );
    throw Error("Unexpected route");
  };
  const document = {
    get visibilityState() {
      return visible ? "visible" : "hidden";
    },
    addEventListener: (event, callback) => events.set(event, callback),
    removeEventListener: (event) => events.delete(event),
  };
  const window = {
    setTimeout(callback) {
      timers.set(++timer, callback);
      return timer;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const { useResourceLibrary } = compile(
    "../components/useResourceLibrary.ts",
    {
      react,
      "@/components/AuthProvider": {
        useAuth: () => ({
          status: owner ? "authenticated" : "anonymous",
          profile: owner ? { uid: owner } : null,
          sessionKey: owner,
          agentHubConfigured: configured,
          requestPrivate,
        }),
      },
      "@/lib/resource-library": contracts,
    },
    { document, window },
  );
  const render = ({ flush = true } = {}) => {
    let result;
    do {
      index = 0;
      dirty = false;
      result = useResourceLibrary({ active });
      if (flush)
        for (const entry of effects.splice(0)) {
          cells[entry.slot]?.cleanup?.();
          cells[entry.slot] = { deps: entry.deps, cleanup: entry.effect() };
        }
    } while (flush && dirty);
    return result;
  };
  return {
    render,
    calls,
    timers,
    owner: (next) => (owner = next),
    capability: (next) => (configured = next),
    active: (next) => (active = next),
    visibility(next) {
      visible = next;
      events.get("visibilitychange")?.();
    },
    async ready() {
      render();
      await settle();
      return render();
    },
    unmount() {
      mounted = false;
      cells.forEach((cell) => cell.cleanup?.());
    },
  };
}

test("catalogue failure does not erase existing User lists or pretend they are empty", async () => {
  const h = harness({
    transport: ({ route }) => (route.includes("catalogue") ? response({}, 503) : undefined),
  });
  const view = await h.ready();
  assert.equal(view.catalogue.error, "unavailable");
  assert.equal(view.catalogue.data, null);
  assert.equal(view.watchlist.data.items[0].symbol, "SYNTH");
  assert.equal(view.follows.data.items[0].name, "CREATOR_A");
  h.unmount();
});

test("User resource lists work without Portfolio or Hub and refresh when returning from Market", async () => {
  const h = harness({ configured: false });
  const view = await h.ready();
  assert.equal(view.catalogue.data, null);
  assert.equal(view.watchlist.data.items.length, 1);
  assert.ok(h.calls.every((call) => call.service === "user"));
  const count = h.calls.length;
  h.active(false);
  h.render();
  await settle();
  assert.equal(h.calls.length, count);
  h.active(true);
  await h.ready();
  assert.equal(h.calls.length, count + 2);
  h.unmount();
});

test("account switch masks rows during render and stale body, write and task callbacks cannot cross sessions", async () => {
  let block = false;
  const late = deferred();
  const h = harness({
    transport: ({ route, key }) =>
      block && key === "owner_A:1" && route.endsWith("watchlist") ? late.promise : undefined,
  });
  const before = await h.ready();
  const oldTask = before.useForTask;
  const oldSave = before.saveFollows;
  const oldItem = before.catalogue.data.groups[1].items[0];
  block = true;
  const load = before.reload("watchlist");
  await settle();
  h.owner("owner_B:1");
  const masked = h.render({ flush: false });
  assert.equal(masked.follows.data, null);
  assert.equal(masked.watchlist.data, null);
  let selected = 0;
  oldTask(oldItem, () => selected++);
  assert.equal(selected, 0);
  assert.equal(await oldSave([]), false);
  h.render();
  late.resolve(response(stocks("OLD")));
  await load;
  await settle();
  const after = h.render();
  assert.equal(after.follows.data.items[0].name, "CREATOR_B");
  assert.equal(after.watchlist.data.items[0].symbol, "SYNTH");
  h.owner(null);
  const logout = h.render({ flush: false });
  assert.equal(logout.follows.data, null);
  assert.equal(logout.catalogue.data, null);
  h.unmount();
});

test("follows replace uses current revision, normalizes locators and refreshes discovery only after success", async () => {
  const h = harness();
  const before = await h.ready();
  assert.equal(
    await before.saveFollows([{ name: "New", handleOrUrl: "@MiXeD", note: "note" }]),
    true,
  );
  const write = h.calls.find((call) => call.options.method === "PUT");
  assert.equal(write.key, "owner_A:1");
  assert.equal(write.options.json.expectedRevision, 1);
  assert.equal(write.options.json.items[0].handleOrUrl, "https://www.youtube.com/@mixed");
  await settle();
  const after = h.render();
  assert.equal(after.follows.data.revision, 2);
  assert.equal(h.calls.filter((call) => call.route.includes("catalogue")).length, 2);
  h.unmount();
});

test("CAS conflict and uncertain write forbid repeat writes until explicit successful reload", async () => {
  for (const mode of ["conflict", "malformed", "unavailable"]) {
    const h = harness({
      transport: ({ options }) =>
        options.method === "PUT"
          ? mode === "conflict"
            ? response({}, 409)
            : mode === "malformed"
              ? response({ invalid: true })
              : Promise.reject(Error("offline"))
          : undefined,
    });
    const before = await h.ready();
    assert.equal(await before.saveFollows([]), false);
    const after = h.render();
    assert.equal(after.follows.stale, true);
    assert.equal(after.follows.data.items[0].name, "CREATOR_A");
    assert.equal(await after.saveFollows([]), false);
    assert.equal(h.calls.filter((call) => call.options.method === "PUT").length, 1);
    await after.reload("follows");
    assert.equal(h.render().follows.stale, false);
    h.unmount();
  }
});

test("body read is fenced after account change and bounds streamed bytes rather than Content-Length", async () => {
  let controller;
  const readStarted = deferred();
  const h = harness({
    transport: ({ route, key }) =>
      route.endsWith("channel-follows") && key === "owner_A:1"
        ? new Response(
            new ReadableStream({
              start(value) {
                controller = value;
                readStarted.resolve();
              },
            }),
            { headers: { "Content-Type": "application/json", "Content-Length": "1" } },
          )
        : undefined,
  });
  h.render();
  await readStarted.promise;
  h.owner("owner_B:1");
  h.render({ flush: false });
  controller.enqueue(new TextEncoder().encode(JSON.stringify(channels("OLD_CREATOR"))));
  controller.close();
  h.render();
  await settle();
  assert.equal(h.render().follows.data.items[0].name, "CREATOR_B");
  h.unmount();
  const huge = harness({
    transport: ({ route }) =>
      route.endsWith("watchlist")
        ? new Response(" ".repeat(131073), {
            headers: { "Content-Type": "application/json", "Content-Length": "1" },
          })
        : undefined,
  });
  const failed = await huge.ready();
  assert.equal(failed.watchlist.error, "invalid_response");
  assert.equal(failed.watchlist.data, null);
  huge.unmount();
});

test("capability disable immediately masks catalogue and rejects stale task selection; User lists remain available", async () => {
  const h = harness();
  const before = await h.ready();
  let selected;
  before.useForTask(before.catalogue.data.groups[1].items[0], (value) => (selected = value));
  assert.deepEqual(Object.keys(selected).sort(), ["ref", "sourceEpoch"]);
  h.capability(false);
  const hidden = h.render({ flush: false });
  assert.equal(hidden.catalogue.data, null);
  selected = null;
  before.useForTask(before.catalogue.data.groups[1].items[0], (value) => (selected = value));
  assert.equal(selected, null);
  await h.ready();
  assert.equal(h.render().watchlist.data.items[0].symbol, "SYNTH");
  h.unmount();
});

test("single-flight writes, revoked source epochs and aborted-body deadlines fail closed", async () => {
  const pending = deferred();
  const h = harness({
    transport: ({ options }) => (options.method === "PUT" ? pending.promise : undefined),
  });
  const before = await h.ready();
  const write = before.saveFollows([]);
  assert.equal(await before.saveFollows([]), false);
  assert.equal(h.calls.filter((call) => call.options.method === "PUT").length, 1);
  pending.resolve(response(channels("AFTER", 2)));
  assert.equal(await write, true);
  await settle();
  const now = h.render();
  const old = structuredClone(now.catalogue.data.groups[1].items[0]);
  old.sourceEpoch = 99;
  let selected = false;
  now.useForTask(old, () => (selected = true));
  assert.equal(selected, false);
  h.unmount();
  const timeout = harness({
    transport: ({ route }) =>
      route.endsWith("watchlist")
        ? new Response(new ReadableStream({ start() {} }), {
            headers: { "Content-Type": "application/json" },
          })
        : undefined,
  });
  timeout.render();
  await settle();
  for (const callback of [...timeout.timers.values()]) callback();
  await settle();
  const timedOut = timeout.render();
  assert.equal(timedOut.watchlist.error, "timeout");
  assert.equal(timedOut.watchlist.data, null);
  timeout.unmount();
});

test("creator GET permits server-added row metadata above the bounded write size", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    name: "Creator",
    handleOrUrl: `https://www.youtube.com/@creator_${i}`,
    note: "字".repeat(830),
  }));
  contracts.channelInputs(items);
  const rows = {
    revision: 1,
    limit: 50,
    items: items.map((item, i) => ({
      ...item,
      followId: `follow_${i}`,
      verification: "user_provided",
      addedAt: "2026-10-30T10:00:00Z",
    })),
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length > 131072);
  const h = harness({
    transport: ({ route }) => (route.endsWith("channel-follows") ? response(rows) : undefined),
  });
  const view = await h.ready();
  assert.equal(view.follows.error, "");
  assert.equal(view.follows.data.items.length, 50);
  h.unmount();
});
