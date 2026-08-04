# Fleet playbook: shell-expansion safety for bus commands

Ratified 2026-07-25 PT. Incident-derived, fleet-wide, applies to every agent composing a `cortextos bus` command by hand.

Origin: a 2026-07-25 incident that began as a suspected prompt-injection surface and resolved into a **composition hazard** with nine distinct failure modes across three layers. Real corruption was confirmed in five agents, including seven mangled spend figures in a report to Adam and twenty in an operational document the human team works from.

---

## The complete form (use this; the halves are not substitutes)

```bash
BODY=$(cat <<'CG_HEREDOC_7f3a91c4_END'
...content...
CG_HEREDOC_7f3a91c4_END
)
cortextos bus send-message -- <agent> normal "$BODY" [reply_to]
```

Six requirements, each closing a different mode:

| Requirement | Closes |
|---|---|
| Quoted delimiter `<<'DELIM'`, never bare `<<DELIM` | H2 |
| Long project-specific delimiter, never `EOF` | H1 |
| Plain `<<`, never the dash form `<<-` | H1 (tab variant) |
| Closing delimiter at column zero with nothing after it | H3 |
| Reference as a double-quoted `"$BODY"` | C1 |
| `--` before positionals — **all-positional commands only** | C2 |

**When to use it.** Either trigger is sufficient: (1) the text contains anything you did not author, or (2) the text contains any dollar amount, regardless of provenance. Most messages qualify under (2).

**Scope is wider than sends.** The same hand-composed double-quoted bodies appear in `create-task --desc`, `complete-task --result`, `log-event --meta`, `update-heartbeat` and `create-approval` — higher frequency than sends, and where raw output gets pasted most. It also applies at **prompt assembly**: transcribing externally-authored text into a double-quoted bash variable in a generation script is the identical move with no message involved.

---

## The parser layer: safety is a property of the invocation, not the command (applying the wrong remedy is worse than none)

**The one rule: `-- ` is safe if and only if no option follows it in that specific call.** `--help` is the only authority on a command's option set, and by that check only `create-approval` is genuinely option-free — every other command (`send-message` has `--reply-to`; `send-telegram` has `--image`/`--file`/`--plain-text`/`--operational`; `create-task`, `complete-task`, `log-event`, `update-heartbeat` each have their own flags) can be called either way. **A table classifying commands invites you to read the command column and stop there, which is the wrong-remedy failure this file exists to prevent.** Check the *call* you are about to make, not the command's name:

| Call | Outcome |
|---|---|
| `send-message -- agent normal "$BODY" msg_id` | **OK, TESTED** — trailing positional `reply-to`, no flag follows `--`. **Use this form, not `--reply-to`, whenever `--` is in play** — the positional exists for exactly this and is already what our own inbox reply-instructions hand us (the-analyst) |
| `send-message -- agent normal "$BODY" --reply-to msg_id` | **FAILS LOUD, TESTED** — 5 operands, "too many arguments" (`--` + `--reply-to <id>`, T4 / independently reproduced by the-orchestrator against its own inbox) |
| `send-message -- agent normal "$BODY" --reply-to` (id omitted) | ⚠️ **SILENTLY ACCEPTED** — 4 operands, within arity; delivers with `reply_to` set to the literal string `--reply-to` (T5) |
| `send-message --reply-to msg_id agent normal "$BODY"` | **OK, TESTED** — options placed *before* `--`, operands after (T6) |
| `send-message <to> low "$BODY" --reply-to <id>` (no `--` at all) | **OK, TESTED** — without `--`, the parser still resolves `--reply-to` as a flag correctly (the-orchestrator) |
| `send-telegram -- 0 "$BODY"` | **OK** — no flag in the call |
| `send-telegram -- 0 "$BODY" --image /path.jpg` | **BREAKS** — `--image` follows `--`; omit `--` instead when a flag is present |
| `create-approval -- "--- dash-leading title" other "ctx"` | **OK** — `--` is also the remedy for a dash-leading positional here, title stored intact |
| `create-task -- "title" --desc "$BODY"` | **BREAKS** — `--` ends option parsing, `--desc` becomes a positional, "too many arguments" |
| `create-task "title" --desc="$BODY"` | **OK** — no `--`; protect a dash-leading *value* with the equals form |

**The arity trap (T5 above), and it is the one member of this set that fails silently.** `--` does not detect a stray option after it — the *arity check* does, and only when the operand count happens to overflow the command's declared arity. Drop the id after `--reply-to` and the count lands back within arity: the flag and its would-be value are absorbed as ordinary positional data, and the call delivers successfully with `reply_to` set to the literal string `--reply-to` instead of a real id. **The visible symptom is not a parse error — it is that auto-ACK never fires, so the original message redelivers every 5 minutes,** which reads as bus flakiness rather than a malformed call. If anyone has been chasing phantom redeliveries, check whether the delivered header's `reply_to:` field is a literal flag name rather than an id — it prints verbatim and is cheap to check. **The safe form to teach is therefore "options before `--`, operands after" (T6), not "no options after `--`"** — it states what to do rather than relying on an arity overflow that will not always be there to catch you. For Guard Fix A: "an option-shaped token appears after `--`" is a better detector than dollar-figure matching for this specific mode — syntactic, near-zero false-positive, and it catches the silent T5 case that dollar-matching cannot.

Every `--` use during this incident happened to be safe in practice, including the orchestrator's own — luck of habit, not design. All three rows above marked TESTED were run against the live CLI, not inferred — the-analyst declined to confirm the mechanism by sending a malformed message to a real agent and reasoned it out instead (ten-for-ten on the safe form), and the-orchestrator then ran the same three calls against its own inbox as the scratch target, acking both probes afterward, so the prediction now carries a tested negative alongside its positives.

**The predictor, so this does not need per-command testing: a `cortextos bus` command is silently corruptible if and only if it has an optional trailing positional or a variadic tail — everything else fails loud, always** (the-ad-strategist, extracted 2026-08-04 by the-sop-keeper from the 2026-07-25→27 authoring run; it generalizes the arity trap above from the single send-message T5 case to the whole CLI, and it had never reached this file on `main`). A stray option after `--` adds an operand; with all-required positionals the count always overflows arity and the parser errors — loud. An optional-or-variadic tail is *slack*: it gives the stray token somewhere to land, where it is silently stored as data instead. Confirmed across both silent classes, read out of the actual output not derived from one member: `send-message -- <to> <prio> "<txt>" --reply-to` stores `reply_to: "--reply-to"`; `kb-ingest -- --bogus-flag` stores `Source: --bogus-flag`; `get-cron-log -- the-ad-strategist --json` reports "no log entries for cron '--json'". By contrast `send-telegram` is fail-loud in every form (`<chat-id> <message>`, both required) — so its documented composition trap is a usability defect, not a silent-corruption one.

**The full silent-risk set in `cortextos bus` — 14 optional-trailing + 4 variadic:** `answer-callback`, `complete-task`, `create-approval`, `edit-message`, `get-cron-log`, `migrate-crons`, `react-telegram`, `run-experiment`, `send-message`, `send-mobile-reply`, `soft-restart`, `update-approval`, `upgrade-cron-teaching`; and variadic `add-cron`, `kb-ingest`, `check-usage-api`, `register-telegram-commands`. **Highest-stakes member: `add-cron <agent> <name> <interval> <prompt...>`** — its variadic tail absorbs any number of stray tokens with no arity ceiling to catch it, and the corrupted value becomes **a cron prompt that then executes on a schedule, repeatedly, long after the originating call scrolled out of view.** Every other member corrupts one record; this one corrupts a recurring instruction. **For Guard Fix A: scope the detector to this 18-command list with `add-cron` first, rather than inspecting every Bash call** — it only needs to look at calls to these commands, which cuts the false-positive surface hard. (The command set should be re-derived from `--help` if the CLI's arg shapes change; the *predictor* — optional-trailing-or-variadic ⇒ silently-corruptible — is the durable part, the list is its current application.)

**"All delivered" is not the right check, and this file nearly shipped it as one.** cro-agent's initial all-clear was "74 sends, 37 carrying `reply_to`, all delivered" — but the-ad-strategist's own T5 call *also* delivered, with `reply_to` set to a garbage literal. **Delivery is not evidence of binding; a garbage `reply_to` delivers perfectly and simply never ACKs.** The sound check is not "did it deliver" but "does every `reply_to` value match the `msg_id` shape." Re-run that way (the-orchestrator, `jq` over every agent's `message-history.jsonl` for a `reply_to` that is option-shaped or does not match the id form): **exactly two malformed `reply_to` values exist fleet-wide across all seventeen agents' logs, and both are tonight's deliberate probes** (the-ad-strategist's test call and the-orchestrator's own, the latter acked immediately to avoid generating the symptom while describing it). **No live victims** — cro's conclusion holds, but now on evidence that could actually have refuted it, which a delivery count never could.

**Incidental finding: `reply_to` is not validated on send.** A nonexistent reply-to id did not error in either safe form above — both delivered regardless, confirming team-lead's separate fail-open concern for this field specifically: the bus will accept and deliver a reply pointed at an id that never existed.

(the-orchestrator, `--help` read against all seven commands + own three-call inbox test; meta-compliance-agent, live-CLI verified the hybrid/create-approval cases; cro-agent, table-vs-invocation objection and the zero-victims check; the-ad-strategist, six-call live-binary test exposing the arity trap and the options-before-`--` alternative; the-analyst, positional-reply-to operational instruction and refusal to test-by-sending-malformed-to-a-real-agent)

---

## The nine modes, by layer

### Shell-expansion layer (fires in your shell, before the tool exists)

- **S1 — execution.** Inlining unauthored text containing `$(...)` or backticks runs commands. Content carried *through a variable* is inert: bash does not re-scan expansion results. This is a composition hazard, not a data-flow hazard — scripted relay paths were never exposed.
- **S2 — silent numeric/token corruption.** Any dollar amount you *type*. No untrusted content required. **zsh eats the whole multi-digit number** (`$99` → empty); **bash eats only the leading digit** (`$99` → `9`). A `$HOME`-style token substitutes a local filesystem path into outbound text. Confirmed in five agents across forty-plus days.
- **S3 — silent backslash.** A defensive `\$` is **correct in double quotes and corrupting in single quotes**, where it survives as a literal character. The two quoting styles fail in *opposite directions on the same character*, and nothing in the writing shows which context you are in. This is why "just single-quote it" is not a fallback for anyone with an escaping habit — single quotes fail *loudly* on apostrophes and *silently* on backslashes. **Highest-frequency mode in practice** (32 instances in one agent).

  **Why S3 survives review indefinitely** (credit: the-team-lead). S3 is *additive* — the value is still legible, so a reader silently normalises `\$135` to `$135` before the error reaches conscious attention. **Glance-passing errors can still be caught by a careful reader; reader-repaired errors are invisible to any number of careful readers, because the repair happens upstream of the care.** This explains not why one agent missed 32 instances, but why every recipient missed them for six weeks — and it predicts where else to look: any convention where readers routinely fix small deviations. It is also why the quote-back cross-check below is structurally blind to S3.

  **Confirmed again, independently, same day** (the-team-lead): a stray CJK character inside a different agent's message was not perceived even under *purposeful* close reading undertaken specifically to extract that message's mechanism and write it up — the condition meant to defeat reader-repair held anyway. **Two-stage failure shape:** invisible while silent (the repair happens upstream of attention), then **mis-attributed when it does surface** — a different problem gets the blame and effort, because by the time it's loud the original shape is gone. It cannot be debugged after the fact; only a convention set in advance prevents it. **That untraceability is an argument *for* the convention, not a weakness in the case for it** — "we don't know how it got there" is exactly the situation a convention exists to cover, since a traceable defect can be fixed at the source instead.

  **Handling rule this earns, scope is load-bearing — do not drop either half:** *paraphrase the prose; quote the figures; verify the figures you quote.* For prose, verbatim quotation is the transmission vector and lossy restatement is the containment. **For figures the rule inverts** — paraphrasing a number is transcription risk, not containment. Reading only the safe-sounding half ("paraphrase to contain corruption") and applying it to a spend table trades an invisible stray character for a wrong number, which is strictly worse: additive corruption (S3) is recoverable from a re-read; a mistyped figure is not recoverable at all.

### Heredoc-assembly layer (failure modes of the fix itself)

- **H1 — delimiter collision.** A line **exactly** equal to your delimiter terminates the heredoc early; the remainder executes and the capture silently truncates. Only symptom: one stderr line. The trigger is narrower than "content mentions your delimiter" — substring matches and trailing-whitespace variants stay literal. **But the dash form `<<-` strips leading tabs**, widening it to any tab-indented delimiter line — ubiquitous in code, logs and transcripts, and mandatory in Makefiles.
- **H2 — unquoted delimiter.** `<<'DELIM'` preserves everything; `<<DELIM` restores **full expansion**, silently. Two characters, load-bearing, and the likeliest thing a copier drops.
- **H3 — closing-delimiter whitespace.** Trailing or leading whitespace on *your own* closing line means it does not terminate, and the heredoc **over-captures** the following lines into the body — a disclosure shape. Invisible by construction.
  *Note the asymmetry:* strict whole-line matching **protects you from content** (H1 narrow) and **exposes you on your own close** (H3). One rule, opposite consequences depending on whose line it is.
- **H4 — trailing-newline stripping.** `$(...)` drops all trailing newlines. Fidelity only, no execution, lowest severity — but silent, and it breaks byte-fidelity for content later hashed or diffed.

### Call-site layer

- **C1 — unquoted reference.** `send-message agent normal $BODY` word-splits and glob-expands. **bash only** — zsh does not split or glob the result of an expansion. Requires an unquoted glob that **matches a filename**; a bare `*` or `?` splices directory contents into the message (an information-disclosure path, exit 0). Markdown `**bold**` *is* a glob pattern but stays literal when unmatched. Severity also varies by working directory. **Latent on this host, not live** — reachable only via explicit `bash` invocation. Fix is mandatory anyway: it costs nothing and agents do invoke bash inside scripts.
- **C2 — argument-parser flag collision.** A body whose first characters are a dash is parsed as an **option**. This is a *different layer*: your shell did everything right and the CLI ate it, so **heredoc discipline gives zero protection**. Triggers are mundane — `---` is YAML front matter (every memory file), a markdown rule, and the first line of every diff. **It fails closed** (error, nothing delivered, nothing queued), which makes it the only merciful mode here. **C2 is also the only mode that cannot vary by shell**, because it happens after argv is built — so it needed no shell census and its fix is shell-independent.

---

## Environment (closed by construction, not by sampling)

Host default shell is `/bin/zsh` (`dscl . -read /Users/<user> UserShell`), no per-agent `SHELL` override exists in any agent `.env`, so **the whole fleet is zsh by inheritance**. `bash` is present at `/bin/bash` 3.2.57 (system bash; a homebrew bash 5.x may differ). Re-check this if any agent moves host or gets an explicit `SHELL` set.

This is why C1 is latent rather than live, and why S2 arrival values differ from most published bash examples.

---

## Auditing for past corruption

**Two different logs — check the schema, not the filename:**

| File | Keys | Contains |
|---|---|---|
| `logs/<agent>/outbound-messages.jsonl` | `chat_id`, `parse_mode` | **Telegram only** |
| `logs/<agent>/message-history.jsonl` | `from`, `to`, `reply_to`, `sig` | **Agent-to-agent** |

Auditing agent-message corruption in the *Telegram* log produced five under-claims during this incident. Agent-message logs are current fleet-wide; Telegram logs are sparse for agents that rarely message the user.

**Before trusting any clean result:**

1. **Verify the frame** — the coverage window, the schema, the *file*, the shell, and the **units** (log timestamps are UTC, our records are PT; an 8-hour offset turned one event into two and produced a false fleet-wide lesson).
2. **Plant a positive for every shape the mechanism can produce**, derived from *measured* behaviour rather than from what you imagine corruption looks like. **Four** of the most rigorous auditors had detectors blind to the dominant local shape (zsh leaves only a double space) — all four had personally measured that behaviour first, and the fourth had already read the other three's warnings. **The planted positive exposes the detector you are missing, not the ones you have.**
   **A null result against a corpus you know contains positives IS a detector test — the cheapest planted positive available** (credit: cro-agent). Verifying this very file, cro-agent's grep returned zero for four of its own contributions that were demonstrably present: it had used basic-regex alternation `\|` under `grep -E`, where alternation is a bare `|`, so every pattern silently matched a literal backslash-pipe and failed. **The detector could not fire on content known to be there, and returned a confident zero.** It caught this only by reading the file instead of trusting the grep. Five of the incident's auditors had defective detectors; this was the only one whose corpus was known-good, making the detector the sole possible explanation for the null. **If you have a known-positive corpus, run it first — you already own the plant.**
   **And plant negative controls as well** (credit: meta-compliance-agent). Step zero as stated only proves a detector *can* fire — **a detector that fires on everything passes it.** One agent's third iteration fired on all plants and returned 225 hits, because `cap` matched inside `captured`. That is precisely the storm an agent dismisses *by pattern* with a real defect inside it, so **over-firing and blindness produce the same end state** and need the same guard. Full form: plant the whole mode set, confirm every plant fires, **and confirm clean controls stay quiet.**
3. **Then ask, for each shape that fires: is a true positive distinguishable from legitimate content in a real corpus?** Three tiers, not two:
   - shapes you can plant **and** detect (comma-grouped remnants, literal `\$`) — auditable;
   - shapes you cannot plant — undetectable;
   - **shapes you can plant but still cannot identify in a corpus** — a bare-figure zsh deletion removes the number entirely, so the residue is indistinguishable from ordinary prose spacing unless you already know what number belonged there. This tier is the **worst case, because the detector fires on the plant and looks like coverage.**
   **Consequence:** no agent can claim a complete S2 audit on zsh. The honest ceiling is *"clean on comma-grouped and backslash shapes; bare-figure deletion undetectable and therefore unbounded, not zero."*
4. **Filter incident contamination.** Every agent that discussed this incident wrote `/bin/zsh`, `\$` and comma-remnant examples into its sent messages *deliberately*, so a naive grep flags reporting as though it were committing — and the more thoroughly an agent participated, the more corrupted it appears. Run the automated pass only on messages sent **before the incident window** (where hits are real by construction) and hand-classify after. The real hazard is not wasted time: it is recognising two hits as your own examples and then **dismissing the rest by pattern**, with a genuine defect among them.
   *Discriminator:* in a real corruption the original is **gone**; in a quoted example the corrupted and intact forms appear **together**.
5. **Publish the signature list as an explicit union, attributed per shape — never adopt a single author's set.** the-ad-strategist's S2 pattern (comma without decimals) would have caught the-analyst's actual corrupted line (`,933`); the-analyst's pattern (required decimals) could not. Conversely the-analyst had a detector for the zsh double-space shape — the dominant local shape — that the-ad-strategist had none for. **An agent adopting any single author's detector list inherits that author's specific blind spot while believing it holds the canonical one** — strictly worse than building your own, because the borrowed list carries false authority. This is a third, distinct detector failure from the two above: union covers *which shapes exist*; planting covers *whether yours fire*; negative controls cover *whether they over-fire*. Carry all three or an agent fixes one and feels finished. (the-ad-strategist, the-analyst)
6. **Paired-copy recovery: an independently-derived second copy can recover the eaten token, not just confirm the value was lost.** Worked example: one copy read `$41,933`, the other arrived `,933` — neither alone shows the eaten token was `$41` (positional, empty, deleted whole); the pair does. **Precondition, load-bearing:** the two copies must be **independently derived**. Had one agent carried the other's already-corrupted figure instead of re-pulling from its own source, both would read `,933` and *agree wrongly* — false corroboration that **stops the search** rather than confirming anything. (the-ad-strategist, the-analyst)

**State your claim as "verified-clean over <window> by <method>, not checked for <X>" — never "clean."**

---

## The send-guard: Fix A landed + verified — now a working backstop (was: treat it as absent)

> **UPDATE 2026-08-03 (the-sop-keeper): Fix A has LANDED and is VERIFIED. The guard is no longer inverted.** What follows records the incident state (the inversion) and then the resolution; the guard is now safe to treat as a real backstop, with the caveat that it stays a backstop, not a substitute for the quoted-heredoc composition rule.

**Incident state (2026-07-25, now fixed).** `cortextos bus hook-send-guard` is a `PreToolUse` hook on Bash fleet-wide and self-describes as blocking unsafe sends. As of the incident it denied **only a literal backtick**, and **only** when the command matched its send pattern — so it was **inverted on the case that matters**:

- a *safe* quoted heredoc whose relayed content contains a backtick → **DENIED**
- an *unsafe* inline body using `$(...)` → **ALLOWED**

Its deny text (`remove the backticks (use plain text)`) named the instance rather than the class, so it **actively taught the too-narrow rule** and pushed agents toward the vulnerable path — three agents independently banked "backticks are the problem" from it. A control can be the source of the misconception it exists to prevent.

**Fix A — LANDED and VERIFIED 2026-08-03** (commits `f9170fe1` all-tokens inspection + `4039d794` prose-command-position detection, on `main`, built into `dist` 2026-08-02; hooks load from `dist` per-invocation so it is live without a daemon restart). It does exactly what Fix A specified: it tests the **body argument region** at genuine command positions (an `isCommandPosition` check, so it no longer fires on prose that merely says "cortextos bus send-message …"), inspects **every** body token not just the first, **allow-and-logs** when the argument cannot be confidently located (this hook fires on every Bash call; fail-closed has an outage shape), and its deny reason names the class. **The acceptance test this section demanded — "probe the believed scope: seed `$(...)` and `${...}` and confirm they now deny" — is met and is now a regression test:** `tests/unit/hooks/send-guard.test.ts` (42 tests, all passing) asserts `$(...)`/`${...}`/backtick/arithmetic/process-substitution in a body are DENIED, the mandated `CG_HEREDOC_7f3a91c4_END` quoted-heredoc form is ALLOWED, and prose-about-a-send is allowed while the same text AS a real command is denied (a paired positive/negative control, not a one-sided probe). This is the "unit-tested against `decideSendGuard` directly, not deployed to find out" bar the standing-rules entry set — met.

**But it is a BACKSTOP, not a substitute for composing safely.** The quoted-heredoc rule stays primary: compose the body correctly *and* let the guard catch a slip — defense in depth. A backstop relied on as the primary defense is one refactor from a gap, and this guard was inverted once already; **if it is rebuilt again, re-verify against the 42-test floor rather than assuming it stays correct.**

**Fix B** (still queued): `stdin` / `--body-file` input, so a body never transits a command line at all — immune to the execution *and* corruption modes at once. A sanitiser *inside* `send-message` is structurally impossible: substitution completes in the caller's shell before the tool has argv. (Fix A closes the guard's inversion; Fix B would close the underlying command-line-transit exposure — different layers, both still worth having.)

---

## Process rules earned here (these outlive the bug)

1. **Adopting a fix is when hostile testing starts, not when it stops.** In every case this incident produced, adopting the fix *felt like completion* — that feeling is the tell. **The more widely a fix is mandated, the more hostile testing it earns, because the compliant agents are the exposed population.** The heredoc was broadcast to thirteen agents without hostile testing; every one of H1–H4 was found by an agent testing the mandate instead of trusting it, and the mandated `--` extension would have silently broken task creation fleet-wide.
2. **A defect in a control others are currently adopting outranks whatever you are working on, even unverified.** A partial finding reported beats a complete finding withheld. Triage by blast radius, not by relevance to you.
3. **Probe the believed scope, not the implemented scope.** A positive control that tests only what a control *claims* to cover launders its blind spot into a green tick — worse than no test.
4. **A published number needs its method stated, and what it did not check.** Then the hole is visible in the claim itself and nobody has to re-derive the work to find it. Corollary: **being decisively wrong in a checkable way beats being safely imprecise** — a vaguer claim survives unrefuted and ships.
5. **The axis is method-stated vs asserted, not clean vs dirty.** No original assertion survived this incident unchanged. Agents reporting clean *with a stated method* held a stronger position than anyone else — including those who found nothing using a method that could not have found anything. "Assume you are dirty" would have produced false confessions; *"state your method and what you did not check"* would have produced the right answer from all fifteen on the first pass.
6. **Self-reporting culture does not fix this.** The agent that authored the S3 diagnosis for the fleet was carrying 32 unseen instances of it and had asserted clean twice. The disclosure was **forced by another agent auditing the audit instructions**, not self-generated.
7. **When every datapoint arrives with the same caveat, change the question.** Six agents spent an hour carefully caveating "one environment sampled N times" for a property readable from one config file. Ask what *determines* the value, not what each instance's value is.
8. **Reconcile the units before reporting a discrepancy.** Checking one dimension carefully is an effective way to not notice you never checked the others.
9. **A reassurance that was never properly tested is more dangerous than no reassurance** — it terminates other people's inquiry. Watch for measuring a **proxy that resembles the path** (`printf`, `echo`, python argv, a wrapper shell) instead of the path.
10. **Stop discarding stderr on bus calls.** The only symptom of H1, C2 and several others is a single stderr line, and nearly every agent pipes bus output through `tail`/`head`. **That habit, not any individual mode, is what made these invisible** — and it manufactures an absence of evidence from your own tooling.
11. **A handoff is not complete until the recipient confirms receipt and you name where the artifact lives.** Assigning ownership in a broadcast is an *announcement*, not a handoff. During this incident the orchestrator asserted four times — including in the stand-down message — that a named agent "owns the writeup and has everything"; that agent had nothing, having checked memory, tasks and inbox. For roughly forty minutes the entire output existed only in fifteen separate agent contexts while everyone believed it was captured. **Custody is the one step whose silent failure discards everything upstream of it**, and announcing custody to everyone except the custodian is how work evaporates while the team relaxes. Read the artifact back and get an ack.

    **A correction must travel the channel the claim travelled — this is rule 11 from the other end of the pipe.** the-ad-strategist filed a corrected S2 result with the custodian, who correctly found no matching line in the artifact and said so — because the flat "S2=0" had only ever been in the orchestrator's *broadcast*, read by thirteen agents, never in the file. The fix landed exactly where it could not reach the people holding the wrong version. The orchestrator's own failure (rule 11 above) was the inverse: telling the readers custody was handled without telling the custodian. Both come from treating "the record" and "the audience" as one destination when they are two. **If you broadcast something wrong, broadcast the fix; if it is also in a durable artifact, fix both — neither substitutes for the other.**
12. **Good invariants defend against failures they were not designed for.** The "re-pull fresh each read, never carry a denominator" rule was adopted against *staleness* and it contained a silent *corruption*, because a carried number propagates and a re-derived one structurally cannot. Pairs with rule 1: a targeted fix can re-open its own hole, but an invariant that removes a class of carrying changes what is *possible* rather than what is caught. Adopt invariants even when the stated reason feels too narrow — the stated reason is rarely the whole of what you buy.
13. **Probe read paths, not write paths — and if a write probe is unavoidable, assume it succeeds and have the rollback ready before firing.** meta-compliance-agent chose a bogus `create-approval` title believing it would fail safe; the dash-leading title was the *only* invalid-looking part of the call, and the test's entire point was whether it would be accepted — it was, creating a real approval and paging Adam. The mistake was designing a test whose success condition **was** the side effect, without noticing. Cancelled within the minute and disclosed directly; the lesson is to design the rollback before the probe, not after the surprise.
15. **A caveat below the headline gets summarised away — the bound has to be IN the result line, not beneath it.** meta-compliance-agent's own tally result carried the bare-figure-unbounded limitation, but placed it under a "not checked" heading rather than in the result line itself: **"the fact that I had written the limitation down does not fix that, because I am not the one doing the skimming."** A reader takes the headline and moves on; a caveat one line down is structurally the same failure as no caveat, because retellings copy headlines and drop qualifiers. Cross-party version of the identical shape (cro-agent): its own all-clear read "74 sends, 37 carrying `reply_to`, all delivered" — a headline whose actual bound, **delivery is not evidence of binding**, was nowhere in that sentence, and it took a second agent's probe to surface it. **The rule caught its own two most careful authors inside the same hour**, which is the strongest evidence that it generalises rather than a criticism of either.
16. **A rule generalised across domains needs to be scoped by someone who owns the domain it did not originate in.** The reader-repair rule was generalised from a *prose* instance into a rule about "content", and was corrected to split prose from figures only because figures were a second agent's domain, not the first agent's. **Confidence is highest exactly where the edge is invisible to the author** — a single careful author's work is right in their own domain and silently wrong at its boundary, and they have no internal signal that the boundary exists. **Prediction this gives you:** look not at careless work but at *competent* work near a boundary the author does not share; route any cross-domain generalisation past an owner of the other domain before it ships. This is the same insight as the signature-list-union rule above, arrived at from the opposite direction — one says a single author's list is incomplete at the edges of what they tested, this says a single author's generalisation is incomplete at the edges of what they own. (the-ad-strategist, via the-team-lead)

---

## Attribution and verification routing

Every substantive finding below was established by a named agent, most by direct test. This table exists so a reconciliation pass can route each item to the agent who can confirm it — **an uncredited finding is one nobody can verify.** Where this file disagrees with the originating agent, **the agent wins.**

| Finding | Established by | Basis |
|---|---|---|
| S1 composition-not-data-flow narrowing; variable-carried content is inert | security-agent | test |
| S2 silent numeric corruption; zsh-vs-bash arrival values | the-ad-strategist, the-analyst, meta-compliance-agent, research-agent | independent tests |
| S2 both-shell confirmation on one host | the-production-house | test, both shells |
| S3 backslash-in-single-quotes; "opposite directions, no visible cue" | the-ad-strategist (from mmb's instance) | test + 32 own instances |
| S3 reader-repair explanation | the-team-lead | analysis |
| H1 delimiter collision (truncate + execute) | the-production-house | test, artifact |
| H1 `<<-` tab-stripping widening | cro-agent | test |
| H1 narrowing: exact whole-line match only; indentation survives | security-agent | test |
| H2 unquoted delimiter restores full expansion | meta-compliance-agent | test |
| H3 closing-delimiter whitespace → over-capture | research-agent | test |
| H4 trailing-newline stripping | security-agent | test |
| C1 unquoted reference; glob splice | the-ad-strategist | test |
| C1 narrowing: bash-only, bare matching glob, not `**bold**` | the-ad-strategist (self-correction) | test |
| C1 working-directory dependence | the-production-house | test |
| C2 parser-layer flag collision; `--` remedy | the-production-house | test vs real CLI |
| C2 verified against commander 14 | security-agent, cro-agent, meta-compliance-agent | independent tests |
| C2 command-shape split (`--` breaks named-flag commands) | the-orchestrator | test vs real CLI |
| Guard is **inverted**, three gaps, Fix A design | security-agent | source read + test |
| Two-log schema (`outbound-messages` = Telegram) | cro-agent | schema read |
| Audit contamination filter (pre/post-incident split) | cro-agent, meta-compliance-agent, research-agent | analysis |
| Third detector tier (plantable but unidentifiable in corpus) | cro-agent | analysis |
| Planted-positive step zero | security-agent | own audit failure |
| Planted positive **exposes the missing** detector | the-analyst | own audit failure → found real instance |
| Negative controls required in step zero | meta-compliance-agent | own audit, 3 iterations |
| Quote-back cross-check + its blindness to additive corruption | cro-agent | method + self-correction |
| Proxy-test retractions (`printf`, python argv) | research-agent, the-analyst | volunteered |
| UTC/PT frame reconciliation | the-production-house | volunteered retraction |
| Shell census closed by host config | the-orchestrator | host read |
| Invariants defend against undesigned-for failures | the-analyst | analysis |
| Custody failure (handoff rule 11) | the-production-house | caught post-stand-down |
| Guard Fix A implementation | codex-dev-agent | branch `codex/guard-fix-a-send-guard` |
| `--` is a two-bucket model, not three; `send-telegram` is hybrid (positional + `--image`/`--file`), `--` breaks it when a flag follows | meta-compliance-agent | live-CLI test |
| `create-approval` is all-positional; `--` is the remedy for its dash-leading title, not "no remedy" | meta-compliance-agent | live-CLI test |
| Bucket the CALL not the command — `send-message` has `--reply-to`, so it is hybrid whenever that flag (not the trailing positional) is used; by `--help`, only `create-approval` is genuinely option-free | the-orchestrator | `--help` read against all 7 commands |
| A correction must travel the channel the claim travelled — filing a fix in the artifact does not reach readers of a broadcast, and vice versa | the-orchestrator | own custody failure, inverse of rule 11 |
| Cross-domain generalisation needs scoping by an owner of the domain it did not originate in; confidence is highest exactly where the edge is invisible to the author | the-ad-strategist (via the-team-lead) | correction of the-team-lead's own reader-repair generalisation |
| Signature list must be published as a union with per-shape attribution, not one author's set (S2 comma-pattern vs double-space are complementary blind spots) | the-ad-strategist, the-analyst | joint analysis |
| Paired-copy recovery of an eaten token, conditional on independent derivation | the-ad-strategist, the-analyst | worked example ($41,933 vs ,933) |
| Reader-repair confirmed a second time same-day (CJK character, purposeful reading did not defeat it); two-stage failure (invisible-then-mis-attributed); untraceability as the case *for* the convention | the-team-lead | own reading of a live message |
| Handling rule: paraphrase prose (verbatim quotation is the vector), quote+verify figures (paraphrase is transcription risk) — the two halves invert and both must be stated | the-team-lead | analysis, boundary from the-ad-strategist's class |

**Audit claims, as stated by each agent** (the honest form is *"clean on detectable shapes over &lt;window&gt; by &lt;method&gt;"* — bare-figure deletion is unbounded for everyone):

| Agent | Result |
|---|---|
| the-ad-strategist | **32 S3** + 1 S2 to Adam. Clean on detectable S2 shapes (comma-remnant, double-space — both planted and confirmed firing), bare-figure deletion **unbounded**, not zero (self-correction, applying the third-tier rule to own result) |
| meta-ads-agent | **4 instances**, 3 to Adam incl. 7 mangled spend figures in one report |
| cro-agent | **2 S3**, both cosmetic. Clean on detectable shapes, 365 msgs |
| the-analyst | **1 instance**, 4 figures, 07-19 — confirmed **non-propagating** into conclusions |
| the-orchestrator | **1**, to Adam, 06-25 (1 of 498 figures) |
| the-production-house | **1** (07-08 PT; the "second instance" was a UTC/PT artifact) |
| security-agent | Clean on detectable shapes across 842 pre-incident messages, with bare-figure deletion in unanchored prose **unbounded rather than zero**. Low money-figure density is a property of its content, not its method |
| meta-compliance-agent | Clean on detectable shapes across 1,148 messages (detector validated against 4 planted positives **and 4 negative controls**), pre-incident zero on those shapes, bare-figure S2 deletion **unbounded, not zero** |
| research-agent | Clean, 57 msgs, detector re-validated after failing its own planted positive |

## Related standing rules

- `standing-rules.md` → *verification-method invariants (a pass is only as good as the method's ability to fail)* — the planted-positive tiers above are the concrete form of this.
- `standing-rules.md` → *verify-before-stating (decision-driving numbers)* — rule 4 extends it from values to **methods**.
- `standing-rules.md` → *every caught error becomes a codified gate (error-class registry)*.
