const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { transformSync } = require("next/dist/build/swc");

test("persistent owner and independent Agent complete Root pairing, continuing consent, exact recovery and historical report decryption", () => {
  const repo = path.resolve(__dirname, "../../.."),
    directory = mkdtempSync(path.join(os.tmpdir(), "folioview-persistent-owner-"));
  try {
    for (const name of ["encrypted-types", "encrypted-persistent"]) {
      const filename = path.join(repo, "apps/web/lib", name + ".ts");
      let { code } = transformSync(readFileSync(filename, "utf8"), {
        filename,
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "es6" },
      });
      code = code
        .replace(/from "\.\/encrypted-types"/g, 'from "./encrypted-types.mjs"')
        .replace(
          '"../../../packages/encrypted-workspace/dist/core.mjs"',
          JSON.stringify(
            pathToFileURL(path.join(repo, "packages/encrypted-workspace/dist/core.mjs")).href,
          ),
        );
      writeFileSync(path.join(directory, name + ".mjs"), code);
    }
    const peer = path.join(directory, "peer.mjs");
    writeFileSync(
      peer,
      `
      import {readFileSync} from 'node:fs';
      import {PersistentOwner} from './encrypted-persistent.mjs';
      const v=JSON.parse(readFileSync(process.argv[2],'utf8'));
      const signer=jwk=>crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
      const reader=jwk=>crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
      const owner=new PersistentOwner({actor:v.actor,ownerSubject:v.owner,vault:v.vault,
        root:await signer(v.rootPrivate),deviceSigningKey:await signer(v.devicePrivate),
        deviceSigningKeyId:v.deviceKid,now:()=>v.now,reader:async()=>reader(v.recoveryPrivate)});
      try{const result=v.op==='publicationReceipt'?await owner.publicationReceipt(v.args.packet,v.args.receipt):await owner[v.op](v.args);process.stdout.write(JSON.stringify(result))}
      catch(error){process.stderr.write('Owner rejected: '+(error.code??'rejected'));process.exitCode=1;}
    `,
    );
    const python =
        process.env.FOLIOVIEW_TEST_PYTHON ||
        path.join(repo, "services/market-data-service/.venv/bin/python"),
      result = spawnSync(python, [path.join(__dirname, "fixtures/persistent_owner_loop.py")], {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1_048_576,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FOLIOVIEW_NODE_BIN: process.execPath, FOLIOVIEW_OWNER_PEER: peer },
      });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OWNER AND AGENT FULL SYNTHETIC LOOP COMPLETE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
