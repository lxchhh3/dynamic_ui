# LLM layer — status & handoff for site build

This is what the LLM layer in `eval/` does today, what shape of data it produces,
and what the web frontend has to do to use it safely.

## What it does

Given a **user intent** (one sentence, English or Chinese) and a **component
registry** (JSON schema describing available UI components and their props),
the LLM outputs **one JSON object** that picks a single component and fills
its props:

```
intent:    "Add a submit button to the checkout page."
output:    {"component": "Button", "props": {"label": "Submit", "variant": "primary"}}
```

The model is **Qwen3-14B (AWQ 4-bit)**. It runs locally in the
`qwen-eval:nv25.02` Docker image, consumes ~10 GB VRAM, and answers in
~2–3 seconds (up to ~5 s when a validation retry fires).

## Contract

### Input
- `intent`: free-form string, ≤ 1000 characters (truncated if longer)
- `registry`: same schema as `eval/registry.json` — array of components, each
  with typed props, optional `enum`, and `required` flags

### Output — success
```json
{
  "component": "Card",
  "props": {
    "title": "Homemade Fried Rice",
    "body": "1. Cook rice... 2. Heat a pan...",
    "imageUrl": "https://example.com/fried-rice.png"
  }
}
```

Exactly one component. Only props declared on that component. String/number/
boolean/array types enforced. Enum values guaranteed to be from the declared
enum.

### Output — refusal
When the user tries to leak the system prompt, swap the model's role, force
markdown, or otherwise subvert the task:
```json
{"component":"Alert","props":{"message":"Request not supported.","severity":"info"}}
```
Treat this as a signal that the request was off-task; log it and optionally
don't render.

### Output — warnings (non-blocking)
The validator returns a `warnings` array alongside the parsed JSON. Each
warning has a `code`, the affected `prop`, and extra context. The model's
output is still considered "valid" when warnings fire — the site is expected
to apply the defense.

| code | meaning | site must do |
|---|---|---|
| `dangerous_substring` | prop value contains `<script`, `javascript:`, `on*=`, `data:text/html`, `eval(`, `<iframe`, `document.cookie` | escape or drop the value |
| `url_scheme_not_allowed` | `imageUrl` not in `http://`, `https://`, `/`, `data:image/` | drop the imageUrl |
| `handler_not_allowlisted` | `onClick`/`onClose`/`onSubmit` is not a bare `identifier()` call | **never eval** — look up the handler name in the site's allowlist or ignore |
| `string_too_long` | prop value exceeds per-prop cap (labels 200, body 4000) | truncate with ellipsis |
| `system_prompt_echo` | prop value paraphrased ≥ 2 rule fragments | treat as refused, show neutral Alert |

### Output — errors (blocking)
Before the retry loop exhausts, any of these makes the response invalid and
triggers one retry with the error list fed back to the model:
- `json_unparseable`, `duplicate_key`, `missing_top_key`, `component_not_in_registry`,
  `missing_required_prop`, `unknown_prop`, `type_mismatch`, `enum_violation`

If retries run out, the final response still has `valid: false` and the site
should show an error state instead of rendering.

## Security model

Four layers, cheapest first:

1. **Input length cap** (server-side, pre-prompt) — intents > 1000 chars are truncated.
2. **Hardened system prompt (v5)** — instructs the model to treat user text as
   untrusted data, refuse role-swap / prompt-leak / meta-commentary, and emit
   the neutral "Request not supported" Alert for subversion attempts.
3. **Validator** — structure, component membership, required props, enum,
   types, duplicate top-level keys.
4. **Value sanitizer** — warns on payload-shaped strings (see warnings table).

What the **site is responsible for**:
- Never `eval()`, `new Function()`, or `dangerouslySetInnerHTML` on any prop
  value. String values are content, not code.
- Handler props are **identifier strings**, not executable code. Maintain an
  allowlist on the frontend (`{ submitForm: () => ..., openSupport: () => ... }`)
  and ignore unknown names.
- Escape all string values on render. React does this by default for text;
  watch out for anywhere you pass props into HTML attributes directly.
- Content-Security-Policy header that blocks inline scripts and unsafe eval.

## Performance

| metric | value |
|---|---|
| Model | Qwen3-14B-AWQ 4-bit |
| VRAM (peak) | ~10 GB |
| Model load time | ~30–40 s (one-time, at container start) |
| Per-request latency (no retry) | ~2–3 s |
| Per-request latency (1 retry) | ~5 s |
| Max tokens out | 512 (more than enough for one component) |
| Sampling | greedy, temperature=0, seed=0 (deterministic) |
| Hardware | RTX 5070 Ti, Blackwell sm_120, 16 GB VRAM |

## Current status

Done (in `eval/`):
- 3-model benchmark across 30 bilingual prompts — **Qwen3-14B-AWQ picked** (leaderboard.json)
- Validator (`validate.py`) with structural + enum + type + duplicate-key + value-sanitizer checks
- Retry-with-feedback loop in `run_model.py` — converges on enum/type/unknown-prop errors
- System prompt v5 with 2 few-shot examples, one-component rule, role-hardening, anti-echo rule
- Adversarial probe (10 intents) and security probe (12 intents) — results in `probe_out_v3.json`, `probe_security_v5.json`

Not yet done (LLM side):
- **HTTP serving endpoint** — currently batch-only (`run_model.py` reads `prompts.json`). Needs a small FastAPI wrapper to accept `POST /render {intent, registry}` and return `{component, props, warnings, valid}`. Design is straightforward; will build when the site-side shape stabilizes.
- **Real registry** — current `eval/registry.json` is a 15-component demo. Swap in when site provides the real one; everything is registry-driven so no code changes needed.
- **Constrained JSON decoding** — deferred. Retry-with-feedback hits 100% valid on the tested subset; constrained decoding adds a dependency and saves latency but may mask model confusion, not a clear win yet.

## How to invoke today

From the WSL/Git-Bash shell, with Docker Desktop running:

```bash
# Batch mode — runs all 30 eval prompts
MSYS_NO_PATHCONV=1 docker run --rm --gpus all \
  -v /d/Proj/local_qwen_workspace:/workspace -w /workspace/eval \
  qwen-eval:nv25.02 \
  python run_model.py \
    --model models/qwen3-14b \
    --output-key qwen3-14b \
    --model-family qwen3 \
    --dtype float16 \
    --enable-thinking false \
    --max-new-tokens 512 \
    --max-retries 1

# Ad-hoc probe — pass any intents.json
MSYS_NO_PATHCONV=1 docker run --rm --gpus all \
  -v /d/Proj/local_qwen_workspace:/workspace -w /workspace/eval \
  qwen-eval:nv25.02 \
  python probe.py \
    --model models/qwen3-14b \
    --model-family qwen3 \
    --enable-thinking false \
    --max-retries 1 \
    --intents <your_intents.json> \
    --out <your_out.json>
```

Each response includes `attempts[]` (every generation attempt with its text,
validation state, and warnings), `retries_used`, `valid_after_retries`, and
`warnings` at the top level.

## Files

```
eval/
  registry.json              # demo 15-component registry
  prompts.json               # 30 eval prompts (15 EN + 15 ZH)
  validate.py                # structural validator + value sanitizer
  run_model.py               # batch generator with retry loop
  probe.py                   # ad-hoc tester (adversarial/security probes)
  checks.py                  # post-hoc validator over a responses/*.json file
  adversarial_intents.json   # 10 off-task probes
  security_intents.json      # 12 injection/leak/payload probes
  responses/                 # raw model outputs
  responses_checked/         # same, annotated with validator flags
  scores/                    # pointwise 1-5 judge scores (eval phase)
  leaderboard.json           # model-selection result
  probe_out_v3.json          # adversarial probe result
  probe_security_v5.json     # security probe result
```
