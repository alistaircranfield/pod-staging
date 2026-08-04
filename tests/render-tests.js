/*
 * Render smoke test — the resident board
 * --------------------------------------
 * The rule suite exercises allocation LOGIC and never draws a page. That gap has now cost two
 * live bugs: a change-log helper that called itself and blew the stack, and — on 6 Aug — the
 * "Who can…" button wired INSIDE the `if (TESTMODE)` block, so on rota.salford.icu it drew,
 * looked clickable, and did nothing at all. Nothing failed loudly because nothing ran.
 *
 * Cover has had a suite like this since 4 Aug. The resident board, which is the one residents
 * actually use, did not. This is that suite.
 *
 * It loads the real file, seeds enough data for every page to do work, opens every tab, and
 * fails on ANY thrown error, unhandled rejection, or page that renders empty when it shouldn't.
 * It knows nothing about pod rules — that is the other suite's job, and it should stay that way.
 *
 * Run:  node tests/render-tests.js       (needs jsdom on NODE_PATH)
 * Exit: 0 all good, 1 something threw or drew nothing.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const HERE = __dirname;
const PAGE = fs.existsSync(path.join(HERE, "..", "index.html"))
  ? path.join(HERE, "..", "index.html")
  : path.join(HERE, "..", "Pod-Allocations.html");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

function inlineAssets(html) {
  for (const f of ["core.css", "core.js"]) {
    const p = path.join(HERE, "..", f);
    if (!fs.existsSync(p)) continue;
    const body = fs.readFileSync(p, "utf8");
    html = f.endsWith(".css")
      ? html.replace(/<link rel="stylesheet" href="core\.css[^"]*">/, "<style>" + body + "</style>")
      : html.replace(/<script src="core\.js[^"]*"><\/script>/, "<script>" + body + "</script>");
  }
  /* k.js carries the flow URLs and is served alongside the page, so jsdom never fetches it.
     Stand one in — the URLs are never called, every fetch is stubbed to reject. */
  html = html.replace(/<script src="k\.js[^"]*"><\/script>/,
    '<script>window.__POD_KEYS = { r: "https://example.invalid/read", s: "https://example.invalid/save" };</script>');
  return html;
}

function load() {
  let html = inlineAssets(fs.readFileSync(PAGE, "utf8"));
  html = html.replace("startUp();", "try{ if(!data) loadData(blankData()); }catch(e){}\nstartUp();");
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.org/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.scrollTo = () => {};
      w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.fetch = () => Promise.reject(new Error("no net"));
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.addEventListener("error", e => errors.push(String((e.error && e.error.message) || e.message)));
      w.addEventListener("unhandledrejection", e => {
        const m = String((e.reason && e.reason.message) || e.reason || "");
        if (!/no net/.test(m)) errors.push("unhandled rejection: " + m);
      });
    }
  });
  return new Promise(res => setTimeout(() => res({ w: dom.window, errors }), 900));
}

/* Enough that every page has something to draw. A page that renders nothing cannot fail, which
   is exactly how an empty log hid a stack overflow for half a day. */
const SEED = `(function(){
  const T = todayISO(), K = mondayOf(T);
  data.staffPw = "seeded-hash";
  store.sset("staffUnlocked", "1");
  currentWeekKey = K;
  const wk = getWeek(K);
  const mk = (id, name, grade, extra) => { data.staff.push(Object.assign({ id: id, name: name,
    grade: grade, active: true, adhoc: false, aliases: [] }, extra || {})); return id; };
  mk("r1", "Alice Ring", "ST", { airway: true, phoneHolder: true, transfer: true, nights: true });
  mk("r2", "Sam Aziz", "CT", { airway: true, nights: true });
  mk("r3", "Jo Bloggs", "FY2", { nights: true, verified: false });
  mk("a1", "An ACCP", "ACCP", { transfer: true, picc: true, nights: true, supernum: true });
  mk("a2", "Another ACCP", "ACCP", { picc: true, phoneShadow: true });
  mk("c1", "A Consultant", "CON", {});
  wk.roster = wk.roster || {};
  wk.roster[T] = { r1:{code:"LD",kind:"day",src:"a"}, r2:{code:"SD",kind:"day",src:"a"} };
  const di = Math.round((new Date(T) - new Date(K)) / 86400000);
  wk.days[di] = blankDay();
  wk.days[di].pods.A.assign.push({ id:"r1", shift:"LD" });
  const now = new Date().toISOString();
  data.log = [
    { t: now, who: "A", kind: "manual", on: T, msg: "a move", d: { act:"move", subj:"Alice Ring", from:"A", to:"B" } },
    { t: now, who: "allocate sync", kind: "auto", on: T, msg: "Kate Bailey on the rota, LD",
      d: { act:"on", subj:"Kate Bailey", shift:"LD", to:"C" } }
  ];
  data.feedback = [{ t: now, name: "anonymous", kind: "Problem", msg: "Something", read: false }];
  data.lastSync = now;
  return "seeded";
})()`;

(async () => {
  console.log("=== Render smoke test — resident board ===");
  console.log("  page: " + path.basename(PAGE));
  const { w, errors } = await load();

  ok("page loads with no script errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  ok("the app booted", w.eval("typeof renderAll === 'function'"));
  try { w.eval(SEED); } catch (e) { ok("seed data applied", false, e.message); }

  const TABS = ["rota", "team", "staff", "fair", "log", "settings", "import", "feedback", "help"];
  for (const t of TABS) {
    const before = errors.length;
    let threw = "";
    try { w.eval("switchTab(" + JSON.stringify(t) + "); renderAll();"); }
    catch (e) { threw = e.message; }
    ok("renders tab: " + t, !threw && errors.length === before, threw || errors.slice(before).join(" | "));
  }

  /* ---- the toolbar. The Who can… bug was invisible because the button existed and simply had
     no handler; checking it draws is not enough, so check it OPENS. ------------------------- */
  console.log("\n-- the toolbar works on the live site, not just the test one --");
  ok("Who can… is wired outside the test-site block",
     (function(){ const src = fs.readFileSync(PAGE, "utf8");
       const wired = src.search(/^\$\("#btnWhoCan"\)\.onclick/m);
       const testblk = src.search(/^if \(TESTMODE\) \{/m);
       return wired > -1 && testblk > -1 && wired < testblk; })());
  ok("and clicking it actually opens something",
     (function(){ try { w.eval("document.getElementById('btnWhoCan').onclick()");
       return w.eval("document.getElementById('modalBg').style.display") === "flex"; }
       catch(e){ return "ERR " + e.message; } })() === true);
  w.eval("try{ closeModal(); }catch(e){}");

  /* ---- the Staff page, rebuilt 6 Aug ------------------------------------------------------ */
  console.log("\n-- Staff: a column per skill, sortable and filterable --");
  w.eval("switchTab('staff'); renderStaff();");

  ok("the header draws one column per skill",
     w.eval("document.querySelectorAll('#staffHead th.skh').length") === w.eval("SK_COLS.length"),
     w.eval("document.querySelectorAll('#staffHead th.skh').length") + " of " + w.eval("SK_COLS.length"));
  ok("every header carries an icon AND a word",
     w.eval("[...document.querySelectorAll('#staffHead th.skh')].every(function(t){" +
            "return t.querySelector('svg') && t.textContent.trim().length; })"));
  ok("PICC is one of them — it had no column at all before today",
     w.eval("document.getElementById('staffHead').textContent").indexOf("PICC") >= 0);
  ok("the header is sticky so it survives a scroll",
     /position:sticky/.test(fs.readFileSync(PAGE, "utf8").match(/#staffTable th\{[^}]*/)[0]));

  ok("a row draws a cell for every skill",
     w.eval("document.querySelectorAll('#staffBody tr:first-child td.skc').length") === w.eval("SK_COLS.length"));
  ok("skills the person has are marked on, the rest off",
     w.eval("(function(){ const r = [...document.querySelectorAll('#staffBody tr')].find(function(x){" +
            "return x.textContent.indexOf('An ACCP') === 0 || /^.An ACCP/.test(x.textContent); });" +
            "if (!r) return 'row not found';" +
            "const on = [...r.querySelectorAll('td.skc.on')].length; return on; })()") === 4,
     "expected transfer, picc, nights, supernum");
  ok("consultants are not listed",
     w.eval("document.getElementById('staffBody').textContent").indexOf("A Consultant") < 0);

  console.log("\n-- sorting --");
  const firstName = () => w.eval("(document.querySelector('#staffBody tr td.namecell')||{}).textContent||''");
  w.eval("stSort = { key:'name', dir:1 }; renderStaff();");
  const az = firstName();
  w.eval("stSort = { key:'name', dir:-1 }; renderStaff();");
  ok("clicking a header reverses the order", az !== firstName(), az + " / " + firstName());
  w.eval("stSort = { key:'checked', dir:1 }; renderStaff();");
  ok("sorting by checked puts the unchecked person first", /Jo Bloggs/.test(firstName()), firstName());
  w.eval("stSort = { key:'picc', dir:1 }; renderStaff();");
  ok("sorting by a skill puts the people who have it first", /ACCP/.test(firstName()), firstName());

  console.log("\n-- filtering --");
  w.eval("stSort = { key:'name', dir:1 }; stSkills = new Set(['picc']); renderStaff();");
  ok("filtering by a skill narrows the list",
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") === 2,
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") + " rows");
  ok("and says so, with the count and a removable chip",
     (function(){ const t = w.eval("document.getElementById('staffFilters').textContent");
       return /2 of 5/.test(t) && /PICC/.test(t) && /Clear all/.test(t); })(),
     w.eval("document.getElementById('staffFilters').textContent"));
  w.eval("stGrades = new Set(['ACCP']); renderStaff();");
  ok("grade and skill filters combine",
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") === 2);
  w.eval("stGrades = new Set(['FY2']); renderStaff();");
  ok("a combination matching nobody says so rather than looking empty",
     /Nobody matches/.test(w.eval("document.getElementById('staffBody').textContent")));
  w.eval("stGrades = null; stSkills = new Set(); renderStaff();");
  ok("clearing the filters brings everyone back",
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") === 5);
  ok("and the filter bar disappears when nothing is filtered",
     w.eval("document.getElementById('staffFilters').textContent").trim() === "");

  console.log("\n-- the profile panel --");
  ok("the twist opens it",
     (function(){ try {
       w.eval("document.querySelector('#staffBody tr .twist').onclick()");
       return w.eval("document.querySelectorAll('#staffBody textarea').length") > 0;
     } catch(e){ return "ERR " + e.message; } })() === true);
  ok("it shows a filler person until there is a photo",
     w.eval("(function(){ const ta = document.querySelector('#staffBody textarea');" +
            "const panel = ta && ta.closest('td'); return panel ? !!panel.querySelector('svg') : false; })()") === true);
  ok("its labels sit above their fields, not beside them",
     w.eval("(function(){ const ta = document.querySelector('#staffBody textarea');" +
            "const panel = ta && ta.closest('td'); if (!panel) return false;" +
            "return [...panel.querySelectorAll('label')].some(function(l){" +
            "return /about/i.test(l.textContent) && /block/.test(l.getAttribute('style')||''); }); })()") === true);
  /* Nobody types a start date — there is no such field. It comes from the first day they appear
     on the Optima roster, so it cannot go stale (Ali, 6 Aug). */
  ok("it shows when they started, worked out rather than typed",
     w.eval("(function(){ const ta = document.querySelector('#staffBody textarea');" +
            "const panel = ta && ta.closest('td'); return panel ? panel.textContent : ''; })()")
       .toLowerCase().indexOf("started") >= 0);
  /* Most of the unit predates Optima. Anyone already on the FIRST roster we hold did not start
     that day — we simply cannot know, so it shows a dash rather than a wrong date (Ali, 6 Aug). */
  ok("somebody on the very first roster shows a dash, not a made-up start date",
     w.eval("firstOnRota('r1').predatesRota") === true);
  ok("and the panel prints the dash rather than that date",
     (function(){ const t = w.eval("(function(){ const ta = document.querySelector('#staffBody textarea');" +
       "const panel = ta && ta.closest('td'); return panel ? panel.textContent : ''; })()");
       return /—/.test(t); })());
  ok("somebody never on the rota says so",
     w.eval("(function(){ return typeof firstOnRota === 'function' && !firstOnRota('nobody').first; })()") === true);
  ok("the supervisor list offers consultants",
     w.eval("(function(){ const s = document.querySelector('#staffBody select');" +
            "return s ? [...s.options].map(function(o){return o.textContent;}).join('|') : ''; })()")
       .indexOf("A Consultant") >= 0);

  /* ---- the person form ------------------------------------------------------------------
     PICC had no tick box until 6 Aug: the form rendered flags of kind "rule" and "info" and a
     third kind fell through in silence. Assert EVERY skill can be set, not just the two kinds
     that happened to be handled. */
  console.log("\n-- every skill can actually be ticked --");
  w.eval("staffModal(data.staff.find(function(s){ return s.id === 'r1'; }))");
  const formTxt = w.eval("document.getElementById('modal').textContent");
  ok("the form offers PICC", /PICC/i.test(formTxt), formTxt.slice(0, 80));
  const missing = w.eval("(function(){ const t = document.getElementById('modal').textContent;" +
    "return FLAGS.filter(function(f){ return f[2] && f[2] !== 'staff' && t.indexOf(f[1]) < 0; })" +
    ".map(function(f){ return f[0]; }).join(','); })()");
  ok("and every other skill too — no kind falls through", missing === "", "missing: " + missing);
  ok("the columns and the form agree on which skills exist",
     w.eval("SK_COLS.filter(function(c){ return !FLAGS.some(function(f){ return f[0] === c[0]; }); }).length") === 0);
  w.eval("try{ closeModal(); }catch(e){}");

  /* Anything the page depends on being SEEN has to be a shape we ship. The funnel was the
     character ⌷ and rendered as an empty box on every column. */
  ok("no missing-glyph characters in the page source",
     !/[\u2300-\u23FF\u2B00-\u2BFF]/.test(
       fs.readFileSync(PAGE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")));

  ok("no errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  if (failures.length) { console.log("Failures:"); failures.forEach(f => console.log(" - " + f)); }
  process.exit(fail ? 1 : 0);
})();
