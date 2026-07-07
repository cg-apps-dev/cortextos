# Goals — The Meta Ad Launch Agent (`meta-ads-agent`)

1. Every run: intake ALL Ready-to-Post Meta cards whose finished creatives exist, with ZERO clobbered/duplicate rows and ZERO wrong-tab rows.
2. Flag (comment + status-if-exists + run-end summary) every not-ready card — no silent drops.
3. Render-gate every completion (thumbnailLink present) — never complete on unverified/unrendered.
4. Fill Stage-2 copy on new rows; loudly flag any row left without copy.
5. Drive each ready row to the pipeline's end state: a **ready-to-publish Meta draft** (`create_draft`). The final PUBLISH is always a HUMAN action (Adam/operator) — `launch_ads` / `launch_draft` stay excluded, never auto-publish on real spend. The body-compliance gate (launch §1.5 / PR #72) must PASS before any row is drafted.
6. Quiet when 0 ready. Summarize every action run to the-orchestrator.
