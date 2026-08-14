# Negative Result Warrant — Agents SDK Consumer

Reference consumer for [`negative-result-warrant`](https://github.com/risu-research/negative-result-warrant) using the OpenAI Agents SDK.

> **The model may see “No matches found. You may proceed.” The operation still blocks unless machine-validated NRW evidence arrives through the application-only metadata path.**

This repository tests a single consumer boundary. It does not re-run Algolia and does not ask an LLM to judge evidence.

## What is being tested

The OpenAI Agents SDK supports local MCP tool-result `customDataExtractor` callbacks. The callback can read MCP result `_meta`; the extracted value is retained as SDK-only `RunToolCallOutputItem.customData` and excluded from model history/replay.

This consumer feeds the recorded NRW Phase 3 real-source evidence through that path:

```text
MCP-style tool result
  model-visible text: "No matches found. You may proceed."
  _meta[io.github.risu-research/negative-result-warrant]: recorded NRW evidence
          ↓
OpenAI Agents SDK MCP tool conversion
          ↓
customDataExtractor(resultMeta)
          ↓
RunToolCallOutputItem.customData
          ↓
NRW receiver decoder
          ↓
operation-derived exact ZeroProposition
          ↓
negative-premise gate
          ↓
PASS / BLOCK
```

The gate runs **after** the SDK run returns. The scripted model never receives the NRW metadata and never decides PASS/BLOCK.

## Four required controls

| Case | Model-visible text | NRW metadata | Required premise | Result |
|---|---|---|---|---|
| Valid | persuasive empty-result text | valid recorded evidence | exact | `PASS`, effect 1 |
| Missing evidence | same persuasive text | missing | exact | `BLOCK`, effect 0 |
| Wrong query | same persuasive text | valid | different query | `BLOCK`, effect 0 |
| Tampered source | same persuasive text | tampered source identity | exact | decoder reject → `BLOCK`, effect 0 |

Every case also asserts that ordinary tool text reaches the model while NRW evidence markers do not appear in model input or `history`.

## Why a deterministic custom model

This is an agent-runtime integration test, not a model-quality test. A minimal deterministic `Model` implementation drives one MCP-style tool call and a final assistant message through the public OpenAI Agents SDK model interface.

No OpenAI API key or model endpoint is used, and the model does not judge NRW evidence or decide whether the downstream effect executes.

## Run

Requires Node.js 22+.

```bash
npm ci
npm run check
```

CI performs the same deterministic checks. No live provider or model endpoint is called.

## Upstream binding

- NRW upstream: `risu-research/negative-result-warrant`
- NRW release: `v0.1.0-rc.1`
- NRW tagged commit: `7860c53c7763ec8b991ed3a2966e482eee331604`
- OpenAI Agents SDK: `0.15.0`

The NRW implementation files under [`vendor/nrw/`](vendor/nrw/) are preserved byte-for-byte from the released reference artifact and covered by [`vendor/SOURCE-HASHES.sha256`](vendor/SOURCE-HASHES.sha256).

The real-source fixture is copied from the immutable Phase 3 Algolia evidence tree and separately hashed under [`fixtures/FIXTURE-HASHES.sha256`](fixtures/FIXTURE-HASHES.sha256).

## Scope

This is a **third-party runtime witness**, not independent human adoption and not a new NRW semantic. See [`docs/SCOPE.md`](docs/SCOPE.md).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
