/* fixday-adapter-probe.js — DOES THE ADAPTER ACTUALLY RUN THE PLANNER, AND WHAT DOES IT COST?
 *
 * Why this is a probe and not an assertion in rule-tests.js: every fixture in that suite is built
 * by seedDay(), which makes a day with NO ROSTER. Planner.fixDay works out who is on from
 * wk.roster, so on a roster-less day it correctly finds nobody on — which is why planDayFix falls
 * back to the old passes there, and why the suite alone cannot tell you whether the new path works.
 *
 * So this loads the real page, builds a week from the REAL Optima roster, writes it with the
 * planner, and then does the thing the ward actually does: takes one person off a day and asks
 * for the day to be fixed. It reports how many OTHER people had to move, both ways.
 *
 *   node tests/fixday-adapter-probe.js
 *
 * Two traps this deliberately avoids, both of which have produced false green results here:
 *   · THE WEEK IS IN THE FUTURE. Anything touching the write gate or the sync skips a date before
 *     today, so a probe on a past week passes for the wrong reason.
 *   · EVERY CASE IS CHECKED FOR PEOPLE FIRST. A day with nobody in it satisfies "nobody moved".
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "index.html");
const BENCH = path.join(ROOT, "..", "..", "docs", "bench", "allocate-bench.json");

function inlineScript(html, file, src) {
  const safe = src.replace(/<\/script/gi, "<\\/script");
  return html.replace(new RegExp('<script src="' + file.replace(".", "\\.") + '[^"]*"><\\/script>'),
    () => "<script>" + safe + "</script>");
}

function loadApp() {
  let html = fs.readFileSync(APP, "utf8");
  for (const f of ["strength.js", "planner.js"]) {
    try { html = inlineScript(html, f, fs.readFileSync(path.join(ROOT, f), "utf8")); } catch (e) {}
  }
  const hook = `window.__api = function(){ return {
    data, PODS, getWeek, blankDay, mondayOf, todayISO, addDays, staffById,
    planDayFix, planDayFixLegacy: typeof planDayFixLegacy !== "undefined" ? planDayFixLegacy : null,
    fillWeekWithPlanner: typeof fillWeekWithPlanner !== "undefined" ? fillWeekWithPlanner : null,
    hasPlanner: () => typeof Planner !== "undefined" && !!Planner && typeof Planner.fixDay === "function",
    setWeek: k => { currentWeekKey = k; },
    setRule: (k, v) => { data.rules = data.rules || {}; data.rules[k] = v; }
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
  return new Promise(res => setTimeout(() => res(dom.window.__api()), 1200));
}

/* Shift the real roster forward so the week under test is in the FUTURE. */
function futureMonday(api) {
  const today = api.todayISO();
  let m = api.mondayOf(today);
  return api.addDays(m, 7);
}

(async function () {
  const api = await loadApp();
  console.log("planner present in the page: " + api.hasPlanner());
  if (!api.hasPlanner()) { console.log("planner.js did not load — nothing to probe."); process.exit(1); }

  const bench = JSON.parse(fs.readFileSync(BENCH, "utf8"));
  const srcKeys = Object.keys(bench.weeks).sort().filter(k => Object.keys(bench.weeks[k].roster).length >= 7);

  /* the page's staff list, replaced with the roster's people so ids line up */
  api.data.staff.length = 0;
  for (const id in bench.staff) api.data.staff.push(Object.assign({ active: true, aliases: [] }, bench.staff[id]));

  const MON = futureMonday(api);
  console.log("probing week beginning " + MON + " (future, so no date-before-today shortcut can pass this for the wrong reason)\n");

  let totalCases = 0, movedNew = 0, worstNew = 0, movedOld = 0, worstOld = 0;
  let usedPlanner = 0, usedLegacy = 0, emptied = 0;
  const perCase = [];

  for (let wi = 0; wi < srcKeys.length && totalCases < 60; wi++) {
    const src = bench.weeks[srcKeys[wi]];

    /* rebuild this real week under a future key */
    const roster = {};
    for (let di = 0; di < 7; di++)
      roster[api.addDays(MON, di)] = JSON.parse(JSON.stringify(src.roster[api.addDays(srcKeys[wi], di)] || {}));

    api.data.weeks = api.data.weeks || {};
    const wk = { key: MON, roster: roster, days: [] };
    for (let di = 0; di < 7; di++) wk.days.push(api.blankDay());
    api.data.weeks[MON] = wk;
    api.setWeek(MON);
    /* open the write gate for the probe — the gate is tested elsewhere and is not what is
       being measured here */
    api.setRule("writeDay", 0); api.setRule("writeHour", 0);
    try { api.fillWeekWithPlanner(wk, MON); } catch (e) { console.log("  write failed: " + e.message); continue; }

    for (let di = 0; di < 7 && totalCases < 60; di++) {
      const iso = api.addDays(MON, di);
      const before = snapshot(api, wk, di);
      const ids = Object.keys(before);
      if (ids.length < 6) continue;                 /* a day with nobody in it proves nothing */

      const victim = ids[(wi + di) % ids.length];   /* spread the cases over the roster */

      /* take them off, exactly as the ward does: they are no longer on the roster that day */
      const keptRoster = wk.roster[iso][victim];
      delete wk.roster[iso][victim];
      for (const p of api.PODS)
        wk.days[di].pods[p].assign = wk.days[di].pods[p].assign.filter(a => a.id !== victim);

      const dayBefore = snapshot(api, wk, di);

      const resNew = api.planDayFix(di);
      const nNew = othersMoved(api, dayBefore, resNew.fixed, victim);
      const afterCount = countPlaced(api, resNew.fixed);
      if (!afterCount) emptied++;

      let nOld = null;
      if (api.planDayFixLegacy) {
        const resOld = api.planDayFixLegacy(di);
        nOld = othersMoved(api, dayBefore, resOld.fixed, victim);
      }

      /* did the new path actually run the planner, or did it fall back? A fallback and the
         legacy call give identical answers, which is the tell. */
      const fellBack = nOld !== null && JSON.stringify(resNew.fixed.pods) === JSON.stringify(api.planDayFixLegacy(di).fixed.pods);
      if (fellBack) usedLegacy++; else usedPlanner++;

      movedNew += nNew; worstNew = Math.max(worstNew, nNew);
      if (nOld !== null) { movedOld += nOld; worstOld = Math.max(worstOld, nOld); }
      perCase.push({ iso, di, victim, nNew, nOld, fellBack });
      totalCases++;

      if (keptRoster) wk.roster[iso][victim] = keptRoster;
    }
  }

  console.log("cases: " + totalCases + "  ·  repaired by the planner: " + usedPlanner +
              "  ·  fell back to the old passes: " + usedLegacy);
  console.log("days emptied by a repair: " + emptied + "   (must be 0)");
  console.log("");
  console.log("  NEW  Planner.fixDay   others moved, mean " + (movedNew / Math.max(1, totalCases)).toFixed(2) + " · worst " + worstNew);
  console.log("  OLD  four passes      others moved, mean " + (movedOld / Math.max(1, totalCases)).toFixed(2) + " · worst " + worstOld);
  console.log("");
  const bad = perCase.filter(c => c.nOld !== null && c.nNew > c.nOld + 1).slice(0, 8);
  if (bad.length) {
    console.log("cases where the planner moved MORE than the old path by 2 or more:");
    bad.forEach(c => console.log("  " + c.iso + " victim " + c.victim + "  new " + c.nNew + " vs old " + c.nOld));
  } else console.log("no case where the planner moved two more people than the old path.");
  process.exit(emptied ? 1 : 0);

  function snapshot(api, wk, di) {
    const m = {};
    for (const p of api.PODS) for (const a of (wk.days[di].pods[p].assign || [])) if (a.id) m[a.id] = p;
    return m;
  }
  function countPlaced(api, day) {
    let n = 0;
    for (const p of api.PODS) n += (day.pods[p].assign || []).filter(a => a.id).length;
    return n;
  }
  function othersMoved(api, before, day, victim) {
    const after = {};
    for (const p of api.PODS) for (const a of (day.pods[p].assign || [])) if (a.id) after[a.id] = p;
    let n = 0;
    for (const id in before) {
      if (id === victim) continue;
      if (after[id] && after[id] !== before[id]) n++;
    }
    return n;
  }
})();
