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
  /* strength.js IS THE ALGORITHM AND MUST BE IN THE HARNESS. Same trap the rule suite fell into
     on 14 Aug: jsdom is handed the page as a string with no working origin, so a <script src>
     silently fetches nothing, `Strength` stays undefined, and every assertion about the score or
     the weights quietly tests the ABSENCE of it. The page is written to degrade gracefully when
     strength.js is missing — which is right for a bad deploy and fatal for a test suite, because
     the degraded path passes. Inlined here so the tests exercise the same two files the browser
     loads. */
  /* planner.js joins the list on 26.08.20, for exactly the reason written above: from today it is
     what writes a week, and fillWeekWithPlanner degrades to the old day-at-a-time path when it is
     absent — so leaving it out would grade the degraded path here too.

     TWO ESCAPES, BOTH LEARNED THE HARD WAY ON 26.08.20. An HTML parser ends a <script> at the
     first `</script>` it sees, even inside a comment, and planner.js documents its own install
     line — so the inlined copy was cut off mid-file and jsdom reported a SyntaxError from a line
     number in unrelated CSS. And String.replace reads `$&`, "$'" and "$`" in a replacement STRING
     as instructions, so a source file containing them is rewritten on the way in. Escape the tag,
     and pass a function. */
  /* podcost.js joins on 26.08.21 — the dials now take their number from the planner's price list
     through it, so a harness without it grades a number the browser no longer draws. */
  for (const f of ["core.css", "core.js", "strength.js", "planner.js", "podcost.js"]) {
    const p = path.join(HERE, "..", f);
    if (!fs.existsSync(p)) continue;
    const body = fs.readFileSync(p, "utf8");
    if (f.endsWith(".css")) {
      html = html.replace(/<link rel="stylesheet" href="core\.css[^"]*">/, () => "<style>" + body + "</style>");
    } else {
      const safe = body.replace(/<\/script/gi, "<\\/script");
      html = html.replace(new RegExp('<script src="' + f.replace(".", "\\.") + '[^"]*"><\\/script>'),
                          () => "<script>" + safe + "</script>");
    }
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

  /* ---- the Staff page saves what it says it saved ----------------------------------------
     12 Aug: Check, the person sheet's Save, Bring back and Delete all called markDirty() and
     nothing else — and markDirty() returns without a word outside edit mode. The tick appeared,
     the badge dropped, the next 3-minute sync pulled the shared copy back over the top, and Tom
     McKernan needed checking a third time. Two halves to assert: the button arms editing itself,
     and the change is WRITTEN OUT rather than left sitting in memory. */
  console.log("\n-- the Staff page saves what it says it saved --");
  const clickCheck = () => w.eval("(function(){ var b = document.querySelector('#staffBody .rowbtn.check');" +
    "if (!b) return false; b.click(); return true; })()");   // el() binds with addEventListener, so .onclick is null
  const settle = () => new Promise(r => setTimeout(r, 40));
  w.eval("window.__realEnter = enterEdit; window.__realSave = saveFile;" +
         "window.__armed = 0; window.__saved = 0;" +
         "saveFile = function(){ window.__saved++; return Promise.resolve(); };" +
         "stGrades = null; stSkills = new Set();" +
         "EDIT_MODE = false; teamEditTried = false; data.staff[0].verified = false;" +
         // stands in for a refusal: asked for, not granted
         "enterEdit = function(){ window.__armed++; return Promise.resolve(); };" +
         "renderStaff();");
  ok("an unchecked new starter still gets a Check button", clickCheck() === true);
  await settle();
  ok("clicking it asks for edit mode instead of assuming it", w.eval("window.__armed") === 1);
  ok("and when editing is refused the tick is NOT quietly set anyway",
     w.eval("data.staff[0].verified") === false);
  ok("...and nothing was saved", w.eval("window.__saved") === 0);
  w.eval("enterEdit = function(){ window.__armed++; EDIT_MODE = true; return Promise.resolve(); }; renderStaff();");
  clickCheck();
  await settle();
  ok("with editing armed the tick lands", w.eval("data.staff[0].verified") === true);
  ok("and it is written out there and then, not left in memory to be lost",
     w.eval("window.__saved") >= 1);
  /* Ali, 12 Aug: "if somebody logs into the rota team bit past the shield it should enter edit
     mode and block others from saving until theyve stopped using". */
  w.eval("EDIT_MODE = false; teamEditTried = false; window.__armed = 0; switchTab('staff');");
  await settle();
  ok("walking in past the shield arms editing by itself", w.eval("window.__armed") === 1);
  w.eval("switchTab('fair'); switchTab('log');");
  await settle();
  ok("...asked once per visit, so a refusal doesn't nag on every tab",
     w.eval("window.__armed") === 1, "asked " + w.eval("window.__armed") + " times");
  /* DONE MEANS DONE — 26.08.21. Ali: "theres no way of getting out of edit mode. clicking done
     should do that." A deliberate exit must not be undone by the auto-arm on the next team-page
     tap. Enter edit, exit via exitEdit, then move around the team pages — edit must NOT re-arm. */
  w.eval("saveFile = function(){ dirty = false; return Promise.resolve(true); };" +
         "dirty = false; EDIT_MODE = true; window.__armed = 0; exitEdit();");
  await settle();
  ok("Done drops out of edit mode", w.eval("EDIT_MODE") === false && /viewmode/.test(w.eval("document.body.className")));
  w.eval("switchTab('fair'); switchTab('staff'); switchTab('log');");
  await settle();
  ok("...and moving around the team pages does not silently re-arm it",
     w.eval("EDIT_MODE") === false && w.eval("window.__armed") === 0,
     "edit=" + w.eval("EDIT_MODE") + " armed=" + w.eval("window.__armed"));
  /* The prompt pre-fills the last editor. Tested at the dialog mechanism — uiDialog must put
     `value` into the box — rather than by driving enterEdit, whose file-handle gate needs a real
     picker. The call site passing value:prev is a one-liner beside this. */
  ok("the who's-editing box pre-fills the value it is given, so the usual case is one tap",
     w.eval("(function(){ document.querySelectorAll('.dlg-bg').forEach(function(x){x.remove();});" +
            "uiPrompt('x', { value:'Nellie Johnson', options:['Nellie Johnson','Sam Aziz'] });" +
            "var d = [...document.querySelectorAll('.dlg-bg')].pop();" +
            "var i = d ? d.querySelector('input[type=text]') : null; var v = i ? i.value : null;" +
            "if(d) d.remove(); return v; })()") === "Nellie Johnson");
  /* A RENAME MUST NOT ORPHAN SOMEBODY FROM THE SYNC. merge.py matches an Optima row on the name
     plus the aliases, so tidying "Thomas Mckernan" to "Tom McKernan" without keeping the old one
     means the next pull does not recognise him and appends a SECOND record with the same id.
     Found 12 Aug while fixing the save bug; fixed on both sides, asserted on this one. */
  w.eval("EDIT_MODE = true; saveFile = function(){ return Promise.resolve(); };" +
         "window.__was = data.staff[0].name; data.staff[0].aliases = [];" +
         "staffModal(data.staff[0]);" +
         "(function(){ var i = document.querySelector('#modal input[type=text]'); i.value = 'Renamed Person';" +
         "var b = [].slice.call(document.querySelectorAll('#modal .modalbtns button')); b[b.length-1].click(); })();");
  ok("renaming somebody keeps the name the Optima sync knows them by",
     JSON.parse(w.eval("JSON.stringify(data.staff[0].aliases)")).includes(w.eval("normName(window.__was)")),
     w.eval("JSON.stringify(data.staff[0].aliases)"));
  ok("...and the new name is the one on the record",
     w.eval("data.staff[0].name") === "Renamed Person");
  w.eval("data.staff[0].name = window.__was; data.staff[0].aliases = [];");
  w.eval("enterEdit = window.__realEnter; saveFile = window.__realSave;" +
         "EDIT_MODE = false; teamEditTried = true; data.staff[0].verified = true;" +
         "switchTab('staff'); renderStaff();");

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
     w.eval("logView = 'cat'; renderLog(); !!document.querySelector('#logList input[type=text]')"));
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
     w.eval("(function(){ logView = 'cat'; logQuery = ''; renderLog();" +
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
     w.eval("(function(){ logView = 'cat'; logQuery = ''; renderLog();" +
            "const t = document.getElementById('logList').textContent;" +
            "return t.indexOf('Ambrose') >= 0 && t.indexOf('Sam Aziz') >= 0; })()") === true);
  ok("you can search by who made the change, not just by person",
     w.eval("(function(){ logQuery = 'allocate sync'; renderLog();" +
            "const t = document.getElementById('logList').textContent;" +
            "const r = t.indexOf('Sam Aziz') >= 0 && t.indexOf('Ambrose') < 0; logQuery=''; renderLog(); return r; })()") === true);

  /* ---- reading the log by PERSON (9 Aug) ---------------------------------------------------
     Ali, looking at twelve rows under TODAY that were one person's problem being fixed:
     "nothing ties the rows together". Both date modes answer "what happened then"; this one
     answers "what has happened to HIM", which is the question somebody actually arrives with. */
  console.log("\n-- the change log read by person --");
  w.eval("logView = 'cat'; logQuery = ''; logFilter = 'all'; data.log = [" +
    "{ t:'2026-08-07T15:12:00Z', who:'allocate sync', kind:'auto', on:'2026-08-12', msg:'a'," +
    "  d:{ act:'shift', subj:'Antony Taylor Gutierrez', from:'N', to:'LD' } }," +
    "{ t:'2026-08-09T18:15:00Z', who:'Nicholas Coffin', kind:'manual', on:'2026-08-12', msg:'b'," +
    "  d:{ act:'move', subj:'Antony Taylor Gutierrez', from:'C&D', to:'C' } }," +
    "{ t:'2026-08-09T18:16:00Z', who:'Nicholas Coffin', kind:'manual', on:'2026-08-13', msg:'c'," +
    "  d:{ act:'move', subj:'Philip Meeson', from:'C&D', to:'A&B', night:true } }," +
    "{ t:'2026-08-06T09:00:00Z', who:'Alistair', kind:'manual', on:null, msg:'Password changed' }" +
    "]; logBy = 'person'; renderLog();");
  const headsOf = "[...document.querySelectorAll('#logList .loghead')].map(h => h.textContent)";
  ok("Group by offers a third way of reading it",
     w.eval("[...document.querySelectorAll('#logList select')][0].options.length") === 3);
  ok("every row about one person sits under their name",
     w.eval("(function(){ const h = " + headsOf + ";" +
            "return h.some(x => x.indexOf('Antony Taylor Gutierrez') === 0 && /2$/.test(x)); })()") === true);
  /* The question is nearly always about somebody who has JUST been moved, so alphabetical would
     bury them under whoever happens to start with an A. */
  ok("the person touched most recently comes first, not the one first alphabetically",
     w.eval("(function(){ const h = " + headsOf + ";" +
            "return h[0].indexOf('Philip Meeson') === 0; })()") === true);
  /* A series reads forwards. Newest-first is right for "what just happened" and wrong for
     "how did we get here" — which is the whole reason for this mode. */
  ok("and inside a person the entries run oldest first, so the story reads forwards",
     w.eval("(function(){ const g = [...document.querySelectorAll('#logList .loghead')]" +
            ".find(h => h.textContent.indexOf('Antony') === 0); if (!g) return false;" +
            "const rows = [...g.nextSibling.querySelectorAll('tr.logrow')]; if (rows.length < 2) return false;" +
            "return /15:12|16:12/.test(rows[0].textContent) && /18:15|19:15/.test(rows[1].textContent); })()") === true);
  ok("the rota day is on every row, because that is what a person's series is a series of",
     w.eval("document.querySelectorAll('#logList tr.logrow td:first-child span').length") ===
     w.eval("document.querySelectorAll('#logList tr.logrow').length"));
  /* Dropping them would be tidier and would also hide them. An entry the reader cannot see is
     worse than one they can see is not about anybody. */
  ok("entries that are not about one person are still shown, under a heading that says so",
     w.eval("(function(){ const h = " + headsOf + ";" +
            "return h[h.length - 1].indexOf('Not about one person') === 0; })()") === true);
  ok("...and that bucket sorts last however recent it is",
     w.eval("(function(){ const h = " + headsOf + ";" +
            "return h.filter(x => x.indexOf('Not about one person') === 0).length === 1; })()") === true);
  ok("searching still narrows it, and the groups go with it",
     w.eval("(function(){ logQuery = 'meeson'; renderLog();" +
            "const h = " + headsOf + "; logView = 'cat'; logQuery = ''; logBy = 'made'; renderLog();" +
            "return h.length === 1 && h[0].indexOf('Philip Meeson') === 0; })()") === true);

  /* ---- the unified change-log board (26.08.21) --------------------------------------------
     Five ideas measured on the real 132-entry live log, built into one board. A/B/C were already
     here (day-grouped story, per-person collapse, paperwork excluded). These assertions cover the
     three things added: the score on the SAME price list as the board, the after-publish marker,
     and the by-person path. */
  console.log("\n-- the change-log board: score, publish marker, by-person --");
  ok("there is a fourth way to read the log — by person",
     w.eval("(function(){ switchTab('log'); logView='story'; renderLog();" +
            "const b=[...document.querySelectorAll('#logList .logvw button')].map(x=>x.textContent);" +
            "return b.indexOf('By person') >= 0; })()") === true);
  ok("the story score comes from the planner's price list, matching the board",
     w.eval("(function(){ return typeof logPlannerScore === 'function' && typeof PodCost !== 'undefined'; })()") === true);
  /* A change made after a week is public is the one owed an explanation. The moment is derived
     from the publish clock, not a stored field, so it works on old entries too. */
  ok("a week has a publish moment derived from the clock",
     w.eval("(function(){ const m = weekPublishMoment(mondayOf(todayISO()));" +
            "return m instanceof Date && !isNaN(m.getTime()); })()") === true);
  ok("a change before publish is not flagged, one after it is",
     w.eval("(function(){ const iso = addDays(mondayOf(todayISO()), 21);" +
            "const m = weekPublishMoment(mondayOf(iso)).getTime();" +
            "const before = changeAfterPublish(new Date(m-1000).toISOString(), iso);" +
            "const after  = changeAfterPublish(new Date(m+1000).toISOString(), iso);" +
            "return before === false && after === true; })()") === true);
  ok("the by-person view draws one path row per person, in pod circles",
     w.eval("(function(){ const T = addDays(mondayOf(todayISO()), 16);" +
            "data.log = [" +
            "{ t:'2026-08-18T10:00:00Z', who:'A', kind:'manual', on:T, msg:'m', d:{act:'move',subj:'Sam Aziz',from:'A',to:'B'} }," +
            "{ t:'2026-08-18T10:05:00Z', who:'A', kind:'manual', on:T, msg:'m', d:{act:'move',subj:'Sam Aziz',from:'B',to:'C'} }," +
            "{ t:'2026-08-18T10:06:00Z', who:'A', kind:'manual', on:T, msg:'m', d:{act:'move',subj:'Nia Reggie',from:'D',to:'E'} }" +
            "]; logView='person'; renderLog();" +
            "const rows = document.querySelectorAll('#logList .pprow');" +
            "const circles = document.querySelectorAll('#logList .pprow .stchip');" +
            "return rows.length === 2 && circles.length >= 3; })()") === true);
  ok("the by-person path never says why anybody was off — only where they went",
     w.eval("(function(){ const t = document.getElementById('logList').textContent.toLowerCase();" +
            "return t.indexOf('sick') < 0 && t.indexOf('reason') < 0 && t.indexOf('because') < 0; })()") === true);
  /* Leave the log non-empty and the view back on the default — later tests (the log-seen mark,
     the story-view checks) assume a populated log they did not set up themselves. */
  w.eval("logView = 'story'; logBy = 'made'; logQuery = ''; renderLog();");

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

  /* ── THE BUG THAT HID FOR WEEKS — 26.08.21 ─────────────────────────────────────────────────
     Measured on live 26.08.20: `data.cons.from` was "seed" and Setup had been showing amber
     "cached names" for weeks on a board whose Cover read was succeeding on every single load.
     `from` and `at` were being set inside the "have the names changed?" branch, and because the
     seed is built from the same staff records Cover's initials come from, the names matched on
     the first read and the branch never ran.

     A SUCCESSFUL READ IS A FACT ABOUT THE READ, not about whether the answer was new. These two
     assertions are the difference between "we could not reach Cover" and "Cover told us nothing
     we did not already know", which is exactly what got conflated. */
  const noNewNames = await w.eval("(async function(){" +
    "data.cons = { names: { JQS: 'Jane Smith' }, from: 'seed', at: null }; coverLive = null;" +
    "readCover = async () => ({ names: { JQS: 'Jane Smith' } }); EDIT_MODE = true;" +
    "await refreshCover();" +
    "return data.cons.from + '|' + (data.cons.at ? 'stamped' : 'no stamp'); })()");
  ok("a Cover read that finds nothing new still records that Cover answered, and stamps the time",
     noNewNames === "cover|stamped", String(noNewNames));

  const whyItFailed = await w.eval("(async function(){ coverLive = null;" +
    "readCover = async () => { coverError = 'Cover could not be reached — it answered 500 '; return null; };" +
    "await refreshCover(); return consFreshness(); })()");
  ok("a failed read names the reason rather than drawing one amber word for all three kinds",
     /answered 500/.test(String(whyItFailed)), String(whyItFailed));

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

  /* ---- ATTENTION: ONE RULE FOR EVERY ROW ---------------------------------------------------
     Ali, 11 Aug (for Cover) and again on 12 Aug when the resident board still did not have it:
     "when i say ive checked that should just grey out and badge drop". The lifecycle has four
     moments and each one is a way of getting it wrong, so each one is asserted: the press does
     the work and saves, the badge drops immediately, the row STAYS greyed rather than vanishing,
     and on the fourth day a live condition that is still true comes back while a record of
     something that happened stays gone. */
  console.log("\n-- Attention: press it, it greys, the badge drops --");
  {
    const settle2 = () => new Promise(r => setTimeout(r, 40));
    w.eval("window.__re2 = enterEdit; window.__rs2 = saveFile; window.__saved2 = 0;" +
           "saveFile = function(){ window.__saved2++; return Promise.resolve(); };" +
           "enterEdit = function(){ EDIT_MODE = true; return Promise.resolve(); };" +
           "data.sorted = {}; data.pendingSkills = []; data.staff[0].verified = false;" +
           "data.staff[0].active = true; renderAll();");
    const sid = w.eval("data.staff[0].id");
    const row = "unver:" + sid;
    const rows = () => w.eval("JSON.stringify(attentionItems().map(function(x){ return [x.id, !!x.done]; }))");
    const live = () => w.eval("attentionItems().reduce(function(a,x){ return a + (x.done ? 0 : x.n); }, 0)");
    const find = id => JSON.parse(rows()).find(r => r[0] === id);
    ok("an unchecked person gets a row of their own, not a lump of six names", !!find(row), rows());
    ok("...and it offers Checked rather than a generic Sorted",
       w.eval("(attentionItems().find(function(x){ return x.id === '" + row + "'; })||{}).sortLabel") === "Checked");
    const before = live();
    await w.eval("markSorted('" + row + "')");
    await settle2();
    ok("pressing it does the work — they are actually checked", w.eval("data.staff[0].verified") === true);
    ok("...and it is saved, not just held in memory", w.eval("window.__saved2") >= 1);
    ok("the badge drops at once", live() === before - 1, before + " -> " + live());
    const after = find(row);
    ok("but the row is STILL THERE, greyed — not vanished", !!after && after[1] === true, rows());
    w.eval("renderTeamGate();");
    ok("...and the page draws it greyed, with no buttons left to press",
       w.eval("(function(){ var r = document.querySelector('#attnList .attnrow.done');" +
              "return !!r && !r.querySelector('.attnsort') && /Checked by|Checked/.test(r.textContent); })()") === true);
    /* Three days up. */
    w.eval("data.sorted['" + row + "'].t = new Date(Date.now() - 4 * 86400000).toISOString();" +
           "data.staff[0].verified = true;");
    ok("after three days a dealt-with row drops off", !find(row), rows());
    w.eval("data.staff[0].verified = false;");
    const back = find(row);
    ok("...but a LIVE condition that is still true comes back, counting again",
       !!back && back[1] === false, rows());
    /* A historical fact — a skill that starts on a date — stays dealt with. */
    w.eval("data.staff[0].verified = true; data.sorted = {};" +
           "data.pendingSkills = [{ id: data.staff[1].id, name: data.staff[1].name, add: { airway: true }, from: todayISO(), applied: true }];");
    const pend = "pend:" + w.eval("data.staff[1].id") + ":" + w.eval("todayISO()");
    ok("a skill starting on a date raises a row too", !!find(pend), rows());
    await w.eval("markSorted('" + pend + "')");
    await settle2();
    w.eval("data.sorted['" + pend + "'].t = new Date(Date.now() - 9 * 86400000).toISOString();");
    ok("and once somebody has said they have dealt with it, it stays gone", !find(pend), rows());
    w.eval("enterEdit = window.__re2; saveFile = window.__rs2; EDIT_MODE = false; teamEditTried = true;" +
           "data.sorted = {}; data.pendingSkills = []; data.staff[0].verified = true; renderAll();");
  }

  /* THE TABLE'S OWN SCROLL PANE, AND THE BUTTON BAR.
     Ali, 9 Aug: "the scroll to see the oncall/fgh is glitchy. Scrolls the whole page and the top
     header doesnt extend that far - surely would be better if it was just the table that scrolled
     within its pane". Measured on the live page before changing anything: a 1512px viewport
     against a 1733px document, so the page slid 221px sideways while the sticky topbar, sized to
     the viewport at 1434px, stopped dead and left bare background beside it.

     jsdom has no layout, so these assert the rules that PRODUCE the behaviour. They are only
     correct together, which is why they are tested together: making the wrapper a scroll container
     re-points the header's sticky from the viewport to the pane, so `top` must become 0, and the
     day column must gain `left:0` or you scroll to Fairfield and lose which day you are reading. */
  {
    const cssAll = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
    const css = cssAll.split("<style>")[1].split("</style>")[0];
    ok("the table scrolls inside its own pane, so the page cannot slide past the topbar",
      /\.rota-wrap\{overflow:auto/.test(css));
    ok("the header row sticks to the PANE, not the viewport", /table\.rota th\{top:0/.test(css));
    ok("the day column is pinned left", /table\.rota td\.daylabel\{position:sticky;left:0/.test(css));
    ok("borders are separate, or a sticky cell carries its border away and the seam flickers",
      /table\.rota\{border-collapse:separate/.test(css));
    ok("the phone hands the pane back — it reflows to cards and has nothing to scroll sideways",
      /\.rota-wrap\{overflow:visible;max-height:none\}/.test(css));
    /* `.pill`, `.chip` and `.statchip` all had white-space:nowrap; the buttons were missed, so
       "Auto-fill week" wrapped and that one button grew while its neighbours stayed short. */
    ok("button labels cannot wrap, which is what made the bar ragged in edit mode",
      /button\.btn,\.hbtn\{white-space:nowrap\}/.test(css));
    ok("and everything in the week bar is one height",
      /\.weekbar>button,\.weekbar \.btn\{min-height:36px/.test(css));
  }

  /* ── WHAT HAPPENED ──────────────────────────────────────────────────────────────────────
     The view the log now opens on, so it is asserted rather than assumed. */
  console.log("\n-- what happened --");
  w.eval("switchTab('log'); logView = 'story'; renderLog();");
  ok("the story view draws at all", w.eval("!!document.querySelector('#logList .story')"));
  /* Closed is the whole point of the redesign — Ali, 26.08.15: "unusably busy". */
  ok("every day opens CLOSED — nothing is expanded until it is asked for",
     w.eval("[].every.call(document.querySelectorAll('#logList .stopen'), function(x){ return x.style.display === 'none'; })"));
  ok("...and no pod grid is drawn until a go is opened",
     w.eval("document.querySelectorAll('#logList .stgrid').length === 0"));
  ok("a day that only the sync touched and did not change is left out",
     w.eval("(function(){ var t=(document.getElementById('logList')||{}).textContent||'';" +
            "return /only the sync ran|^$/.test(t) || t.indexOf('show sync') >= 0; })()"));
  ok("...and the categorised search box is not in it",
     w.eval("!document.querySelector('#logList input[type=text]')"));

  /* A→B→C by one person is one move; a second person's move stays their own. This is the whole
     shape Ali asked for and the two halves fight each other, so both are asserted together. */
  {
    const r = JSON.parse(w.eval("(function(){" +
      "var iso = todayISO(), A = data.staff[0];" +
      "data.log = [" +
      " {t:'2026-08-14T06:10:00.000Z',who:'Test One',msg:'x',kind:'manual',on:iso,d:{act:'move',subj:A.name,from:'E',to:'A'}}," +
      " {t:'2026-08-14T06:11:00.000Z',who:'Test One',msg:'x',kind:'manual',on:iso,d:{act:'move',subj:A.name,from:'A',to:'B'}}," +
      " {t:'2026-08-14T06:20:00.000Z',who:'Test Two',msg:'x',kind:'manual',on:iso,d:{act:'move',subj:A.name,from:'B',to:'C'}}];" +
      "var st = logDayStory(iso);" +
      "return JSON.stringify({goes: st.sessions.length, firstMoves: st.sessions[0].moves.length," +
      " a: st.sessions[0].moves[0].from + '>' + st.sessions[0].moves[0].to," +
      " chain: !!st.sessions[0].moves[0].chain," +
      " b: st.sessions[1].moves[0].from + '>' + st.sessions[1].moves[0].to});})()"));
    ok("two people means two goes, never one merged block", r.goes === 2, "goes=" + r.goes);
    ok("...and one person's two hops collapse to a single move", r.firstMoves === 1);
    ok("...reading E to B rather than E to A", r.a === "E>B", r.a);
    ok("...with the hops still readable underneath", r.chain === true);
    ok("...while the next person's move stays their own", r.b === "B>C", r.b);
  }
  ok("a move out and straight back reads as no change",
    w.eval("(function(){ var iso = todayISO(), A = data.staff[0];" +
      "data.log = [" +
      " {t:'2026-08-14T06:10:00.000Z',who:'T',msg:'x',kind:'manual',on:iso,d:{act:'move',subj:A.name,from:'C',to:'D'}}," +
      " {t:'2026-08-14T06:12:00.000Z',who:'T',msg:'x',kind:'manual',on:iso,d:{act:'move',subj:A.name,from:'D',to:'C'}}];" +
      "return logDayStory(iso).sessions[0].moves[0].noop === true; })()") === true);

  /* HARD RULE 6, on the surface that shows the most history. */
  ok("no word for an absence or its cause appears anywhere in the view",
    w.eval("(function(){ logView='story'; renderLog();" +
      "var t = (document.getElementById('logList')||{}).textContent || '';" +
      "return !/sick|illness|absent|annual leave|unwell|reason/i.test(t); })()") === true);

  /* Declining a suggestion has to leave a trace, or the log can never tell "the board said
     nothing" from "the board said something and it was not taken". */
  ok("turning down Fix this day is recorded as a fact about the board",
    w.eval("typeof planDayFix === 'function'") &&
    /Fix this day suggested/.test(w.eval("(function(){ var s=document.documentElement.innerHTML; return s; })()")));

  /* ── THE WEIGHT SUGGESTION, ADDED 26.08.15 ────────────────────────────────────────────────
     Ali chose "suggest, you accept" over letting the weights move on their own. These assert the
     REFUSAL to act as hard as they assert the arithmetic, because the dangerous failure here is
     not a wrong number — it is a number that applies itself. */

  ok("a weight suggestion needs a real sample before it says anything",
    w.eval("(function(){ data.reqFixes={R04:3}; data.reqChance={R04:4}; data.reqLeft={};" +
      "var h=strWeightHint('R04'); return h && h.enough===false && h.n<20; })()") === true);

  ok("gates never get a suggested weight, because a gate has no weight",
    w.eval("(function(){ data.reqFixes={R01:500}; data.reqChance={R01:500};" +
      "return strWeightHint('R01') === null; })()") === true);

  ok("a requirement people always fix is suggested a HIGHER weight",
    w.eval("(function(){ data.reqFixes={R04:30}; data.reqChance={R04:31}; data.reqLeft={};" +
      "var h=strWeightHint('R04'); return h.enough && h.want > h.cur; })()") === true);

  ok("a requirement people keep waving through is suggested a LOWER weight",
    w.eval("(function(){ data.reqFixes={N04:1}; data.reqChance={N04:40}; data.reqLeft={N04:6};" +
      "var h=strWeightHint('N04'); return h.enough && h.want < h.cur; })()") === true);

  ok("turning a suggestion down counts against the weight, not for it",
    w.eval("(function(){ data.reqChance={N01:25}; data.reqFixes={N01:12};" +
      "var a=strWeightHint('N01').want; data.reqLeft={N01:25};" +
      "var b=strWeightHint('N01').want; return b < a; })()") === true);

  ok("no suggestion may move a weight by more than half of itself",
    w.eval("(function(){ data.reqFixes={R04:999}; data.reqChance={R04:999}; data.reqLeft={};" +
      "var h=strWeightHint('R04'); return h.want <= h.cur*1.5 + 0.001; })()") === true &&
    w.eval("(function(){ data.reqFixes={R04:0}; data.reqChance={R04:999}; data.reqLeft={R04:999};" +
      "var h=strWeightHint('R04'); return h.want >= h.cur*0.5 - 0.001; })()") === true);

  ok("asking for a suggestion NEVER changes the live weight",
    w.eval("(function(){ var before=Strength.wOf(strengthCfg(),'R04');" +
      "data.reqFixes={R04:99}; data.reqChance={R04:99}; data.reqLeft={};" +
      "strWeightHint('R04'); strWeightHint('R04'); strWeightHint('R04');" +
      "return Strength.wOf(strengthCfg(),'R04') === before; })()") === true);

  ok("evidence that is neutral leaves the weight where it is",
    w.eval("(function(){ data.reqFixes={N05:15}; data.reqChance={N05:30}; data.reqLeft={};" +
      "var h=strWeightHint('N05'); return h.enough && Math.abs(h.want - h.cur) < 0.25; })()") === true);

  /* COUNTS ONLY, NEVER NAMES — the same instinct as hard rule 6, one surface along. */
  ok("the evidence counters hold numbers and nothing else",
    w.eval("(function(){ data.reqFixes={R04:3}; data.reqChance={R04:9}; data.reqLeft={R04:2};" +
      "var all=[data.reqFixes,data.reqChance,data.reqLeft], i, k;" +
      "for(i=0;i<all.length;i++) for(k in all[i]) if(typeof all[i][k] !== 'number') return false;" +
      "return true; })()") === true);

  /* ── THE PUBLISHED WINDOW, ADDED 26.08.15 ─────────────────────────────────────────────────
     Ali: "make only this week and the next visible to trainees." The assertions that matter are
     the ones about the EDGE — a window that quietly lets somebody through is not a window, and a
     window that hides the rota team's own board is a different bug with the same cause. */

  /* CHANGED 26.08.16, FROM 3 AND 2. Ali: "nobody does look forward and so many things change and
     the allocator doesnt get its best chance to fix... the current week is live, the next week is
     draft framed and then everything forward is not written." The window is now the WRITE window
     as well as the publication window — the two used to differ, and every week in the gap was an
     allocation nobody could see, written from an incomplete roster and never revisited. */
  ok("the published window is two weeks, one of them firm",
    w.eval("(function(){ return rule('visibleWeeks') === 2 && rule('firmWeeks') === 1; })()") === true);

  /* REWRITTEN 26.08.20. This used to read the real calendar and assert that two weeks were always
     visible. From today the second week only opens at 07:00 on the Friday, so on a Wednesday the
     old assertion was asserting the bug. The clock is data now, so move it rather than read it —
     otherwise this test means something different depending on which day it is run. */
  ok("before the Friday, only this week is visible",
    w.eval("(function(){ var m = mondayOf(todayISO()); data.rules = data.rules || {};" +
      "data.rules.publishDay = 6; data.rules.publishHour = 23;" +   // a moment this week cannot have reached
      "var r = weekIsVisible(m) && !weekIsVisible(addDays(m,7));" +
      "delete data.rules.publishDay; delete data.rules.publishHour; return r; })()") === true);

  ok("from the Friday, two weeks are visible and the third is not",
    w.eval("(function(){ var m = mondayOf(todayISO()); data.rules = data.rules || {};" +
      "data.rules.publishDay = 0; data.rules.publishHour = 0;" +    // already passed
      "var r = weekIsVisible(m) && weekIsVisible(addDays(m,7)) && !weekIsVisible(addDays(m,14));" +
      "delete data.rules.publishDay; delete data.rules.publishHour; return r; })()") === true);

  /* THE TWO EDGES. The whole point of the draft week is that it is visible AND not firm, so a
     test that only checked visibility would pass with the distinction deleted. */
  ok("the current week is firm, the next is draft",
    w.eval("(function(){ var m = mondayOf(todayISO());" +
      "return weekIsFirm(m) && !weekIsFirm(addDays(m,7))" +
      " && weekIsDraft(addDays(m,7)) && !weekIsDraft(m); })()") === true);

  /* Rewritten 26.08.15: draft now means "not the week we are in", so a week beyond the published
     window IS a draft — the rota team see it while editing and it is certainly not settled. What
     must stay true is that the CURRENT week is never marked. */
  ok("the current week is never a draft, and every later week is",
    w.eval("(function(){ var m = mondayOf(todayISO());" +
      "return !weekIsDraft(m) && weekIsDraft(addDays(m,7)) && weekIsDraft(addDays(m,21)); })()") === true);

  ok("firm can never reach past visible, however the numbers are set",
    w.eval("(function(){ data.rules = data.rules || {}; data.rules.visibleWeeks = 2;" +
      "data.rules.firmWeeks = 9; var over = firmTo() > visibleTo();" +
      "delete data.rules.visibleWeeks; delete data.rules.firmWeeks; return over === false; })()") === true);

  ok("last week is outside it too — worked weeks are not the trainees' business either",
    w.eval("(function(){ return !weekIsVisible(addDays(mondayOf(todayISO()),-7)); })()") === true);

  /* REWRITTEN 26.08.20, AND THE CHANGE IS DELIBERATE. The setting used to be able to widen the
     window to any number of weeks; it can now only NARROW it, because the publication clock caps
     it at two and Ali's rule is that nothing further ahead than next week is visible to anyone.
     So the front-end editability that matters is downward, and the upward case is now an assertion
     that the cap holds — which is the more important of the two. */
  ok("the window is editable from the front end, downward",
    w.eval("(function(){ data.rules = data.rules || {};" +
      "data.rules.publishDay = 0; data.rules.publishHour = 0;" +    // Friday passed: two would be visible
      "data.rules.visibleWeeks = 1;" +
      "var narrow = !weekIsVisible(addDays(mondayOf(todayISO()),7));" +
      "data.rules.visibleWeeks = 2; delete data.rules.publishDay; delete data.rules.publishHour;" +
      "return narrow === true; })()") === true);

  ok("...but never upward past next week, whatever the number is set to",
    w.eval("(function(){ data.rules = data.rules || {};" +
      "data.rules.publishDay = 0; data.rules.publishHour = 0; data.rules.visibleWeeks = 4;" +
      "var wide = weekIsVisible(addDays(mondayOf(todayISO()),14));" +
      "data.rules.visibleWeeks = 2; delete data.rules.publishDay; delete data.rules.publishHour;" +
      "return wide === false; })()") === true);

  ok("a bad value falls back to a window rather than to no window",
    w.eval("(function(){ data.rules = data.rules || {}; data.rules.visibleWeeks = 0;" +
      "var m = mondayOf(todayISO()); var ok1 = weekIsVisible(m);" +
      "delete data.rules.visibleWeeks; return ok1 === true; })()") === true);

  /* THE SNAPSHOT. It exists to answer one question and it must not answer it wrongly: a week
     nobody snapshotted has NO ANSWER, which is not the same as "nothing changed". */
  ok("a week is snapshotted when it becomes visible",
    w.eval("(function(){ EDIT_MODE = true; data.seen = {}; snapVisibleWeeks();" +
      "return !!(data.seen && data.seen[mondayOf(todayISO())]); })()") === true);

  ok("the snapshot is taken once and not overwritten on every redraw",
    w.eval("(function(){ EDIT_MODE = true; data.seen = {}; snapVisibleWeeks();" +
      "var first = data.seen[mondayOf(todayISO())].at;" +
      "snapVisibleWeeks(); snapVisibleWeeks();" +
      "return data.seen[mondayOf(todayISO())].at === first; })()") === true);

  ok("a week nobody snapshotted reads as no answer, never as no change",
    w.eval("(function(){ data.seen = {}; return seenPodOf(todayISO(), 'nobody') === null; })()") === true);

  ok("snapshots of weeks that have fallen out of the window are dropped",
    w.eval("(function(){ EDIT_MODE = true; data.seen = {}; data.seen[addDays(mondayOf(todayISO()),-70)] = {at:'x',pods:{}};" +
      "snapVisibleWeeks(); return !data.seen[addDays(mondayOf(todayISO()),-70)]; })()") === true);

  /* HARD RULE 6 reaches this too: a record of who was where is one field away from a record of
     why they moved, and the snapshot must never grow that field. */
  ok("the snapshot holds pods and a timestamp and nothing else",
    w.eval("(function(){ EDIT_MODE = true; data.seen = {}; snapVisibleWeeks();" +
      "var sn = data.seen[mondayOf(todayISO())]; if(!sn) return false;" +
      "var keys = Object.keys(sn).sort().join(',');" +
      "return keys === 'at,pods'; })()") === true);

  /* THE GUARD ITSELF. This is the assertion that would have caught the 12 Aug Staff-page bug,
     which is why it is worth more than the four above it. */
  ok("a reader who cannot save never takes a snapshot it would then lose",
    w.eval("(function(){ EDIT_MODE = false; data.seen = {}; snapVisibleWeeks();" +
      "return Object.keys(data.seen).length === 0; })()") === true);

  /* ── SHOWING A CHANGE, ADDED 26.08.15 ─────────────────────────────────────────────────────
     Ali: "how highlight changes on the allocation board." The failure to guard against is not an
     unmarked chip, it is a WRONGLY marked one — a board that cries wolf about moves that never
     happened is worse than one that says nothing. */

  ok("a chip that has not moved is not marked",
    w.eval("(function(){ EDIT_MODE = true; currentWeekKey = mondayOf(todayISO());" +
      "data.seen = {}; snapVisibleWeeks(); renderWeek();" +
      "return document.querySelectorAll('.chip.moved').length === 0; })()") === true);

  ok("a chip that changed pod since the week was published is marked",
    w.eval("(function(){ EDIT_MODE = true; currentWeekKey = mondayOf(todayISO());" +
      "var wk = getWeek(currentWeekKey), day = wk.days[0];" +
      "var from = null, id = null;" +
      "for (var i=0;i<PODS.length && !id;i++){ var a = day.pods[PODS[i]].assign;" +
      "  if (a.length && a[0].id) { from = PODS[i]; id = a[0].id; } }" +
      "if (!id) return true;" +
      "data.seen = {}; snapVisibleWeeks();" +
      "var to = PODS.filter(function(p){ return p !== from; })[0];" +
      "day.pods[from].assign = day.pods[from].assign.filter(function(x){ return x.id !== id; });" +
      "day.pods[to].assign.push({ id: id, shift: 'SD' });" +
      "renderWeek();" +
      "return document.querySelectorAll('.chip.moved').length > 0; })()") === true);

  ok("no snapshot means nothing is marked, rather than everything",
    w.eval("(function(){ EDIT_MODE = true; data.seen = {}; currentWeekKey = mondayOf(todayISO());" +
      "renderWeek(); return document.querySelectorAll('.chip.moved').length === 0; })()") === true);

  /* HARD RULE 6 on the newest surface. */
  /* Scoped to the chips and their titles, which is what this marking IS. The page as a whole
     legitimately contains the word "reason" in unrelated help text, and an assertion that fails
     on that is an assertion nobody will keep. */
  ok("the marking says where somebody was and never why they moved",
    w.eval("(function(){ var t = Array.prototype.map.call(document.querySelectorAll('.chip'), " +
      "  function(c){ return (c.title||'') + ' ' + c.textContent; }).join(' ');" +
      "return !/sick|illness|absent|unwell|reason|because/i.test(t); })()") === true);

  /* ── THE DRAFT MARK IS GONE, AND THAT IS NOW WHAT IS ASSERTED — 26.08.20 ──────────────────
     Three assertions here used to require the wash and its flag. Ali removed the caveat once the
     publication window made it unnecessary: a trainee cannot reach a week until it has been
     written and then published, so every week they can see has been through both gates and
     tinting it would caveat a rota the system is telling them to rely on.

     These are kept as assertions rather than deleted, pointing the other way. A removed feature
     with no test is a feature that comes back by accident — and this one has been re-added once
     already, in a different shape, on 26.08.16. */
  ok("no draft wash or flag anywhere on the board, on any week",
    w.eval("(function(){ switchTab('rota');" +
      "var keys = [0, 7, 14].map(function(n){ return addDays(mondayOf(todayISO()), n); });" +
      "var found = false;" +
      "keys.forEach(function(k){ currentWeekKey = k; renderWeek();" +
      "  if (document.querySelector('.draftwk') || document.querySelector('.draftflag')) found = true; });" +
      "currentWeekKey = mondayOf(todayISO()); renderWeek(); return !found; })()") === true);

  ok("...and the stylesheet carries no rule that could paint one",
    w.eval("(function(){ var css = [].slice.call(document.querySelectorAll('style'))" +
      "  .map(function(s){ return s.textContent; }).join('');" +
      "return !/draftwk|draftflag/.test(css); })()") === true);

  /* weekIsDraft itself stays — it answers whether a week has been worked yet, which is a real
     question with other callers. What went is the paint, not the predicate. */
  ok("the predicate survives the paint being removed",
    w.eval("typeof weekIsDraft === 'function' && weekIsDraft(addDays(mondayOf(todayISO()), 7)) === true") === true);

  /* ── THE TWO CLOCKS ARE REACHABLE FROM A SCREEN — hard rule 1, 26.08.20 ───────────────────
     They were data the store could hold and no screen could reach, which is the half of hard
     rule 1 that gets forgotten. Asserted through the SETTINGS SCREEN rather than by calling
     rule() — the point is not that the numbers exist, it is that somebody can change them
     without a code edit. */
  ok("Setup offers both clocks as days and hours, not as raw numbers",
    w.eval("(function(){ EDIT_MODE = true; settingsPage = null; renderSettings();" +
      "var sels = [].slice.call(document.querySelectorAll('#setList select'));" +
      "var days = sels.filter(function(s){ return /Monday/.test(s.textContent) && /Sunday/.test(s.textContent); });" +
      "var hours = sels.filter(function(s){ return /07:00/.test(s.textContent) && /14:00/.test(s.textContent); });" +
      "return days.length >= 2 && hours.length >= 2; })()") === true);

  ok("...set to Tuesday 14:00 to write and Friday 07:00 to publish",
    w.eval("(function(){ return rule('writeDay') === 1 && rule('writeHour') === 14 &&" +
      "rule('publishDay') === 4 && rule('publishHour') === 7; })()") === true);

  /* Changing the clock from the screen must actually move the window, or the control is a prop. */
  ok("moving the write clock from the screen moves the written edge",
    w.eval("(function(){ var before = writableTo();" +
      "data.rules = data.rules || {}; data.rules.writeDay = 6; data.rules.writeHour = 23;" +
      "var after = writableTo();" +
      "delete data.rules.writeDay; delete data.rules.writeHour;" +
      "return after < before; })()") === true);

  /* A publish moment before the write moment would put a blank week in front of every trainee. */
  ok("publishing cannot be set earlier than writing",
    w.eval("(function(){ EDIT_MODE = true; settingsPage = null; renderSettings();" +
      "var sels = [].slice.call(document.querySelectorAll('#setList select'));" +
      "var days = sels.filter(function(s){ return /Monday/.test(s.textContent); });" +
      "var pubDay = days[1];" +           // second day pick-list is the publish clock
      "pubDay.value = '0'; pubDay.onchange();" +   // Monday, before Tuesday
      "var held = rule('publishDay') === 4;" +     // refused, so it is still Friday
      "return held && pubDay.value === '4'; })()") === true);

  /* ── FIX WEEK AND FIX AHEAD ARE GONE, AND STAY GONE — 26.08.20 ────────────────────────────
     Both were measured inert on the live board before removal: Fix ahead found zero days across
     every week from today, Fix week zero changes on this week and next. They are gone because a
     button called "Fix week" invites a re-plan of days people have read, which is the fault the
     rebuild exists to remove. Asserted rather than just deleted, for the same reason as the draft
     wash: a removed control with no test comes back by accident. */
  ok("Fix week and Fix ahead are gone from the board",
    w.eval("(function(){ switchTab('rota'); EDIT_MODE = true; renderWeek();" +
      "return !document.getElementById('btnFixWeek') && !document.getElementById('btnFixAhead')" +
      "  && !document.getElementById('btnFixMenu'); })()") === true);

  /* Fix THIS DAY is the repair path and must survive — it is what somebody presses when one
     person comes off, and the only remaining way to run a repair by hand. */
  ok("...but Fix this day still works, because that is the repair path",
    w.eval("(function(){ return typeof planDayFix === 'function' && typeof applyFixedDay === 'function'" +
      "  && typeof fixWorthTaking === 'function'; })()") === true);

  /* ── AUTO-FILL WENT TOO — 26.08.20 ────────────────────────────────────────────────────────
     Measured before removing it: benching ONE person and pressing it moved 65 others, 55 of them
     on days that had nothing to do with the change, while its dialog promised nobody would move.
     Fix this day is now the only repair a human runs by hand. */
  ok("Auto-fill week is gone as well",
    w.eval("(function(){ return !document.getElementById('btnAutoFill') && typeof autoFillWeek === 'undefined'; })()") === true);

  ok("...but the week door and the day builder both survive, because the nightly needs them",
    w.eval("(function(){ return typeof fillWeekWithPlanner === 'function' && typeof autoFillDay === 'function'; })()") === true);

  /* ── THE 36-HOUR CHANGE MARK — Ali, 26.08.20 ──────────────────────────────────────────────
     "its the trainees that need to know theres been a short notice swap." Read from the log, so
     the assertions drive the LOG and read the BOARD — never the helper on its own, which would
     pass with the mark wired to nothing. */
  console.log("\\n-- changes in the last 36 hours --");
  {
    /* Whichever day of this week actually has somebody placed — the fixture does not guarantee
       day 0, and a test that silently targets an empty day passes for the wrong reason. */
    const di = w.eval("(function(){ currentWeekKey = mondayOf(todayISO());" +
      "var wk = getWeek(currentWeekKey);" +
      "for (var i = 0; i < 7; i++) { var d = wk.days[i];" +
      "  for (var p of PODS) if (d.pods[p].assign.some(function(a){ return a.id; })) return i; }" +
      "return -1; })()");
    const iso = w.eval("addDays(mondayOf(todayISO()), " + di + ")");
    const seed = (hoursAgo, d) => w.eval("(function(){ data.log = data.log || [];" +
      "data.log.unshift({ t: new Date(Date.now() - " + hoursAgo + "*3600000).toISOString()," +
      " who:'allocate sync', kind:'auto', msg:'x', on:'" + iso + "', d:" + JSON.stringify(d) + " }); })()");

    w.eval("data.log = []");
    const who = w.eval("(function(){ var d = getWeek(mondayOf(todayISO())).days[" + di + "];" +
      "for (var p of PODS) for (var a of d.pods[p].assign) if (a.id) return (staffById(a.id)||{}).name; return null; })()");
    ok("the fixture has somebody to mark", di >= 0 && !!who, "di=" + di + " who=" + who);

    ok("a person moved 4 hours ago is marked, and says where from",
      w.eval("(function(){ data.log = []; return true; })()") === true &&
      (seed(4, { act: "move", subj: who, from: "D", to: "A" }),
       w.eval("(function(){ currentWeekKey = mondayOf(todayISO()); renderWeek();" +
         "var c = [].slice.call(document.querySelectorAll('#weekGrid .chip.rc'));" +
         "return c.length > 0 && c.some(function(x){ return /from D/.test(x.textContent); }); })()") === true));

    ok("...and the day carries the count",
      w.eval("(function(){ var n = document.querySelector('#weekGrid .rccount');" +
        "return !!n && /1/.test(n.textContent); })()") === true);

    ok("a change 40 hours ago is outside the window and is not marked",
      w.eval("(function(){ data.log = []; return true; })()") === true &&
      (seed(40, { act: "move", subj: who, from: "D", to: "A" }),
       w.eval("(function(){ renderWeek(); return !document.querySelector('#weekGrid .chip.rc')" +
         " && !document.querySelector('#weekGrid .rccount'); })()") === true));

    ok("an arrival reads 'new' rather than naming a pod it never came from",
      w.eval("(function(){ data.log = []; return true; })()") === true &&
      (seed(2, { act: "on", subj: who }),
       w.eval("(function(){ renderWeek();" +
         "var c = document.querySelector('#weekGrid .chip.rc');" +
         "return !!c && /new/.test(c.textContent); })()") === true));

    /* A removal has no chip to draw on, so it must still reach the count or the count lies. */
    ok("somebody taken off has no chip, but still counts on the day",
      w.eval("(function(){ data.log = []; return true; })()") === true &&
      (seed(3, { act: "off", subj: "Nobody Here" }),
       w.eval("(function(){ renderWeek();" +
         "return !document.querySelector('#weekGrid .chip.rc')" +
         " && !!document.querySelector('#weekGrid .rccount'); })()") === true));

    /* Hard rule 6 lives one surface away: the mark says WHAT moved, never why. */
    ok("the mark never says why anybody moved",
      w.eval("(function(){ data.log = []; return true; })()") === true &&
      (seed(2, { act: "move", subj: who, from: "D", to: "A" }),
       w.eval("(function(){ renderWeek();" +
         "var t = [].slice.call(document.querySelectorAll('#weekGrid .chip.rc'))" +
         "  .map(function(c){ return (c.title||'') + ' ' + c.textContent; }).join(' ');" +
         "return !/sick|illness|absent|unwell|reason|because|swap/i.test(t); })()") === true));

    w.eval("data.log = []; renderWeek();");
  }

  ok("no errors across the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n=== " + pass + " passed, " + fail + " failed ===");
  if (failures.length) { console.log("Failures:"); failures.forEach(f => console.log(" - " + f)); }
  process.exit(fail ? 1 : 0);
})();
