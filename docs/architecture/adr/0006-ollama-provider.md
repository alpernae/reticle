# ADR-006: Ollama as a first-class AI provider (native HTTP API)

**Status:** Proposed
**Date:** 2026-11-17
**Deciders:** Maintainer (alpernae)

## Context

DeepSeek-R1 8B is installed locally through Ollama (`deepseek-r1:latest`: qwen3 architecture, 8.2 B, Q4_K_M, thinking + tools capable, 131k max context; Ollama 0.40.16 on `127.0.0.1:11434`). Reticle has three providers today (`claude-cli`, `anthropic`, `opencode`), selected by one global order (`lib/ai.ts`). OpenCode can reach Ollama, but only through a one-shot text endpoint that hides the controls a reasoning model needs: `think`, `num_ctx`, `format`, `keep_alive`, streaming and loaded-model status.

Key facts about the model:
- It emits a reasoning phase. If that phase is not separated, it pollutes the parsed output.
- Ollama's default context window is far smaller than Reticle's prompts (digest + winner cards ≈ 6–15k tokens), so prompts get silently truncated unless `num_ctx` is set.
- One consumer GPU serves one request at a time; the first call after idle pays a model-load delay.

## Decision

Add an `ollama` provider that calls Ollama's **native** `/api/chat` with `stream: true`, `think: true`, explicit `options.num_ctx` (sized from the prompt and capped by a setting), `format` (JSON schema) for structured kinds, and `keep_alive`. It reads models from `/api/tags` and health from `/api/version` and `/api/ps`. Reasoning text is stored as a task event, never as output. Concurrency is limited to 1. The base URL comes from `settings.ollamaHost`, then `OLLAMA_HOST`, then `http://127.0.0.1:11434`. Provider choice becomes **per task kind** (a routing setting) instead of one global order; per-run pins still override it.

## Options Considered

### Option A: Native Ollama provider (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low: about 200 lines next to the existing runners |
| Cost | Free inference on local hardware |
| Scalability | One GPU = serialized calls; fine for one user |
| Team familiarity | High: plain `fetch` + NDJSON |

**Pros:** full control of reasoning, context and structured output; real cancel (abort the stream); live VRAM and loaded-model info; the base for fine-tuned versions (ADR-007).
**Cons:** Ollama-specific API surface.

### Option B: OpenAI-compatible `/v1/chat/completions`
**Pros:** the same code would work with LM Studio, vLLM and llama.cpp server.
**Cons:** loses `think` separation, `keep_alive` and `/api/ps`; `num_ctx` handling is less direct. Keep as a possible second adapter behind the same provider interface.

### Option C: Keep routing Ollama through OpenCode
**Pros:** zero new code.
**Cons:** no reasoning separation, no context control (silent truncation), no structured output, weak health info. Rejected.

## Trade-off Analysis

The model's value depends on two settings OpenCode does not expose: context size (or prompts get truncated) and reasoning separation (or parsing breaks). The native API is small and stable, so owning one more runner is cheap. Per-kind routing lets the local model take the work it is good at (categorize, Ask, short structured tools) without lowering quality on long-form drafts until a fine-tuned version proves itself.

## Consequences

- **Easier:** free, private, offline-capable AI for high-volume kinds; side-by-side provider data on every task; a clear path to fine-tuned models.
- **Harder:** cold-start and thinking latency must be visible in Activity; Docker needs `host.docker.internal` (or an `ollama` compose service) to reach the host.
- **Revisit:** add the `/v1` adapter if you want LM Studio or vLLM; turn `think` off per kind if latency matters more than reasoning for short tools.

## Action Items
1. [ ] `ProviderId` += `'ollama'`; add it to `RUNNERS`, `PROVIDER_LABEL`, `MODEL_CHOICES` (dynamic from `/api/tags`) and config validation in `lib/ai.ts`.
2. [ ] `providers/ollama.ts`: streaming chat, `think`, `format`, `num_ctx` sizing, `keep_alive`, abort, `<think>` stripping fallback, error classification (unreachable / model-missing / oom / timeout).
3. [ ] Health: `/api/version` + `/api/ps` into `provider_health` and the Usage widget data.
4. [ ] Routing setting per task kind with Ollama-aware defaults; limiter `ollama: 1`.
5. [ ] `ollama.pull` and `ollama.warm` tasks.
6. [ ] Docker docs: `OLLAMA_HOST=http://host.docker.internal:11434` + `extra_hosts: host-gateway`, or an optional `ollama` service with GPU.
