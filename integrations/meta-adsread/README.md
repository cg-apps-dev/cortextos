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

## Resolving act_ids + proving coverage (per fresh BM token)

When a BM token lands but some `act_id`s are unknown (or to prove the token reads the
full granted set), query `/me/adaccounts` ON the token itself - it enumerates exactly
the accounts that token can access, with `account_id` + `name`:
```
GET https://graph.facebook.com/v25.0/me/adaccounts?fields=account_id,name&access_token=<vault token>
```
This is more reliable than the FB Assets Tracker (which lags) and doubles as a COVERAGE
proof (no blind spots). Always redact the token from any output. Example: the `alirezacg`
token enumerated AliCG1 + AliCG2 + AliCG3 in one call, resolving two unknown act_ids.

## API version

`GRAPH_API_VERSION` is pinned (single bump point) to the current GA Graph/Marketing API
version. As of 2026-07 = `v25.0` (GA since 2026-02, verified from Meta's changelog). Bump
in one place when Meta releases a new GA and the old one nears deprecation.

## Accounts (blind-set) - tokens land as Adam builds each BM

| E-code | act_id | portfolio | bm_slug | token |
|---|---|---|---|---|
| CG-AGY-1 | act_3143544815853824 | 1502991767957367 (CG Host) | cghost | LANDED - live-verified; token rotated to the shared app (helper picked up the swap zero-change, fresh-read-per-call) |
| JCG1 | act_1520076759702669 | 1525068304367805 (CG Business / Jonas) | jcg | LANDED - live-verified |
| JCG2 | act_2239846920175881 | 1525068304367805 (CG Business / Jonas) | jcg | LANDED - live-verified (SAME token as JCG1 - shared-app proof) |
| AliCG1 | act_2180010646097084 | 2358286301637483 (Ali Reza CG) | alirezacg | LANDED - live-verified (3 campaigns) |
| AliCG2 | act_3641597392655827 | 2358286301637483 (Ali Reza CG) | alirezacg | LANDED - live-verified (1 campaign; act_id resolved via /me/adaccounts) |
| AliCG3 | act_1016871730924954 | 2358286301637483 (Ali Reza CG) | alirezacg | LANDED - readable, 0 campaigns (empty acct; discovered via /me/adaccounts) |
| E-0930 | act_1010516044876635 | 998703455883601 (HT-G2) | n/a | INTENTIONALLY-EXCLUDED - restricted + retired by Adam 2026-07-21 (stopped using weeks ago). NOT a coverage gap; do NOT re-flag as missing in /me/adaccounts reconciliation. No token, no access needed. |
| E-0558 | act_1268263495454014 | Exi-BMN-162 (Exiscale) | exiscale | LANDED - live-verified 4 camp/224 ads; lives in Exiscale BM, not HT-G2 (README guess corrected) |

### Exiscale BM (Exi-BMN-162) - 10 accounts, one shared-app SU token (`exiscale.adsread.token`)

Enumerated via `/me/adaccounts` (E-codes self-declared in account names). All LIVE. Indexed.

| E-code | act_id | campaigns(active) | ads(active) |
|---|---|---|---|
| E-0628 | act_961695713306441 | 4(2) | 162(122) |
| E-0842 | act_1684271439433192 | 4(2) | 231(126) (also ak_-readable) |
| E-0828 | act_1442758003808819 | 4(2) | 209(125) (also ak_-readable) |
| E-0750 | act_1290506663038054 | 5(0) | 131(0) |
| E-0682 | act_1283879943251089 | 3(1) | (ads recount pending - rate cap) |
| E-0639 | act_935623455755124 | 3(1) | 125(104) |
| E-0558 | act_1268263495454014 | 4(2) | 224(136) |
| E-0681 | act_1461686192642303 | 4(2) | 324(215) |
| E-0593 | act_1681011799914295 | 2(0) | 128(0) |
| E-0537 | act_4255987457989779 | 6(2) | 150(79) |

As each BM token lands (orch provides `<bm_slug>` + the covered E-codes), add the vault
`<bm_slug>.adsread.token` + a per-E-code entry to `adsread-index.json`.
