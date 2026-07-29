# Handover — run this on the computer, not in the cloud

Paste everything below the line into a **new Cowork task started "On your computer"**
(desktop app → "Run this task" picker, top right, when starting a new task).

Why: the cloud sandbox this was built in cannot reach
`default9a12677ec2e94deba58aee1c59ac01.61.environment.api.powerplatform.com`
(network allowlist), and its GitHub token has no write access to
`pod-allocations/pod-allocations.github.io`. Both work fine from the machine.

---

You are picking up the CCU Pod Allocator (rota.salford.icu), owner Dr Alistair
Cranfield, Salford Royal critical care. Two jobs, in this order.

## 1. Deploy the new build

The repo is `https://github.com/pod-allocations/pod-allocations.github.io`
(GitHub Pages, custom domain rota.salford.icu). Files: `index.html`, `test.html`,
`consultants.html`, `demo.html`, `k.js`.

A commit is ready but unpushed. If you do not have the working copy, the changes
to `index.html` are all inside `autoFillDay()` plus some UI. Clone the repo,
apply, commit, push to `main`. Pages redeploys in about a minute.

Whenever `index.html` changes, regenerate `test.html` — it is the same file with
`<script>window.__POD_TEST = true;</script>` inserted before the `k.js` script tag
and the title suffixed with " — TEST". `build-test.sh` does this.

## 2. Re-run the live allocations from this week

1. Open `https://rota.salford.icu/` and wait for it to load (it pulls the live
   rota from Power Automate on load — check `data.staff.length` is about 120 and
   `Object.keys(data.weeks).length` is about 53).
2. Run, in the page console:

   ```js
   STICK_TO = null;
   const mon = mondayOf(todayISO());
   const moved = reallocateSettled(mon, true);
   moved
   ```

   `reallocateSettled` re-runs every week from this Monday forward, snapshotting
   the current placement first so people keep their pods wherever the rules allow.
   It loops until a further pass moves nobody.

3. Verify before saving — every day from this Monday on should satisfy:

   ```js
   (() => {
     const bad = [];
     for (const key of weeksFrom(mondayOf(todayISO()))) {
       data.weeks[key].days.forEach((day, di) => {
         const n = PODS.map(q => day.pods[q].assign.filter(a => a.id && countsInNumbers(a.id)).length);
         const total = n.reduce((a, b) => a + b, 0);
         if (total >= 5 && n[4] === 0) bad.push(addDays(key, di) + ' EMPTY E ' + n.join('/'));
         if (n[4] > Math.min(...n.slice(0, 4))) bad.push(addDays(key, di) + ' E TOO BIG ' + n.join('/'));
         if (Math.max(...n) - Math.min(...n) > 1 && total >= 10) bad.push(addDays(key, di) + ' LOPSIDED ' + n.join('/'));
       });
     }
     return bad;
   })()
   ```

   That must come back empty. If it does not, stop and report rather than saving.

4. Save with `await relaySave()`, then **reload the page from scratch** and
   re-run the verification above against the freshly-loaded data. Do not report
   success from memory — a previous session reported a save that another open tab
   had already overwritten.

## What changed in the rules (so you can sanity-check the output)

- Pod balance is a hard rule: nobody enters a pod that has met its share while
  another pod is still short. Pod A finishing with six while Pod E sat empty was
  the bug; every split should now land on target.
- Never-a-third-pod-in-a-week yields to balance, but only to top up the emptiest
  pod.
- Pod E is never the biggest.
- Nights: the phone holder is only pulled into C/D/E once five are on. With four,
  the phone rotates and the night pods stay put.
- Night airway cover is balanced deliberately: one airway-trained each side.

## Known outstanding

- `__POD_KEYS.fb` was never added to `k.js`, so the feedback email leg is inert.
- A person marked inactive keeps their existing allocations.
- Fairfield membership survives losing the `fgh` skill.
