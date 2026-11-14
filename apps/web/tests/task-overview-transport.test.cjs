const test = require("node:test"),
  assert = require("node:assert/strict"),
  { compile } = require("./resource-library-helpers.cjs");
const { types, request, reader, providers, overview } = require("./task-overview-helpers.cjs"),
  { body } = require("./task-overview-fixtures.cjs");
function config(send, patch = {}) {
  return {
    scope: "owner_A:vault_A:1:1",
    vault: "vault_A",
    active: true,
    visible: true,
    known: () => [],
    send,
    ...patch,
  };
}
test("overview subscribers cancel independently and an immutable receipt cannot poison another consumer", async () => {
  let release,
    sends = 0;
  const gate = new Promise((r) => (release = r)),
    read = new overview.TaskOverviewRead(() => {});
  read.configure(
    config(async () => {
      sends++;
      return gate;
    }),
  );
  const abort = new AbortController(),
    a = read.acquire(abort.signal),
    b = read.acquire();
  abort.abort();
  await assert.rejects(a, /cancelled/);
  release(Response.json(body()));
  const got = await b;
  assert.equal(sends, 1);
  assert.equal(Object.isFrozen(got.data.tasks.items[0]), true);
  const before = got.data.tasks.items[0].taskId;
  got.data.tasks.items[0].taskId = "poisoned";
  assert.equal((await read.acquire()).data.tasks.items[0].taskId, before);
  read.invalidate();
});
test("streamed overview bytes retain the original one MiB ceiling and no failure becomes reusable data", async () => {
  let canceled = 0,
    sends = 0;
  const read = new overview.TaskOverviewRead(() => {});
  read.configure(
    config(async () => {
      sends++;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(1048577));
          },
          cancel() {
            canceled++;
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  await assert.rejects(read.acquire(), /invalid_response/);
  assert.equal(read.receipt, null);
  assert.equal(canceled, 1);
  await assert.rejects(read.acquire(), /invalid_response/);
  assert.equal(sends, 2);
  read.invalidate();
});
test("ignored transport abort settles at the original metadata deadline and cannot publish late", async () => {
  const timers = new Map();
  let release;
  const gate = new Promise((r) => (release = r));
  const local = compile(
    "../lib/task-overview.ts",
    {
      "./task-types": types,
      "./task-overview-request": request,
      "./task-result-reader": reader,
      "./report-provider-attribution": providers,
      "./workspace-cache": compile("../lib/workspace-cache.ts"),
    },
    {
      setTimeout: (fn, ms) => {
        const id = {};
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const read = new local.TaskOverviewRead(() => {});
  read.configure(config(() => gate));
  const action = read.acquire();
  await new Promise((r) => setImmediate(r));
  assert.equal([...timers.values()][0].ms, 11500);
  [...timers.values()][0].fn();
  await assert.rejects(action, /request_timeout/);
  release(Response.json(body()));
  await new Promise((r) => setImmediate(r));
  assert.equal(read.receipt, null);
  read.invalidate();
});
test("scope version changes invalidate a cache while visibility-only reentry retains its original receipt TTL", async () => {
  let now = 1000,
    sends = 0;
  const send = async () => {
      sends++;
      return Response.json(body());
    },
    read = new overview.TaskOverviewRead(
      () => {},
      () => now,
    );
  read.configure(config(send));
  const receipt = await read.acquire();
  now = 2000;
  read.configure(config(send, { visible: false }));
  read.configure(config(send));
  assert.equal((await read.acquire()).at, receipt.at);
  assert.equal(sends, 1);
  read.configure(config(send, { scope: "owner_A:vault_A:1:2" }));
  assert.equal(read.receipt, null);
  await read.acquire();
  assert.equal(sends, 2);
  read.invalidate();
});

test("soft region invalidation still aborts every physical overview subscriber at a hidden boundary", async () => {
  let sentSignal;
  const read = new overview.TaskOverviewRead(() => {});
  const send = async (_path, options) => {
    sentSignal = options.signal;
    return new Promise(() => {});
  };
  read.configure(config(send));
  const pending = read.acquire();
  await new Promise((r) => setImmediate(r));
  read.invalidate(false);
  assert.equal(sentSignal.aborted, false);
  read.configure(config(send, { visible: false }));
  assert.equal(sentSignal.aborted, true);
  await assert.rejects(pending, /cancelled/);
  read.invalidate();
});
