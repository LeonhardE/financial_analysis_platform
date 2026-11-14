const test = require("node:test"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
const fixture = require("./full-flow-crypto-fixture.cjs");
const base = ["contractVersion", "profile", "ownerSubject", "vaultId", "rootKeyId", "ref"];
const ref = () => fixture.bindings()[0].ref;
function receipt(prepared, at = 1000) {
  const { localPending, ...packet } = prepared,
    p = fixture.decoded(packet.body.command);
  return {
    packet,
    localPending,
    record: {
      state: {
        ...Object.fromEntries(base.map((k) => [k, p[k]])),
        revision: p.revision,
        stableOperationId: p.stableOperationId,
        operationFingerprint: createHash("sha256")
          .update(packet.body.command.protected + "." + packet.body.command.payload)
          .digest("hex"),
        recipientKeyId: p.recipientKeyId,
        acceptedAt: at,
      },
      command: packet.body.command,
    },
  };
}
test("actual Owner Worker prepares, seals, independently verifies and decrypts names without changing its financial/registry state", async () => {
  const h = await fixture.createHarness();
  try {
    const f = await fixture.createOwner(h),
      before = structuredClone(f.vault),
      name = "PRIVATE_SYNTHETIC_NAME";
    const prepared = await f.session.prepareDisplayName({ ref: ref(), item: null, name });
    const r = receipt(prepared);
    assert.ok(!JSON.stringify(prepared).includes(name));
    assert.ok(!JSON.stringify(r.localPending).includes(name));
    const read = await f.session.openDisplayName({ ref: ref(), item: r.record });
    assert.equal(read.name, name);
    assert.equal(read.state.revision, 1);
    const many = await f.session.openDisplayNames({ refs: [ref()], items: [r.record] });
    assert.equal(many[0].name, name);
    assert.equal(
      (
        await f.session.verifyDisplayNameReceipt({
          packet: r.packet,
          receipt: {
            contractVersion: r.record.state.contractVersion,
            profile: r.record.state.profile,
            item: r.record,
          },
        })
      ).operationId,
      r.packet.operationId,
    );
    const reopened = await f.session.openDisplayNamePending({
      record: r.localPending,
      ref: ref(),
      operationId: r.packet.operationId,
    });
    assert.deepEqual(reopened, r.packet);
    assert.deepEqual(f.vault, before);
    const next = receipt(
      await f.session.prepareDisplayName({ ref: ref(), item: r.record, name: "Second synthetic" }),
    );
    assert.equal(next.record.state.revision, 2);
    assert.equal(
      (await f.session.openDisplayName({ ref: ref(), item: next.record })).name,
      "Second synthetic",
    );
  } finally {
    await h.close();
  }
});
test("actual Worker refuses substituted Owner/ref/incarnation/signature/receipt/pending and refuses a locked session", async () => {
  const h = await fixture.createHarness();
  try {
    const f = await fixture.createOwner(h),
      r = receipt(
        await f.session.prepareDisplayName({ ref: ref(), item: null, name: "Synthetic" }),
      );
    for (const mutate of [
      (v) => (v.state.ref.incarnation = "other_incarnation"),
      (v) => (v.state.vaultId = "other_vault"),
      (v) => (v.state.revision = 10),
      (v) => (v.state.acceptedAt = 1001),
      (v) => (v.command.signature = "A".repeat(86)),
    ]) {
      const v = structuredClone(r.record);
      mutate(v);
      await assert.rejects(f.session.openDisplayName({ ref: ref(), item: v }));
    }
    const foreign = await fixture.createOwner(h, "synthetic_other_owner");
    await assert.rejects(foreign.session.openDisplayName({ ref: ref(), item: r.record }));
    await assert.rejects(
      foreign.session.openDisplayNamePending({
        record: r.localPending,
        ref: ref(),
        operationId: r.packet.operationId,
      }),
    );
    await assert.rejects(
      f.session.openDisplayNames({ refs: [ref()], items: [r.record, r.record] }),
    );
    for (const name of ["", "x".repeat(81), " x ", "\u202eprivate"])
      await assert.rejects(f.session.prepareDisplayName({ ref: ref(), item: null, name }));
    const locked = new h.core.VaultCore(f.uid, f.now);
    await assert.rejects(locked.openDisplayName({ ref: ref(), item: r.record }));
  } finally {
    await h.close();
  }
});

test("Web and actual local Hub interoperate, preserve original receipts and read historical names after writer expiry", async () => {
  const { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    { pathToFileURL } = require("node:url"),
    { spawnSync } = require("node:child_process"),
    { transformSync } = require("next/dist/build/swc");
  const repo = path.resolve(__dirname, "../../.."),
    dir = mkdtempSync(path.join(os.tmpdir(), "fv-display-owner-"));
  try {
    symlinkSync(path.join(repo, "node_modules"), path.join(dir, "node_modules"), "dir");
    for (const name of ["encrypted-types", "encrypted-display-names"]) {
      const file = path.join(repo, "apps/web/lib", name + ".ts");
      let { code } = transformSync(readFileSync(file, "utf8"), {
        filename: file,
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "es6" },
      });
      code = code
        .replace('"./encrypted-types"', '"./encrypted-types.mjs"')
        .replace(
          '"../../../packages/encrypted-workspace/dist/core.mjs"',
          JSON.stringify(
            pathToFileURL(path.join(repo, "packages/encrypted-workspace/dist/core.mjs")).href,
          ),
        );
      writeFileSync(path.join(dir, name + ".mjs"), code);
    }
    const peer = path.join(dir, "peer.mjs");
    writeFileSync(
      peer,
      `
  import {DisplayNameOwner} from './encrypted-display-names.mjs';
  let input='';for await(const chunk of process.stdin)input+=chunk;const f=JSON.parse(input);
  const signer=await crypto.subtle.importKey('jwk',f.device,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const reader=await crypto.subtle.importKey('jwk',f.reader,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
  const owner=new DisplayNameOwner({ownerSubject:f.owner,vault:f.vault,deviceSigningKey:signer,deviceSigningKeyId:f.deviceId,recoveryPublic:f.recoveryPublic,now:()=>f.now,reader:async()=>reader});
  try{process.stdout.write(JSON.stringify(await owner[f.op](f.args)))}catch(error){process.stderr.write('rejected');process.exitCode=1;}
  `,
    );
    const result = spawnSync(
      process.env.FOLIOVIEW_TEST_PYTHON ||
        path.join(repo, "services/market-data-service/.venv/bin/python"),
      [path.join(__dirname, "fixtures/display_name_owner_loop.py")],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 1048576,
        env: { ...process.env, FOLIOVIEW_NODE_BIN: process.execPath, FOLIOVIEW_OWNER_PEER: peer },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DISPLAY NAMES LOCAL LOOP COMPLETE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
