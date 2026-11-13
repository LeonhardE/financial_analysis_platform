const assert = require("node:assert/strict");
const test = require("node:test");
const { compile } = require("./resource-library-helpers.cjs");
const { DisplayLru, WorkspaceDisplayCache, DisplayReadPool } = compile("../lib/workspace-cache.ts");
const gate = () => {
  let resolve;
  return { promise: new Promise((r) => (resolve = r)), resolve: (v) => resolve(v) };
};

test("display LRU enforces entry/byte bounds, touches on read and refuses oversized data", () => {
  const c = new DisplayLru(2, 1000);
  c.set("a", "first");
  c.set("b", "second");
  c.get("a");
  c.set("c", "third");
  assert.equal(c.get("b"), undefined);
  assert.equal(c.size, 2);
  assert.ok(c.bytes <= 1000);
  assert.equal(c.set("large", "x".repeat(1000)), false);
  assert.equal(c.size, 2);
  c.clear();
  assert.equal(c.bytes, 0);
});

test("a display session owns all three bounded caches and scope transitions synchronously clear them", () => {
  const c = new WorkspaceDisplayCache();
  c.bind("owner_A:vault_A:1");
  for (let n = 0; n < 40; n++) c.taskNames.set(String(n), "PRIVATE_NAME");
  for (let n = 0; n < 12; n++) c.reports.set(String(n), { title: "PRIVATE_REPORT" });
  for (let n = 0; n < 3; n++) c.holdings.set(String(n), { symbol: "PRIVATE_TICKER" });
  assert.deepEqual([c.taskNames.size, c.reports.size, c.holdings.size], [32, 10, 2]);
  c.bind("owner_A:vault_A:1");
  assert.equal(c.reports.size, 10);
  for (const scope of ["owner_A:vault_A:2", "owner_A:vault_B:2", "owner_B:vault_B:2", null]) {
    c.bind(scope);
    assert.equal(c.taskNames.size + c.reports.size + c.holdings.size, 0);
    c.reports.set("a", "private");
  }
  c.clear();
  assert.equal(c.reports.size, 0);
});

test("coalesced display reads share one transport but keep independent streamed bodies and cancellation", async () => {
  const p = new DisplayReadPool(),
    g = gate(),
    a = new AbortController(),
    b = new AbortController();
  let calls = 0,
    transportSignal;
  const send = (signal) => {
    calls++;
    transportSignal = signal;
    return g.promise;
  };
  const first = p.run("owner_A:catalogue", send, a.signal);
  const firstRejected = assert.rejects(first, /cancelled/);
  const second = p.run("owner_A:catalogue", send, b.signal);
  await Promise.resolve();
  a.abort();
  await firstRejected;
  assert.equal(calls, 1);
  assert.equal(transportSignal.aborted, false);
  let body;
  g.resolve(
    new Response(
      new ReadableStream({
        start(c) {
          body = c;
        },
      }),
    ),
  );
  const r = await second;
  assert.equal(transportSignal.aborted, false);
  body.enqueue(new TextEncoder().encode("verified display"));
  body.close();
  assert.equal(await r.text(), "verified display");
});

test("all cancelled subscribers abort transport; completed reads and different owners are never cached", async () => {
  const p = new DisplayReadPool(),
    a = new AbortController(),
    g = gate();
  let signal;
  const first = p.run(
    "A:list",
    (s) => {
      signal = s;
      return g.promise;
    },
    a.signal,
  );
  const rejected = assert.rejects(first, /cancelled/);
  await Promise.resolve();
  a.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  g.resolve(new Response("late"));
  let calls = 0;
  const send = async () => {
    calls++;
    return new Response("fresh");
  };
  const [x, y] = await Promise.all([p.run("A:list", send), p.run("B:list", send)]);
  assert.equal(await x.text(), "fresh");
  assert.equal(await y.text(), "fresh");
  assert.equal(calls, 2);
  const next = await p.run("A:list", send);
  assert.equal(await next.text(), "fresh");
  assert.equal(calls, 3);
});

test("private reads queue at two transports, cancel before dispatch and release capacity on failure", async () => {
  const p = new DisplayReadPool(),
    gates = [gate(), gate(), gate(), gate()];
  const a = new AbortController();
  const calls = [];
  const send = (i) => () => {
    calls.push(i);
    return gates[i].promise;
  };
  const first = p.run("one", send(0));
  const second = p.run("two", send(1));
  const cancelled = p.run("three", send(2), a.signal);
  const rejects = assert.rejects(cancelled, /cancelled/);
  const fourth = p.run("four", send(3));
  await Promise.resolve();
  assert.deepEqual(calls, [0, 1]);
  a.abort();
  await rejects;
  gates[0].resolve(new Response("first"));
  await first;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [0, 1, 3]);
  p.clear();
  gates[1].resolve(new Response("second"));
  gates[3].resolve(new Response("fourth"));
  await Promise.allSettled([second, fourth]);
  const fresh = await p.run("fresh", async () => new Response("fresh"));
  assert.equal(await fresh.text(), "fresh");
});
