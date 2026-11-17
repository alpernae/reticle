# ADR-007: Feedback capture and an eval-gated fine-tuning loop for local models

**Status:** Proposed
**Date:** 2026-11-17
**Deciders:** Maintainer (alpernae)

## Context

The goal is a closed loop: **Ollama → harness → user → (feedback) → better local model**. A generic 8B reasoning distill does not write in the creator's voice. The only data that can teach it is the creator's own behaviour: which drafts they pick, how they edit them, and how the posts actually perform.

Today Reticle keeps final outputs in `ai_runs.output` and logged results in `manual`, but it does not link a posted result back to the exact draft, prompt and model that produced it. It also does not record picks, ignores or edits. Ollama can serve adapters (`ADAPTER` in a Modelfile) but cannot train them.

## Decision

1. **Capture:** store every draft as a `generations` row (prompt, output, thinking, model, snapshot version, automatic checks) and every user signal as `feedback` (picked, ignored, edited text, rating, real result).
2. **Build datasets** with a `dataset.build` task: SFT JSONL (targets = user-edited text first, then picked drafts that passed all checks, weighted by real results), preference JSONL (chosen/rejected pairs) and a frozen held-out eval split. Filters, deduplication, a size gate (≥ ~150 SFT rows) and a source filter (default: Ollama outputs + user-edited text).
3. **Train outside Node:** a `trainer/` Python kit (Unsloth/PEFT QLoRA on the fp16 HF base `DeepSeek-R1-0528-Qwen3-8B`). Manual by default; an optional `model.train` task can spawn it and stream its logs. The GPU is never shared with Ollama inference during training.
4. **Register** the adapter with `ollama create reticle-r1:vN` (Modelfile `FROM` base + `ADAPTER`), after checking that the architecture matches.
5. **Gate on evaluation:** a `model.eval` task runs the frozen eval set on the candidate and the active model and scores both with the harness's own checks (format compliance, limit fit, pattern-fit score, voice similarity via local embeddings, banned phrases, latency, optional blind LLM judge).
6. **Promote or roll back** through the routing setting; keep previous versions for one-click rollback; optionally A/B one variant per Generate run to watch pick rate and real results after promotion.

## Options Considered

### Option A: LoRA SFT on user-derived data, eval-gated (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium: capture + dataset + registry + eval; the trainer is a script |
| Cost | Local GPU time (about 20–60 min per run on a 12 GB card) |
| Scalability | Adapters are about 50–200 MB; any number of versions |
| Team familiarity | Medium: needs basic PEFT/Unsloth knowledge |

**Pros:** learns the creator's actual voice; fully private; versioned and reversible; the eval gate reuses existing domain code.
**Cons:** needs weeks of feedback before the first useful run; requires a GPU and a Python environment.

### Option B: Prompt-only personalization (few-shot with the user's best posts)
**Pros:** no training; works today with any model.
**Cons:** consumes context on every call; weaker voice transfer on 8B models. **Do it anyway as the baseline** (retrieve 3–5 of your edited posts into the prompt), since it costs little and becomes the bar a fine-tune must beat.

### Option C: Preference optimization (DPO/ORPO) from day one
**Pros:** directly optimizes "picked over ignored".
**Cons:** needs many more pairs than are available early and is unstable with tiny data. Plan it as a later stage on the same dataset builder.

### Option D: Distill Claude outputs into the local model
**Pros:** plentiful, high-quality targets.
**Cons:** possible conflict with the provider's terms on using outputs to train models; teaches Claude's voice, not yours. Excluded by default via the source filter; the user decides after checking the terms.

## Trade-off Analysis

Voice is the gap between an 8B model and the drafts the user actually wants, and user-edited text is the highest-quality signal for voice. LoRA SFT is the cheapest technique that uses it. Because fine-tunes can silently regress (lost reasoning, format drift), the automatic eval gate built from the harness's existing checks is what makes the loop safe to run repeatedly.

## Consequences

- **Easier:** measurable model improvement over time; a dataset that is useful even for prompt-only retrieval (Option B); full provenance from a posted result back to the prompt and model.
- **Harder:** more state (generations, feedback, versions, datasets); storage for datasets and adapters under `DATA_DIR`; a Python/GPU prerequisite for training (documented, optional).
- **Revisit:** DPO/ORPO at about 500 preference pairs; per-platform adapters if one adapter underfits; larger base models once the eval harness exists.

## Action Items
1. [ ] Migrations: `generations`, `feedback`, `datasets`, `model_versions`.
2. [ ] Record generations in drafts/tools use cases; add feedback capture points (pick, copy, save, edited "posted text", rating, result link on Winners).
3. [ ] Retrieval baseline: put your top edited posts into prompts as voice examples.
4. [ ] `dataset.build` task + export action + size gate + source filter + thinking mode option.
5. [ ] `trainer/` kit (train_lora.py, export_gguf.py, README with WSL2/VRAM notes).
6. [ ] `model.register` (Modelfile + `ollama create` + architecture check), `model.eval` (report), `model.promote` / `model.rollback`, optional A/B.
