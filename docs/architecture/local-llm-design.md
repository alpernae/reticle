# Reticle: Local LLM (Ollama · DeepSeek-R1) and Fine-Tuning Loop

**Status:** Proposed
**Date:** 2026-11-17
**Builds on:** [system-design.md](system-design.md) (task system, layered modules, typed storage)
**Decision records:** [ADR-006](adr/0006-ollama-provider.md) · [ADR-007](adr/0007-feedback-and-fine-tuning-loop.md)

---

## 1. TL;DR

Add **Ollama as a fourth first-class AI provider** that talks to Ollama's HTTP API directly (not through OpenCode), and build a **closed feedback loop** around it:

```
 Ollama (DeepSeek-R1 8B, later reticle-r1:vN)
     │  completions (+ separated thinking)
     ▼
 Reticle harness ── prompts, routing, parsing, limit fitting, pattern-fit scoring
     │  drafts
     ▼
 User ── picks / edits / copies / logs real numbers
     │  feedback signals
     ▼
 Dataset builder ──▶ trainer (out-of-process, Python + GPU) ──▶ LoRA adapter
     │                                                              │
     └──────────── eval gate (held-out set) ◀── ollama create reticle-r1:vN
                         │ pass
                         ▼
                 promote: routing now uses reticle-r1:vN
```

Two important rules:

1. **Reticle never trains in Node.** Ollama only runs inference; it cannot train. Training runs as a separate Python job (Unsloth/PEFT), outside the app or as an opt-in sidecar. Reticle's job is to **collect the data, export the dataset, register the adapter, evaluate it and route to it**.
2. **The local model earns its traffic.** Routing is decided per task kind, and a fine-tuned version is promoted only if it beats the current model on a held-out eval set built from your own data.

---

## 2. What is installed (verified)

| Property | Value | Implication |
|---|---|---|
| Ollama tag | `deepseek-r1:latest` (not `:8b`, which is not pulled) | Use the tag from `/api/tags` and never hard-code it |
| Server | Ollama 0.40.16 on `127.0.0.1:11434` | The HTTP API is available |
| Architecture | `qwen3`, 8.2 B params, Q4_K_M | This is the **DeepSeek-R1-0528-Qwen3-8B** distill. Fine-tune the **HF fp16 base**, not this quantized GGUF |
| Context | 131,072 max | Ollama's *default* `num_ctx` is much smaller. Reticle prompts (digest + winner cards ≈ 6–15k tokens) **must** set `num_ctx` explicitly |
| Capabilities | `completion`, `thinking`, `tools` | Use `think: true` to get reasoning in a separate field instead of `<think>` tags in the text |
| Defaults | temperature 0.6, top_p 0.95 | DeepSeek's recommended sampling; keep these |
| License | MIT | Fine-tuning and local redistribution of adapters are allowed |

**Realistic expectations for an 8B reasoning distill:** strong at classification, extraction, short structured outputs and reasoning about the data digest. Weaker than Claude at long-form writing in a specific voice and at strict multi-section output formats. Its "thinking" phase adds 5–60 s on consumer GPUs. That is exactly why the loop matters: fine-tuning on *your* approved posts is how an 8B model closes the voice gap.

---

## 3. Requirements

**Functional**
- Use Ollama models in any AI feature, either through the provider order or pinned per run.
- Pick models from Ollama's live list (`/api/tags`), including future `reticle-r1:vN` builds.
- Route per task kind (for example categorize → local first, generate → Claude first).
- Capture feedback on every draft and turn it into training data.
- Export datasets, register adapters, evaluate them and promote or roll back versions.

**Non-functional**
- Everything local: prompts, outputs, datasets and adapters never leave the machine (it fits local-first perfectly).
- One GPU: Ollama runs **one request at a time** by default, so the limiter is set to 1.
- Never block the UI: model load (cold start of 5–20 s) and thinking time happen in tasks, never inside a request.
- Reproducible: every output records the model, digest, options and snapshot version that produced it.

---

## 4. Architecture

### 4.1 Where it fits

```
 application/ (drafts, tools, categorize, ask, workflows …)
        │  AIGateway.complete({ kind, system, prompt, schema?, pin? })
        ▼
 infrastructure/ai/
   router.ts ──── routing policy per task kind  (settings.aiRouting)
   limiter.ts ─── per provider: claude-cli 2 · anthropic 4 · opencode 2 · ollama 1
   health.ts ──── provider_health (+ ollama /api/ps, /api/tags)
   providers/
     claude-cli.ts · anthropic.ts · opencode.ts
     ollama.ts  ◀── NEW: /api/chat, streaming NDJSON, think, format, keep_alive
        │
        ▼  HTTP  (OLLAMA_HOST, default http://127.0.0.1:11434)
 Ollama ── deepseek-r1:latest · reticle-r1:v1 … (Modelfile FROM base + ADAPTER)

 application/learning/                     ◀── NEW (ADR-007)
   feedback.ts   record signals on drafts
   dataset.ts    build SFT / preference JSONL from feedback
   models.ts     register adapter → ollama create → eval → promote/rollback
   eval.ts       held-out set, automatic metrics (reuses domain/fit + limits)

 External, opt-in: trainer/ (Python, Unsloth or PEFT) ── reads dataset, writes adapter
```

### 4.2 The Ollama provider (ADR-006)

**Calls** go to `POST /api/chat` with:

```jsonc
{
  "model": "deepseek-r1:latest",          // or reticle-r1:v3
  "messages": [
    { "role": "system", "content": "<composed playbook prompt>" },
    { "role": "user",   "content": "<task prompt>" }
  ],
  "think": true,                           // reasoning goes to message.thinking, not into content
  "stream": true,                          // NDJSON; lets us heartbeat, show progress, and abort mid-generation
  "format": { /* JSON schema */ },         // only for structured kinds (categorize, ask, tool lists)
  "options": { "num_ctx": 16384, "temperature": 0.6, "top_p": 0.95, "num_predict": 4096 },
  "keep_alive": "15m"                      // stay warm between automation steps
}
```

Behaviour:

- **Thinking is kept, not shown as the answer.** `message.thinking` is saved as a `task_events` entry of type `reasoning` (collapsed in Activity). Only `message.content` is parsed as output. As a fallback for older models or servers, strip `<think>…</think>` from the content.
- **Context sizing:** estimate tokens (chars/3.5) and set `num_ctx` to the next power of two ≥ estimate + `num_predict`, capped by a setting (default 32k, which bounds VRAM). If the prompt still does not fit, trim winner cards first and the pattern table second, and record the trim as a task event.
- **Structured output:** use `format` (JSON schema) for categorize, Ask, hook lists and other Toolkit lists. Generate keeps the existing text format plus `parseVariants`, because forcing JSON on a reasoning distill for long prose degrades the prose.
- **Cancel:** abort the fetch, which makes Ollama stop generating. The worker heartbeat ([ADR-001](adr/0001-durable-task-system.md)) handles it the same way as for other providers.
- **Health and models:** `/api/tags` → model list (replaces nothing; it sits beside OpenCode's list). `/api/ps` → loaded models and VRAM, shown in the Usage widget. `/api/version` → reachability. Errors are classified as `unreachable`, `model-missing` (offer `ollama pull`), `oom` and `timeout`.
- **Cold start:** the first call after idle loads the model (5–20 s). The limiter treats Ollama as concurrency 1. An optional warm-up task (`keep_alive` ping) runs before scheduled automations that route to Ollama.
- **Docker:** set `OLLAMA_HOST=http://host.docker.internal:11434` and add `extra_hosts: ["host.docker.internal:host-gateway"]` to compose for Linux. Alternatively, add an `ollama` service to compose with GPU passthrough. Both are documented; neither is the default.

### 4.3 Routing policy

A typed setting replaces the single global order:

```ts
type Routing = Record<TaskKind | 'default', ProviderRef[]>;   // ProviderRef = { provider, model? }

// sensible defaults once Ollama is detected
default:     [claude-cli, anthropic, ollama, opencode]
categorize:  [ollama, claude-cli, anthropic]        // cheap, structured, high volume → local first
ask:         [ollama, claude-cli, anthropic]
brief:       [claude-cli, anthropic, ollama]
generate:    [claude-cli, anthropic, ollama]        // switched to reticle-r1:vN once it passes eval
tool:        [claude-cli, anthropic, ollama]
```

A per-run pin (the existing model picker) still overrides routing. The router skips a provider whose `provider_health.retry_at > now`, and it records **every attempt** on the task. That gives you real side-by-side latency and failure data per provider.

### 4.4 The feedback loop (ADR-007)

#### Signals the harness already sees or can cheaply capture

| Signal | Where it comes from | Strength | Use |
|---|---|---|---|
| Draft **picked** (copied, saved to Results) | Generate / Toolkit UI actions | medium | positive SFT example; `chosen` in a preference pair |
| Draft **ignored** while a sibling was picked | same | weak | `rejected` in a preference pair |
| **Edited before posting** (final text ≠ draft) | Results "posted text" field | **strong** | SFT target = *your edited text* (best possible voice data) |
| **Real result logged** (likes/comments/views on Winners) | `manual` table | strongest, but delayed | weight examples by outlier vs your own median |
| Explicit 👍/👎 + reason | small control on each draft | medium | filter or label |
| Automatic checks failed (over limit, format parse failed, banned phrase) | harness (`enforce`, `parseVariants`, playbook "never do") | negative | exclude from SFT; `rejected` example |

Stored as:

```sql
CREATE TABLE generations (            -- one row per draft the harness produced
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  kind TEXT NOT NULL, platform TEXT, format TEXT,
  provider TEXT, model TEXT, snapshot_version INTEGER,
  system_hash TEXT, prompt TEXT NOT NULL, output TEXT NOT NULL, thinking TEXT,
  auto_checks TEXT,                    -- JSON: {fitsLimit, parsed, fitScore, banned:[]}
  created INTEGER NOT NULL
);
CREATE TABLE feedback (
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                  -- picked | ignored | edited | rated | result
  value TEXT,                          -- edited text, rating, or result JSON
  at INTEGER NOT NULL
);
CREATE TABLE model_versions (
  name TEXT PRIMARY KEY,               -- reticle-r1:v3
  base TEXT NOT NULL,                  -- deepseek-r1:latest (+ HF base id used for training)
  adapter_path TEXT, dataset_id TEXT, eval TEXT,   -- eval JSON (metrics vs baseline)
  status TEXT NOT NULL,                -- registered | evaluating | passed | failed | active | retired
  created INTEGER NOT NULL
);
CREATE TABLE datasets (id TEXT PRIMARY KEY, kind TEXT, path TEXT, rows INTEGER, stats TEXT, created INTEGER);
```

#### Dataset builder

Two output formats, both JSONL under `DATA_DIR/training/<dataset-id>/`:

- **`sft.jsonl`** (supervised): `{"messages":[{system},{user},{assistant}]}`. The assistant text is, in priority order: your edited final text, then a picked draft that passed every automatic check. Examples are weighted (duplicated or tagged) by logged result.
- **`prefs.jsonl`** (preference, for DPO/ORPO later): `{"prompt":…, "chosen":…, "rejected":…}` built from picked-vs-ignored siblings and good-vs-failed-checks pairs.
- **`eval.jsonl`**: a held-out 10–15% split, stratified by platform and kind, frozen per dataset and never trained on.

Rules applied at build time:

- **Reasoning traces:** R1 distills are trained to think before answering. SFT on answers alone can erode that. Default: include the model's own `thinking` when the example came from Ollama. For examples whose target is your edited text, use a short empty think block (`<think>\n\n</think>`) so the model learns "for voice tasks, answer directly". This is a tunable option (`thinking: keep | empty | drop`).
- **Prompts are re-rendered** from the stored inputs with the *current* playbook, so training matches what inference will send.
- **Deduplicate and filter:** near-duplicate outputs, very short targets, and anything that failed limits or banned-phrase checks.
- **Minimum size gate:** refuse to build below about 150 SFT rows (LoRA on fewer mostly memorizes). The UI shows progress toward it.
- **Data rights:** use *your own* text and outputs you are allowed to train on. Training on another provider's outputs (for example Claude drafts you didn't edit) may be restricted by that provider's terms. The builder has a `sources` filter (`ollama-only`, `user-edited-only`, `all`) and defaults to `ollama + user-edited`. Check the terms before widening it.

#### Training (out of process)

Reticle ships a small `trainer/` folder (Python, not imported by the app):

```
trainer/
  train_lora.py      # Unsloth/PEFT QLoRA on deepseek-ai/DeepSeek-R1-0528-Qwen3-8B (fp16/bf16 HF weights)
  export_gguf.py     # merge → GGUF (llama.cpp convert) or export adapter GGUF
  requirements.txt
  README.md          # hardware, WSL2 notes, expected runtime
```

- **Hardware:** QLoRA on 8B needs about 10–12 GB VRAM (an RTX 3060 12 GB or better). On Windows, use WSL2 or native Unsloth. A few hundred examples × 2–3 epochs is about 20–60 minutes.
- **Hyperparameters to start with:** LoRA r=16, alpha=32, dropout 0.05, lr 1e-4–2e-4, 2–3 epochs, max_seq 8192, completion-only loss.
- **Two ways to run it:**
  1. **Manual (default):** Settings → *Export dataset* writes the folder and prints the exact command. You run it and then click *Register adapter*.
  2. **Managed (opt-in):** `settings.trainer = { python, script, workdir }`. A `model.train` task spawns the process, streams its log into `task_events`, and registers the output when it exits 0. It is subject to the same limiter idea: training and Ollama inference never share the GPU at the same time (the task stops Ollama models via `keep_alive: 0` before starting).

#### Register → evaluate → promote

1. **Register:** write a Modelfile and run `ollama create reticle-r1:vN -f Modelfile` (through the CLI or `POST /api/create`).
   ```
   FROM deepseek-r1:latest
   ADAPTER ./adapter.gguf            # or FROM ./merged.gguf when you merge instead
   PARAMETER num_ctx 16384
   PARAMETER temperature 0.6
   PARAMETER top_p 0.95
   ```
   The adapter must be trained on the **same base** as `FROM`. Reticle records both IDs and refuses to register if `ollama show` reports a different architecture.
2. **Evaluate** (`model.eval` task): run the frozen `eval.jsonl` through both the candidate and the current active model, with identical prompts and seeds, and score each output automatically using **the harness you already have**:

   | Metric | Source |
   |---|---|
   | format compliance (parsed variants / valid JSON) | `parseVariants`, schema validation |
   | fits platform limit without shortening | `domain/limits`, `enforce` |
   | pattern-fit score | `domain/fit` (`fitScorer`) |
   | voice similarity to your edited targets | embedding cosine via Ollama `/api/embed` (e.g. `nomic-embed-text`) |
   | banned phrases / "never do" violations | playbook rules |
   | latency p50/p95, tokens/s | task timings |
   | optional LLM-judge pairwise win rate | Claude or base R1 as judge, blind A/B order |

3. **Gate:** promote only if the candidate is ≥ baseline on compliance and limits **and** improves voice similarity or judge win rate by a set margin, with no metric dropping more than 5%. Otherwise the version is marked `failed` with its report.
4. **Promote:** routing entries that point at the old version switch to `reticle-r1:vN`; the previous version is kept for instant **rollback**. After promotion, an **online check** compares the pick rate and logged results over the next N drafts (a shadow or A/B option sends 1 of 3 variants from each model).

---

## 5. Task kinds added (on the ADR-001 worker)

| Kind | What it does | Limiter |
|---|---|---|
| `ollama.pull` | `POST /api/pull`, streams progress | network |
| `ollama.warm` | load the model with `keep_alive` before scheduled runs | ollama:1 |
| `dataset.build` | feedback → JSONL + stats + eval split | cpu |
| `model.train` *(opt-in)* | spawn the Python trainer, stream logs | gpu:1 (excludes ollama) |
| `model.register` | Modelfile + `ollama create` + architecture check | ollama:1 |
| `model.eval` | run eval set on candidate vs active, score, write report | ollama:1 |
| `model.promote` / `model.rollback` | update routing, record the change | — |

---

## 6. Trade-offs

| Choice | Alternative | Why |
|---|---|---|
| Direct Ollama provider | Keep using Ollama through OpenCode | Direct gives `think`, `format`, `num_ctx`, `keep_alive`, streaming and `/api/ps`, all of which OpenCode's one-shot text endpoint hides. OpenCode stays for its other providers. |
| `/api/chat` | OpenAI-compatible `/v1/chat/completions` | The native API exposes `think`, `keep_alive` and `options.num_ctx`. Using `/v1` would also make LM Studio or vLLM easy later, so the provider is written against a small interface and a `/v1` adapter can be added if needed. |
| LoRA + Ollama `ADAPTER` | Full fine-tune; merged GGUF | LoRA is about 50–200 MB per version, fast to train, and easy to stack and roll back. Merging is supported for setups where `ADAPTER` is unsupported for the architecture. |
| Training outside Node | Train inside the app | Python owns the ML stack; keeping it outside avoids CUDA and Python dependencies in the Node image and the Docker build. |
| SFT first, preferences later | DPO from day one | Preference pairs need volume (hundreds of picked/ignored pairs). SFT on edited text gives the biggest voice gain with the least data. |
| Automatic eval gate | Trust your eyes | Fine-tunes regress silently (format drift, lost reasoning). The harness already contains the metrics, so it is cheap to use them. |

**Main risks:** small datasets overfit (mitigated by the size gate and held-out eval); the reasoning phase hurts latency for interactive kinds (mitigated by routing interactive kinds to Claude, or with `think: false` for short tools — a setting per kind); GPU contention between training and inference (mitigated by the shared GPU limiter).

---

## 7. Implementation plan

| Phase | Work | Depends on | Effort |
|---|---|---|---|
| **A. Provider** | `ollama` ProviderId; `providers/ollama.ts` (chat, stream, think, format, num_ctx sizing, abort); model list from `/api/tags`; health from `/api/version` + `/api/ps`; `OLLAMA_HOST` setting; strip `<think>` fallback; Docker docs | Works on today's `lib/ai.ts` (add to `RUNNERS`, `PROVIDER_LABEL`, `MODEL_CHOICES`, config validation) | 1 day |
| **B. Routing** | per-kind routing setting + router; limiter ollama:1; record attempts | ADR-001 limiter (a simple semaphore works before that) | 1 day |
| **C. Capture** | `generations` + `feedback` tables; record picked / ignored / edited / rated / result | ADR-003 migrations | 1–2 days |
| **D. Dataset** | `dataset.build` task; SFT, prefs and eval JSONL; filters; size gate; export UI action | C | 1–2 days |
| **E. Trainer kit** | `trainer/` scripts + README; manual path first | D | 1–2 days |
| **F. Registry & eval** | `model_versions`; register via `ollama create`; eval task + report; promote/rollback; optional A/B | B, D | 2–3 days |
| **G. Managed training** *(opt-in)* | `model.train` task spawning Python; GPU limiter | E, ADR-001 | 1 day |

Phase A is useful on its own today: DeepSeek-R1 becomes selectable in every AI feature. Phases C–D should start early because data accumulates over weeks; training only becomes worthwhile once about 150+ good examples exist.

---

## 8. Revisit later

- **Bigger local models** (14B/32B R1 distills or other families): the router and eval gate already make A/B swaps safe.
- **Embeddings for retrieval:** `/api/embed` with a local embedding model can pick winner cards by semantic similarity to your idea instead of only by outlier score.
- **Preference training (DPO/ORPO)** once there are about 500 pairs.
- **Multiple adapters per platform** (`reticle-r1-x`, `reticle-r1-linkedin`) if one adapter underfits across very different formats.
