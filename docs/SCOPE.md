# Scope

This repository is a **consumer witness**, not a new Negative Result Warrant profile and not a re-test of the live Algolia source.

It isolates one question:

> Can a third-party agent runtime carry NRW evidence from an MCP result `_meta` field into application-only state, keep that evidence out of model replay/history, and let a deterministic application gate consume it only for the exact required negative premise?

The recorded evidence fixture comes from the public `negative-result-warrant` Phase 3 Algolia run. No live Algolia request is made here.

The OpenAI Agents SDK model is a minimal deterministic custom `Model` implementation using the public SDK model interface. No OpenAI model API call or API key is required. The model controls only the ordinary tool-call flow. It does **not** decide whether NRW evidence is valid or whether the effect executes.

## Explicit nonclaims

This repository does not establish:

- independent human adoption;
- another provider witness;
- cryptographic authenticity;
- freshness or state continuity;
- general agent safety;
- a new MCP semantic;
- that model-visible text is trustworthy.

The expected result is narrower: evidence may remain application-only inside a third-party agent runtime, and model-visible persuasion alone cannot satisfy the deterministic negative-premise gate.
