#!/usr/bin/env python3
"""Meta Marketing-API ads_read read helper (per-BM vault token, leak-safe).

Reads ad-account data (adsets / ads / campaigns / insights / ...) via the Meta
Marketing API using a per-Business-Manager System-User ads_read token. The token
NEVER leaves the vault: this helper resolves an account -> BM -> vault token file,
calls the Graph API, and prints JSON. The token is never printed or logged.

CONVENTION (canonical, dev-owned read path):
- Tokens live OUT OF TREE in the vault (leak-safe, never in .env / repo):
    $CTX_ROOT/secure-tokens/<bm_slug>.adsread.token   (0600)
    $CTX_ROOT/secure-tokens/<bm_slug>.adsread.meta     (sidecar: label/bm/su/scope)
  One System-User token PER BM covers whatever ad accounts Adam assigned to that SU.
- A resolver index (NOT secret-bearing, but operationally sensitive -> also vault):
    $CTX_ROOT/secure-tokens/adsread-index.json
    { "<E-code>": { "bm_slug": "<slug>", "act_id": "<numeric ad account id, no act_ prefix>" }, ... }

USAGE (what mmb calls per-account):
    python meta_adsread.py --account E-0930 --endpoint insights \\
        --fields spend,impressions,cpc,ctr --params date_preset=last_7d
    python meta_adsread.py --account E-0930 --endpoint adsets \\
        --fields name,daily_budget,bid_amount,targeting --all
Output: JSON on stdout (mmb parses). Errors: a clear message on stderr + nonzero exit;
the token is redacted from any surfaced error.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

# Current GA Graph/Marketing API version (verified from Meta's changelog at build time,
# 2026-07: v25.0 is GA, introduced 2026-02). Single bump point.
GRAPH_API_VERSION = "v25.0"
GRAPH_HOST = "https://graph.facebook.com"
DEFAULT_TIMEOUT = 30


def _ctx_root():
    return os.environ.get("CTX_ROOT") or os.path.join(
        os.path.expanduser("~"), ".cortextos", os.environ.get("CTX_INSTANCE_ID", "default")
    )


def _vault_dir():
    return os.environ.get("META_ADSREAD_VAULT") or os.path.join(_ctx_root(), "secure-tokens")


def _load_index():
    path = os.path.join(_vault_dir(), "adsread-index.json")
    if not os.path.exists(path):
        raise SystemExit(f"ERROR: resolver index not found at {path} (populate it with E-code -> bm_slug/act_id).")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _resolve(account):
    """account = an E-code (index key) OR a numeric act_id. Returns (act_id, bm_slug)."""
    index = _load_index()
    if account in index:
        entry = index[account]
        return str(entry["act_id"]).replace("act_", ""), entry["bm_slug"]
    # act_id fallback: reverse-lookup the bm_slug by matching act_id
    acct_num = str(account).replace("act_", "")
    for _ecode, entry in index.items():
        if str(entry.get("act_id", "")).replace("act_", "") == acct_num:
            return acct_num, entry["bm_slug"]
    raise SystemExit(
        f"ERROR: account '{account}' not in adsread-index.json (add it as an E-code -> bm_slug/act_id entry)."
    )


def _read_token(bm_slug):
    path = os.path.join(_vault_dir(), f"{bm_slug}.adsread.token")
    if not os.path.exists(path):
        raise SystemExit(f"ERROR: vault token not found: {path} (expected <bm_slug>.adsread.token, 0600).")
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read().strip()


def _redact(text, token):
    """Never let a token reach stderr/logs even if the API echoes it."""
    if token and token in text:
        text = text.replace(token, "<REDACTED_TOKEN>")
    return text


def read(account, endpoint, fields, extra_params, follow_all, limit):
    act_id, bm_slug = _resolve(account)
    token = _read_token(bm_slug)
    params = {"access_token": token}
    if fields:
        params["fields"] = fields
    if limit:
        params["limit"] = str(limit)
    for kv in extra_params or []:
        if "=" in kv:
            k, v = kv.split("=", 1)
            params[k] = v
    base = f"{GRAPH_HOST}/{GRAPH_API_VERSION}/act_{act_id}/{endpoint}"
    url = base + "?" + urllib.parse.urlencode(params)

    collected = []
    try:
        while True:
            with urllib.request.urlopen(url, timeout=DEFAULT_TIMEOUT) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            data = payload.get("data")
            if data is None:
                # non-list endpoint (single object) -> return as-is
                return payload
            collected.extend(data)
            nxt = (payload.get("paging") or {}).get("next")
            if not (follow_all and nxt):
                if follow_all:
                    return {"data": collected}
                return payload
            url = nxt  # next already carries the access_token
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        raise SystemExit(f"ERROR: Marketing API HTTP {e.code} for act_{act_id}/{endpoint}: {_redact(body, token)}")
    except urllib.error.URLError as e:
        raise SystemExit(f"ERROR: Marketing API request failed for act_{act_id}/{endpoint}: {_redact(str(e.reason), token)}")


def main():
    ap = argparse.ArgumentParser(description="Meta Marketing-API ads_read read helper (per-BM vault token).")
    ap.add_argument("--account", required=True, help="E-code (index key) or numeric act_id")
    ap.add_argument("--endpoint", required=True, help="adsets | ads | campaigns | insights | ... (act_<id>/<endpoint>)")
    ap.add_argument("--fields", default="", help="comma-separated field list")
    ap.add_argument("--params", action="append", default=[], help="extra query param k=v (repeatable), e.g. date_preset=last_7d")
    ap.add_argument("--limit", type=int, default=0, help="page size (0 = API default)")
    ap.add_argument("--all", action="store_true", help="follow paging.next and return the full data[] set")
    args = ap.parse_args()
    act_id, bm_slug = _resolve(args.account)
    token = _read_token(bm_slug)
    result = read(args.account, args.endpoint, args.fields, args.params, args.all, args.limit)
    # LEAK-SAFETY: Meta echoes the access_token inside paging.next/previous URLs.
    # Redact the token from the serialized output so it NEVER leaves the vault via stdout.
    out = json.dumps(result, indent=2)
    if token:
        out = out.replace(token, "<REDACTED_TOKEN>")
    sys.stdout.write(out + "\n")


if __name__ == "__main__":
    main()
