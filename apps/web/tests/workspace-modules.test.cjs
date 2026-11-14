const test = require("node:test"),
  assert = require("node:assert/strict");
const React = require("react"),
  jsx = require("react/jsx-runtime");
const { compile, deferred, settle } = require("./resource-library-helpers.cjs");
const { hooks } = require("./resource-ui-harness.cjs");

function modules(timers = new Map()) {
  return {
    timers,
    api: compile(
      "../components/WorkspacePanels.tsx",
      {
        react: React,
        "react/jsx-runtime": jsx,
        "next-intl": { useTranslations: () => (v) => v },
        "./WorkspaceFeedback": { InlineError: () => null, LoadingIndicator: () => null },
      },
      {
        setTimeout(fn, ms) {
          const key = {};
          timers.set(key, { fn, ms });
          return key;
        },
        clearTimeout(key) {
          timers.delete(key);
        },
      },
    ),
  };
}
test("module loading has an in-place failure deadline and a fresh explicit retry", async () => {
  const { api, timers } = modules(),
    old = deferred();
  const first = api.loadWorkspaceModule(() => old.promise);
  const rejected = assert.rejects(first, /module_unavailable/);
  assert.equal(timers.size, 1);
  [...timers.values()][0].fn();
  await rejected;
  old.resolve("late chunk");
  await settle();
  assert.equal(timers.size, 0);
  assert.equal(await api.loadWorkspaceModule(async () => "fresh chunk"), "fresh chunk");
  assert.equal(timers.size, 0);
});
test("module boundary replaces a failed page with local recovery without replacing its workspace parent", () => {
  const { api } = modules();
  const parentSession = {},
    props = { children: { parentSession }, fallback: "retry-local-module" };
  const boundary = new api.WorkspaceModuleBoundary(props);
  assert.equal(boundary.render().parentSession, parentSession);
  boundary.state = api.WorkspaceModuleBoundary.getDerivedStateFromError(Error("chunk failed"));
  assert.equal(boundary.render(), "retry-local-module");
  const retried = new api.WorkspaceModuleBoundary(props);
  assert.equal(retried.render().parentSession, parentSession);
});
function configuration() {
  const h = hooks(),
    requests = [],
    timers = new Map(),
    events = new Map();
  let now = 100000,
    active = true,
    visible = true;
  const destination = {
    schemaVersion: 1,
    enabled: true,
    hubOrigin: "https://agent-hub-api-123456789.northamerica-northeast2.run.app",
  };
  const connection = compile("../lib/agent-connections.ts", {
    "./task-types": compile("../lib/task-types.ts"),
  });
  const link = compile("../lib/agent-link.ts", { "./agent-connections": connection });
  const { useAgentLinkConfiguration } = compile(
    "../components/useAgentLinkConfiguration.ts",
    { react: h.react, "@/lib/agent-link": link },
    {
      Date: class extends Date {
        static now() {
          return now;
        }
      },
      document: {
        get visibilityState() {
          return visible ? "visible" : "hidden";
        },
        addEventListener(k, v) {
          events.set(k, v);
        },
        removeEventListener(k) {
          events.delete(k);
        },
      },
      window: {
        setTimeout(fn, ms) {
          const key = {};
          timers.set(key, { fn, ms });
          return key;
        },
        clearTimeout(key) {
          timers.delete(key);
        },
      },
      fetch: async (_url, options) => {
        const request = deferred();
        requests.push({ ...request, options });
        return request.promise;
      },
    },
  );
  return {
    requests,
    timers,
    destination,
    render: () => h.render(() => useAgentLinkConfiguration(active)),
    active(v) {
      active = v;
    },
    advance(ms) {
      now += ms;
    },
    hidden(v) {
      visible = !v;
      events.get("visibilitychange")?.();
    },
    close: () => h.close(),
  };
}
test("route reentry reuses public Agent destination metadata and refresh failure keeps the valid origin", async () => {
  const h = configuration();
  h.render();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(Response.json(h.destination));
  await settle();
  assert.equal(h.render().data.hubOrigin, h.destination.hubOrigin);
  h.active(false);
  h.render();
  h.active(true);
  h.render();
  assert.equal(h.requests.length, 1);
  h.advance(60001);
  h.active(false);
  h.render();
  h.active(true);
  h.render();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(Response.json({}, { status: 503 }));
  await settle();
  const state = h.render();
  assert.equal(state.error, true);
  assert.equal(state.data.hubOrigin, h.destination.hubOrigin);
  h.close();
});
test("public Agent config deadline and hidden late reply cannot create an unverified destination", async () => {
  const h = configuration();
  h.render();
  [...h.timers.values()][0].fn();
  await settle();
  assert.equal(h.render().error, true);
  assert.equal(h.render().data, null);
  h.hidden(true);
  h.render();
  h.requests[0].resolve(Response.json(h.destination));
  await settle();
  assert.equal(h.render().data, null);
  h.close();
});
