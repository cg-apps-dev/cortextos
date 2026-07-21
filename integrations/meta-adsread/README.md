# Meta Marketing-API ads_read read integration

A leak-safe read path for Meta ad-account data (adsets / ads / campaigns / insights)
via per-Business-Manager System-User `ads_read` tokens. Unblinds accounts that the
mmb `ak_` key cannot read (per-account-grant gaps). Built 2026-07-21 (dev lane).

## Design (canonical)

- **Tokens live OUT OF TREE in the vault** - never in `.env` / the repo (200-char
  never-expiry EAA System-User tokens = a leak surface; the out-of-tree vault is safer):
  - `$CTX_ROOT/secure-tokens/<bm_slug>.adsread.token`  (0600)
  - `$CTX_ROOT/secure-tokens/<bm_slug>.adsread.meta`    (sidecar: label / bm / system_user / scope)
- **One System-User token per BM**, but `ads_read` is granted **per-account** within the
  BM (proven: BM-siblings can differ in readability). So a token covers only the specific
  accounts Adam assigned to that SU - the index lists each granted E-code individually.
- **Resolver index** (not secret, but operationally sensitive -> also vault):
  - `$CTX_ROOT/secure-tokens/adsread-index.json`
  - `{ "<E-code>": { "bm_slug": "<slug>", "act_id": "act_<num>", "portfolio_id": "<id>" }, ... }`
  - Built STRUCTURALLY from `act_id` + `portfolio_id` (the FB Assets Tracker Status column
    LAGS reality - do NOT use it; structure only).
- **The token NEVER leaves the vault via output.** Meta echoes the `access_token` inside
  `paging.next` URLs; the helper redacts the token from all stdout (`<REDACTED_TOKEN>`).

## Query path (what mmb calls, per account)

```
python integrations/meta-adsread/meta_adsread.py \
    --account <E-code|act_id> \
    --endpoint <adsets|ads|campaigns|insights|...> \
    --fields <comma,separated,fields> \
    [--params date_preset=last_7d] [--params ...] \
    [--limit N] [--all]
```
- `--account` an E-code (index key) or a numeric `act_id`. mmb never handles the token.
- `--endpoint` the `act_<id>/<endpoint>` edge.
- `--all` follows `paging.next` and returns the full `data[]`.
- Output: JSON on stdout (token-redacted). Errors: clear message on stderr + nonzero exit.

Example (proven live on CG-AGY-1):
```
python integrations/meta-adsread/meta_adsread.py --account CG-AGY-1 --endpoint campaigns --fields name,status
```

## API version

`GRAPH_API_VERSION` is pinned (single bump point) to the current GA Graph/Marketing API
version. As of 2026-07 = `v25.0` (GA since 2026-02, verified from Meta's changelog). Bump
in one place when Meta releases a new GA and the old one nears deprecation.

## Accounts (blind-set) - tokens land as Adam builds each BM

| E-code | act_id | portfolio | bm_slug | token |
|---|---|---|---|---|
| CG-AGY-1 | act_3143544815853824 | 1502991767957367 (CG Host) | cghost | LANDED - in index, live-verified (steady token, no rotation - Adam's call) |
| JCG1 | act_1520076759702669 | 1525068304367805 (CG Business / Jonas) | jcg | LANDED - live-verified |
| JCG2 | act_2239846920175881 | 1525068304367805 (CG Business / Jonas) | jcg | LANDED - live-verified (SAME token as JCG1 - shared-app proof) |
| AliCG1 | act_2180010646097084 | 2358286301637483 (Ali Reza CG) | tbd | pending (+ AliCG2 same BM) |
| E-0930 | act_1010516044876635 | 998703455883601 (HT-G2) | tbd | pending (siblings E-0842/E-0828 read via ak_) |
| E-0558 | act_1268263495454014 | 1660120598450008 (HT-G2) | tbd | pending (siblings read via ak_) |

As each BM token lands (orch provides `<bm_slug>` + the covered E-codes), add the vault
`<bm_slug>.adsread.token` + a per-E-code entry to `adsread-index.json`.
