# Upstream runtime boundary

This consumer targets **OpenAI Agents SDK for JavaScript v0.15.0**.

Official upstream references:

- SDK repository/tag: https://github.com/openai/openai-agents-js/tree/v0.15.0
- MCP guide: https://openai.github.io/openai-agents-js/guides/mcp/
- Results guide: https://openai.github.io/openai-agents-js/guides/results/

The relevant SDK mechanism is `customDataExtractor` for local MCP tool results. Its context exposes MCP result `_meta` as `resultMeta`. The returned JSON-compatible value is attached to `RunToolCallOutputItem.customData` as SDK-only application data rather than model history.

The feature was introduced upstream in commit:

`b740fb3a8c818135e33a096bb323f5f1ff7d319f` — `feat: add SDK-only custom data for tool outputs (#1360)`

and appears in the official `@openai/agents-core` changelog under v0.11.8. This consumer pins v0.15.0, whose public testing entrypoint also exports the deterministic `ScriptedModel` used here.

No OpenAI model endpoint is contacted by this repository's test suite.
