/*
 * Consultant page test suite
 * --------------------------
 * The consultant page had no tests at all, and every defect found on 30–31 July was the same
 * shape: a rule enforced in index.html and not here. These assertions cover the things that
 * actually went wrong, plus the hard rules this page is capable of breaking.
 *
 * Rewritten 3 Aug 2026 for the separated consultant store. Two things moved:
 *   - the consultant rota now lives in the CONSULTANT store (cdata.consRota), reached through
 *     CR(), not in the resident board's pod-data.json;
 *   - the page has no SAVE key at all, so it is structurally incapable of writing pod-data.json.
 * The fixture therefore serves two different files behind two different flows, and the suite
 * asserts the separation itself — see "The page cannot write the resident board" below, which
 * is the test that would have caught the bug this whole refactor exists to prevent.
 *
 * Run:  node tests/consultant-tests.js      (needs jsdom — npm i jsdom)
 * Exit code 0 = all pass, 1 = one or more failures.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const PAGE = path.join(__dirname, "..", "consultants.html");
const RESIDENT = path.join(__dirname, "..", "index.html");
const CORE_CSS = path.join(__dirname, "..", "core.css");
const CORE_JS = path.join(__dirname, "..", "core.js");

const LIVE = "https://rota.salford.icu/consultants.html";
const TEST = "https://alistaircranfield.github.io/pod-staging/consultants.html";

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("  ✗ " + name + (detail ? " — " + detail : "")); }
}

// ---- a small but realistic rota -------------------------------------------------------------
const MON = (() => { const d = new Date(); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return d.toISOString().slice(0,10); })();
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); };

function fakeConsRota() {
  const days = {};
  for (let i = 0; i < 7; i++) {
    const cur = { A:"TF", B:"MG", C:"WH", D:"AB", E:"CMAB", oncall:"NJC", cod:"CMAB", fgh:"", wkend:i>4, fin: i === 0 ? { TF:"18:00" } : {} };
    days[addDays(MON, i)] = { auto: JSON.parse(JSON.stringify(cur)), cur, note: "" };
  }
  // one day deliberately absent from consRota — the page must not fall over
  delete days[addDays(MON, 3)];
  return { days, map: { TF:"Fudge", MG:"Ghrew", WH:"Habeichi", AB:"Baiou", CMAB:"Booth", NJC:"Coffin" }, fair:{}, window:{} };
}

/* The resident board. It no longer carries consRota: that is the whole point of the separation,
   so the fixture must not quietly hand the page the thing it is supposed to have stopped using. */
function fakeRota(extra) {
  return Object.assign({
    version: 1,
    staff: [
      { id:"s1", name:"Test Consultant", grade:"CON", active:true, aliases:[] },
      { id:"s2", name:"Test Resident", grade:"ST", active:true, aliases:[] }
    ],
    weeks: { [MON]: { roster: {}, days: Array.from({length:7}, (_, di) => ({ pods:{A:{assign: di === 0 ? [{id:"s2",shift:"LD"}] : []},B:{assign:[]},C:{assign:[]},D:{assign:[]},E:{assign:[]}}, night:{AB:[],CDE:[],super:[],phone:null}, extras:[], phone:null, shadow:[] })) } },
    log: []
  }, extra || {});
}

/* The consultant store: personal data the resident link can never reach, and now the rota too. */
function fakeStore(extra) {
  return Object.assign({
    v: 1, adminPin: "", rotaPin: "", pins: {}, admins: ["AJC"],
    jobPlans: {}, skills: {}, tariff: {}, log: [],
    consRota: fakeConsRota()
  }, extra || {});
}

// ---- load the page under controlled conditions ----------------------------------------------
/* opts.store === null loads the page with the consultant store unreachable (CREAD unset), which
   is the state every browser is in until the store link has been used once. */
function loadPage({ url, testMode, keys, localKeys, resident, store }) {
  let html = fs.readFileSync(PAGE, "utf8");
  /* jsdom won't fetch external scripts, but the real page always loads core.js — and since the
     change-log reader moved in there, pretending it's absent tests a page that doesn't exist.
     Inline it so the fixture matches what a browser actually runs. */
  html = html.replace(/<script src="core\.js[^"]*"><\/script>/,
    "<script>" + fs.readFileSync(CORE_JS, "utf8") + "</script>");
  const posts = [];      // writes that reached the RESIDENT save flow — must always stay empty
  const cposts = [];     // writes that reached the CONSULTANT save flow
  const hook = `window.__api = function(){ return {
    get data(){ return data; }, applyEdit, applySwap, postLive, rowLabel, weeksAvail,
    TESTMODE, READ, CREAD, CSAVE,
    hasSaveKey: (typeof SAVE !== "undefined"),
    get consRota(){ return CR(); },
    get cdata(){ return cdata; }, setCdata: v => { cdata = v; },
    setJun: v => { showJun = v; }, renderRota, renderAll, setCurWeek: k => { curWeek = k; },
    applyFinSwap: typeof applyFinSwap !== "undefined" ? applyFinSwap : null,
    profileFor: typeof profileFor !== "undefined" ? profileFor : null }; };`;
  html = html.replace("load().catch(", hook + "\nload().catch(");

  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url,
    beforeParse(w) {
      w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.scrollTo = () => {}; w.requestAnimationFrame = cb => setTimeout(cb, 0);
      w.HTMLElement.prototype.scrollIntoView = () => {};
      // core.js is an external file jsdom won't fetch; it is the thing that sets this flag.
      if (testMode) w.__POD_TEST = true;
      if (keys) w.__POD_KEYS = keys;
      if (localKeys) { try { for (const k in localKeys) w.localStorage.setItem(k, localKeys[k]); } catch(e){} }
      try { w.localStorage.setItem("consEditor", "AJC"); } catch(e){}
      /* Routing matters here: "cread"/"csave" also match /read/ and /save/, so the consultant
         flows are tested for FIRST. Getting this the wrong way round would serve the resident
         board as the consultant store and hide exactly the bug the suite is looking for. */
      w.fetch = (u, opt) => {
        const target = String(u);
        const isPost = opt && String(opt.method).toUpperCase() === "POST";
        if (/csave/i.test(target)) { if (isPost) cposts.push(target); return Promise.resolve({ ok:true, text:()=>Promise.resolve("") }); }
        if (/cread/i.test(target)) {
          if (store === null) return Promise.reject(new Error("consultant store unreachable"));
          return Promise.resolve({ ok:true, json:()=>Promise.resolve(store || fakeStore()), text:()=>Promise.resolve("{}") });
        }
        if (/save/i.test(target)) { if (isPost) posts.push(target); return Promise.resolve({ ok:true, text:()=>Promise.resolve("") }); }
        if (/read/i.test(target)) {
          return Promise.resolve({ ok:true, json:()=>Promise.resolve(resident || fakeRota()), text:()=>Promise.resolve("{}") });
        }
        return Promise.reject(new Error("unexpected fetch: " + target));
      };
    }
  });
  return new Promise(res => setTimeout(() => res({ api: dom.window.__api && dom.window.__api(), win: dom.window, posts, cposts }), 700));
}

const KEYS = { r:"https://flow/read", s:"https://flow/save", cr:"https://flow/cread", cs:"https://flow/csave" };

(async () => {
  console.log("\n=== Consultant page suite ===\n");

  // 0) THE SEPARATION ---------------------------------------------------------------------
  /* This section is the reason the suite was rewritten. The consultant page used to post the
     whole of pod-data.json on every save, from a stale copy read at page load — so two people
     with the page open could silently wipe each other's resident board. The fix was not to be
     more careful about when it writes; it was to take the key away, so the write is impossible
     to express. These assertions hold that door shut. */
  console.log("The page cannot write the resident board");
  {
    const src = fs.readFileSync(PAGE, "utf8");
    ok("the source never declares a resident SAVE key", !/\b(const|let|var)\s+SAVE\b/.test(src),
      (src.match(/\b(const|let|var)\s+SAVE\b.*/) || [""])[0]);
    ok("nothing is ever posted to SAVE", !/postLive\(\s*SAVE\b/.test(src) && !/fetch\(\s*SAVE\b/.test(src));
    const boot = await loadPage({ url: LIVE, testMode: false, keys: KEYS });
    ok("the running page has no SAVE binding at all", boot.api.hasSaveKey === false);

    // ...and behaviourally: exercise every writer on the LIVE host and watch the resident flow.
    const { api, posts, cposts } = await loadPage({ url: LIVE, testMode: false, keys: KEYS });
    /* Order matters: the finish swap trades the times held against two NAMES, so it has to run
       before the edit renames one of them, or it is a no-op and this proves nothing. */
    await api.applyFinSwap(MON, "A", "B");
    await api.applyEdit(addDays(MON, 1), "A", "ZZ");
    await api.applySwap(addDays(MON, 2), "C", "D");
    ok("after a finish swap, an edit and a pod swap the resident flow has had nothing", posts.length === 0,
      posts.length + " posts to the resident save flow");
    ok("all three writes went to the consultant store instead", cposts.length === 3, cposts.length + " posts to CSAVE");

    // the link the admin panel builds must not hand the resident save key on either
    const linkLine = (src.match(/"#r=".*/) || [""])[0];
    ok("the shareable link carries no resident save key", !/&s=/.test(linkLine), linkLine.slice(0, 140));
  }

  console.log("The rota is read from the consultant store, not the resident board");
  {
    const { api } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    ok("CR() resolves to the store's copy", !!api.consRota && !!api.consRota.days[MON]);
    ok("the store is where it came from", api.cdata.consRota === api.consRota);
    ok("the resident board is not carrying one", !api.data.consRota);

    // a stale consRota still sitting in pod-data.json must be ignored, not preferred
    const decoy = fakeConsRota(); decoy.days[MON].cur.A = "DECOY";
    const b = await loadPage({ url: TEST, testMode: true, keys: KEYS, resident: fakeRota({ consRota: decoy }) });
    ok("a leftover consRota in pod-data.json is ignored", b.api.consRota.days[MON].cur.A === "TF",
      b.api.consRota.days[MON].cur.A);
  }

  console.log("With no consultant store connected the page changes nothing");
  {
    const { api, posts, cposts } = await loadPage({ url: LIVE, testMode: false, keys: { r: KEYS.r }, store: null });
    ok("the page still loads the resident data", !!api.data && !!api.data.staff);
    ok("there is no rota to show", !api.consRota);
    const before = JSON.stringify(api.cdata);
    await api.applyEdit(MON, "A", "ZZ");
    ok("an edit is refused rather than half-applied", JSON.stringify(api.cdata) === before);
    ok("and nothing was posted anywhere", posts.length === 0 && cposts.length === 0,
      posts.length + " resident, " + cposts.length + " consultant");
  }

  // 1) THE WRITE GATE ---------------------------------------------------------------------
  console.log("Never writes to the live rota from a test host");
  {
    const { api, posts, cposts } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    ok("page booted in test mode", api && api.TESTMODE === true, "TESTMODE=" + (api && api.TESTMODE));
    const day = addDays(MON, 0);
    await api.applyEdit(day, "A", "ZZ");
    ok("an edit posts nothing to either save flow", posts.length === 0 && cposts.length === 0,
      posts.length + " resident, " + cposts.length + " consultant");
    await api.applySwap(day, "A", "B");
    ok("a swap posts nothing to either save flow", posts.length === 0 && cposts.length === 0,
      posts.length + " resident, " + cposts.length + " consultant");
    ok("the edit still took effect locally", api.consRota.days[day].cur.A !== "TF");
  }

  // 2) ...but it DOES write when it is the live site --------------------------------------
  console.log("Writes normally on the live host");
  {
    const { api, posts, cposts } = await loadPage({ url: LIVE, testMode: false, keys: KEYS });
    ok("page booted in live mode", api && api.TESTMODE === false, "TESTMODE=" + (api && api.TESTMODE));
    await api.applyEdit(addDays(MON, 0), "A", "ZZ");
    ok("an edit posts exactly once to the consultant save flow", cposts.length === 1, cposts.length + " posts");
    ok("and never to the resident one", posts.length === 0, posts.length + " posts");
  }

  // 3) HARD RULE 7 — a swap exchanges two people, it never introduces a third --------------
  console.log("Hard rule 7 — nothing is added to a shift after the four-monthly write");
  {
    const { api } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    const day = addDays(MON, 0);
    const before = Object.assign({}, api.consRota.days[day].cur);
    const peopleBefore = ["A","B","C","D","E","oncall","cod"].map(k => before[k]).filter(Boolean).sort().join(",");
    await api.applySwap(day, "A", "B");
    const after = api.consRota.days[day].cur;
    const peopleAfter = ["A","B","C","D","E","oncall","cod"].map(k => after[k]).filter(Boolean).sort().join(",");
    ok("the same people are on the day after a swap", peopleBefore === peopleAfter, peopleBefore + " → " + peopleAfter);
    ok("the two pods actually exchanged", after.A === before.B && after.B === before.A);
    await api.applySwap(day, "A", "A");
    ok("swapping a pod with itself does nothing", api.consRota.days[day].cur.A === after.A);
  }

  // 4) HARD RULE 3 — everything logged -----------------------------------------------------
  /* The log moved into the consultant store with everything else. That is not just tidiness:
     while the log lived in the file the page was overwriting, a lost update erased the evidence
     of itself. It is also displayed for the first time — eight call sites wrote to it and no
     screen showed it. */
  console.log("Hard rule 3 — every change is logged, in the consultant store");
  {
    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    const day = addDays(MON, 1);
    const n0 = api.cdata.log.length;
    await api.applyEdit(day, "C", "QQ");
    ok("an edit adds a log entry", api.cdata.log.length === n0 + 1);
    ok("the resident board's log is untouched", api.data.log.length === 0, api.data.log.length + " entries");
    const e = api.cdata.log[0] || {};
    ok("the entry names who made it", /AJC/.test(e.who || ""), JSON.stringify(e.who));
    ok("the entry names the day and the change", (e.msg||"").includes(day) && (e.msg||"").includes("QQ"), e.msg);
    await api.applySwap(day, "A", "B");
    ok("a swap adds its own log entry", api.cdata.log.length === n0 + 2);
    ok("an edit that changes nothing is not logged", await (async () => {
      const before = api.cdata.log.length;
      await api.applyEdit(day, "C", "QQ");            // same value again
      return api.cdata.log.length === before;
    })());
    api.renderAll();
    ok("the Log tab shows the entries", /QQ/.test(win.document.querySelector("#logBox").textContent),
      win.document.querySelector("#logBox").textContent.slice(0, 80));
    // the store must not grow without bound
    api.cdata.log = Array.from({length: 300}, (_, i) => ({ t:new Date().toISOString(), who:"AJC", msg:"consultant filler " + i }));
    await api.applyEdit(day, "C", "RR");
    ok("the log is capped at 300 entries", api.cdata.log.length === 300, api.cdata.log.length + " entries");
    ok("and it is the newest that survives", /RR/.test(api.cdata.log[0].msg), api.cdata.log[0].msg);
  }

  // 5) KEY RESOLUTION — the reason the page was blank on staging ---------------------------
  console.log("Key resolution");
  {
    const a = await loadPage({ url: TEST, testMode: true, keys: null,
      localKeys: { podR:"https://flow/read", podCR:"https://flow/cread", podCS:"https://flow/csave" } });
    ok("falls back to the keys cached in this browser", !!(a.api && a.api.READ), "READ=" + (a.api && a.api.READ));
    ok("and loads its data with them", !!(a.api && a.api.data && a.api.data.staff), "data " + (a.api && a.api.data ? "loaded" : "missing"));
    ok("including the consultant store", !!(a.api && a.api.consRota));

    const b = await loadPage({ url: TEST, testMode: true, keys: KEYS, localKeys: { podR:"https://flow/WRONG" } });
    ok("k.js beats the cached copy", b.api.READ === KEYS.r, b.api.READ);
  }

  // 6) DOESN'T FALL OVER ON A GAP ----------------------------------------------------------
  console.log("Robustness");
  {
    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    const missing = addDays(MON, 3);                  // deliberately absent from consRota
    ok("a day with no consultant rota does not throw", !api.consRota.days[missing]);
    let threw = null;
    try { await api.applySwap(missing, "A", "B"); } catch(e){ threw = e.message; }
    ok("swapping on a missing day is a no-op, not a crash", threw === null, threw);
    ok("the week grid rendered", !!win.document.querySelector("#weekGrid"));
  }

  // 7) STRUCTURAL — the shared files stay shared -------------------------------------------

  console.log("Finish-time pill (job b)");
  {
    const { api, win, posts, cposts } = await loadPage({ url: LIVE, testMode: false, keys: KEYS });
    const pill = win.document.querySelector("#weekGrid .finpill");
    ok("an 18:00 finish is a pill in the cell", !!pill, "no .finpill");
    ok("the pill is draggable like COD", !!pill && pill.getAttribute("draggable") === "true");
    ok("17:00 finishes are not drawn at all", win.document.querySelectorAll("#weekGrid .finpill").length === 1,
      win.document.querySelectorAll("#weekGrid .finpill").length + " pills");
    ok("initials lead every cell at the shared inset — no badge slot before them",
      [...win.document.querySelectorAll("#weekGrid td[data-pod] .cellwrap")].every(w => w.firstElementChild && w.firstElementChild.classList.contains("cell")));
    const codGhost = win.document.querySelector("#weekGrid .codpill");
    ok("COD is a ghost pill after the name, still draggable", !!codGhost &&
      codGhost.previousElementSibling && codGhost.previousElementSibling.classList.contains("cell") &&
      codGhost.getAttribute("draggable") === "true");
    ok("applyFinSwap exists", typeof api.applyFinSwap === "function");
    if (typeof api.applyFinSwap === "function") {
      const day = MON;
      const before = JSON.parse(JSON.stringify(api.consRota.days[day].cur));
      const n0 = cposts.length, l0 = api.cdata.log.length;
      await api.applyFinSwap(day, "A", "B");
      const after = api.consRota.days[day].cur;
      ok("a fin swap moves the finish time, not the people",
        after.A === before.A && after.B === before.B && (after.fin.MG || "") === "18:00" && !(after.fin.TF),
        JSON.stringify(after.fin));
      ok("a fin swap saves once to the consultant store and is logged",
        cposts.length === n0 + 1 && api.cdata.log.length === l0 + 1,
        (cposts.length - n0) + " posts, " + (api.cdata.log.length - l0) + " log entries");
      ok("and still nothing to the resident board", posts.length === 0, posts.length + " posts");
      const l1 = api.cdata.log.length;
      await api.applyFinSwap(day, "A", "fgh");   // nobody on Fairfield that day
      ok("a fin swap onto an empty slot is a no-op", api.cdata.log.length === l1);
    }
  }

  console.log("Hover card (job c)");
  {
    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    ok("profileFor exists", typeof api.profileFor === "function");
    if (typeof api.profileFor === "function") {
      api.cdata.profiles = { s2: { about: "Keen on echo", supervisor: "TF" } };
      const p = api.profileFor("s2");
      ok("profileFor merges the staff record with the stored profile",
        !!p && p.name === "Test Resident" && p.grade === "ST" && p.about === "Keen on echo",
        JSON.stringify(p));
      ok("the educational supervisor is resolved to a name, not initials", !!p && /Fudge/.test(p.supervisorName || ""), p && p.supervisorName);
      api.setJun(true); api.renderRota();
      const pill = win.document.querySelector("#weekGrid .rpill[data-rid='s2']");
      ok("a resident pill carries its profile hook", !!pill, "no .rpill[data-rid]");
      if (pill) {
        pill.dispatchEvent(new win.Event("mouseenter", { bubbles: false }));
        const card = win.document.querySelector("#hovercard");
        ok("hovering shows the card with the resident's details",
          !!card && card.style.display !== "none" && /Test Resident/.test(card.textContent) && /Keen on echo/.test(card.textContent),
          card ? card.textContent.slice(0, 80) : "no card");
        pill.dispatchEvent(new win.Event("mouseleave", { bubbles: false }));
        ok("leaving hides it", card.style.display === "none");
      }
    }
  }

  console.log("Shield + rota-team gate (job f)");
  {
    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    ok("the rail carries only Pods and the resident shield",
      !!win.document.querySelector("aside #btnTeam") &&
      !win.document.querySelector("aside button[data-tab='fair']") &&
      !win.document.querySelector("aside button[data-tab='log']") &&
      !win.document.querySelector("aside button[data-tab='admin']"));
    // no password set: the shield opens the inset menu straight onto Fairness
    win.document.querySelector("#btnTeam").click();
    ok("no password set: shield opens the inset menu",
      win.document.body.classList.contains("teamopen") &&
      win.document.querySelectorAll("#teamPanel .tpi").length === 3 &&
      win.document.querySelector("#tab-fair").style.display !== "none");
    win.document.querySelector("#tpBack").click();
    ok("Menu goes back to Pods", !win.document.body.classList.contains("teamopen") &&
      win.document.querySelector("#tab-rota").style.display !== "none");
    // with the rota-team password set, the shield asks for it first
    api.data.staffPw = "0123456789abcdef";
    win.sessionStorage.removeItem("consTeamUnlocked");
    win.document.querySelector("#btnTeam").click();
    ok("password set: the shield shows the gate, not the menu",
      !!win.document.querySelector("#whoOverlay") && !win.document.body.classList.contains("teamopen"));
  }

  console.log("Four-week publication window");
  {
    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    const far = addDays(MON, 42);                                      // six weeks out
    const full = { A:"TF",B:"MG",C:"WH",D:"AB",E:"CMAB",oncall:"NJC",cod:"CMAB",fgh:"",wkend:false,fin:{} };
    api.consRota.days[far] = { auto: Object.assign({}, full), cur: Object.assign({}, full) };
    api.data.staffPw = "0123456789abcdef";                             // a password exists, viewer not unlocked
    win.sessionStorage.removeItem("consTeamUnlocked");
    api.setCurWeek(addDays(MON, 42)); api.renderRota();
    const txt = win.document.querySelector("td[data-pod='A'][data-date='" + far + "']");
    ok("beyond four weeks the grid shows nothing, even when data exists",
      !!txt && !/TF/.test(txt.textContent) && /—/.test(txt.textContent), txt && txt.textContent.trim());
    ok("unpublished cells are not editable", !txt.querySelector(".cell[data-d]"));
    win.sessionStorage.setItem("consTeamUnlocked", "1"); api.renderRota();
    ok("the rota team sees the whole horizon once through the shield",
      /TF/.test(win.document.querySelector("td[data-pod='A'][data-date='" + far + "']").textContent));
    win.sessionStorage.removeItem("consTeamUnlocked");
    api.setCurWeek(MON); api.renderRota();
    ok("inside four weeks the grid shows the allocation",
      /TF/.test(win.document.querySelector("td[data-pod='A'][data-date='" + MON + "']").textContent));
  }

  console.log("Combined fairness page");
  {
    const { win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    ok("the Totals tab is gone — one combined page", !win.document.querySelector("#tab-staff") && !win.document.querySelector("aside button[data-tab='staff']"));
    const heads = [...win.document.querySelectorAll("#fairBox table.fair th")].map(x => x.textContent.trim());
    ok("fairness table carries A&B, C&D, % neuro AND the staffing counts",
      ["A&B","C&D","% neuro","Pods/wk","On call","COD","Fairfield"].every(k => heads.some(hh => hh.includes(k))), heads.join(" | "));
    ok("it wears the resident table's colour language", !!win.document.querySelector("#fairBox .dot"));
    ok("My figures buttons appear once the store is connected", !!win.document.querySelector("#fairBox .mybtn"));
    const b = await loadPage({ url: TEST, testMode: true, keys: { r: KEYS.r }, store: null });
    ok("and not when it isn't", !b.win.document.querySelector("#fairBox .mybtn"));
  }

  console.log("Transposed grid (job d)");
  {
    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    const ths = [...win.document.querySelectorAll("#weekGrid table.rota tr:first-child th")].map(x => x.textContent.trim());
    ok("pods run across the top", ["A","B","C","D","E"].every(p => ths.some(h => h.startsWith("Pod " + p))), ths.join(" | "));
    const podth = win.document.querySelector("#weekGrid th.podth");
    ok("each pod column wears the resident board's solid colour bar",
      !!podth && /var\(--pod[A-E]b\)/.test(podth.getAttribute("style") || ""), podth && podth.getAttribute("style"));
    const a = win.document.querySelector("td[data-pod='A'][data-date='" + MON + "']");
    const e = win.document.querySelector("td[data-pod='E'][data-date='" + MON + "']");
    ok("a day is one row with every pod on it", !!a && !!e && a.parentElement === e.parentElement);
    api.setJun(true); api.renderRota();
    const a2 = win.document.querySelector("td[data-pod='A'][data-date='" + MON + "']");
    ok("residents sit inside their pod's cell when shown", !!a2 && !!a2.querySelector(".rpill"),
      a2 ? a2.innerHTML.slice(0, 120) : "no cell");
  }

  console.log("Shared code stays shared");
  {
    const cons = fs.readFileSync(PAGE, "utf8");
    const res = fs.readFileSync(RESIDENT, "utf8");
    const core = fs.existsSync(CORE_CSS) ? fs.readFileSync(CORE_CSS, "utf8") : "";
    ok("core.css defines the pod palette", /--podA:/.test(core));
    ok("the consultant page does not redefine it", !/--podA:/.test(cons));
    ok("the resident page does not redefine it", !/--podA:/.test(res));
    ok("both pages load core.css", /core\.css/.test(cons) && /core\.css/.test(res));
    ok("both pages load core.js", /core\.js/.test(cons) && /core\.js/.test(res));
    ok("no raw fetch to a save flow outside postLive", (cons.match(/fetch\(\s*C?SAVE/g) || []).length === 0,
       (cons.match(/fetch\(\s*C?SAVE/g) || []).join(", "));
  }

  /* ── The change log ────────────────────────────────────────────────────────────────────────
     Two things are being protected here. First, that an entry says WHEN it was made, WHICH rota
     day it changed, and WHO decided — three separate facts that used to be one. Second, that the
     months of entries written before any of that existed still read correctly and are never
     rewritten. A migration that quietly restamps history would be worse than the original gap. */
  console.log("The change log — one shape, read two ways");
  {
    const core = fs.readFileSync(CORE_JS, "utf8");
    const sandbox = { window: {}, document: { addEventListener(){} }, location: { protocol: "https:", hostname: "x" } };
    /* Missing readers must show up as failed assertions, not as a crashed suite — a suite that
       dies on the first gap tells you nothing about the other twenty. */
    try {
      new Function("window", "document", "location",
        core + "\nwindow.__log = { groupLog, logKind, logOn, logMade, logDayLabel };")
        (sandbox.window, sandbox.document, sandbox.location);
    } catch (e) { /* reported by every assertion below */ }
    const miss = () => { throw new Error("core.js has no change-log reader"); };
    const L = sandbox.window.__log ||
      { groupLog: miss, logKind: miss, logOn: miss, logMade: miss, logDayLabel: miss };
    /* Any reader that is absent throws; catch it once here so the whole section reports as
       failures. Proven to have teeth by running this file against the pre-change build. */
    const guard = (f, empty) => function(){ try { return f.apply(null, arguments); } catch (e) { return empty; } };
    L.groupLog = guard(L.groupLog, []);
    ["logKind","logOn","logMade","logDayLabel"].forEach(k => L[k] = guard(L[k], "MISSING"));

    const entries = [
      { t: "2026-08-03T09:00:00.000Z", who: "Ali",  msg: "moved someone",  kind: "manual", on: "2026-08-11" },
      { t: "2026-08-03T08:30:00.000Z", who: "sync", msg: "Optima sync",    kind: "auto",   on: "2026-08-04" },
      { t: "2026-08-02T17:00:00.000Z", who: "Ali",  msg: "password set",   kind: "manual", on: null },
      { t: "2026-07-30T11:00:00.000Z", who: "Nick", msg: "written before kind and on existed" }
    ];
    const legacy = entries[3];

    ok("an entry with no kind reads as a person's decision", L.logKind(legacy) === "manual");
    ok("an entry with no rota date falls back to when it was made", L.logOn(legacy) === "2026-07-30");
    ok("reading an old entry does not change it",
      !("kind" in legacy) && !("on" in legacy), JSON.stringify(legacy));
    ok("when and which-day are genuinely different facts",
      L.logMade(entries[0]) === "2026-08-03" && L.logOn(entries[0]) === "2026-08-11");

    const made = L.groupLog(entries, "made", "all");
    ok("grouped by when changed: newest day first",
      made.map(g => g.date).join(",") === "2026-08-03,2026-08-02,2026-07-30", made.map(g => g.date).join(","));
    ok("two changes made on the same day sit in one group", !!made[0] && made[0].entries.length === 2);

    const aff = L.groupLog(entries, "affects", "all");
    ok("grouped by rota day: the day affected, not the day changed",
      aff.map(g => g.date).join(",") === "2026-08-11,2026-08-04,2026-08-02,2026-07-30",
      aff.map(g => g.date).join(","));
    ok("an undated change falls back to the day it was made (Ali, 3 Aug)",
      aff.some(g => g.date === "2026-08-02" && g.entries[0].msg === "password set"));

    ok("filter: automatic shows only the software's changes",
      L.groupLog(entries, "made", "auto").reduce((n, g) => n + g.entries.length, 0) === 1);
    ok("filter: manual shows the rest, old entries included",
      L.groupLog(entries, "made", "manual").reduce((n, g) => n + g.entries.length, 0) === 3);
    ok("filter: all shows everything", L.groupLog(entries, "made", "all")
      .reduce((n, g) => n + g.entries.length, 0) === 4);
    ok("nothing in, nothing out — no crash on an empty log", L.groupLog([], "made", "all").length === 0);
    ok("a null entry in the list is skipped, not thrown on",
      L.groupLog([null, entries[0]], "made", "all").length === 1);
    ok("today and yesterday are named, older days are dated",
      L.logDayLabel("2026-08-03", "2026-08-03") === "Today" &&
      L.logDayLabel("2026-08-02", "2026-08-03") === "Yesterday" &&
      /July/.test(L.logDayLabel("2026-07-30", "2026-08-03")));

    // ---- the page itself ----
    const cons = fs.readFileSync(PAGE, "utf8");
    ok("every writer goes through clog — no entry is built by hand any more",
      (cons.match(/cdata\.log\.unshift/g) || []).length === 1,
      (cons.match(/cdata\.log\.unshift/g) || []).length + " inline writers");
    ok("the Log tab no longer guesses by pattern-matching the message text",
      !/\/consultant\|on call\/i\.test/.test(cons));

    const { api, win } = await loadPage({ url: TEST, testMode: true, keys: KEYS });
    api.setCdata(Object.assign(api.cdata || {}, { log: entries.slice() }));
    win.renderLog();
    const heads = [...win.document.querySelectorAll("#logBox .loghead")].map(h => h.textContent);
    ok("the log renders grouped, with a count on each day", heads.length === 3 && /2$/.test(heads[0]), heads.join(" | "));
    ok("both controls are on the page and neither needs a sentence to explain it",
      win.document.querySelectorAll("#logBox .segbtn").length === 5);
    ok("the software's own changes are marked apart from a person's",
      win.document.querySelectorAll("#logBox .logrow.auto").length === 1);
    ok("the date NOT being grouped on is shown on the row, so both are always visible",
      win.document.querySelectorAll("#logBox .logon").length === 2);

    const seg = t => [...win.document.querySelectorAll("#logBox .segbtn")].find(b => b.textContent === t);
    const auto = seg("Automatic");
    if (auto) auto.onclick();
    ok("clicking Automatic redraws to just the software's changes",
      !!auto && win.document.querySelectorAll("#logBox .logrow").length === 1,
      win.document.querySelectorAll("#logBox .logrow").length + " rows");

    const byDay = seg("Rota day");
    if (byDay) byDay.onclick();
    ok("the two controls are independent — filter survives changing the grouping",
      !!byDay && win.document.querySelectorAll("#logBox .logrow").length === 1 &&
      [...win.document.querySelectorAll("#logBox .segbtn")].filter(b => b.classList.contains("on"))
        .map(b => b.textContent).join(",") === "Rota day,Automatic");
  }

  console.log("\n" + (fail ? "=== " + pass + " passed, " + fail + " failed ===" : "=== " + pass + " passed, 0 failed ==="));
  if (fail) { console.log("\nFailures:"); failures.forEach(f => console.log(" - " + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("suite crashed:", e); process.exit(1); });
