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
  mk("n1", "Nia Reggie", "Neurology", { nights: true, supernum: true });
  wk.roster = wk.roster || {};
  /* Everybody gets a duty in the current week. Before the historic rule existed, rostering two
     people was enough; now anybody with nothing in the four pulled weeks is correctly classed as
     gone, so a fixture that rosters two would empty the Current list and take the staff-table
     tests with it. A realistic fixture is a rostered one. */
  wk.roster[T] = { r1:{code:"LD",kind:"day",src:"a"}, r2:{code:"SD",kind:"day",src:"a"},
                   r3:{code:"SD",kind:"day",src:"a"}, a1:{code:"LD",kind:"day",src:"a"},
                   a2:{code:"SD",kind:"day",src:"a"}, n1:{code:"SD",kind:"day",src:"a"} };
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

  const TABS = ["rota", "mine", "team", "staff", "fair", "log", "settings", "import", "feedback", "help"];
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
  /* The phone holder is also a name in a pod, so a list built from both used to show them twice
     (Ali, 5 Aug). Nobody wears two hats in a list of people. */
  ok("somebody who holds the phone AND sits in a pod is listed once, not twice",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "d.phone = 'r1'; d.shadow = ['r1'];" +
            "const all = dayAllAssigned(d);" +
            "return all.filter(function(x){ return x === 'r1'; }).length; })()") === 1);

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

  /* How many people the Staff page shows with nothing filtered. Taken from the page rather than
     from data.staff, because the two are not the same number — consultants are reference-only and
     never listed — and hard-coding either one means these tests fail the next time somebody adds
     a person to SEED, which is a test measuring its own fixture instead of the behaviour. */
  const staffRows = w.eval("(function(){ stGrades = null; stSkills = new Set(); renderStaff();" +
    "return document.querySelectorAll('#staffBody tr td.namecell').length; })()");

  console.log("\n-- filtering --");
  w.eval("stSort = { key:'name', dir:1 }; stSkills = new Set(['picc']); renderStaff();");
  ok("filtering by a skill narrows the list",
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") === 2,
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") + " rows");
  ok("and says so, with the count and a removable chip",
     (function(){ const t = w.eval("document.getElementById('staffFilters').textContent");
       return new RegExp("2 of " + staffRows).test(t) && /PICC/.test(t) && /Clear all/.test(t); })(),
     w.eval("document.getElementById('staffFilters').textContent"));
  w.eval("stGrades = new Set(['ACCP']); renderStaff();");
  ok("grade and skill filters combine",
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") === 2);
  w.eval("stGrades = new Set(['FY2']); renderStaff();");
  ok("a combination matching nobody says so rather than looking empty",
     /Nobody matches/.test(w.eval("document.getElementById('staffBody').textContent")));
  w.eval("stGrades = null; stSkills = new Set(); renderStaff();");
  /* The funnel popup lives on document.body, so renderStaff() never touches it. Clear used to
     change the filter and leave every tick box looking ticked. */
  ok("Clear actually unticks the boxes, not just the list underneath",
     (function(){ w.eval("stGrades = null; renderStaff();");
       w.eval("(function(){ const f = document.querySelector('#staffHead .fun'); if (f) f.click(); })()");
       const before = w.eval("document.querySelectorAll('.funpop input[type=checkbox]:checked').length");
       w.eval("(function(){ const bs = [...document.querySelectorAll('.funpop .fbtn')];" +
              "const clear = bs.find(function(x){ return /Clear/.test(x.textContent); });" +
              "if (clear) clear.click(); })()");
       const after = w.eval("document.querySelectorAll('.funpop input[type=checkbox]:checked').length");
       w.eval("document.querySelectorAll('.funpop').forEach(function(x){ x.remove(); }); stGrades = null; stSkills = new Set(); renderStaff();");
       return before > 0 && after === 0; })());

  ok("clearing the filters brings everyone back",
     w.eval("document.querySelectorAll('#staffBody tr td.namecell').length") === staffRows);
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

  /* ---- neurology registrars: supernumerary, Pods C & D, and nothing else ------------------
     Ali, 4 Aug: "set a firm rule that neurology registrars are supernumerary and only ever
     allocated to C & D". A hard block, so these assert REFUSAL, not a warning. The rule is on the
     GRADE, not on the Neuro tick — the tick keeps its soft neuroTarget aim, and a test that
     confused the two would lock the wrong people to C/D without anyone noticing. */
  console.log("\n-- neurology registrars --");
  ok("a neurology registrar is supernumerary even with the tick off",
     w.eval("(function(){ const s = staffById('n1'); s.supernum = false;" +
            "const r = isSupernumerary(s) && !countsInNumbers('n1'); s.supernum = true; return r; })()") === true);
  ok("the Neuro TICK is left alone — it is not the same thing",
     w.eval("isNeuroReg(staffById('r1')) === false && isSupernumerary(staffById('r2')) === false") === true);

  ok("Pods C and D are allowed, A, B and E are not",
     w.eval("['A','B','C','D','E'].filter(function(p){ return neuroPodOK(staffById('n1'), p); }).join('')") === "CD");

  ok("dropped onto Pod A they are put back on C or D wherever the day came from",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "d.pods.A.assign.push({ id:'n1', shift:'SD' });" +      // as an import or an old save might
            "normalizePods(d);" +
            "const onA = d.pods.A.assign.some(function(a){ return a.id === 'n1'; }) ||" +
            "            (d.pods.A.super||[]).indexOf('n1') >= 0;" +
            "const onCD = (d.pods.C.super||[]).concat(d.pods.D.super||[]).indexOf('n1') >= 0;" +
            "return !onA && onCD; })()") === true);

  ok("and never in the counted list, only in Super",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "return ['A','B','C','D','E'].every(function(p){" +
            "  return !(d.pods[p].assign||[]).some(function(a){ return a.id === 'n1'; }); }); })()") === true);

  /* Ali, 4 Aug: "aron cook is supernumerary on the board. how has it allowed a drop into pod
     numbers and not into supernumerary column". Auto-fill pushed everybody into assign and only
     declined to COUNT the supernumeraries, so a pod drew five names and was counted as four. */
  ok("ANY supernumerary the allocator places lands in Super, not in the numbers",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "d.pods.B.assign.push({ id:'a1', shift:'LD' });" +   // a1 is an ACCP marked supernum
            "normalizePods(d);" +
            "const inNumbers = d.pods.B.assign.some(function(a){ return a.id === 'a1'; });" +
            "const inSuper = (d.pods.B.super||[]).indexOf('a1') >= 0;" +
            "return !inNumbers && inSuper; })()") === true);
  ok("and a supernumerary who is NOT a neurology registrar keeps their own pod",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "return (d.pods.B.super||[]).indexOf('a1') >= 0; })()") === true);
  ok("somebody who counts is left in the numbers where they are",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "d.pods.B.assign.push({ id:'r2', shift:'LD' }); normalizePods(d);" +
            "return d.pods.B.assign.some(function(a){ return a.id === 'r2'; }); })()") === true);

  /* Ali, 4 Aug: "dont drop the shift". A supernumerary on an 8-8 and one on an 8-4 are not the
     same person to plan around, and until now becoming supernumerary erased the difference. */
  console.log("\n-- the shift survives the Super box --");
  const di0 = "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000)";
  ok("a long day stays a long day on the way into Super",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), d = wk.days[" + di0 + "];" +
            "d.pods.B.assign.push({ id:'a1', shift:'LD' }); normalizePods(d);" +
            "return superShiftOf(d, 'a1'); })()") === "LD");
  ok("and comes back with them when they leave it",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), d = wk.days[" + di0 + "];" +
            "return currentAssignShift(d, 'a1'); })()") === "LD");
  ok("moving between two Super boxes keeps it",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), d = wk.days[" + di0 + "];" +
            "removeAssign(d, 'a1'); d.pods.D.super.push('a1'); pruneSuperShift(d);" +
            "return superShiftOf(d, 'a1') === 'LD' && (d.pods.B.super||[]).indexOf('a1') < 0; })()") === true);
  ok("removeAssign clears the Super boxes, so nobody is ever in two",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), d = wk.days[" + di0 + "];" +
            "d.pods.C.super.push('a1'); removeAssign(d, 'a1');" +
            "return ['A','B','C','D','E'].every(function(p){ return (d.pods[p].super||[]).indexOf('a1') < 0; }); })()") === true);
  ok("and once they are really gone the shift is forgotten, not left lying about",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), d = wk.days[" + di0 + "];" +
            "pruneSuperShift(d); return superShiftOf(d, 'a1'); })()") === null);

  ok("at night they end up in C,D&E, never A&B or E",
     w.eval("(function(){ const wk = getWeek(currentWeekKey), di = " +
            "Math.round((new Date(todayISO()) - new Date(currentWeekKey))/86400000), d = wk.days[di];" +
            "d.night.AB = ['n1']; d.night.CDE = []; d.night.E = [];" +
            "normalizePods(d);" +
            "return d.night.AB.indexOf('n1') < 0 && d.night.CDE.indexOf('n1') >= 0; })()") === true);

  ok("auto-fill will not score them onto a general pod",
     w.eval("(function(){ const s = staffById('n1');" +
            "return ['A','B','E'].every(function(p){ return !neuroPodOK(s, p); }); })()") === true);

  ok("the form ticks supernumerary and locks it for a neurology registrar",
     (function(){ w.eval("staffModal(staffById('n1'))");
       const r = w.eval("(function(){ const b = [...document.querySelectorAll('#modal input[type=checkbox]')]" +
         ".find(function(c){ return c.parentElement && /Supernumerary/i.test(c.parentElement.textContent); });" +
         "return b ? (b.checked && b.disabled) : 'no box'; })()");
       w.eval("try{ closeModal(); }catch(e){}"); return r; })() === true);

  /* ---- the change log records changes, not drags ------------------------------------------
     Ali, 4 Aug: "i dragged and changed back so no actual change occurred - is there a way to stop
     this showing and clogging up change log?" */
  console.log("\n-- a move and a move back leave nothing behind --");
  ok("there and back cancels both entries",
     w.eval("(function(){ data.log = []; const T = todayISO();" +
            "logEntry('x', 'manual', T, 'A', { act:'move', subj:'Nia Reggie', from:'C', to:'D' });" +
            "logEntry('x', 'manual', T, 'A', { act:'move', subj:'Nia Reggie', from:'D', to:'C' });" +
            "return data.log.length; })()") === 0);
  ok("a longer round trip cancels the whole chain",
     w.eval("(function(){ data.log = []; const T = todayISO();" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'A', to:'B' });" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'B', to:'C' });" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'C', to:'A' });" +
            "return data.log.length; })()") === 0);
  ok("somebody else moving in between does not break the cancel",
     w.eval("(function(){ data.log = []; const T = todayISO();" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'A', to:'B' });" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Jo Bloggs', from:'D', to:'E' });" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'B', to:'A' });" +
            "return data.log.length === 1 && data.log[0].d.subj === 'Jo Bloggs'; })()") === true);
  ok("a real move is still recorded",
     w.eval("(function(){ data.log = []; const T = todayISO();" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'A', to:'B' });" +
            "return data.log.length; })()") === 1);
  ok("a sync's move is never erased by a person dragging back",
     w.eval("(function(){ data.log = []; const T = todayISO();" +
            "logEntry('x','auto',T,'allocate sync',{ act:'move', subj:'Sam Aziz', from:'A', to:'B' });" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'B', to:'A' });" +
            "return data.log.length; })()") === 2);
  ok("the same person on a DIFFERENT day is not treated as a return",
     w.eval("(function(){ data.log = []; const T = todayISO(), U = addDays(T, 1);" +
            "logEntry('x','manual',U,'A',{ act:'move', subj:'Sam Aziz', from:'A', to:'B' });" +
            "logEntry('x','manual',T,'A',{ act:'move', subj:'Sam Aziz', from:'B', to:'A' });" +
            "return data.log.length; })()") === 2);
  ok("a night move now records where the person came from",
     w.eval("typeof nightSpotOf === 'function' && NIGHT_LABEL.AB === 'A&B' && NIGHT_LABEL.CDE === 'C&D'") === true);

  /* ---- the change log: searchable, and the badge belongs to the board ----------------------
     Ali, 4 Aug: "there needs to be search bar on the change log", and the log badge should clear
     for everyone rather than for whoever happened to look. */
  console.log("\n-- the change log --");
  w.eval("switchTab('log'); data.log = [" +
    "{ t:'2026-08-04T10:00:00Z', who:'Alistair', kind:'manual', on: todayISO(), msg:'x'," +
    "  d:{ act:'move', subj:'Christopher Ambrose', from:'A', to:'B' } }," +
    "{ t:'2026-08-04T09:00:00Z', who:'allocate sync', kind:'auto', on: todayISO(), msg:'y'," +
    "  d:{ act:'move', subj:'Sam Aziz', from:'C', to:'D' } }]; renderLog();");
  ok("the log page draws a search box",
     w.eval("!!document.querySelector('#logList input[type=text]')"));
  ok("typing a name narrows it to that person",
     w.eval("(function(){ logQuery = 'ambrose'; renderLog();" +
            "const t = document.getElementById('logList').textContent;" +
            "return t.indexOf('Ambrose') >= 0 && t.indexOf('Sam Aziz') < 0; })()") === true);
  ok("and says how many matched",
     /1 of 2 entries match/.test(w.eval("document.getElementById('logList').textContent")));
  ok("a search matching nobody says so rather than looking broken",
     w.eval("(function(){ logQuery = 'zzzz'; renderLog();" +
            "return /Nothing matches that/.test(document.getElementById('logList').textContent); })()") === true);
  /* The box must survive its own keystrokes. The first version redrew the whole panel on every
     input, destroying the very element being typed into — one character at a time, focus lost
     each time (Ali, 5 Aug). Assert the SAME node is still there and still focused after a
     repaint, not merely that a box exists. */
  ok("typing does not destroy the search box",
     w.eval("(function(){ logQuery = ''; renderLog();" +
            "const box = document.querySelector('#logList input[type=text]');" +
            "box.focus(); box.value = 'amb';" +
            "box.dispatchEvent(new window.Event('input', { bubbles: true }));" +
            "const same = document.querySelector('#logList input[type=text]') === box;" +
            "return same && document.activeElement === box; })()") === true);
  ok("and the search repaints without a full redraw",
     w.eval("(function(){ logQuery = 'ambrose';" +
            "const box = document.querySelector('#logList input[type=text]');" +
            "const groups = box.parentElement.parentElement.lastChild;" +
            "groups.innerHTML = ''; groups.append(logGroups(data.log, 400));" +
            "const t = groups.textContent;" +
            "return t.indexOf('Ambrose') >= 0 && t.indexOf('Sam Aziz') < 0; })()") === true);

  ok("clearing the box brings everything back",
     w.eval("(function(){ logQuery = ''; renderLog();" +
            "const t = document.getElementById('logList').textContent;" +
            "return t.indexOf('Ambrose') >= 0 && t.indexOf('Sam Aziz') >= 0; })()") === true);
  ok("you can search by who made the change, not just by person",
     w.eval("(function(){ logQuery = 'allocate sync'; renderLog();" +
            "const t = document.getElementById('logList').textContent;" +
            "const r = t.indexOf('Sam Aziz') >= 0 && t.indexOf('Ambrose') < 0; logQuery=''; renderLog(); return r; })()") === true);

  ok("the log mark lives on the board, not in this browser",
     w.eval("(function(){ data.logSeen = ''; store.set('logSeen','');" +
            "renderLogGate(); return (data.logSeen || '').length > 0; })()") === true);
  ok("and a metadata mark is not treated as a rota edit",
     w.eval("(function(){ const a = rotaSig(data); const keep = data.logSeen;" +
            "data.logSeen = '2099-01-01T00:00:00Z'; const b = rotaSig(data);" +
            "data.logSeen = keep; return a === b; })()") === true);

  /* ---- the reworded attention item -------------------------------------------------------- */
  console.log("\n-- a pending skill reads name first, date last --");
  ok("the attention row names the person, the skill and the date",
     w.eval("(function(){ data.pendingSkills = [{ id:'r1', name:'Locum Doctor'," +
            "add:{ airway:true }, from: addDays(todayISO(), 14), applied:true }];" +
            "const it = attentionItems().filter(function(x){ return /Locum Doctor/.test(x.title); })[0];" +
            "return it ? it.title : 'no row'; })()").indexOf("Locum Doctor — airway from") === 0);
  ok("and the body says what actually changes on that date",
     /Ticked and in use now\. Auto-fill starts choosing them for airway on/.test(
       w.eval("(function(){ const it = attentionItems().filter(function(x){" +
              "return /Locum Doctor/.test(x.title); })[0]; return it ? it.body : ''; })()")));
  ok("two skills at once read as a list, not as a key name",
     w.eval("(function(){ data.pendingSkills = [{ id:'r1', name:'Locum Doctor'," +
            "add:{ airway:true, phoneHolder:true }, from: addDays(todayISO(), 14), applied:true }];" +
            "const it = attentionItems().filter(function(x){ return /Locum Doctor/.test(x.title); })[0];" +
            "data.pendingSkills = []; return it ? it.title : ''; })()").indexOf("airway and phone") > 0);

  /* ---- the skill start picker ------------------------------------------------------------
     The counts on the buttons are produced by running the real reallocation and diffing it, so
     these tests check the machinery rather than the arithmetic: that a trial leaves nothing
     behind, that only written weeks are offered, and that the picker tells the truth about the
     unwritten ones. */
  console.log("\n-- picking when a skill starts --");
  w.eval("(function(){ const K = mondayOf(todayISO());" +
         "for (let n=0;n<4;n++){ const key = addDays(K, n*7); const wk = getWeek(key); wk.roster = {};" +
         "  for (let d=0; d<7; d++) wk.roster[addDays(key,d)] = {" +
         "    r1:{code:'LD',kind:'day',src:'a'}, r2:{code:'LD',kind:'day',src:'a'}," +
         "    r3:{code:'SD',kind:'day',src:'a'}, a2:{code:'SD',kind:'day',src:'a'} };" +
         "  wk.days.forEach(function(dd,di){ autoFillDay(wk, di, key); }); } })()");

  ok("three weeks are offered, not four", w.eval("writtenWeeks().length") === 3);
  /* This week is never offered: reallocateFrom works in whole weeks, so starting from this Monday
     would rewrite days people have already worked. */
  ok("and this week is not one of them",
     w.eval("writtenWeeks().indexOf(mondayOf(todayISO()))") === -1);
  ok("the first one offered is next Monday",
     w.eval("writtenWeeks()[0] === addDays(mondayOf(todayISO()), 7)") === true);

  ok("a trial puts the rota back exactly as it found it",
     w.eval("(function(){ const before = JSON.stringify(data.weeks);" +
            "trialSkillFrom(mondayOf(todayISO()), 'r3', 'Jo Bloggs', { phoneHolder:true }, true, false);" +
            "return JSON.stringify(data.weeks) === before; })()") === true);
  ok("and puts the pending skills back too",
     w.eval("(function(){ const before = JSON.stringify(data.pendingSkills || []);" +
            "trialSkillFrom(mondayOf(todayISO()), 'r3', 'Jo Bloggs', { phoneHolder:true }, true, false);" +
            "return JSON.stringify(data.pendingSkills || []) === before; })()") === true);

  /* Ali's hypothesis, 4 Aug: shadowing should cost nothing, holding the phone should cost real
     moves. Asserted as a RELATIONSHIP, not as fixed numbers — the fixture is small and the exact
     count is not the point. */
  ok("phone shadow moves nobody",
     w.eval("(function(){ const m = trialSkillFrom(mondayOf(todayISO()), 'r3', 'Jo Bloggs'," +
            "{ phoneShadow:true }, false, false); return m.length; })()") === 0);
  ok("phone holder costs more than phone shadow",
     w.eval("(function(){ const hold = trialSkillFrom(mondayOf(todayISO()), 'r3', 'Jo Bloggs'," +
            "{ phoneHolder:true }, true, false).length;" +
            "const shade = trialSkillFrom(mondayOf(todayISO()), 'r3', 'Jo Bloggs'," +
            "{ phoneShadow:true }, false, false).length; return hold >= shade; })()") === true);
  ok("starting later never costs more than starting sooner",
     w.eval("(function(){ const wks = writtenWeeks();" +
            "const early = trialSkillFrom(wks[0], 'r3', 'Jo Bloggs', { phoneHolder:true }, true, false).length;" +
            "const late  = trialSkillFrom(wks[wks.length-1], 'r3', 'Jo Bloggs', { phoneHolder:true }, true, false).length;" +
            "return late <= early; })()") === true);

  ok("the moves are counted by kind, not lumped together",
     w.eval("(function(){ const c = countMoves(['Ann: Pod A → Pod B on 1 Sep'," +
            "'Phone: X → Y on 1 Sep', 'Night phone: X → Y on 1 Sep']);" +
            "return c.pods === 1 && c.phone === 1 && c.nphone === 1 && c.total === 3; })()") === true);

  ok("the dialog draws four boxes — three weeks and the unwritten one",
     (function(){ w.eval("staffModal(staffById('r3'))");
       w.eval("try{ closeModal(); }catch(e){}");
       w.eval("askWhenSkillStarts('Jo Bloggs', ['Airway'], 'r3', { airway:true })");
       const n = w.eval("document.querySelectorAll('#modal .wkbtn').length");
       const fut = w.eval("document.querySelectorAll('#modal .wkbtn.future').length");
       const txt = w.eval("document.getElementById('modal').textContent");
       w.eval("try{ closeModal(); }catch(e){}");
       return n === 4 && fut === 1 && /not written yet/.test(txt); })() === true);

  /* ---- historic staff ---------------------------------------------------------------------
     Ali's rule: no pod duty anywhere in the four weeks pulled from Allocate means gone. Absence
     from a rota already written is evidence in a way absence in the past is not. */
  console.log("\n-- historic staff --");
  w.eval("(function(){ const K = mondayOf(todayISO());" +
         "data.weeks = {};" +
         "for (let n=0;n<4;n++){ const key = addDays(K, n*7); const wk = getWeek(key); wk.roster = {};" +
         "  for (let d=0; d<7; d++) wk.roster[addDays(key,d)] = { r1:{code:'LD',kind:'day',src:'a'} }; }" +
         // somebody who worked a fortnight ago and has nothing ahead
         "const old = addDays(K, -14); const ow = getWeek(old); ow.roster = {};" +
         "for (let d=0; d<7; d++) ow.roster[addDays(old,d)] = { r2:{code:'LD',kind:'day',src:'a'} };" +
         "recomputeHistoric(); })()");

  ok("somebody still on the coming rota is current", w.eval("isHistoric('r1')") === false);
  ok("somebody with nothing in the four weeks is historic", w.eval("isHistoric('r2')") === true);
  ok("and they drop out of the pick-lists from today",
     w.eval("isActiveOn(staffById('r2'), todayISO())") === false);
  ok("but a week they actually worked still edits properly",
     w.eval("isActiveOn(staffById('r2'), addDays(todayISO(), -14))") === true);
  /* The guard here used to be "was ever rostered", which quietly exempted everybody who left
     before the Optima roster started arriving — they had no roster entry anywhere, so they were
     skipped and stayed Current for good. New has to be a fact about the person. */
  /* Consultants never appear in the Optima roster at all, so absence from it is not evidence of
     anything. Treating it as evidence made every consultant inactive and emptied the pod
     dropdowns on the live board (Ali, 6 Aug). */
  /* Ali, 8 Aug: "The (this week) looks clunky." The title said it and the button said it. */
  ok("the week title no longer repeats what the This week button already says",
     /this week/i.test(w.eval("(function(){ currentWeekKey = mondayOf(todayISO()); renderWeek();" +
            "return document.querySelector('#weekTitle').textContent; })()")) === false);
  ok("the button marks itself current instead",
     w.eval("document.querySelector('#btnToday').getAttribute('aria-current')") === "true");
  ok("and lets go of that mark once you navigate away",
     w.eval("(function(){ currentWeekKey = addDays(mondayOf(todayISO()), 7); renderWeek();" +
            "return document.querySelector('#btnToday').getAttribute('aria-current'); })()") === "false");

  /* Ali, 8 Aug: "what the F is this rendering about". The Super box drew disabled dropdowns when
     you were not editing, so a supernumerary looked nothing like the chips on the same pod. */
  ok("out of edit mode the Super box draws chips, not dropdowns",
     w.eval("(function(){ const box = document.createElement('div');" +
            "data.staff.push({ id:'sup9', name:'Sup Person', grade:'Neurology', active:true });" +
            "const d = blankDay(); setSuperShift(d,'sup9','SD');" +
            "idListEditor(box, todayISO(), ['sup9'], null, 'add', d);" +
            "return box.querySelectorAll('select').length === 0 && box.querySelectorAll('.chip').length === 1; })()") === true);
  ok("and the chip still carries the shift, so nothing is lost by looking better",
     w.eval("(function(){ const box = document.createElement('div'); const d = blankDay();" +
            "setSuperShift(d,'sup9','SD'); idListEditor(box, todayISO(), ['sup9'], null, 'add', d);" +
            "return (box.querySelector('.tagx')||{}).textContent; })()") === "SD");

  /* ---- SETTINGS, SOURCE PANEL AND THE RESET (Ali, 8 Aug) --------------------------------- */

  ok("the source panel gives times to the minute, never a bare date",
     w.eval("whenMin('2026-08-08T12:43:07Z')").indexOf(":") > 0);
  ok("and says so rather than inventing one when there is no timestamp",
     w.eval("whenMin(null)") === "\u2014");

  /* A backup job that has silently stopped looks exactly like one with nothing to do. */
  ok("a backup less than a day old is not flagged",
     w.eval("(function(){ data.lastBackup = new Date(Date.now()-2*3600000).toISOString();" +
            "return hoursSince(data.lastBackup) < 26; })()") === true);
  ok("past 26 hours it is",
     w.eval("(function(){ data.lastBackup = new Date(Date.now()-30*3600000).toISOString();" +
            "return hoursSince(data.lastBackup) > 26; })()") === true);
  ok("and a backup that has never run reads as missing, not as fine",
     w.eval("hoursSince(null)") === null);

  ok("the roster's reach is read from the data, so 'why can't I see September' is answerable here",
     typeof w.eval("rosterReach()") === "string");

  /* Sync now cannot run anything — it asks. Claiming otherwise would be a lie the page cannot
     back up. */
  ok("Sync now writes a request for the next run rather than claiming it ran",
     w.eval("(function(){ delete data.syncRequest; syncNow(); return !!(data.syncRequest && data.syncRequest.t); })()") === true);

  /* Addresses are shown on the lock screen, which anybody with the link reaches. */
  ok("an admin address is masked before it reaches the lock screen",
     w.eval("maskEmail('alistair.cranfield@nhs.net')") === "ali\u2022\u2022\u2022@nhs.net");
  ok("a short local part is not turned into a hint about itself",
     w.eval("maskEmail('ac@nhs.net')") === "a\u2022\u2022\u2022@nhs.net");
  ok("and something that is not an address survives being masked",
     w.eval("maskEmail('nonsense')") === "nonsense");

  /* THE HOLE THIS CLOSES. Anyone who could reach the board could clear the password by typing
     RESET at it. The word must not survive anywhere as a fallback — a fallback that reopens the
     hole is not a fallback. */
  ok("nothing on the board still resets a password by typing a word at it",
     w.eval("document.documentElement.outerHTML").indexOf("Type RESET") === -1);
  ok("the reset asks a named admin instead, and there is a dialog to do it",
     w.eval("typeof resetDialog === 'function'") === true);
  ok("with no admins set up it says so rather than offering a button that goes nowhere",
     w.eval("(function(){ data.admins = []; resetDialog();" +
            "const t = document.querySelector('#modal').textContent; closeModal();" +
            "return /No address/.test(t); })()") === true);

  /* Removing the last address recreates the lockout the mechanism exists to prevent. */
  ok("settings keeps at least one reset address",
     w.eval("(function(){ data.admins = ['a@nhs.net']; settingsPage = null; renderSettings();" +
            "const b = [...document.querySelectorAll('#setList button')].find(x => x.textContent === 'Remove');" +
            "if (b) b.click(); return (data.admins || []).length; })()") === 1);
  ok("but a second one can be removed",
     w.eval("(function(){ data.admins = ['a@nhs.net','b@nhs.net']; renderSettings();" +
            "const b = [...document.querySelectorAll('#setList button')].find(x => x.textContent === 'Remove');" +
            "if (b) b.click(); return (data.admins || []).length; })()") === 1);
  ok("and something that is not an address is refused rather than stored",
     w.eval("(function(){ data.admins = ['a@nhs.net']; return isEmail('not an address'); })()") === false);

  /* The importers are a fallback now, not part of the routine. */
  ok("Import is off the rail",
     w.eval("(function(){ const b = document.querySelector('button[data-tab=\\'import\\']');" +
            "return b ? b.style.display : 'missing'; })()") === "none");
  ok("but still reachable, as a subpage of Settings",
     w.eval("(function(){ settingsPage = null; renderSettings();" +
            "return [...document.querySelectorAll('#setList .subtile')].some(t => /Import by hand/.test(t.textContent)); })()") === true);
  ok("the grade defaults moved to a subpage too, so the numbers people change are not buried",
     w.eval("(function(){ settingsPage = 'grades'; renderSettings();" +
            "const t = document.querySelector('#setList').textContent; settingsPage = null; renderSettings();" +
            "return /SKILLS A GRADE STARTS WITH/.test(t); })()") === true);

  /* A collapse inside a hidden subpage is one lid too many (Ali, 8 Aug). */
  ok("the manual importer is not folded away a second time",
     w.eval("(function(){ const c = document.querySelector('#manualRosterCard');" +
            "return c ? c.tagName : 'missing'; })()") === "DIV");

  /* The night gap (Ali, 8 Aug). allocate_auto now places a newly-rostered night person using these
     two rules and then hands over to normalizeNight — so this test guards the rule the sync leans
     on, in the one place it is written. Five on nights means the phone holder splits off to Pod E,
     which is the move Nicholas Coffin had to make by hand on 14 Aug. */
  ok("a fifth arriving on nights sends the phone holder to Pod E on their own",
     w.eval("(function(){ const d = blankDay(); d.night.AB=['a','b']; d.night.CDE=['c','d'];" +
            "d.night.phone='c'; const nd=d.night;" +
            "const half = nd.CDE.length < nd.AB.length ? 'CDE' : 'AB'; nd[half].push('e');" +
            "normalizeNight(d); return JSON.stringify({E:nd.E, ab:nd.AB, cde:nd.CDE}); })()")
     === JSON.stringify({ E: ["c"], ab: ["a", "b", "e"], cde: ["d"] }));
  ok("with only four on, nobody splits off — the phone rotates and the pods hold still",
     w.eval("(function(){ const d = blankDay(); d.night.AB=['a','b']; d.night.CDE=['c'];" +
            "d.night.phone='c'; d.night.CDE.push('e'); normalizeNight(d);" +
            "return (d.night.E||[]).length; })()") === 0);
  ok("a neurology registrar goes to the C/D side of nights and never A&B",
     w.eval("(function(){ data.staff.push({ id:'nr9', name:'N Reg', grade:'Neurology', active:true });" +
            "const d = blankDay(); d.night.AB=['nr9']; normalizePods(d);" +
            "return d.night.AB.length === 0 && d.night.CDE.includes('nr9'); })()") === true);

  /* Consultants come from Cover now (Ali, 8 Aug). The three things that had to hold: old days keep
     rendering, the board never blanks, and the list needs nothing from the staff register. */
  ok("the migration maps every old consultant record to the initials Cover knows them by",
     w.eval("(function(){ data.cons = null; data.staff.push({ id:'conX', name:'Jane Smith', grade:'CON'," +
            "active:true, aliases:['JQS'] }); migrateConsultants();" +
            "return data.cons.byId['conX'] === 'JQS' && data.cons.names['JQS'] === 'Jane Smith'; })()") === true);
  ok("an alias the rota team typed beats initials taken from the name",
     w.eval("data.cons.byId['conX']") === "JQS");
  ok("a day saved with the old staff id still resolves to a person",
     w.eval("consKey('conX') === 'JQS' && consSurname('conX') === 'Smith'") === true);
  ok("with Cover unreachable the names still come, from the cache",
     w.eval("(function(){ coverLive = null; return consList().includes('JQS') && consName('JQS') === 'Jane Smith'; })()") === true);
  ok("and the control says so rather than a sentence on the screen",
     w.eval("(function(){ coverLive = null; data.cons.at = '2026-08-06T09:00:00.000Z';" +
            "return /Cover could not be reached/.test(consFreshness()); })()") === true);
  ok("when Cover answers it wins over the cache",
     w.eval("(function(){ coverLive = { names: { JQS: 'Jane Q Smith' } }; const n = consName('JQS');" +
            "coverLive = null; return n; })()") === "Jane Q Smith");
  ok("the allocation is never drawn from the cache — only a live Cover",
     w.eval("(function(){ coverLive = null; return Object.keys(coverDays()).length; })()") === 0);

  ok("a consultant is never historic, however long they are absent from the roster",
     w.eval("(function(){ data.staff.push({ id:'con9', name:'A Consultant Two', grade:'CON'," +
            "active:true, adhoc:false, aliases:[] }); recomputeHistoric();" +
            "return isHistoric('con9'); })()") === false);
  ok("and so stays selectable for the pod dropdowns",
     w.eval("isActiveOn(staffById('con9'), todayISO())") === true);
  ok("the rule says WHY, so the next odd route is easy to add",
     w.eval("typeof rosterDecides === 'function' && rosterDecides(staffById('con9')) === false" +
            " && rosterDecides(staffById('r1')) === true") === true);

  ok("somebody added and not yet rostered is NOT historic — they are just new",
     w.eval("(function(){ const s = staffById('a1'); s.startAuto = true;" +
            "recomputeHistoric(); const r = isHistoric('a1'); delete s.startAuto; return r; })()") === false);
  ok("but somebody with no roster history and no grace IS historic — they left before we had rosters",
     w.eval("(function(){ const s = staffById('a1'); delete s.startAuto;" +
            "recomputeHistoric(); return isHistoric('a1'); })()") === true);

  /* An end date used to be decoration: isActiveOn took a date and ignored it, so somebody with an
     end date six months ago was still being rostered, still filling pods, and still counted in
     the phone fair-share denominators. The 12-month simulation had exactly such a leaver and
     never noticed, which is why its neuro band was calibrated 3 points off. */
  ok("an end date actually ends somebody",
     w.eval("(function(){ const s = staffById('r1'); s.end = addDays(todayISO(), -30);" +
            "const after = isActiveOn(s, todayISO());" +
            "const before = isActiveOn(s, addDays(todayISO(), -60));" +
            "delete s.end; return after === false && before === true; })()") === true);

  ok("a fortnight's leave does not make somebody historic",
     w.eval("(function(){ const K = mondayOf(todayISO());" +
            // nothing for two weeks, then back in weeks three and four
            "for (let n=2;n<4;n++){ const key = addDays(K, n*7); const wk = getWeek(key);" +
            "  for (let d=0; d<7; d++) wk.roster[addDays(key,d)].r2 = {code:'LD',kind:'day',src:'a'}; }" +
            "recomputeHistoric(); return isHistoric('r2'); })()") === false);

  ok("a shift appearing brings them back on their own",
     w.eval("(function(){ const K = mondayOf(todayISO());" +
            "for (let n=2;n<4;n++){ const key = addDays(K, n*7); const wk = getWeek(key);" +
            "  for (let d=0; d<7; d++) delete wk.roster[addDays(key,d)].r2; }" +
            "recomputeHistoric(); const gone = isHistoric('r2');" +
            "const wk = getWeek(addDays(K, 21)); wk.roster[addDays(K, 21)].r2 = {code:'LD',kind:'day',src:'a'};" +
            "recomputeHistoric(); return gone === true && isHistoric('r2') === false; })()") === true);

  ok("Bring back holds somebody on the list with no shift at all",
     w.eval("(function(){ const K = mondayOf(todayISO());" +
            "const wk = getWeek(addDays(K, 21)); delete wk.roster[addDays(K, 21)].r2;" +
            "recomputeHistoric(); const gone = isHistoric('r2');" +
            "staffById('r2').keepCurrent = true; recomputeHistoric();" +
            "const back = isHistoric('r2'); delete staffById('r2').keepCurrent;" +
            "return gone === true && back === false; })()") === true);

  ok("the staff page grows a Historic tab when there is somebody in it",
     (function(){ w.eval("recomputeHistoric(); staffTab = 'current'; switchTab('staff'); renderStaff();");
       const t = w.eval("document.getElementById('staffTabs').textContent");
       return /Current/.test(t) && /Historic/.test(t); })());
  ok("and the tab lists them instead of the current staff",
     (function(){ w.eval("staffTab = 'historic'; renderStaff();");
       const t = w.eval("document.getElementById('staffBody').textContent");
       const r = /Sam Aziz/.test(t) && !/Alice Ring/.test(t);
       w.eval("staffTab = 'current'; renderStaff();"); return r; })());

  /* Start dates fill themselves in for new people only. */
  ok("a new person's start date comes from their first shift",
     w.eval("(function(){ const K = mondayOf(todayISO());" +
            "data.staff.push({ id:'new1', name:'New Person', grade:'FY1', active:true, adhoc:false," +
            "aliases:[], start:null, startAuto:true });" +
            "const wk = getWeek(K); wk.roster[addDays(K,2)].new1 = {code:'LD',kind:'day',src:'a'};" +
            "fillStartDates(); return staffById('new1').start === addDays(K,2); })()") === true);
  ok("and somebody already on the list is left blank",
     w.eval("(function(){ const s = staffById('r1'); s.start = null; delete s.startAuto;" +
            "fillStartDates(); return s.start; })()") === null);

  /* ---- two records, one person ------------------------------------------------------------
     The real case, 5 Aug: Optima matches on name, did not recognise "Aaron Cook", and minted an
     ad-hoc locum called "Arron Cook". The rota was written against the locum; Neurology and
     supernumerary sat on the record nothing used. */
  console.log("\n-- suspected duplicates --");
  w.eval("(function(){ const K = mondayOf(todayISO());" +
         "data.staff.push({ id:'real1', name:'Aaron Cook', grade:'Neurology', supernum:true," +
         "  active:true, adhoc:false, aliases:[] });" +
         "data.staff.push({ id:'loc1', name:'Arron Cook', grade:'', active:true, adhoc:true, aliases:[] });" +
         "const wk = getWeek(K); wk.days[0].pods.D.assign.push({ id:'loc1', shift:'SD' });" +
         "wk.roster[addDays(K,0)] = wk.roster[addDays(K,0)] || {};" +
         "wk.roster[addDays(K,0)].loc1 = { code:'SD', kind:'day', src:'a' }; })()");

  ok("one letter apart, one side ad-hoc — flagged",
     w.eval("suspectedDuplicates().filter(function(d){ return d.dup.id === 'loc1' && d.keep.id === 'real1'; }).length") === 1);
  ok("and it says why in words, not a score",
     /one letter apart/.test(w.eval("suspectedDuplicates().filter(function(d){ return d.dup.id==='loc1'; })[0].why")));
  ok("two real staff who merely look alike are NOT flagged",
     w.eval("(function(){ data.staff.push({ id:'x1', name:'Jack Roddy', grade:'IMT', active:true, adhoc:false, aliases:[] });" +
            "data.staff.push({ id:'x2', name:'Jack Hodd', grade:'CON', active:true, adhoc:false, aliases:[] });" +
            "const hit = suspectedDuplicates().some(function(d){ return /Roddy|Hodd/.test(d.dup.name + d.keep.name); });" +
            "data.staff = data.staff.filter(function(s){ return s.id !== 'x1' && s.id !== 'x2'; }); return hit; })()") === false);
  ok("two placeholders that normalise the same are NOT flagged either",
     w.eval("(function(){ data.staff.push({ id:'z1', name:'ICU zLocum1', active:true, adhoc:true, aliases:[] });" +
            "data.staff.push({ id:'z2', name:'ICU zLocum2', active:true, adhoc:true, aliases:[] });" +
            "const hit = suspectedDuplicates().some(function(d){ return /zLocum/.test(d.dup.name); });" +
            "data.staff = data.staff.filter(function(s){ return s.id !== 'z1' && s.id !== 'z2'; }); return hit; })()") === false);

  console.log("\n-- merging them --");
  const merged = w.eval("(function(){ const r = mergeStaff('real1','loc1'); return r ? r.moved : -1; })()");
  ok("the merge moves the allocations across", merged > 0, String(merged));
  ok("the duplicate record is gone", w.eval("!staffById('loc1')") === true);
  ok("their name is kept as an alias, so the next import matches",
     w.eval("(staffById('real1').aliases || []).join(',')").indexOf("Arron Cook") >= 0);
  ok("the shift now belongs to the real person, not a ghost id",
     w.eval("(function(){ const K = mondayOf(todayISO()), d = getWeek(K).days[0];" +
            "const inD = (d.pods.D.assign||[]).some(function(a){ return a.id === 'real1'; });" +
            "const inSuper = (d.pods.D.super||[]).indexOf('real1') >= 0;" +
            "return inD || inSuper; })()") === true);
  ok("and the roster entry moved too — nothing still points at the old id",
     w.eval("(function(){ const K = mondayOf(todayISO()), r = getWeek(K).roster[addDays(K,0)];" +
            "return !!r.real1 && !r.loc1; })()") === true);

  /* Being neurology and supernumerary now MEANS something, because the flags are finally on the
     record the rota uses. */
  ok("once merged they are supernumerary, so they leave the counted numbers",
     w.eval("(function(){ const K = mondayOf(todayISO()), d = getWeek(K).days[0];" +
            "sweepSupernumeraries();" +
            "const counted = PODS.some(function(p){ return (d.pods[p].assign||[]).some(function(a){ return a.id === 'real1'; }); });" +
            "const inSuper = PODS.some(function(p){ return (d.pods[p].super||[]).indexOf('real1') >= 0; });" +
            "return !counted && inSuper; })()") === true);
  ok("and a neurology registrar lands on C or D, nowhere else",
     w.eval("(function(){ const K = mondayOf(todayISO()), d = getWeek(K).days[0];" +
            "return ['C','D'].some(function(p){ return (d.pods[p].super||[]).indexOf('real1') >= 0; }); })()") === true);
  ok("the sweep reaches weeks nobody has opened",
     w.eval("typeof sweepSupernumeraries === 'function' && sweepSupernumeraries() >= 0") === true);
  ok("merging is offered as an action on the attention row, not just described",
     w.eval("(function(){ const its = attentionItems().filter(function(x){ return /look like the same person/.test(x.title); });" +
            "return its.length === 0 || typeof its[0].act === 'function'; })()") === true);

  /* ---- finding a date, and finding yourself ------------------------------------------------
     Trial feedback, 6 Aug: "a week overview or a Calender view so we can check allocation on a
     specific date more easily". The date jump reuses the week title, so it adds no furniture;
     My shifts is its own rail page rather than a dialog, because people sit in it. */
  console.log("\n-- my shifts, and the date jump --");
  ok("the week title opens a date picker rather than only jumping to today",
     w.eval("typeof jumpToDate === 'function' && typeof document.getElementById('weekTitle').onclick === 'function'") === true);
  /* Project rule 2: no explainer text in the UI. A legend under the grid is the rule's own example
     of a screen that is not clear enough (Ali, 8 Aug). This test is here so it cannot come back. */
  ok("the month carries no explainer line",
     w.eval("(function(){ switchTab('mine'); const t = document.querySelector('#tab-mine').textContent;" +
            "return /a dot means|not written yet|Pick yourself once|Choose a person to see/.test(t); })()") === false);
  ok("and says what supernumerary means by writing it, not by a legend",
     w.eval("typeof renderMine === 'function' && !/\\u00b7\"\\)\\)/.test(renderMine.toString())") === true);

  ok("My shifts is a rail item, not another toolbar icon",
     w.eval("!!document.querySelector('aside button[data-tab=mine]') && !document.getElementById('btnMyMonth')") === true);
  ok("and it draws a month grid for the person picked",
     w.eval("(function(){ store.set('myId','r1'); switchTab('mine'); renderMine();" +
            "const box = document.getElementById('mineBox');" +
            "return box.querySelectorAll('.mday').length >= 28 && !!box.querySelector('select'); })()") === true);
  ok("the choice is remembered in this browser, not written to the rota",
     w.eval("(function(){ const before = JSON.stringify(data.staff);" +
            "store.set('myId','r2'); renderMine();" +
            "return store.get('myId') === 'r2' && JSON.stringify(data.staff) === before" +
            "  && JSON.stringify(data).indexOf('\"myId\"') < 0; })()") === true);
  ok("a day the person is on says where they are",
     w.eval("(function(){ const T = todayISO(); const wk = getWeek(mondayOf(T));" +
            "const di = Math.round((new Date(T) - new Date(mondayOf(T)))/86400000);" +
            "const d = wk.days[di]; d.pods.A.assign = [{ id:'r1', shift:'LD' }];" +
            "const w2 = whereIsPerson('r1', T); return w2 && w2.pod === 'A' && w2.shift === 'LD'; })()") === true);
  ok("a week that has not been written is marked, not hidden",
     w.eval("(function(){ return weekExists(addDays(todayISO(), 400)) === false; })()") === true);

  /* ---- NOT ON, NEVER WHY (hard rule 6, sharpened 8 Aug after the DPIA) --------------------
     The only special-category data this project ever held was a log line saying a named person
     was off sick. It is gone, and these assert it stays gone — including the WORDS, because
     health data is defined by what it reveals and a neutral field reached from a control
     labelled "off sick" is still an Article 9 record. Asserted against the source rather than a
     rendered screen: the fault would come back as somebody typing a helpful label. */
  {
    const src = require("fs").readFileSync(PAGE, "utf8");
    /* The comment explaining WHY this was removed legitimately quotes the old wording, so the
       check is on live code: no writer may set a reason, and no control may name one. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("nothing writes a reason for an absence", !/why:\s*["']sick["']/.test(code));
    ok("...and no log message names one", !/Sickness fix/.test(code));
    ok("...and no control, label or help text says off sick", !/off sick/i.test(code));
    ok("...and no code path is named after it", !/SickFix|sickFix/.test(code));
    /* Taking somebody off is still possible and still logged — the point is that it is one
       action with one meaning, not that it disappeared. */
    ok("taking someone off a day is still there, unqualified",
       /removeTitle: "Take off this day"/.test(code));
    ok("...and still writes who and when", /act: "off", subj: g\.name/.test(code));

    const core = require("fs").readFileSync(require("path").join(__dirname, "..", "core.js"), "utf8");
    const coreCode = core.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok("the shared renderer draws one chip for every removal",
       !/chip\("sick"/.test(coreCode) && !/chip\("off rota"/.test(coreCode));
    ok("...and never reconstructs a reason out of an old message",
       !/why:\s*["'](sick|rota)["']/.test(coreCode));
  }

  ok("no errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  if (failures.length) { console.log("Failures:"); failures.forEach(f => console.log(" - " + f)); }
  process.exit(fail ? 1 : 0);
})();
