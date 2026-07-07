# META Ad Upload Sheet — Column-Ownership Map & Write Protocol

**Status:** RATIFIED by the-orchestrator (2026-06-04). Canonical — both meta-ads-agent and meta-media-buyer-agent read this.
**Sheet:** `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME` ("META - Ad Upload Sheet")
**Exact column letters/names:** always header-map by NAME from [`column-maps.md`](./column-maps.md) (same directory; live read, never hardcode letters). This doc assigns ownership by **category** — `column-maps.md` is the source of the exact columns.

## Why this exists
The pipeline split created **two writers** on one sheet with **no lock**:
- **meta-ads-agent** — content half: ClickUp intake → copy / avatar / actor.
- **meta-media-buyer-agent** — media-buying half: batching → AdManage drafts → launch / review-status.

Two writers + no lock = risk of a concurrent read-modify-write clobbering each other's columns or shifting the header map. This map + protocol removes that risk.

## Column ownership (by category)

### meta-ads-agent OWNS (content / intake columns) — writes; media-buyer reads only
- ClickUp intake fields (Card ID, status mirror, concept/theme)
- Customer Avatar, Funnel Stage
- Headline + Headline Var. 1–4
- Primary (Primary Text / body) + Primary Var. 1–4
- Ad Description
- Media URLs (Drive links), asset/tab fields
- Actor Age Bracket (auto-populated by intake vision)
- Ad Name (the verbatim Stage-4 join key — authored on the content side)
- Any other copy / creative / intake-produced column

### meta-media-buyer-agent OWNS (launch / review-status columns) — writes; content side reads only
- **Review / delivery status** (current AdManage review state, incl. disapproved stamps)
- **`Ad Set Group`** — bundle-ID selection record (adset-batch STEP 2; operator confirms)
- **Per-account launch stamps** — which account(s) each ad is live in (Stage-4 launch-tracker stamp-back)
- Any other launch / tracking-produced column

### Shared-read, neither writes casually
- **Header row (row 1).** Structural. Only the agent ADDING a new column touches row 1, anti-clobber (append at end-of-range, re-read row 1 after, verify no map shift, verify the `Ad Name` formula isn't an open full-row range that captures the new column). Announce structural column adds in advance.

## Write protocol (no concurrent RMW)
1. **One writer per row-range at a time.** Never both agents read-modify-write the same tab simultaneously.
2. **Announce the write window** via heartbeat/bus before a pass ("writing `Ad Set Group`/review-status on tab X, ~N rows"); the other writer holds writes on that tab until it clears.
3. **Mid-batch = no cross-writes.** If the other agent's heartbeat shows it active in its batch, hold your writes on that tab until it reports done (orchestrator greenlights the window). (Applied 2026-06-04: media-buyer held a review-status refresh while meta-ads was mid video+static batch.)
4. **Stay strictly in your owned columns.** Write only your category's columns; never overwrite the other side's. Read theirs freely.
5. **Batch + targeted writes.** Prefer a single batched update of only the owned column(s) over per-cell round-trips, to shrink the collision window. (Composio `GOOGLESHEETS_BATCH_UPDATE` via `COMPOSIO_MULTI_EXECUTE_TOOL`.)
6. **Re-map by name every run.** Header-map columns by NAME before any write; never trust a cached letter — a structural add by the other side may have shifted positions.
7. **On conflict, the orchestrator arbitrates.** If both need to write the same tab urgently, ping the-orchestrator to sequence — don't race.
