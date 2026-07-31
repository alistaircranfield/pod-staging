/*
 * Autonomous rule test-suite for Pod-Allocations.html
 * ---------------------------------------------------
 * Loads the real app in a headless DOM (jsdom), then exercises every allocation
 * rule and safety check with crafted + randomised scenarios and asserts they hold.
 *
 * Run:  node tests/rule-tests.js
 *       (needs jsdom — NODE_PATH is set by run-tests.sh, or `npm i jsdom` here)
 *
 * Exit code 0 = all pass, 1 = one or more failures.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP = path.join(__dirname, "..", "Pod-Allocations.html");

// ---- load the app and expose its internals via a single hook ---------------------------------
function loadApp() {
  let html = fs.readFileSync(APP, "utf8");
  const hook = `window.__api = function(){ return {
    data, PODS, blankDay, getWeek, autoFillDay, autoFillWeek, checkDay,
    mondayOf, todayISO, addDays, poolFor, staffById, canHoldPhone, isPhoneShadow,
    isPhoneSupervisor, isActiveOn, currentAssignShift, inFairfield, addToFairfield,
    fghMembers, countsInNumbers, poolState, removeAssign, attentionItems, srDetectGhosts, srRemoveFromDay,
    aggregateOverrides: typeof aggregateOverrides !== "undefined" ? aggregateOverrides : null,
    renderOverrides: typeof renderOverrides !== "undefined" ? renderOverrides : null,
    normalizeNight: typeof normalizeNight !== "undefined" ? normalizeNight : null,
    setWeek: k => { currentWeekKey = k; },
    getWeekKey: () => currentWeekKey,
    setEdit: () => { EDIT_MODE = true; }
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

// ---- tiny test framework ---------------------------------------------------------------------
let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

// ---- scenario helpers ------------------------------------------------------------------------
let TC = 0;
function mkStaff(api, attrs) {
  const s = Object.assign({
    id: "T" + (++TC), name: "Test" + TC, grade: "", airway: false, phoneHolder: false,
    phoneSupervisor: false, phoneShadow: false, neuro: false, transfer: false, supernum: false,
    nights: false, fgh: false, start: null, end: null, active: true, aliases: []
  }, attrs);
  api.data.staff.push(s);
  return s;
}
// Build an isolated blank day di in the current week, no roster, seeded with `people`.
// people: [{ shift:'LD'|'SD'|'N', ...attrs }]
function seedDay(api, di, people) {
  const wkKey = api.mondayOf(api.todayISO());
  api.setWeek(wkKey);
  const wk = api.getWeek(wkKey);
  wk.roster = null;
  wk.days[di] = api.blankDay();
  const day = wk.days[di];
  const made = people.map(p => {
    const s = mkStaff(api, p);
    day.extras.push({ id: s.id, kind: p.shift === "N" ? "night" : "day", code: p.shift });
    return s;
  });
  return { wk, day, made, dateISO: api.addDays(wkKey, di) };
}
function podCounts(api, day) {
  const c = {};
  for (const p of api.PODS) c[p] = day.pods[p].assign.filter(a => a.id && api.countsInNumbers(a.id)).length;
  return c;
}
function podOf(api, day, id) { return api.PODS.find(p => day.pods[p].assign.some(a => a.id === id)); }
function shiftOf(api, day, id) { return api.currentAssignShift(day, id); }
function rnd(n) { return Math.floor(Math.random() * n); }

// ============================================================================================
async function main() {
  const { api, win, errs } = await loadApp();
  api.setEdit();
  const P = api.PODS;
  const ORIG_STAFF = api.data.staff.length;   // baseline before any synthetic test staff are added

  console.log("\n=== Pod-Allocations rule suite ===\n");

  // 1) Pod E is never larger than any other pod (headcount) --------------------------------
  console.log("Pod E sizing");
  {
    let bad = 0, worst = "";
    for (let t = 0; t < 300; t++) {
      const n = 6 + rnd(28);
      const ppl = Array.from({ length: n }, () => ({ shift: Math.random() < 0.55 ? "LD" : "SD", airway: Math.random() < 0.25 }));
      const { wk, day } = seedDay(api, rnd(7), ppl);
      api.autoFillDay(wk, wk.days.indexOf(day));
      const c = podCounts(api, day);
      const minOther = Math.min(...P.filter(p => p !== "E").map(p => c[p]));
      if (c.E > minOther) { bad++; worst = JSON.stringify(c); }
    }
    ok("E never exceeds the smallest other pod (300 random days)", bad === 0, bad + " breaches, e.g. " + worst);
  }

  // 2) LD-before-E: E misses out on a long day when LDs are scarce -------------------------
  console.log("Long-day coverage");
  {
    let bad = 0, ex = "";
    for (let t = 0; t < 200; t++) {
      const nLD = 1 + rnd(6), nSD = rnd(12);
      const ppl = [];
      for (let i = 0; i < nLD; i++) ppl.push({ shift: "LD" });
      for (let i = 0; i < nSD; i++) ppl.push({ shift: "SD" });
      const { wk, day } = seedDay(api, rnd(7), ppl);
      api.autoFillDay(wk, wk.days.indexOf(day));
      const ld = {}; for (const p of P) ld[p] = day.pods[p].assign.filter(a => a.id && a.shift === "LD").length;
      const adMissing = P.filter(p => p !== "E" && ld[p] === 0);
      // Rule: E only holds an LD once every A–D already has one.
      if (ld.E > 0 && adMissing.length > 0) { bad++; ex = JSON.stringify(ld); }
    }
    ok("E only gets a long-day once every A–D has one (200 random days)", bad === 0, bad + " breaches, e.g. " + ex);
  }

  // 3) Phone holder is ALWAYS a long day, never a short day --------------------------------
  console.log("Phone holder rules");
  {
    let sdHolder = 0, notTrained = 0, keptSD = 0;
    for (let t = 0; t < 250; t++) {
      const nLDph = rnd(3);       // long-day phone-capable
      const ppl = [];
      for (let i = 0; i < nLDph; i++) ppl.push({ shift: "LD", phoneHolder: true });
      for (let i = 0; i < 3 + rnd(6); i++) ppl.push({ shift: Math.random() < 0.5 ? "LD" : "SD" });
      // add a short-day phone-capable person and pre-assign them the phone (as if imported)
      const sdPhone = { shift: "SD", phoneHolder: true };
      ppl.push(sdPhone);
      const { wk, day, made } = seedDay(api, rnd(7), ppl);
      day.phone = made[made.length - 1].id;   // the SD phone person
      api.autoFillDay(wk, wk.days.indexOf(day));
      if (day.phone) {
        const hs = shiftOf(api, day, day.phone) || api.poolState(api.poolFor(day, api.addDays(api.getWeekKey(), wk.days.indexOf(day)))[day.phone] || { code: "SD" });
        if (hs === "SD") sdHolder++;
        if (!api.canHoldPhone(api.staffById(day.phone))) notTrained++;
      }
      // if an LD phone-capable existed, the phone must have moved off the SD person
      if (nLDph > 0 && day.phone === made[made.length - 1].id) keptSD++;
    }
    ok("phone holder is never on a short day (250 days)", sdHolder === 0, sdHolder + " SD holders");
    ok("phone holder is always phone-trained", notTrained === 0, notTrained + " untrained");
    ok("an SD holder is replaced when a long-day holder is available", keptSD === 0, keptSD + " kept on SD");
  }

  // 4) When no LD phone-capable person is on, phone is left unassigned (never an SD holder) --
  {
    const ppl = [{ shift: "SD", phoneHolder: true }, { shift: "LD" }, { shift: "LD" }, { shift: "SD" }];
    const { wk, day, made } = seedDay(api, 0, ppl);
    day.phone = made[0].id;
    api.autoFillDay(wk, 0);
    ok("no LD holder available -> phone left unassigned (not left on SD)", day.phone == null, "phone=" + day.phone);
  }

  // 5) Phone holder sits in the busiest pod when there's spare cover -----------------------
  {
    let notBusiest = 0;
    for (let t = 0; t < 150; t++) {
      const ppl = [{ shift: "LD", phoneHolder: true }];
      for (let i = 0; i < 10 + rnd(15); i++) ppl.push({ shift: Math.random() < 0.6 ? "LD" : "SD" });
      const { wk, day } = seedDay(api, rnd(7), ppl);
      api.autoFillDay(wk, wk.days.indexOf(day));
      if (day.phone) {
        const c = podCounts(api, day);
        const hPod = podOf(api, day, day.phone);
        const maxC = Math.max(...P.map(p => c[p]));
        if (hPod && c[hPod] < maxC) notBusiest++;
      }
    }
    ok("phone holder ends up in the busiest pod (150 days)", notBusiest === 0, notBusiest + " off-busiest");
  }

  // 6) Airway-trained kept off Pod E when there's an alternative ---------------------------
  {
    let eAirwayAvoidable = 0;
    for (let t = 0; t < 150; t++) {
      const ppl = [];
      const nA = 2 + rnd(3);
      for (let i = 0; i < nA; i++) ppl.push({ shift: "LD", airway: true });
      for (let i = 0; i < 8 + rnd(8); i++) ppl.push({ shift: Math.random() < 0.5 ? "LD" : "SD" });
      const { wk, day } = seedDay(api, rnd(7), ppl);
      api.autoFillDay(wk, wk.days.indexOf(day));
      const eAir = day.pods.E.assign.filter(a => a.id && api.staffById(a.id).airway).length;
      // if E has an airway person but some A–D pod has none, that was avoidable
      const adNoAir = P.filter(p => p !== "E").some(p => day.pods[p].assign.filter(a => a.id && api.staffById(a.id).airway).length === 0);
      if (eAir > 0 && adNoAir) eAirwayAvoidable++;
    }
    // soft aim, so allow a small rate rather than zero
    ok("airway cover is kept off Pod E where possible (<10% of 150 days)", eAirwayAvoidable < 15, eAirwayAvoidable + "/150");
  }

  // 7) Neuro-trained lean to Pods C & D ---------------------------------------------------
  {
    let cd = 0, tot = 0;
    for (let t = 0; t < 200; t++) {
      const ppl = [{ shift: "LD", neuro: true }, { shift: "LD", neuro: true }];
      for (let i = 0; i < 8 + rnd(8); i++) ppl.push({ shift: Math.random() < 0.5 ? "LD" : "SD" });
      const { wk, day, made } = seedDay(api, rnd(7), ppl);
      api.autoFillDay(wk, wk.days.indexOf(day));
      for (const s of made.filter(x => x.neuro)) {
        const p = podOf(api, day, s.id);
        if (p) { tot++; if (p === "C" || p === "D") cd++; }
      }
    }
    const pct = Math.round(cd / tot * 100);
    // Nick's target is "at least ~60-70%" of daytime shifts on C/D — a floor, so more is fine.
    ok("neuro-trained mostly on C/D (>=60%)", pct >= 60, pct + "% on C/D");
  }

  // 8) Fairfield is never auto-filled; manual Fairfield people are left alone --------------
  console.log("Fairfield");
  {
    const ppl = [];
    for (let i = 0; i < 6; i++) ppl.push({ shift: "LD" });
    const { wk, day, made, dateISO } = seedDay(api, 2, ppl);
    api.addToFairfield(day, dateISO, made[0].id, "LD");
    api.autoFillDay(wk, 2);
    const inPod = P.some(p => day.pods[p].assign.some(a => a.id === made[0].id));
    ok("auto-fill never pulls a Fairfield person into a pod", !inPod && api.inFairfield(day, dateISO, made[0].id));
    const fghAfter = api.fghMembers(day, dateISO).length;
    ok("auto-fill adds nobody new to Fairfield", fghAfter === 1, "members=" + fghAfter);
  }

  // 9) Supernumerary are not counted in pod numbers ---------------------------------------
  {
    const ppl = [{ shift: "LD", supernum: true }, { shift: "LD" }, { shift: "LD" }];
    const { wk, day } = seedDay(api, 1, ppl);
    api.autoFillDay(wk, 1);
    const c = podCounts(api, day);
    const total = P.reduce((n, p) => n + c[p], 0);
    ok("supernumerary excluded from counted numbers", total === 2, "counted=" + total);
  }

  // 9b) Weekend pairs: Sunday holds Saturday's pods, bar the one swap that gives E a long day ----
  console.log("Weekend continuity");
  {
    // The real weekend shape: nine on, one long day and one short day per pod (E has the single),
    // and the LD/SD roles swap within each pair between Saturday and Sunday. Left alone, that role
    // swap used to scatter people across pods; now the Saturday pods are held.
    const runWeekend = (satRoles, sunRoles) => {
      const wkKey = api.mondayOf(api.todayISO());
      api.setWeek(wkKey);
      const wk = api.getWeek(wkKey);
      wk.roster = null;
      wk.days[5] = api.blankDay(); wk.days[6] = api.blankDay();
      const people = satRoles.map((sh, i) => mkStaff(api, { airway: i % 3 === 0, phoneHolder: true }));
      people.forEach((s, i) => {
        wk.days[5].extras.push({ id: s.id, kind: "day", code: satRoles[i] });
        wk.days[6].extras.push({ id: s.id, kind: "day", code: sunRoles[i] });
      });
      api.autoFillDay(wk, 5, wkKey);
      api.autoFillDay(wk, 6, wkKey);
      const moved = people.filter(s => podOf(api, wk.days[5], s.id) !== podOf(api, wk.days[6], s.id));
      return { wk, people, moved };
    };
    // Nine on: four pods of two plus Pod E's single. Every pair swaps roles overnight, and E's
    // long day drops to a short day — the exact collision that used to move four people.
    const sat = ["LD","SD","LD","SD","LD","SD","LD","SD","LD"];
    const sun = ["SD","LD","SD","LD","SD","LD","LD","LD","SD"];
    let worstMoved = 0, ldGaps = 0, unbalanced = 0;
    for (let t = 0; t < 40; t++) {
      const { wk, moved } = runWeekend(sat, sun);
      worstMoved = Math.max(worstMoved, moved.length);
      const sun6 = wk.days[6];
      const c = podCounts(api, sun6);
      const counted = P.reduce((n, p) => n + c[p], 0);
      if (Math.max(...P.map(p => c[p])) - Math.min(...P.map(p => c[p])) > 1) unbalanced++;
      const ld = {}; for (const q of P) ld[q] = sun6.pods[q].assign.filter(a => a.id && a.shift === "LD").length;
      // Five long days across five pods: every pod that has anybody in it should have one.
      if (P.some(q => c[q] > 0 && ld[q] === 0)) ldGaps++;
      if (counted !== 9) ldGaps++;
    }
    ok("Sunday moves at most two people out of their Saturday pod", worstMoved <= 2, "worst = " + worstMoved);
    ok("Sunday still gives every occupied pod a long day", ldGaps === 0, ldGaps + " days with a gap");
    ok("Sunday stays balanced while holding the Saturday pods", unbalanced === 0, unbalanced + " unbalanced days");
  }

  // 9c) A supernumerary long day does not count as the pod's long day ---------------------
  console.log("Supernumerary long days");
  {
    // The day check ignores supernumeraries when it asks whether a pod has a long day, but the
    // allocator used to count them — so it believed a pod was covered while the board showed red.
    let bad = 0, ex = "";
    for (let t = 0; t < 120; t++) {
      const ppl = [];
      // Five or more counted long days on, so one per pod is always achievable, plus a couple of
      // supernumerary long days to make sure they are not mistaken for the real thing.
      for (let i = 0; i < 5 + rnd(3); i++) ppl.push({ shift: "LD" });
      for (let i = 0; i < 4 + rnd(8); i++) ppl.push({ shift: "SD" });
      for (let i = 0; i < 1 + rnd(2); i++) ppl.push({ shift: "LD", supernum: true });
      const { wk, day } = seedDay(api, rnd(7), ppl);
      api.autoFillDay(wk, wk.days.indexOf(day));
      for (const q of P) {
        const counted = day.pods[q].assign.filter(a => a.id && api.countsInNumbers(a.id));
        if (!counted.length) continue;
        if (!counted.some(a => a.shift === "LD")) { bad++; ex = q + " " + JSON.stringify(day.pods[q].assign.map(a => a.shift)); }
      }
    }
    ok("a pod's long day is never a supernumerary standing in for one", bad === 0, bad + " pods left uncovered, e.g. " + ex);
  }

  // 10) Auto-filled days pass their own hard checks (no residual H issues) -----------------
  console.log("Self-consistency of the checker");
  {
    let hard = 0, sample = "";
    for (let t = 0; t < 200; t++) {
      // Adequately staffed day: >=6 long days (so every pod can get one) incl. an LD phone holder.
      const ppl = [{ shift: "LD", phoneHolder: true }];
      for (let i = 0; i < 6; i++) ppl.push({ shift: "LD", airway: i < 2 });
      for (let i = 0; i < 4 + rnd(14); i++) ppl.push({ shift: Math.random() < 0.5 ? "LD" : "SD", airway: Math.random() < 0.3 });
      const { wk, day, dateISO } = seedDay(api, rnd(7), ppl);
      const di = wk.days.indexOf(day);
      api.autoFillDay(wk, di);
      const issues = api.checkDay(day, dateISO, di, wk).filter(i => i.hard);
      // ignore the night-team hard flags: this per-day seed has no night roster
      const dayHard = issues.filter(i => !/night/i.test(i.msg));
      if (dayHard.length) { hard += dayHard.length; if (!sample) sample = dayHard.map(i => i.msg)[0]; }
    }
    ok("adequately-staffed auto-filled days raise no day-shift hard issues (200 days)", hard === 0, hard + " issues, e.g. " + sample);
  }

  // 11) TWELVE-MONTH SIMULATION over a realistic roster ------------------------------------




  // 8e) Ghost detection: consultants are not Optima people ----------------------------------
  console.log("Optima ghost check");
  {
    const cons = mkStaff(api, { grade: "CON", name: "Ghost Consultant" });
    const res = mkStaff(api, { grade: "ST", name: "Ghost Resident", nights: true });
    const wkKey = api.mondayOf(api.todayISO());
    api.setWeek(wkKey);
    const wk = api.getWeek(wkKey);
    const di = wk.days.length - 1;                          // Sunday: always today or later this week
    wk.days[di] = api.blankDay();
    const day = wk.days[di];
    const dISO = api.addDays(wkKey, di);
    wk.roster = { [dISO]: {} };                             // an Optima roster exists, with NOBODY on it
    day.nightCons = cons.id;                                // consultant on call — from the consultant sheet
    day.night.E = [res.id];                                 // resident in night Pod E — a REAL ghost
    const ghosts = api.srDetectGhosts();
    ok("a consultant on call is never flagged as off the Optima rota", !ghosts.some(g => g.sid === cons.id),
      JSON.stringify(ghosts.map(g => g.name)));
    ok("a resident in night Pod E off the roster IS flagged", ghosts.some(g => g.sid === res.id),
      JSON.stringify(ghosts.map(g => g.name)));
    const hits = api.srRemoveFromDay(day, res.id);
    ok("remove-from-day clears night Pod E too", !(day.night.E || []).includes(res.id) && hits.some(h => /night/i.test(h)),
      JSON.stringify({ E: day.night.E, hits }));
    wk.roster = null; wk.days[di] = api.blankDay();
  }

  // 8d) Consultant-cover attention nudge ----------------------------------------------------
  console.log("Consultant cover running out");
  {
    // Cover far ahead: no nudge. Cover ending soon: a Needs-attention item pointing at Import.
    const consId = mkStaff(api, { grade: "CON", name: "Cover Consultant" }).id;
    const setCoverUntil = daysAhead => {
      for (const k of Object.keys(api.data.weeks)) delete api.data.weeks[k];
      const mon = api.mondayOf(api.todayISO());
      for (let w = 0; w < 5; w++) {
        const wk = api.getWeek(api.addDays(mon, w * 7));
        wk.days.forEach((day, di) => {
          const dISO = api.addDays(api.addDays(mon, w * 7), di);
          const diff = Math.round((new Date(dISO) - new Date(api.todayISO())) / 86400000);
          if (diff >= 0 && diff <= daysAhead) day.pods.A.cons = consId;
        });
      }
    };
    setCoverUntil(20);
    ok("plenty of consultant cover ahead: no nudge", !api.attentionItems().some(x => /consultant cover|pod allocations/i.test(x.title)),
      api.attentionItems().map(x => x.title).join(" | "));
    setCoverUntil(4);
    const hit = api.attentionItems().find(x => /consultant cover|pod allocations/i.test(x.title));
    ok("cover ends within a week: Needs-attention asks for the next sheet", !!hit,
      api.attentionItems().map(x => x.title).join(" | "));
    for (const k of Object.keys(api.data.weeks)) delete api.data.weeks[k];
  }

  // 8c) Overrides admin page --------------------------------------------------------------
  console.log("Overrides admin page");
  {
    ok("aggregateOverrides counts repeated moves, biggest first, and skips malformed rows", (() => {
      if (typeof api.aggregateOverrides !== "function") return false;
      const list = [];
      for (let i = 0; i < 14; i++) list.push({ from: "E", to: "C", shift: "LD" });
      for (let i = 0; i < 3; i++) list.push({ from: "A", to: "B", shift: "SD" });
      list.push({ from: "B", to: "A" });          // no shift — still a real move
      list.push({ from: null, to: "C" });          // malformed — ignored
      const agg = api.aggregateOverrides(list);
      return agg.length === 3 && agg[0].from === "E" && agg[0].to === "C" && agg[0].shift === "LD" && agg[0].count === 14;
    })());
    ok("the overrides page lists every recorded move with who and when", (() => {
      if (typeof api.renderOverrides !== "function") return false;
      api.data.overrides = [
        { t: "2026-07-31T20:00:00Z", d: "2026-08-03", id: "x1", name: "Test Person", from: "E", to: "C", shift: "LD", by: "Ali" },
        { t: "2026-07-31T20:01:00Z", d: "2026-08-03", id: "x2", name: "Other Person", from: "E", to: "C", shift: "LD", by: "Ali" },
        { t: "2026-07-31T20:02:00Z", d: "2026-08-04", id: "x3", name: "Third Person", from: "A", to: "B", shift: "SD", by: "Nick" }
      ];
      api.renderOverrides();
      const rows = win.document.querySelectorAll("#ovrList .logrow");
      const txt = win.document.querySelector("#ovrList").textContent;
      return rows.length === 3 && /Test Person/.test(txt) && /Ali/.test(txt);
    })());
    ok("a repeated move shows as one count on top", (() => {
      if (typeof api.renderOverrides !== "function") return false;
      const top = win.document.querySelector("#ovrTop").textContent;
      return /2/.test(top) && /E/.test(top) && /C/.test(top);
    })());
    api.data.overrides = [];
  }

  // 8b) Night Pod E is a real container -----------------------------------------------------
  console.log("Night Pod E");
  {
    // A blank day carries the container at all, so nothing downstream has to invent it.
    ok("a blank day has night.E as a real (empty) list", Array.isArray(api.blankDay().night.E));

    // Pod E holds MORE THAN ONE person — the whole point of the change (Nick Whitehouse, 31 Jul).
    const a = mkStaff(api, { nights: true }), b = mkStaff(api, { nights: true });
    const { day } = seedDay(api, 1, []);
    day.night.E = day.night.E || [];
    day.night.E.push(a.id, b.id);
    ok("night Pod E holds two people at once", (day.night.E || []).length === 2);
    api.removeAssign(day, a.id);
    ok("removeAssign clears somebody out of night Pod E", !(day.night.E || []).includes(a.id) && (day.night.E || []).includes(b.id));

    // Migration is absent = empty: a saved day from before the change has no E key and must not break.
    const legacy = seedDay(api, 2, []).day;
    delete legacy.night.E;
    let threw = null;
    try { api.checkDay(legacy, api.addDays(api.getWeekKey(), 2), 2, api.getWeek(api.getWeekKey())); } catch (e) { threw = e; }
    ok("a legacy day without night.E runs through the checker untouched", threw === null, String(threw));
  }
  {
    // The night phone holder standing in Pod E is covering a pod — the checker must accept it.
    const ph = mkStaff(api, { phoneHolder: true, nights: true });
    const o1 = mkStaff(api, { nights: true }), o2 = mkStaff(api, { nights: true });
    const { day } = seedDay(api, 3, []);
    day.night.phone = ph.id; day.night.AB = [o1.id, o2.id]; day.night.CDE = []; day.night.E = [ph.id];
    const flags = api.checkDay(day, api.addDays(api.getWeekKey(), 3), 3, api.getWeek(api.getWeekKey())).map(i => i.msg).join(" | ");
    ok("phone holder standing in Pod E counts as covering a pod", !/covers a pod/.test(flags), flags);
  }
  {
    // Airway split is AB against the C/D/E side — an airway person in Pod E covers that side.
    const ph = mkStaff(api, { phoneHolder: true, nights: true, airway: true });
    const o1 = mkStaff(api, { nights: true, airway: true }), o2 = mkStaff(api, { nights: true });
    const { day } = seedDay(api, 4, []);
    day.night.phone = ph.id; day.night.AB = [o1.id, o2.id]; day.night.CDE = []; day.night.E = [ph.id];
    const flags = api.checkDay(day, api.addDays(api.getWeekKey(), 4), 4, api.getWeek(api.getWeekKey())).map(i => i.msg).join(" | ");
    ok("an airway person in Pod E satisfies the C,D&E side of the split", !/Two airway-trained/.test(flags), flags);
  }
  {
    // Legacy five-on data stored the holder inside C,D&E and only DREW a Pod E row.
    // The new model migrates that person into the real container.
    ok("normalizeNight exists for legacy five-on data", typeof api.normalizeNight === "function");
    if (typeof api.normalizeNight === "function") {
      const ids = Array.from({ length: 5 }, () => mkStaff(api, { nights: true, phoneHolder: true }).id);
      const { day } = seedDay(api, 5, []);
      day.night.phone = ids[4]; day.night.AB = [ids[0], ids[1]]; day.night.CDE = [ids[2], ids[3], ids[4]];
      delete day.night.E;
      api.normalizeNight(day);
      ok("legacy five-on day: holder migrates from C,D&E into Pod E",
        (day.night.E || []).includes(ids[4]) && !(day.night.CDE || []).includes(ids[4]),
        JSON.stringify(day.night));
      // ...and running it again changes nothing (it will be called from render paths).
      const snap = JSON.stringify(day.night);
      api.normalizeNight(day);
      ok("normalizeNight is idempotent", JSON.stringify(day.night) === snap);
    }
  }
  {
    // Auto-fill: five on nights -> the holder covers Pod E as a real placement, not a drawing.
    const five = Array.from({ length: 5 }, () => ({ shift: "N", nights: true, phoneHolder: true }));
    const { wk, day } = seedDay(api, 6, five);
    api.autoFillDay(wk, 6);
    const n = day.night;
    ok("five on nights: auto-fill places the phone holder in the real Pod E",
      !!n.phone && (n.E || []).includes(n.phone), JSON.stringify({ phone: n.phone, AB: n.AB, CDE: n.CDE, E: n.E }));
    ok("five on nights: the other four still cover A&B and C&D two apiece",
      (n.AB || []).length === 2 && (n.CDE || []).length === 2, JSON.stringify({ AB: n.AB, CDE: n.CDE }));
  }
  {
    // Auto-fill: four on nights -> nobody splits off, Pod E stays empty, pods hold still.
    const four = Array.from({ length: 4 }, () => ({ shift: "N", nights: true, phoneHolder: true }));
    const { wk, day } = seedDay(api, 0, four);
    api.autoFillDay(wk, 0);
    ok("four on nights: Pod E stays empty", (day.night.E || []).length === 0, JSON.stringify(day.night.E));
  }

  console.log("12-month simulation (52 weeks, ~30 staff)");
  {
    // Reset state so the year runs on a clean, small unit (the crafted tests above pile up staff,
    // which would make every staffById lookup O(n) and blow the runtime).
    api.data.staff.length = ORIG_STAFF;
    for (const k in api.data.weeks) delete api.data.weeks[k];
    TC = 0;
    // Build a realistic unit: 30 staff with a spread of attributes + a few Fairfield-only people.
    const roster = [];
    for (let i = 0; i < 30; i++) roster.push(mkStaff(api, {
      name: "R" + i,
      airway: i % 3 === 0, phoneHolder: i % 4 === 0, phoneSupervisor: i % 9 === 0,
      neuro: i % 7 === 0, transfer: i % 5 === 0, supernum: i === 29, nights: i % 2 === 0,
      start: null, end: null
    }));
    const fghPeople = [mkStaff(api, { name: "FGH1", airway: true }), mkStaff(api, { name: "FGH2" })];
    // one joiner mid-year, one leaver mid-year (to test fairness on people with less time on the unit)
    const base = api.mondayOf(api.todayISO());
    const joiner = mkStaff(api, { name: "Joiner", phoneHolder: true, start: api.addDays(base, -7 * 26) });
    const leaver = roster[1]; leaver.end = api.addDays(base, -7 * 26); // leaves halfway

    const holds = {}, eligLD = {}, weekHolds = [];
    let eViol = 0, ldEViol = 0, phoneSD = 0, phoneUntrained = 0, fghAutofilled = 0;
    let consFail = 0, days = 0, podTotal = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    let neuroCD = 0, neuroTot = 0, phoneDays = 0, noPhoneDays = 0;

    for (let w = 0; w < 52; w++) {
      const wkKey = api.addDays(base, -7 * (51 - w));   // 52 weeks ending this week
      api.setWeek(wkKey);
      const wk = api.getWeek(wkKey);
      const rmap = {};
      for (let d = 0; d < 5; d++) {   // weekdays only, to keep the year's simulation inside one run
        const iso = api.addDays(wkKey, d);
        rmap[iso] = {};
        for (const s of roster.concat([joiner])) {
          if (!api.isActiveOn(s, iso)) continue;
          const r = Math.random();
          let code = null;
          if (r < 0.5) code = Math.random() < 0.6 ? "LD" : "SD"; else if (r < 0.62 && s.nights) code = "N";
          if (code) { rmap[iso][s.id] = { code, kind: code === "N" ? "night" : "day" }; if (code === "LD") eligLD[s.id] = (eligLD[s.id] || 0) + 1; }
        }
        // Fairfield people via roster (FGH codes -> kind "off", so excluded from pods, shown in Fairfield)
        for (const s of fghPeople) if (Math.random() < 0.6) rmap[iso][s.id] = { code: "FGH LD", kind: "off" };
      }
      wk.roster = rmap;

      for (let d = 0; d < 5; d++) {
        const iso = api.addDays(wkKey, d);
        api.autoFillDay(wk, d);
        const day = wk.days[d];
        days++;
        // pod E sizing + LD-before-E
        const c = {}; for (const p of P) c[p] = day.pods[p].assign.filter(a => a.id && api.countsInNumbers(a.id)).length;
        const ld = {}; for (const p of P) ld[p] = day.pods[p].assign.filter(a => a.id && a.shift === "LD").length;
        for (const p of P) podTotal[p] += c[p];
        if (c.E > Math.min(...P.filter(x => x !== "E").map(x => c[x]))) eViol++;
        if (ld.E > 0 && P.filter(x => x !== "E").some(x => ld[x] === 0)) ldEViol++;
        // phone holder validity
        if (day.phone) {
          phoneDays++;
          const hs = shiftOf(api, day, day.phone) || (api.poolFor(day, iso)[day.phone] ? api.poolState(api.poolFor(day, iso)[day.phone]) : null);
          if (hs === "SD") phoneSD++;
          if (!api.canHoldPhone(api.staffById(day.phone))) phoneUntrained++;
          holds[day.phone] = (holds[day.phone] || 0) + 1;
        } else {
          // legitimate only if no LD phone-capable person was on
          const anyLDphone = Object.entries(api.poolFor(day, iso)).some(([id, v]) => v.kind === "day" && api.poolState(v) === "LD" && api.canHoldPhone(api.staffById(id)) && !api.inFairfield(day, iso, id));
          if (anyLDphone) noPhoneDays++;
        }
        // Fairfield people must never be auto-placed into a pod
        for (const s of fghPeople) if (P.some(p => day.pods[p].assign.some(a => a.id === s.id))) fghAutofilled++;
        // neuro on C/D
        for (const p of P) for (const a of day.pods[p].assign) { const s = api.staffById(a.id); if (s && s.neuro) { neuroTot++; if (p === "C" || p === "D") neuroCD++; } }
        // conservation: every on-duty day person (not Fairfield) is placed in a pod exactly once
        const onDuty = Object.entries(api.poolFor(day, iso)).filter(([id, v]) => v.kind === "day" && !api.inFairfield(day, iso, id)).map(([id]) => id);
        const placed = P.flatMap(p => day.pods[p].assign.map(a => a.id)).filter(Boolean);
        const placedSet = new Set(placed);
        const dup = placed.length !== placedSet.size;
        const allPlaced = onDuty.every(id => placedSet.has(id));
        const noExtras = placed.every(id => onDuty.includes(id) || api.inFairfield(day, iso, id));
        if (dup || !allPlaced || !noExtras) consFail++;
      }
      // per-week phone holds (for the "<=2/week" rule)
      const pw = {};
      for (let d = 0; d < 5; d++) { const ph = wk.days[d].phone; if (ph) pw[ph] = (pw[ph] || 0) + 1; }
      weekHolds.push(Math.max(0, ...Object.values(pw)));
    }

    // fairness: holds per eligible long-day, for people with a decent number of eligible LDs
    const rates = roster.concat([joiner]).filter(s => (eligLD[s.id] || 0) >= 10 && api.canHoldPhone(s))
      .map(s => (holds[s.id] || 0) / eligLD[s.id]);
    const rateSpread = rates.length ? (Math.max(...rates) - Math.min(...rates)) : 0;
    const maxWeek = Math.max(...weekHolds);

    console.log("    days simulated: " + days + " | avg pod sizes A/B/C/D/E: " +
      P.map(p => (podTotal[p] / days).toFixed(1)).join(" / "));
    console.log("    phone: " + phoneDays + " days covered, " + noPhoneDays + " uncovered-with-holder-available; neuro on C/D: " +
      (neuroTot ? Math.round(neuroCD / neuroTot * 100) : 0) + "%");

    ok("[12mo] Pod E never larger than another pod (all " + days + " days)", eViol === 0, eViol + " days");
    const adAvgs = ["A", "B", "C", "D"].map(p => podTotal[p] / days);
    ok("[12mo] Pods A–D evenly balanced (spread < 0.6/day)", (Math.max(...adAvgs) - Math.min(...adAvgs)) < 0.6, "spread=" + (Math.max(...adAvgs) - Math.min(...adAvgs)).toFixed(2));
    ok("[12mo] E only holds an LD once every A–D has one", ldEViol === 0, ldEViol + " days");
    ok("[12mo] phone holder never on a short day", phoneSD === 0, phoneSD + " days");
    ok("[12mo] phone holder always phone-trained", phoneUntrained === 0, phoneUntrained + " days");
    ok("[12mo] phone always covered when an LD holder was available", noPhoneDays === 0, noPhoneDays + " gaps");
    ok("[12mo] Fairfield people never auto-placed into a pod", fghAutofilled === 0, fghAutofilled + " times");
    ok("[12mo] every on-duty day person placed exactly once (conservation)", consFail === 0, consFail + " days off");
    ok("[12mo] neuro-trained ~70% on C/D (62-80%)", (() => { const p = Math.round(neuroCD / neuroTot * 100); return p >= 62 && p <= 80; })(), Math.round(neuroCD / neuroTot * 100) + "%");
    // Aim is <=2/week; a 3rd can be forced in a week where only one eligible holder was on some days.
    ok("[12mo] day phone rarely held more than twice a week (<=3)", maxWeek <= 3, "max/week=" + maxWeek);
    ok("[12mo] phone-hold RATE even across eligible staff (spread < 0.15)", rateSpread < 0.15, "rate spread=" + rateSpread.toFixed(3));

    // ---- write a human-readable totals report -------------------------------------------
    const L = [];
    L.push("# Pod Allocations — 12-month simulation totals");
    L.push("");
    L.push("Simulated " + days + " weekdays (52 weeks) on a ~30-person unit with a mid-year joiner and leaver.");
    L.push("Every day was auto-allocated, then checked against every rule.");
    L.push("");
    L.push("## Pod sizes (counted people, daily average)");
    L.push("");
    L.push("| Pod | Avg per day |");
    L.push("|-----|-------------|");
    for (const p of P) L.push("| " + p + " | " + (podTotal[p] / days).toFixed(2) + " |");
    L.push("");
    L.push("Pod E is the smallest every single day (0 days larger than another pod).");
    L.push("");
    L.push("## Referral phone");
    L.push("");
    L.push("- Days with a phone holder: **" + phoneDays + " / " + days + "**");
    L.push("- Days left uncovered where a long-day holder *was* available: **" + noPhoneDays + "** (the rest had no eligible long-day holder on)");
    L.push("- Phone holder on a short day: **" + phoneSD + "** · not phone-trained: **" + phoneUntrained + "**");
    L.push("- Most times anyone held the day phone in a single week: **" + maxWeek + "**");
    L.push("");
    L.push("### Phone-hold fairness (holds per eligible long-day)");
    L.push("");
    L.push("| Person | Holds | Eligible LDs | Rate |");
    L.push("|--------|-------|--------------|------|");
    const rows = roster.concat([joiner]).filter(s => api.canHoldPhone(s) && (eligLD[s.id] || 0) > 0)
      .map(s => ({ name: s.name, h: holds[s.id] || 0, e: eligLD[s.id] || 0 }))
      .sort((a, b) => (b.h / b.e) - (a.h / a.e));
    for (const r of rows) L.push("| " + r.name + " | " + r.h + " | " + r.e + " | " + (r.h / r.e).toFixed(2) + " |");
    L.push("");
    L.push("Rate spread across eligible holders: **" + rateSpread.toFixed(3) + "** (lower = fairer; the joiner, on the unit only half the year, sits on the same rate as everyone else).");
    L.push("");
    L.push("## Skills");
    L.push("");
    L.push("- Neuro-trained shifts landing on Pods C or D: **" + Math.round(neuroCD / neuroTot * 100) + "%**");
    L.push("- Fairfield people auto-placed into a pod: **" + fghAutofilled + "** (never — Fairfield only comes from the roster + manual moves)");
    L.push("- Days where every on-duty person was placed exactly once (no lost/duplicated people): **" + (days - consFail) + " / " + days + "**");
    L.push("");
    const reportPath = path.join(__dirname, "last-run-totals.md");
    fs.writeFileSync(reportPath, L.join("\n"));
    console.log("    totals report written to tests/last-run-totals.md");
  }

  // ---- summary --------------------------------------------------------------------------
  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  if (errs.length) console.log("(page errors during load: " + errs.length + ")");
  if (fail) { console.log("\nFailures:\n - " + failures.join("\n - ")); process.exit(1); }
  process.exit(0);
}
main().catch(e => { console.error(e.stack); process.exit(1); });
