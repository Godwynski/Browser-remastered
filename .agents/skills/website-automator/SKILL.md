---
name: website-automator
description: Playbook for universal web automation with brave-mcp: single-call step batching, label targeting, delta observations, and zero-turn workflows.
---

# Universal Website Automator (`brave-mcp`)

1. **Act without observing when labels are known**: `brave_act` accepts `ref: "Sign in"`, `ref: "button:Save"`, or `ref: "css:#q"`.
2. **Batch sequences in one turn**: Put `goto`, `type`, `select`, `click`, `wait` into `brave_act({ steps: [...] })`. Intermediate steps skip heavy settle polling and return only the final delta.
3. **Read cheaply**:
   - `brave_read` extracts clean Markdown (paged via `offset`).
   - `brave_read({ network: true })` lists captured XHR/fetch JSON responses (`response: n` reads the body).
   - `brave_eval` runs in-page JS and returns JSON directly.
4. **Loop without LLM turns**: Use `brave_workflow` with `paginate_extract`, `bulk_action`, or `run_script` (`table-exporter`, `media-harvester`, `parallel-crawler`, `crop-screenshot`).
5. **Cropped visuals**: When a screenshot is needed, pass `crop: "css-selector"` to `brave_observe` to save 85%+ visual tokens.
