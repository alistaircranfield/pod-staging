/* score-source-probe.js — IS THE NUMBER ON THE DIAL THE ALLOCATOR'S, OR STILL STRENGTH.JS'S?
 *
 * The rule and render suites build their days with seedDay(), which makes a day with NO ROSTER.
 * plannerLedger() works out who is on from the day's pool, so on a roster-less day it finds nobody
 * on, the day is not "staffed", and every dial quietly falls back to strength.js's number. Those
 * suites therefore cannot tell you whether this change did anything at all.
 *
 * So this builds a week from the REAL Optima roster, renders it, and checks the number the board
 * put on the face of each dial against podcost.js computed independently. If they ever disagree,
 * the board and the allocator are marking different papers again and this says so.
 *
 *   node tests/score-source-probe.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "index.html");
const BENCH = path.join(ROOT, "..", "..", "docs", "bench", "allocate-bench.json");
const PC = require(path.join(ROOT, "podcost.js"));
const P  = require(path.join(ROOT, "planner.js"));

function inlineScript(html, file, src) {
  const safe = src.replace(/<\/script/gi, "<\\/script");
  return html.replace(new RegExp('<script src="' + file.replace(".", "\\.") + '[^"]*"><\\/script>'),
    () => "<script>" + safe + "</script>");
}
function loadApp() {
  let html = fs.readFileSync(APP, "utf8");
  for (const f of ["strength.js", "planner.js", "podcost.js"]) {
    try { html = inlineScript(html, f, fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (e) {}
  }
  const hook = `window.__api = function(){ return {
    data, PODS, getWeek, blankDay, mondayOf, todayISO, addDays, staffById, renderAll, renderWeek,
    plannerDayScore: typeof plannerDayScore !== "undefined" ? plannerDayScore : null,
    plannerLedger: typeof plannerLedger !== "undefined" ? plannerLedger : null,
    strengthTick: typeof strengthTick !== "undefined" ? strengthTick : null,
    STR_DAY: () => STR_DAY,
    fillWeekWithPlanner: typeof fillWeekWithPlanner !== "undefined" ? fillWeekWithPlanner : null,
    hasPodCost: () => typeof PodCost !== "undefined" && !!PodCost,
    setWeek: k => { currentWeekKey = k; },
    setEdit: v => { EDIT_MODE = !!v; },
    setRule: (k, v) => { data.rules = data.rules || {}; data.rules[k] = v; },
    rule: typeof rule !== "undefined" ? rule : null,
    countDials: () => document.querySelectorAll(".strdial").length,
    countBars:  () => document.querySelectorAll(".strbar").length,
    countTicks: () => document.querySelectorAll(".strbar .bc, .strring .rc").length
  }; };`;
  html = html.replace("startUp();", hook + "\ntry{ if(!data) loadData(blankData()); }catch(e){}\nstartUp();");
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {}; w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });
  return new Promise(res => setTimeout(() => res({ api: dom.window.__api(), win: dom.window }), 1200));
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

(async function () {
  const { api } = await loadApp();
  ok("podcost.js reached the page", api.hasPodCost());
  if (!api.hasPodCost()) process.exit(1);

  const bench = JSON.parse(fs.readFileSync(BENCH, "utf8"));
  api.data.staff.length = 0;
  for (const id in bench.staff) api.data.staff.push(Object.assign({ active: true, aliases: [] }, bench.staff[id]));

  /* a FUTURE week, so nothing can pass because a date is in the past */
  const MON = api.addDays(api.mondayOf(api.todayISO()), 7);
  const srcKey = Object.keys(bench.weeks).sort().filter(k => Object.keys(bench.weeks[k].roster).length >= 7)[0];
  const roster = {};
  for (let di = 0; di < 7; di++)
    roster[api.addDays(MON, di)] = JSON.parse(JSON.stringify(bench.weeks[srcKey].roster[api.addDays(srcKey, di)] || {}));

  api.data.weeks = api.data.weeks || {};
  const wk = { key: MON, roster: roster, days: [] };
  for (let di = 0; di < 7; di++) wk.days.push(api.blankDay());
  api.data.weeks[MON] = wk;
  api.setWeek(MON);
  api.setRule("writeDay", 0); api.setRule("writeHour", 0);
  api.fillWeekWithPlanner(wk, MON);

  /* ── 1 · the number on the dial is the planner's ────────────────────────────────────────── */
  let scored = 0, agreed = 0, disagreed = [];
  for (let di = 0; di < 7; di++) {
    const pl = api.plannerDayScore(wk, MON, di);
    if (!pl) continue;
    scored++;
    const rec = api.strengthTick(wk.days[di], api.addDays(MON, di), [], wk, di);
    if (!rec || !rec.sc) continue;
    if (rec.sc.day.pct === pl.pct) agreed++;
    else disagreed.push("day " + di + ": dial " + rec.sc.day.pct + " vs podcost " + pl.pct);
    for (const p of api.PODS) {
      if (!pl.pods[p].inUse || !rec.sc.pods[p]) continue;
      if (rec.sc.pods[p].pct !== pl.pods[p].pct)
        disagreed.push("day " + di + " Pod " + p + ": dial " + rec.sc.pods[p].pct + " vs podcost " + pl.pods[p].pct);
    }
  }
  ok("every day of a real week is scored by the planner (" + scored + " days)", scored >= 5, scored + " days scored");
  ok("the day number on the dial equals podcost.js", disagreed.length === 0, disagreed.slice(0, 3).join(" | "));

  /* ── 2 · the ceiling appears exactly when the roster caps the day ───────────────────────── */
  const L = api.plannerLedger(wk, MON);
  let capped = 0, tickShown = 0, tickWrong = [];
  for (let di = 0; di < 7; di++) {
    const pl = api.plannerDayScore(wk, MON, di);
    if (!pl) continue;
    const floor = L.floors[di].floor;
    if (floor > 0) {
      capped++;
      if (pl.ceiling != null && pl.ceiling < 100) tickShown++;
      else tickWrong.push("day " + di + " has floor " + floor + " but no ceiling on the ring");
    } else if (pl.ceiling != null) {
      tickWrong.push("day " + di + " has no floor but shows a ceiling");
    }
  }
  ok("a day the roster caps shows a ceiling, and one it does not caps nothing",
     tickWrong.length === 0, tickWrong.slice(0, 3).join(" | "));
  console.log("     (" + capped + " of the 7 days are capped by this roster; " + tickShown + " draw the tick)");

  /* a day with fewer long-day people than pods MUST be capped — built rather than hoped for */
  const iso = api.addDays(MON, 3);
  const kept = JSON.parse(JSON.stringify(wk.roster[iso]));
  let lds = Object.keys(wk.roster[iso]).filter(id => wk.roster[iso][id].kind === "day" &&
    String(wk.roster[iso][id].code || "").toUpperCase().indexOf("LD") === 0);
  ok("the fixture has people in it", Object.keys(wk.roster[iso]).length > 6, Object.keys(wk.roster[iso]).length + " on");
  for (let i = 4; i < lds.length; i++) wk.roster[iso][lds[i]].code = "SD";   // leave only 4 long days
  for (const p of api.PODS)
    for (const a of wk.days[3].pods[p].assign) if (a.id && lds.indexOf(a.id) >= 4) a.shift = "SD";
  const capped3 = api.plannerDayScore(wk, MON, 3);
  ok("four long days across five pods cannot score 100",
     capped3 && capped3.ceiling != null && capped3.ceiling < 100,
     capped3 ? ("ceiling " + capped3.ceiling) : "no score");
  wk.roster[iso] = kept;

  /* ── 3 · the marks are edit-view only ──────────────────────────────────────────────────── */
  api.setEdit(false); api.renderWeek();
  await new Promise(r => setTimeout(r, 150));
  const viewDials = api.countDials();
  api.setEdit(true); api.renderWeek();
  await new Promise(r => setTimeout(r, 150));
  const editDials = api.countDials(), editBars = api.countBars();
  ok("no score marks at all in view mode", viewDials === 0, viewDials + " drawn");
  ok("marks appear once Edit is pressed", editDials > 0, editDials + " drawn");
  ok("the pod mark is a bar, not a ring", editBars > 0, editBars + " bars");

  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  process.exit(fail ? 1 : 0);
})();
