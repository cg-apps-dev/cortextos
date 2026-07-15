#!/usr/bin/env python3
"""Verify + correct the Customer Avatar cell against the ClickUp field, last-N rows.
Field is authoritative (Adam): fill blanks + correct mismatches to the resolved field value.
Usage: python3 avatar_verify.py [--write] [--since YYYY-MM-DD]"""
import os, sys, re, json, subprocess
HERE="/Users/adamfolker/cortextos/orgs/clean-green-marketing/agents/meta-ads-agent/skills/meta-intake"
sys.path.insert(0, HERE)
import resolve_cards as rc
SHEET="1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME"; A="adam@cleangreen.com"
TABS=["IMAGES (Flower)","VIDEOS (Flower)","IMAGES (Sleep Gummies)","VIDEOS (Sleep Gummies)"]
def L(i):
    s="";i+=1
    while i:
        i,r=divmod(i-1,26);s=chr(65+r)+s
    return s
def get(rng):
    o=subprocess.run(["gog","sheets","get",SHEET,rng,"-a",A,"-j","--results-only"],capture_output=True,text=True,timeout=120)
    return json.loads(o.stdout or "[]")
def batch(data):
    if not data: return 0
    o=subprocess.run(["gog","sheets","batch-update",SHEET,"--data-json="+json.dumps(data),"-a",A],capture_output=True,text=True,timeout=180)
    if o.returncode: raise RuntimeError(o.stderr[:200])
    return len(data)
def cid_of(u):
    m=re.search(r"/t/([A-Za-z0-9]+)",u or "") or re.search(r"([A-Za-z0-9]{6,})$",u or "")
    return m.group(1) if m else ""
def norm(s):  # normalize avatar string for compare (order-insensitive for multiples)
    return ", ".join(sorted(p.strip() for p in (s or "").split(",") if p.strip()))
def main():
    write="--write" in sys.argv
    since=sys.argv[sys.argv.index("--since")+1] if "--since" in sys.argv else None
    rows_by_card={}; rowinfo=[]
    for tab in TABS:
        hdr=get(f"{tab}!1:1")[0]; H={(h or '').replace('\n',' ').strip().lower():i for i,h in enumerate(hdr)}
        need={"added":"added to sheet","av":"customer avatar","card":"clickup card id"}
        if any(v not in H for v in need.values()):
            print(f"  WARN {tab}: missing headers, skip"); continue
        idx={k:H[v] for k,v in need.items()}
        lo,hi=min(idx.values()),max(idx.values())
        data=get(f"{tab}!{L(lo)}2:{L(hi)}"); off={k:v-lo for k,v in idx.items()}
        g=lambda r,i:(r[i].strip() if 0<=i<len(r) and r[i] else "")
        for ridx,r in enumerate(data):
            added,av,card=g(r,off["added"]),g(r,off["av"]),g(r,off["card"])
            if since and (not added or added[:10]<since): continue
            cid=cid_of(card)
            if not cid: continue
            info={"tab":tab,"row":ridx+2,"av":av,"card":cid,"acol":L(idx["av"])}
            rowinfo.append(info); rows_by_card.setdefault(cid,[]).append(info)
    print(f"scanning {len(rowinfo)} rows / {len(rows_by_card)} cards since {since}")
    # resolve each card once
    resolved={}
    for i,cid in enumerate(rows_by_card):
        try: resolved[cid]=rc.resolve(cid).get("avatar","")
        except Exception as e: resolved[cid]=None  # error
    fills=[]; corrections=[]; matches=0; field_blank=0; errs=0
    for info in rowinfo:
        fav=resolved.get(info["card"])
        if fav is None: errs+=1; continue
        sav=info["av"]
        if not fav:
            field_blank+=1; continue          # field unset/unmapped -> leave (flagged elsewhere)
        if not sav:
            fills.append((info,fav))
        elif norm(sav)==norm(fav):
            matches+=1
        else:
            corrections.append((info,sav,fav))
    print(f"MATCH={matches}  FILL(blank)={len(fills)}  MISMATCH(correct)={len(corrections)}  field-blank={field_blank}  resolve-err={errs}")
    if corrections:
        print("MISMATCHES (sheet -> field):")
        for info,sav,fav in corrections[:40]: print(f"  {info['tab']}!{info['acol']}{info['row']}: {sav!r} -> {fav!r}")
    data=[{"range":f"{i['tab']}!{i['acol']}{i['row']}","values":[[v]]} for i,v in fills]
    data+=[{"range":f"{i['tab']}!{i['acol']}{i['row']}","values":[[v]]} for i,s,v in corrections]
    if write and data:
        n=0
        for k in range(0,len(data),120): n+=batch(data[k:k+120])
        print(f"WROTE {n} cells ({len(fills)} fills + {len(corrections)} corrections)")
    json.dump({"fills":len(fills),"corrections":[(i['tab'],i['row'],s,v) for i,s,v in corrections],"matches":matches}, open("/tmp/avatar_verify_result.json","w"))
if __name__=="__main__": main()
