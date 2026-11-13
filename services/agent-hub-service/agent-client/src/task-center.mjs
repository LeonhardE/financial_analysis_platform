/** Opt-in task-center consumer. Calendar eligibility is never native-source attestation. */
import validators from "./task-center-validators.cjs";
import { CONTRACT, BINDING, deny, bytes, parsed, same, digest, verify, sign } from "./crypto.mjs";
export const CENTER = "folioview.task-center.v1";
const versions = ["taskVersion", "executionEpoch", "ruleVersion", "lifecycleEpoch"];
export function reference(d, a) {
  return Object.fromEntries([
    ...versions.map((k) => [k, d[k]]),
    ...["assignmentId", "assignmentVersion", "slotGeneration"].map((k) => [k, a[k]]),
  ]);
}
export async function assignedTrigger(a, baseTriggerId) {
  return (
    "tc_" +
    (await digest([
      a.ownerSubject,
      a.vaultId,
      a.taskId,
      a.assignmentId,
      a.assignmentVersion,
      a.ruleVersion,
      a.lifecycleEpoch,
      "legacy_unknown",
      baseTriggerId,
    ]))
  );
}
export async function verifyCenter(value, { registry, identity, lease, provider, task }) {
  const d = value.definition,
    a = value.assignment;
  for (const [name, row] of [
    ["CenterTaskDefinition", d],
    ["CenterAssignment", a],
  ])
    if (!validators[name](row)) deny("invalid_task_center");
  if (
    value.profile !== CENTER ||
    value.contractVersion !== CONTRACT ||
    d.status !== "active" ||
    a.status !== "active" ||
    d.ruleVersion !== d.definitionVersion ||
    d.lifecycleEpoch !== 1
  )
    deny("insufficient_scope");
  for (const k of ["ownerSubject", "vaultId", "taskId", ...versions])
    if (a[k] !== d[k]) deny("recipient_binding_mismatch");
  for (const k of ["ownerSubject", "vaultId", "connectionId", "clientId"])
    if ((k in a ? a[k] : a.credential[k]) !== identity[k]) deny("recipient_binding_mismatch");
  if (
    a.agentId !== identity.agentId ||
    a.provider !== provider ||
    a.credential.credentialFingerprint !== lease.credentialFingerprint ||
    a.credential.credentialGeneration !== lease.generation ||
    a.authorityFingerprint !== task.fingerprint ||
    d.taskId !== task.context.taskId ||
    d.taskVersion !== task.context.taskVersion ||
    d.executionEpoch !== task.context.executionEpoch ||
    !same(value.binding, reference(d, a))
  )
    deny("recipient_binding_mismatch");
  const context = Object.fromEntries(
    ["contractVersion", "profile", "ownerSubject", "vaultId", "taskId"].map((k) => [k, d[k]]),
  );
  if (a.slotId !== "provider_" + (await digest([a.ownerSubject, provider])))
    deny("recipient_binding_mismatch");
  if (a.assignmentId !== "assignment_" + (await digest([context, a.slotId])))
    deny("recipient_binding_mismatch");
  const controls = [];
  for (const [signed, action] of [
    [value.ruleControl, "set_rules"],
    [value.assignmentControl, "set_assignment"],
  ]) {
    const p = parsed(bytes(signed.payload), true);
    if (!validators.CenterOwnerControl(p) || p.action !== action) deny("invalid_task_center");
    const snap = registry.snapshots.get(p.registrySequence);
    if (
      !snap ||
      snap.digest !== p.checkpointDigest ||
      snap.keyEpoch !== p.keyEpoch ||
      p.rootKeyId !== identity.rootKeyId ||
      p.issuedAt < snap.issuedAt
    )
      deny("registry_conflict");
    const cert = registry.cert(
      p.deviceSigningKeyId,
      "device_sig",
      null,
      p.issuedAt,
      p.registrySequence,
    );
    if (
      !cert.capabilities.includes("control_write") ||
      (action === "set_assignment" && !cert.capabilities.includes("task_grant"))
    )
      deny("key_authorization_required");
    await verify(signed, cert.publicJwk, "fv-control+jws");
    for (const k of [
      "contractVersion",
      "profile",
      "ownerSubject",
      "vaultId",
      "taskId",
      "taskVersion",
      "executionEpoch",
    ])
      if (p[k] !== d[k]) deny("recipient_binding_mismatch");
    controls.push(p);
  }
  const [rules, assignment] = controls;
  const target = Object.fromEntries(
    ["slotId", "provider", "slotGeneration", "credential", "agentId", "authorityFingerprint"].map(
      (k) => [k, a[k]],
    ),
  );
  if (
    rules.expectedDefinitionVersion + 1 !== d.definitionVersion ||
    !same(rules.schedule, d.schedule) ||
    assignment.expectedDefinitionVersion !== d.definitionVersion ||
    assignment.expectedAssignmentVersion + 1 !== a.assignmentVersion ||
    assignment.assignmentId !== a.assignmentId ||
    !same(assignment.assignment, target) ||
    rules.assignment !== null ||
    assignment.schedule !== null ||
    rules.intent !== null ||
    assignment.intent !== null
  )
    deny("recipient_binding_mismatch");
  return value;
}
export async function assignedDue(definition, now) {
  if (definition.schedule === null) return null;
  const s = definition.schedule;
  if (!validators.CenterSchedule(s)) deny("invalid_schedule");
  if (
    (s.frequency === "daily" && s.days.length) ||
    (s.frequency === "weekly" &&
      (!s.days.length ||
        !same(
          s.days,
          [...s.days].sort((a, b) => a - b),
        )))
  )
    deny("invalid_schedule");
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    deny("invalid_schedule");
  }
  const parts = (at) =>
    Object.fromEntries(
      fmt
        .formatToParts(new Date(at * 1000))
        .filter((v) => v.type !== "literal")
        .map((v) => [v.type, v.value]),
    );
  const date = (p) => `${p.year}-${p.month}-${p.day}`;
  const days = [...new Set([date(parts(now)), date(parts(now - 86400))])];
  for (const day of days) {
    const naive = Date.parse(day + "T" + s.localTime + ":00Z") / 1000;
    const weekday = new Date(day + "T00:00:00Z").getUTCDay() || 7;
    if (s.frequency === "weekly" && !s.days.includes(weekday)) continue;
    const candidates = new Set();
    for (let hours = -48; hours <= 48; hours += 6) {
      const at = naive + hours * 3600,
        p = parts(at);
      const offset = Date.parse(`${date(p)}T${p.hour}:${p.minute}:00Z`) / 1000 - at;
      const candidate = naive - offset,
        c = parts(candidate);
      if (date(c) === day && `${c.hour}:${c.minute}` === s.localTime) candidates.add(candidate);
    }
    if (!candidates.size) continue; // DST gap: skip. Repeated wall time: first only.
    const at = Math.min(...candidates);
    if (at < s.effectiveFrom || now < at || now > at + s.graceMinutes * 60 + 59) continue;
    return {
      baseTriggerId:
        "schedule_" +
        (await digest([
          definition.ownerSubject,
          definition.vaultId,
          definition.taskId,
          definition.ruleVersion,
          day,
          s,
        ])),
      scheduledAt: at,
      sourceAttested: false,
    };
  }
  return null;
}

export async function centerRequestProof({ identity, audience, path, request, now, privateKey }) {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const encoded = Buffer.from(nonce).toString("base64url");
  const p = {
    contractVersion: CONTRACT,
    profile: CENTER,
    artifactType: "task_center_agent_request",
    purpose: "authenticated_request",
    ...Object.fromEntries(BINDING.map((k) => [k, identity[k]])),
    audience,
    method: "POST",
    path,
    bodyDigest: await digest(request),
    requestId: "request_" + encoded,
    nonce: encoded,
    issuedAt: now,
    expiresAt: now + 120,
  };
  if (!validators.CenterAgentRequestPayload(p)) deny("invalid_operation");
  return sign(p, privateKey, identity.agentSigningKeyId, "fv-control+jws");
}
