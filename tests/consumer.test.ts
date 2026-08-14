import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runConsumerCase } from "../src/sdk-consumer.ts";
import { NRW_PUBLIC_META_KEY, PERSUASIVE_TOOL_TEXT, RECORDED_CASE } from "../src/constants.ts";

const fixtureUrl = new URL("../fixtures/real-source-negative-evidence.json", import.meta.url);
const validEvidence = JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8")) as unknown;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertModelIsolation(result: Awaited<ReturnType<typeof runConsumerCase>>): void {
  assert.equal(result.modelSawToolText, true, "model should receive ordinary MCP tool text");
  assert.equal(result.modelSawEvidenceMetadata, false, "NRW evidence must stay out of model input/history");
  assert.equal(result.modelSecondRequestJson.includes(NRW_PUBLIC_META_KEY), false);
  assert.equal(result.historyJson.includes(NRW_PUBLIC_META_KEY), false);
  assert.equal(result.historyJson.includes("WARRANTED_ZERO"), false);
  assert.equal(result.historyJson.includes("BOUND_NEGATIVE_EVIDENCE"), false);
}

test("valid recorded NRW metadata survives Agents SDK customData and permits only the exact premise", async () => {
  const result = await runConsumerCase({ metadata: validEvidence });

  assert.equal(result.decoderAccepted, true);
  assert.equal(result.gateVerdict, "PASS");
  assert.equal(result.effectCount, 1);
  assertModelIsolation(result);
  assert.equal(result.stateJson.includes("WARRANTED_ZERO"), true, "SDK run state should preserve application-only evidence");
});

test("persuasive model-visible empty-result text cannot substitute for missing NRW metadata", async () => {
  const result = await runConsumerCase({
    toolText: PERSUASIVE_TOOL_TEXT,
  });

  assert.equal(result.decoderAccepted, false);
  assert.equal(result.gateVerdict, "BLOCK");
  assert.equal(result.effectCount, 0);
  assertModelIsolation(result);
});

test("valid evidence cannot authorize an operation requiring a different query", async () => {
  const result = await runConsumerCase({
    metadata: validEvidence,
    action: { query: `${RECORDED_CASE.query}-different` },
  });

  assert.equal(result.decoderAccepted, true, "evidence itself remains structurally valid");
  assert.equal(result.gateVerdict, "BLOCK", "exact operation-derived proposition must differ");
  assert.equal(result.effectCount, 0);
  assertModelIsolation(result);
});

test("tampered real-source identity is rejected before the negative-premise gate", async () => {
  const tampered = clone(validEvidence) as {
    sourceInstance?: { applicationId?: string; sourceInstanceId?: string };
  };
  assert.ok(tampered.sourceInstance);
  tampered.sourceInstance.applicationId = "other-app";
  tampered.sourceInstance.sourceInstanceId = "algolia-app:other-app";

  const result = await runConsumerCase({ metadata: tampered });

  assert.equal(result.decoderAccepted, false);
  assert.equal(result.gateVerdict, "BLOCK");
  assert.equal(result.effectCount, 0);
  assertModelIsolation(result);
});
