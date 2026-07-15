# PM2 Atomic Restart Survival Experiment

This note records the safe throwaway experiment for whether `pm2 restart <name>`
continues after the issuing shell exits. It never targets `cortextos-daemon`.

Command shape:

```sh
pm2 delete bounce-dummy >/dev/null 2>&1 || true
cat >/tmp/bounce-dummy.js <<'JS'
setInterval(() => {}, 1000);
JS
pm2 start /tmp/bounce-dummy.js --name bounce-dummy
before=$(pm2 jlist)
sh -c 'pm2 restart bounce-dummy >/tmp/bounce-dummy-restart.log 2>&1 & kill -TERM $$' || true
sleep 3
after=$(pm2 jlist)
pm2 delete bounce-dummy
```

Observed on 2026-07-15: `pm2 restart bounce-dummy` completed after the issuing
parent shell exited. The dummy process restart count increased from 0 to 1, then
`pm2 delete bounce-dummy` removed the test process. This supports atomic
`pm2 restart` as a fallback behavior, but the primary guard still requires the
bounce request to originate outside the daemon process tree.
