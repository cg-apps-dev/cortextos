#!/usr/bin/env python3
"""ensure_brain + _alert hardening tests (2026-07-16 concurrency/reaper incident).
CENTERPIECE = the concurrency-re-run that REPRODUCES the incident (>=10 concurrent + reaper-mid-clone):
proves (a) no-clobber/no-destructive-loss/valid-or-fail-closed AND (b) the _alert flood is gone
(ops-only, one-per-incident cross-process dedup). Plus the non-destructive/verify-before-swap/lock-
timeout/load-only cases + _alert b1/b2/b3/ops-only.
Run: python3 test_ensure_brain_hardening.py   (uses multiprocessing for true cross-process concurrency)
"""
import importlib.util, io, contextlib, json, multiprocessing, os, shutil, sys, tempfile, time
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_DATA = "/tmp/brain/agents/meta-compliance-agent/data"


def _import_core():
    spec = importlib.util.spec_from_file_location("verdict_core_h", os.path.join(HERE, "verdict_core.py"))
    m = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(m)
    return m


def _make_valid_brain(dest):
    """Populate dest with a VALID brain (copy the live one) -> passes floor+canary."""
    data = os.path.join(dest, "agents", "meta-compliance-agent", "data")
    os.makedirs(data, exist_ok=True)
    for f in ("banned-terms.json", "cannabis-coding-signals.json", "strain-lexicon.json"):
        shutil.copyfile(os.path.join(LIVE_DATA, f), os.path.join(data, f))


def _env_for(root):
    d = os.path.join(root, "agents", "meta-compliance-agent", "data")
    return {
        "BANNED_TERMS_JSON": os.path.join(d, "banned-terms.json"),
        "CODING_SIGNALS_JSON": os.path.join(d, "cannabis-coding-signals.json"),
        "STRAIN_LEXICON_JSON": os.path.join(d, "strain-lexicon.json"),
    }


# ---------- CENTERPIECE: concurrency-re-run (multiprocessing) ----------
def _conc_worker(cfg, barrier, results):
    os.environ["CTX_ROOT"] = cfg["ctx_root"]
    os.environ["CGM_BRAIN_STORE"] = cfg["store"]
    os.environ["CTX_TEST"] = "1"  # quiet the real notify subprocess; the dedup file + log still run
    for k, v in cfg["env"].items():
        os.environ[k] = v
    core = _import_core()
    core.subprocess.run = lambda *a, **k: None  # no real bus side-effects (log-event/notify) in the test
    claimed = {"n": 0}
    orig = core._alert_notify_once
    def counting_notify(authority):
        r = orig(authority)
        if r:
            claimed["n"] += 1  # this process would send a notify (survived cross-process dedup)
        return r
    core._alert_notify_once = counting_notify
    clone_calls = cfg["clone_calls"]
    def clone_fn(dest):
        with clone_calls.get_lock():
            clone_calls.value += 1
        time.sleep(0.05)  # widen the race window
        if cfg["mode"] == "fail":
            raise RuntimeError("clone down (simulated reaper mid-clone)")
        _make_valid_brain(dest)
    barrier.wait()  # all workers hit ensure_brain simultaneously
    try:
        auth = core.ensure_brain(ttl_seconds=0, clone_fn=clone_fn, lock_timeout=20)
        verdict = core.classify("plain relaxing copy", auth, surface="copy")
        results.append((auth.status, verdict.verdict, verdict.must_not_pass, claimed["n"]))
    except Exception as e:  # a gate must NEVER crash-open; record as a failure
        results.append(("EXC:" + type(e).__name__, "EXC", True, claimed["n"]))


def _run_concurrency(mode, n=10):
    td = tempfile.mkdtemp()
    root = os.path.join(td, "brain")           # the brain root (starts ABSENT = reaper wiped it)
    store = os.path.join(td, "store")
    ctx_root = os.path.join(td, "ctx")
    os.makedirs(store, exist_ok=True); os.makedirs(ctx_root, exist_ok=True)
    cfg = {"ctx_root": ctx_root, "store": store, "env": _env_for(root), "mode": mode,
           "clone_calls": multiprocessing.Value("i", 0)}
    mgr = multiprocessing.Manager()
    results = mgr.list()
    barrier = mgr.Barrier(n)
    procs = [multiprocessing.Process(target=_conc_worker, args=(cfg, barrier, results)) for _ in range(n)]
    for p in procs: p.start()
    for p in procs: p.join(60)
    res = list(results)
    return res, cfg["clone_calls"].value, td, root


def test_concurrency_success_no_race_no_clobber():
    res, nclones, td, root = _run_concurrency("ok", n=10)
    assert len(res) == 10, f"not all workers returned: {len(res)}"
    # every worker ended with a VALID brain, none crashed, NONE fail-open (never PASS on a degraded start)
    for status, verdict, mnp, _ in res:
        assert status == "ok", f"worker degraded on the success path: {status}"
    # no clobber: the final brain loads valid
    core = _import_core()
    assert core.load(_env_for(root)).status == "ok", "final brain not valid after concurrent refresh"
    # concurrency: the lock + skip-if-valid means NOT all 10 cloned (winner clones, others skip)
    assert nclones < 10, f"lock failed - {nclones}/10 cloned (race)"
    shutil.rmtree(td, ignore_errors=True)
    print(f"  [PASS] concurrency success: 10 workers, {nclones} clone(s), all valid, no clobber, no race")


def test_concurrency_all_fail_flood_gone_and_fail_closed():
    res, nclones, td, root = _run_concurrency("fail", n=10)
    assert len(res) == 10
    total_notifies = 0
    for status, verdict, mnp, claimed in res:
        # every worker FAIL-CLOSED (never PASS) - the whole point: fragility != fail-open
        assert verdict != "PASS", f"FAIL-OPEN under concurrent clone-fail: {status}/{verdict}"
        assert mnp is True, f"not must_not_pass under core_loss: {status}"
        total_notifies += claimed
    # FLOOD GONE: cross-process dedup collapses N fail-closed to ONE notify (was 10 in the incident)
    assert total_notifies == 1, f"alert flood not deduped: {total_notifies} notifies (want 1)"
    shutil.rmtree(td, ignore_errors=True)
    print(f"  [PASS] concurrency all-fail: 10 workers all fail-closed (never-PASS), {total_notifies} notify (flood->1)")


# ---------- non-destructive / verify-before-swap / lock-timeout / load-only ----------
def test_clone_fail_preserves_good_brain():
    core = _import_core()
    td = tempfile.mkdtemp(); root = os.path.join(td, "brain"); store = os.path.join(td, "store")
    os.environ["CGM_BRAIN_STORE"] = store; os.makedirs(store, exist_ok=True)
    _make_valid_brain(root)  # a GOOD brain exists
    env = _env_for(root)
    before = core.load(env).status
    def failing_clone(dest):
        raise RuntimeError("clone down")
    auth = core.ensure_brain(env, ttl_seconds=0, clone_fn=failing_clone)  # refresh FAILS
    assert before == "ok"
    assert auth.status == "ok", "clone-fail destroyed the good brain (should be preserved)"
    assert core.load(env).status == "ok", "good brain not intact on disk after failed refresh"
    assert auth.degradations, "should log a degradation on refresh-fail-with-cache"
    shutil.rmtree(td, ignore_errors=True); print("  [PASS] clone-fail preserves the good brain (non-destructive)")


def test_corrupt_clone_not_swapped():
    core = _import_core()
    td = tempfile.mkdtemp(); root = os.path.join(td, "brain"); store = os.path.join(td, "store")
    os.environ["CGM_BRAIN_STORE"] = store; os.makedirs(store, exist_ok=True)
    _make_valid_brain(root)
    env = _env_for(root)
    good_target = os.path.realpath(root)
    def corrupt_clone(dest):  # produces an INCOMPLETE/corrupt brain (missing files) -> fails floor+canary
        os.makedirs(os.path.join(dest, "agents", "meta-compliance-agent", "data"), exist_ok=True)
        open(os.path.join(dest, "agents", "meta-compliance-agent", "data", "banned-terms.json"), "w").write("{}")
    auth = core.ensure_brain(env, ttl_seconds=0, clone_fn=corrupt_clone)
    assert auth.status == "ok", "corrupt clone was swapped in (should retain the good brain)"
    assert core.load(env).status == "ok", "good brain replaced by a corrupt clone (verify-before-swap failed)"
    shutil.rmtree(td, ignore_errors=True); print("  [PASS] corrupt clone NOT swapped over the good brain (verify-before-swap)")


def test_lock_timeout_fail_closed_not_hang():
    core = _import_core()
    td = tempfile.mkdtemp(); root = os.path.join(td, "brain"); store = os.path.join(td, "store")
    os.environ["CGM_BRAIN_STORE"] = store; os.makedirs(store, exist_ok=True)
    env = _env_for(root)  # root ABSENT -> needs refresh -> needs lock
    # hold the lock so ensure_brain times out
    if core.fcntl is None:
        print("  [SKIP] no fcntl"); shutil.rmtree(td, ignore_errors=True); return
    holder = open(os.path.join(store, "brain.refresh.lock"), "w")
    core.fcntl.flock(holder, core.fcntl.LOCK_EX)
    t0 = time.time()
    auth = core.ensure_brain(env, ttl_seconds=0, clone_fn=_make_valid_brain, lock_timeout=1)
    dt = time.time() - t0
    core.fcntl.flock(holder, core.fcntl.LOCK_UN); holder.close()
    assert dt < 5, f"ensure_brain HUNG on the lock ({dt:.1f}s) - must timeout"
    assert auth.status == "failed" and auth.authority_class == "core_loss", "lock-timeout must fail-closed (no cache)"
    shutil.rmtree(td, ignore_errors=True); print(f"  [PASS] lock-timeout -> fail-closed in {dt:.1f}s (no hang)")


def test_load_only_reader_unaffected():
    core = _import_core()
    td = tempfile.mkdtemp(); root = os.path.join(td, "brain"); store = os.path.join(td, "store")
    os.environ["CGM_BRAIN_STORE"] = store; os.makedirs(store, exist_ok=True)
    env = _env_for(root)
    core.ensure_brain(env, ttl_seconds=0, clone_fn=_make_valid_brain)  # hardened refresh
    # a load-only reader (grep_verdict-style: load() then classify creative) works through the refreshed brain
    auth = core.load(env)
    assert auth.status == "ok", "load-only reader broke after hardened refresh"
    v = core.classify({"vision_text": "cannabis", "ocr_text": "cannabis"}, auth, surface="creative")
    assert v.verdict == "FAIL", "load-only creative classify wrong post-refresh"
    shutil.rmtree(td, ignore_errors=True); print("  [PASS] load-only reader unaffected by the hardened refresh")


# ---------- _alert b1/b2/b3 + ops-only (single-process, cross-process-file dedup) ----------
def _failed_auth(core, reasons, cls="core_loss"):
    return core._Authority(status="failed", authority_class=cls, reasons=reasons)


def test_alert_b1_flood_to_one_and_ops_only():
    core = _import_core()
    td = tempfile.mkdtemp(); os.environ["CTX_ROOT"] = td; os.environ.pop("CTX_TEST", None)
    os.environ.pop("PYTEST_CURRENT_TEST", None); os.environ.pop("CI", None)
    calls = []
    core.subprocess.run = lambda args, **kw: (calls.append(args), None)[1]
    auth = _failed_auth(core, ["failed to load authoritative banned terms: /x/banned-terms.json"])
    # simulate 10 separate PROCESSES: fresh per-process _ALERTED each time; shared dedup FILE
    for _ in range(10):
        core._ALERTED.clear()
        core._alert(auth)
    flat = [" ".join(c[:5]) for c in calls]
    notifies = [c for c in flat if "notify-agent" in c]
    assert sum("notify-agent meta-compliance-agent" in c for c in flat) == 1, "b1: >1 mc notify (flood not deduped)"
    assert sum("notify-agent the-orchestrator" in c for c in flat) == 1, "b1: >1 orch notify"
    assert not any("meta-ads-agent" in c for c in notifies), "ops-only: meta-ads-agent (Adam-facing) not dropped"
    assert not any("send-telegram" in c for c in flat), "no telegram"
    assert sum("log-event" in c for c in flat) == 10, "log-event should fire per-process (audit never silent)"
    shutil.rmtree(td, ignore_errors=True); print("  [PASS] _alert b1 flood->1 + ops-only (mc+orch, no meta-ads) + log-always")


def test_alert_b2_recover_re_alerts():
    core = _import_core()
    td = tempfile.mkdtemp(); os.environ["CTX_ROOT"] = td; os.environ.pop("CTX_TEST", None)
    os.environ.pop("PYTEST_CURRENT_TEST", None); os.environ.pop("CI", None)
    calls = []
    core.subprocess.run = lambda args, **kw: (calls.append(args), None)[1]
    auth = _failed_auth(core, ["failed to load authoritative banned terms: /x/banned-terms.json"])
    core._ALERTED.clear(); core._alert(auth)                 # fail -> alert once
    core._ALERTED.clear(); core._alert(auth)                 # same failure -> deduped
    core._alert(core._Authority(status="ok"))                # RECOVER -> clears dedup
    core._ALERTED.clear(); core._alert(auth)                 # fail again -> RE-ALERTS
    n = sum("notify-agent meta-compliance-agent" in " ".join(c) for c in calls)
    assert n == 2, f"b2: recover-then-refail should re-alert (got {n}, want 2)"
    shutil.rmtree(td, ignore_errors=True); print("  [PASS] _alert b2 recover->re-alert (no permanent latch)")


def test_alert_b3_per_class_distinct():
    core = _import_core()
    td = tempfile.mkdtemp(); os.environ["CTX_ROOT"] = td; os.environ.pop("CTX_TEST", None)
    os.environ.pop("PYTEST_CURRENT_TEST", None); os.environ.pop("CI", None)
    calls = []
    core.subprocess.run = lambda args, **kw: (calls.append(args), None)[1]
    a1 = _failed_auth(core, ["failed to load authoritative banned terms: /x/banned-terms.json"])
    a2 = _failed_auth(core, ["failed to load de-code signals: /x/cannabis-coding-signals.json"], cls="component_loss")
    core._ALERTED.clear(); core._alert(a1)
    core._ALERTED.clear(); core._alert(a2)  # DIFFERENT class -> distinct key -> alerts independently
    n = sum("notify-agent meta-compliance-agent" in " ".join(c) for c in calls)
    assert n == 2, f"b3: distinct failure-classes must alert independently (got {n}, want 2)"
    shutil.rmtree(td, ignore_errors=True); print("  [PASS] _alert b3 per-class distinct (banned vs coding alert independently)")


def run_all():
    tests = [
        test_clone_fail_preserves_good_brain,
        test_corrupt_clone_not_swapped,
        test_lock_timeout_fail_closed_not_hang,
        test_load_only_reader_unaffected,
        test_alert_b1_flood_to_one_and_ops_only,
        test_alert_b2_recover_re_alerts,
        test_alert_b3_per_class_distinct,
        test_concurrency_success_no_race_no_clobber,
        test_concurrency_all_fail_flood_gone_and_fail_closed,
    ]
    for t in tests:
        t()
    print(f"OK: {len(tests)} ensure_brain + _alert hardening cases pass")


if __name__ == "__main__":
    if not os.path.isdir(LIVE_DATA):
        raise SystemExit(f"need a live brain fixture at {LIVE_DATA} (run after a brain clone)")
    run_all()
