/*
 * 10-year stress run for the Pod Allocator.
 * -----------------------------------------
 * Ten independent 52-week years. Each year:
 *   - a unit of ~34 people, with staff rotating in and out through the year
 *   - a rota person intervening every other day (fixing whatever the checks flag)
 *   - ~10 skill changes per year, added (queued to a Monday) and removed (immediate)
 * Every day is checked against every rule that matters, and every reallocation is
 * measured for churn and for stability (a no-op reallocation must move nobody).
 *
 * Run: node tests/stress-10y.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP = path.join(__dirname, "..", "index.html");

function loadApp() {
  let html = fs.readFileSync(APP, "utf8");
  const hook = `window.__api = function(){ return {
    data, PODS, getWeek, autoFillDay, checkDay, mondayOf, todayISO, addDays, poolFor,
    staffById, canHoldPhone, isPhoneShadow, isPhoneSupervisor, poolState, countsInNumbers,
    reallocateFrom, reallocateSettled, diffWeeks, sweepInvalidPhones, rosterHistory, planDayFix, applyFixedDay,
    POD_SKILLS, PHONE_SKILLS, SKILL_KEYS,
    setWeek: k => { currentWeekKey = k; },
    setEdit: () => { EDIT_MODE = true; },
    reset: () => { for (const k in data.weeks) delete data.weeks[k]; data.staff.length = 0; data.pendingSkills = []; data.log.length = 0; }
  }; };`;
  html = html.replace("startUp();", hook + "\ntry{ if(!data) loadData(blankData()); }catch(e){}\nstartUp();");
  const errs = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {}; w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.addEventListener("error", e => errs.push(String((e.error && e.error.stack) || e.message)));
    }
  });
  return new Promise(res => setTimeout(() => res({ api: dom.window.__api(), win: dom.window, errs }), 900));
}

// deterministic RNG so a bad year can be reproduced from its seed
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const GRADES = ["SCF", "ST", "CT", "ACCS", "ICM", "Anaes", "IMT", "FY2", "JCF", "ACCP"];

(async () => {
  const t0 = Date.now();
  const { api, errs } = await loadApp();
  const P = api.PODS;

  // running totals across all ten years
  const T = {
    days: 0, years: 0,
    eViol: 0,                 // Pod E bigger than another pod
    unplaced: 0, dupes: 0,    // conservation
    phoneUntrained: 0, nightUntrained: 0,
    phoneSD: 0,
    phoneMissedWithHolder: 0, // no phone despite a trained LD holder being on
    newbiePhone: 0,           // phone inside someone's first two shifts
    thirdPod: 0,              // three different pods in one week
    neuroCD: 0, neuroTot: 0,
    podTotal: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    fixes: 0, fixedDays: 0,
    redDays: 0, amberDays: 0, cleanDays: 0,
    avoidableLD: 0, avoidableAirway: 0,
    kinds: {},
    skillAdds: 0, skillRemoves: 0,
    reallocMoves: 0, reallocRuns: 0, unstableRuns: 0,
    hardAfterFix: 0,
    freedByRemoval: 0
  };
  const perYear = [];
  const issues = [];

  for (let year = 0; year < 10; year++) {
    const R = rng(1000 + year * 7717);
    api.reset();
    const base = api.mondayOf(api.todayISO());
    const yStart = api.addDays(base, -7 * 52 * (10 - year));   // each year sits before the last

    // ---- the unit: 34 people, staggered arrivals and departures through the year -------------
    const staff = [];
    for (let i = 0; i < 34; i++) {
      const g = GRADES[Math.floor(R() * GRADES.length)];
      const s = {
        id: "Y" + year + "_" + i, name: "P" + year + "_" + i, grade: g,
        airway: ["SCF", "ST", "CT", "ACCS", "ICM", "Anaes"].includes(g),
        phoneHolder: ["SCF", "ST", "CT", "ICM", "Anaes"].includes(g),
        phoneSupervisor: ["SCF", "ICM"].includes(g),
        phoneShadow: false, neuro: R() < 0.15, transfer: R() < 0.5,
        supernum: false, nights: true, fgh: false, fghNights: false, fghSuper: false,
        active: true, verified: true, aliases: []
      };
      if (s.phoneSupervisor) s.phoneHolder = true;
      if (s.phoneHolder) s.phoneShadow = false;
      // rotation: a third of the unit turns over during the year
      s._from = R() < 0.30 ? Math.floor(R() * 30) : 0;          // first week they appear
      s._to   = R() < 0.30 ? 22 + Math.floor(R() * 30) : 52;    // last week they appear
      staff.push(s);
      api.data.staff.push(s);
    }

    const yr = { year, moves: [], churn: [], hard: 0, days: 0 };
    const seenShifts = {};   // id -> count of shifts so far, to police the first-two-shifts rule

    // Build the whole year's rosters up front. Real life pulls three months ahead from Optima, so a
    // skills change always lands on weeks that already exist — the point of the exercise.
    const weekKeys = [];
    for (let w = 0; w < 52; w++) {
      const wkKey = api.addDays(yStart, 7 * w);
      weekKeys.push(wkKey);
      const wk = api.getWeek(wkKey);
      wk.roster = {};
      const onThisWeek = staff.filter(s => w >= s._from && w < s._to);
      for (let d = 0; d < 5; d++) {
        const iso = api.addDays(wkKey, d);
        wk.roster[iso] = {};
        /* Optima never produces a night team of three, a night with nobody who can hold the phone,
           or a weekday with four long days on. Drawing each person's shift independently did all
           three constantly, so the old run was measuring a roster that could not exist rather than
           the rules. Build the shape the unit actually rosters: night team first (always four or
           more, always with a phone holder in it), then the day team with at least five long days. */
        const pick = (from, n) => {
          const pool = from.slice();
          for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
          return pool.slice(0, n);
        };
        const set = (s, code) => { wk.roster[iso][s.id] = { code, kind: code === "N" ? "night" : "day", src: "a" }; };

        // --- nights: 4 most often, sometimes 5 or 6, and never without a phone holder ---
        const nightPool = onThisWeek.filter(s => s.nights);
        const nWant = Math.min(nightPool.length, R() < 0.60 ? 4 : R() < 0.9 ? 5 : 6);
        let nightTeam = pick(nightPool, nWant);
        const canPhone = s => s.phoneHolder || s.phoneSupervisor;
        if (!nightTeam.some(canPhone)) {
          const holder = pick(nightPool.filter(canPhone), 1)[0];
          if (holder) nightTeam = [holder, ...nightTeam.filter(s => s.id !== holder.id)].slice(0, nWant);
        }
        nightTeam.forEach(s => set(s, "N"));

        // --- days: 10-16 on, about two-thirds long days, never fewer than five ---
        const dayPool = onThisWeek.filter(s => !nightTeam.some(n => n.id === s.id));
        const dWant = Math.min(dayPool.length, 10 + Math.floor(R() * 7));
        const dayTeam = pick(dayPool, dWant);
        const ldWant = Math.max(5, Math.round(dayTeam.length * (0.60 + R() * 0.15)));
        dayTeam.forEach((s, i) => set(s, i < ldWant ? "LD" : "SD"));
      }
    }

    for (let w = 0; w < 52; w++) {
      const wkKey = weekKeys[w];
      api.setWeek(wkKey);
      const wk = api.getWeek(wkKey);
      const onThisWeek = staff.filter(s => w >= s._from && w < s._to);

      // ---- allocate, then let the rota person look at it every other day --------------------
      wk.days.forEach((day, di) => {
        if (di > 4) return;
        api.autoFillDay(wk, di, wkKey);
        const iso = api.addDays(wkKey, di);
        const globalDay = w * 5 + di;
        if (globalDay % 2 === 0) {                    // "a rota person updates every other day"
          const before = api.checkDay(day, iso, di, wk).filter(x => x.hard).length;
          if (before) {
            T.fixes++;
            try {
              const plan = api.planDayFix(di);
              if (plan && plan.fixed && plan.changes && plan.changes.length) {
                api.applyFixedDay(di, plan.fixed); T.fixedDays++;
              }
            } catch (e) { issues.push("planDayFix threw in year " + year + " on " + iso + ": " + e.message); }
            const after = api.checkDay(day, iso, di, wk).filter(x => x.hard).length;
            if (after) T.hardAfterFix += after;
          }
        }
      });

      // ---- the day-by-day checks -----------------------------------------------------------
      const podsThisWeek = {};
      wk.days.forEach((day, di) => {
        if (di > 4) return;
        const iso = api.addDays(wkKey, di);
        const pool = api.poolFor(day, iso);
        const dayIds = Object.keys(pool).filter(id => pool[id].kind === "day");
        T.days++; yr.days++;

        const counts = {}; let placedAll = [];
        for (const p of P) {
          const ids = day.pods[p].assign.map(a => a.id).filter(Boolean);
          placedAll = placedAll.concat(ids);
          counts[p] = ids.filter(id => api.countsInNumbers(id)).length;
          T.podTotal[p] += counts[p];
          for (const id of ids) (podsThisWeek[id] = podsThisWeek[id] || new Set()).add(p);
        }
        if (P.some(p => p !== "E" && counts.E > counts[p])) T.eViol++;
        const set = new Set(placedAll);
        if (set.size !== placedAll.length) T.dupes++;
        for (const id of dayIds) if (!set.has(id)) T.unplaced++;

        // phone rules
        const ph = day.phone && api.staffById(day.phone);
        if (ph && !api.canHoldPhone(ph)) T.phoneUntrained++;
        if (day.phone) {
          const sh = api.currentAssignShift ? null : null;
          const st = pool[day.phone] ? api.poolState(pool[day.phone]) : null;
          if (st === "SD") T.phoneSD++;
          const nb = staff.find(x => x.id === day.phone);
          if ((seenShifts[day.phone] || 0) < 2 && nb && nb._from > 0) T.newbiePhone++;
        } else {
          const anyHolder = dayIds.some(id => {
            const s = api.staffById(id);
            return s && api.canHoldPhone(s) && api.poolState(pool[id]) === "LD" && (seenShifts[id] || 0) >= 2;
          });
          if (anyHolder) T.phoneMissedWithHolder++;
        }
        const nph = day.night && day.night.phone && api.staffById(day.night.phone);
        if (nph && !api.canHoldPhone(nph)) T.nightUntrained++;

        // neuro placement
        for (const p of P) for (const a of day.pods[p].assign) {
          const s = a.id && api.staffById(a.id);
          if (s && s.neuro) { T.neuroTot++; if (p === "C" || p === "D") T.neuroCD++; }
        }
        // how heavy is the warning load, and which rules are actually firing?
        {
          const issues = api.checkDay(day, iso, di, wk);
          const hard = issues.filter(x => x.hard), soft = issues.filter(x => !x.hard && !x.info);
          if (hard.length) T.redDays++; else if (soft.length) T.amberDays++; else T.cleanDays++;
          const LDon = dayIds.filter(id => api.poolState(pool[id]) === "LD").length;
          const AIRon = dayIds.filter(id => (api.staffById(id) || {}).airway).length;
          for (const h of hard.concat(soft)) {
            const k = (h.hard ? "RED  " : "AMBER") + " " + h.msg
              .replace(/^[A-Z][a-z]+ [A-Z][a-z'\-]+/, "NAME").replace(/\d+/g, "N")
              .replace(/pod\(s\) [A-E, ]+/i, "pod(s) X");
            T.kinds[k] = (T.kinds[k] || 0) + 1;
            if (h.hard && /long-day/.test(h.msg) && LDon >= 5) T.avoidableLD++;
            if (h.hard && /airway/i.test(h.msg) && AIRon >= 4) T.avoidableAirway++;
          }
        }
        // shift counter for the newcomer rule
        for (const id of Object.keys(pool)) seenShifts[id] = (seenShifts[id] || 0) + 1;
      });
      for (const st of Object.values(podsThisWeek)) if (st.size > 2) T.thirdPod++;

      // ---- skills changes: roughly ten a year, spread out ----------------------------------
      if (w > 0 && w % 5 === 0) {
        const live = onThisWeek.filter(s => s._to > w + 4);
        if (live.length) {
          const s = live[Math.floor(R() * live.length)];
          const addMode = R() < 0.6;
          const from = api.addDays(wkKey, 7);        // starts next Monday
          const before = JSON.parse(JSON.stringify(api.data.weeks));

          if (addMode) {
            const pool2 = R() < 0.5 ? api.POD_SKILLS : api.PHONE_SKILLS;
            const k = pool2[Math.floor(R() * pool2.length)];
            if (!s[k]) {
              s[k] = true;
              if (k === "phoneSupervisor") s.phoneHolder = true;
              if (k === "phoneHolder" || k === "phoneSupervisor") s.phoneShadow = false;
              if (k === "phoneShadow") { s.phoneHolder = false; s.phoneSupervisor = false; }
              T.skillAdds++;
              const touchesPods = api.POD_SKILLS.includes(k);
              api.reallocateSettled(from, touchesPods);
              const moves = api.diffWeeks(before, from);
              T.reallocMoves += moves.length; T.reallocRuns++;
              yr.churn.push({ week: w, who: s.name, skill: k, mode: "add", moves: moves.length });
            }
          } else {
            const k = api.PHONE_SKILLS[Math.floor(R() * api.PHONE_SKILLS.length)];
            if (s[k]) {
              s[k] = false;
              if (k === "phoneHolder") s.phoneSupervisor = false;
              T.skillRemoves++;
              const freed = api.sweepInvalidPhones();
              T.freedByRemoval += freed;
              yr.churn.push({ week: w, who: s.name, skill: k, mode: "remove", freed });
            }
          }
        }
      }

      // ---- stability probe: a reallocation with nothing changed must move nobody ------------
      if (w === 30) {
        const snap = JSON.parse(JSON.stringify(api.data.weeks));
        const from = api.addDays(wkKey, 7);
        api.reallocateSettled(from, true);
        const moves = api.diffWeeks(snap, from).filter(m => /Pod/.test(m));
        if (moves.length) {
          T.unstableRuns++;
          issues.push("Year " + year + ": no-op reallocation moved " + moves.length + " pod placements (e.g. " + moves[0] + ")");
        }
      }

    }

    T.years++;
    perYear.push(yr);
    process.stdout.write("  year " + (year + 1) + "/10 done (" + Math.round((Date.now() - t0) / 1000) + "s)\n");
  }

  // ---------------- report ----------------
  const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "n/a";
  console.log("\n================ 10-YEAR STRESS RESULTS ================");
  console.log("Years: " + T.years + " · weekdays simulated: " + T.days);
  console.log("Rota-person interventions: " + T.fixes + " days had issues, " + T.fixedDays + " were auto-fixed");
  console.log("Skill changes: " + T.skillAdds + " added, " + T.skillRemoves + " removed");
  console.log("Reallocations: " + T.reallocRuns + " runs, " + T.reallocMoves + " total changes ("
    + (T.reallocRuns ? (T.reallocMoves / T.reallocRuns).toFixed(1) : 0) + " per change)");
  console.log("Phone allocations released by a skill removal: " + T.freedByRemoval);
  console.log("");
  const line = (name, n, note) => console.log((n === 0 ? "  ✓ " : "  ✗ ") + name + ": " + n + (note ? "  " + note : ""));
  line("Pod E larger than another pod", T.eViol);
  line("Someone rostered but not placed", T.unplaced);
  line("Someone placed twice in a day", T.dupes);
  line("Day phone with someone not phone-trained", T.phoneUntrained);
  line("Night phone with someone not phone-trained", T.nightUntrained);
  line("Phone holder on a short day", T.phoneSD);
  line("Phone left empty when a trained holder was on", T.phoneMissedWithHolder);
  line("Phone inside someone's first two shifts", T.newbiePhone);
  line("Three different pods in one week", T.thirdPod);
  line("No-op reallocation moved people", T.unstableRuns);
  line("Hard issues still there after the rota person fixed the day", T.hardAfterFix);
  console.log("");
  console.log("  Days with a RED issue:   " + T.redDays + " / " + T.days + " (" + pct(T.redDays, T.days) + ")");
  console.log("  Days with only AMBER:    " + T.amberDays + " / " + T.days + " (" + pct(T.amberDays, T.days) + ")");
  console.log("  Days completely clean:   " + T.cleanDays + " / " + T.days + " (" + pct(T.cleanDays, T.days) + ")");
  console.log("  Avoidable no-long-day (5+ LDs on): " + T.avoidableLD + " · avoidable no-airway (4+ on): " + T.avoidableAirway);
  console.log("");
  console.log("  Every rule that fired, most common first:");
  Object.entries(T.kinds).sort((a,b) => b[1]-a[1]).slice(0, 22)
    .forEach(([k,n]) => console.log("    " + String(n).padStart(6) + "  " + k));
  console.log("");
  console.log("  Neuro on Pods C/D: " + pct(T.neuroCD, T.neuroTot) + " (aim ~70%)");
  console.log("  Average pod sizes: " + P.map(p => p + " " + (T.podTotal[p] / T.days).toFixed(2)).join(" · "));
  const allChurn = perYear.flatMap(y => y.churn).filter(c => c.mode === "add");
  if (allChurn.length) {
    const ms = allChurn.map(c => c.moves).sort((a, b) => a - b);
    const pod = allChurn.filter(c => api.POD_SKILLS.includes(c.skill)).map(c => c.moves);
    const phone = allChurn.filter(c => api.PHONE_SKILLS.includes(c.skill)).map(c => c.moves);
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "n/a";
    console.log("");
    console.log("  Changes caused by one skill being added:");
    console.log("    median " + ms[Math.floor(ms.length / 2)] + " · worst " + ms[ms.length - 1]);
    console.log("    pod-class skills (airway/neuro/supernum): avg " + avg(pod) + " over " + pod.length + " changes");
    console.log("    phone-class skills: avg " + avg(phone) + " over " + phone.length + " changes");
  }
  if (issues.length) {
    console.log("\n  ISSUES FOUND (" + issues.length + "):");
    issues.slice(0, 25).forEach(i => console.log("   - " + i));
  }
  if (errs.length) {
    console.log("\n  PAGE ERRORS (" + errs.length + "):");
    [...new Set(errs)].slice(0, 8).forEach(e => console.log("   - " + e.split("\n")[0]));
  }
  const bad = T.eViol + T.unplaced + T.dupes + T.phoneUntrained + T.nightUntrained + T.phoneSD
            + T.newbiePhone + T.thirdPod + T.unstableRuns + issues.length + errs.length;
  console.log("\n" + (bad ? "=== " + bad + " problems ===" : "=== clean ===") + "  (" + Math.round((Date.now() - t0) / 1000) + "s)");
  process.exit(0);
})();
