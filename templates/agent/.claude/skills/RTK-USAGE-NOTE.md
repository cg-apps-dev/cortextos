# RTK auto-hook is active in this session (read this once)

Your Bash commands are auto-rewritten through rtk (token filter, 60-95% savings on
git/test/build/grep/ls). You do NOT need to prefix anything. Two rules and one note:

1. RAW READS FOR PRECISION WORK: rtk-filtered output COLLAPSES function bodies and
   multi-row content (you may see markers like "[+35 more]"). For reviewing
   machine-written code, log-row forensics, or any byte-exact verification: use the Read
   tool on the file, or python3 - NEVER conclude from rtk-filtered command output.
   A filtered view masquerading as the full file is the failure mode.

2. READ THE TEE FILE ON TRUNCATION: very large outputs print
   "[RTK:PASSTHROUGH] Output truncated ... [full output: <path>.log]" - the full output
   IS saved; read that path instead of re-running the command.

3. Cosmetic: `rtk gain` may warn "No hook installed" - it checks rtk's global artifacts,
   not per-agent hooks. Ignore. To bypass rtk for one command: `rtk proxy <cmd>`.
