/* strength-tests.js — assertions for the requirement register and the evaluator.
 *
 * Runs in node (`node tests/strength-tests.js`) and in the browser test page.
 *
 * EVERY FIXTURE IS SYNTHETIC. Real staff names, grades, start dates and skills never appear in
 * this repository — the evaluator is exercised against invented people whose shapes match the
 * real ones. Where a test reproduces a real day (Thursday 13 Aug 2026) it reproduces its SHAPE:
 * three airway-trained across five pods, both ACCPs in one pod, nobody named.
 */
(function () {
  "use strict";
  var S = (typeof module === "object" && module.exports)
    ? require("../strength.js")
    : (typeof globalThis !== "undefined" ? globalThis : this).Strength;

  var pass = 0, fail = 0, msgs = [];
  function ok(cond, what) {
    if (cond) { pass++; return; }
    fail++; msgs.push("FAIL: " + what);
  }
  function eq(a, b, what) { ok(a === b, what + "  (got " + JSON.stringify(a) + ", wanted " + JSON.stringify(b) + ")"); }
  function has(arr, v, what) { ok((arr || []).indexOf(v) !== -1, what + "  (got " + JSON.stringify(arr) + ")"); }
  function hasnt(arr, v, what) { ok((arr || []).indexOf(v) === -1, what + "  (got " + JSON.stringify(arr) + ")"); }

  var DAY = "2026-08-13";
  var n = 0;
  function p(o) { o.id = o.id || ("id" + (++n)); return o; }

  /* ================= THE REGISTER ================= */
  eq(S.REGISTER.length, 24, "the register holds 24 requirements");
  (function () {
    var seen = {}, dupes = 0, i;
    for (i = 0; i < S.REGISTER.length; i++) {
      if (seen[S.REGISTER[i].id]) dupes++;
      seen[S.REGISTER[i].id] = true;
    }
    eq(dupes, 0, "every requirement id is unique — a register with two R04s is not one list");
  })();
  (function () {
    var i, r, bad = 0, noShort = 0;
    for (i = 0; i < S.REGISTER.length; i++) {
      r = S.REGISTER[i];
      if (["pod", "day", "week"].indexOf(r.scope) === -1) bad++;
      if (["gate", "aim"].indexOf(r.kind) === -1) bad++;
      if (!r.short) noShort++;
    }
    eq(bad, 0, "every row carries a legal scope and kind");
    eq(noShort, 0, "every row carries a short form, because a pod corner cannot hold a full label");
  })();
  /* A "from: check" row is answered by checkDay's own sentence, so there must be a pattern that
     recognises it. A row nobody can match is a requirement that silently never fires. */
  (function () {
    var i, r, unmatched = [];
    var samples = {
      R01: "Pod C has 1 countable staff — minimum 2 (supernumeraries don't count).",
      R02: "Pod C has no long-day (8-8) person.",
      R03: "Somebody is allocated to more than one pod (A, B).",
      R04: "Pod(s) C have nobody airway-trained — none to spare elsewhere.",
      R05: "Pod E has more people than Pod B — E should be the smallest, move one across.",
      R06: "Phone holder is in Pod A with 2, while Pod B has 4 — aim to put them where there's the most cover.",
      R08: "No day referral-phone holder allocated.",
      R09: "Somebody isn't phone-trained.",
      R10: "Somebody holds the phone but is on a short day — the phone holder must be on a long day.",
      R11: "No night phone holder allocated.",
      R12: "Night team has 3 countable staff — minimum 4 (one doubles up to cover Pod E).",
      R13: "Somebody is on the night team but not flagged for nights.",
      R14: "Two airway-trained on nights — aim one in A & B and one in C, D & E.",
      R15: "Only 3 transfer-trained on the day shift — aim for 4 (depends who's rostered).",
      R16: "Somebody is on both the day and night shift.",
      R17: "Somebody is in a pod but Optima has them on nights (N) — they need moving to the night team.",
      R18: "Somebody holds the day phone 3+ days in a row — aim to rotate.",
      R19: "Somebody holds the night phone on consecutive nights — aim for one night at a time where able.",
      R20: "Somebody (neuro) — 40% of shifts on Pods C/D this week; aim ~70%."
    };
    for (i = 0; i < S.REGISTER.length; i++) {
      r = S.REGISTER[i];
      if (r.from !== "check") continue;
      if (!samples[r.id] || S.dayAimFor(samples[r.id]) !== r.id) unmatched.push(r.id);
    }
    eq(unmatched.join(","), "", "every check-backed requirement is recognised from its own sentence");
  })();
  eq(S.dayAimFor("something nobody has ever written"), null,
    "an unrecognised sentence returns null rather than guessing at a requirement");

  /* ================= TIME ON THE UNIT ================= */
  var brandNew = p({ name: "AA", grade: "IMT", start: "2026-08-10" });
  var atNinety = p({ name: "BB", grade: "IMT", start: "2026-05-15" });   // 90 days
  var atNinetyOne = p({ name: "CC", grade: "IMT", start: "2026-05-14" }); // 91 days
  var aYear = p({ name: "DD", grade: "ST", start: "2025-01-05" });
  var accp = p({ name: "EE", grade: "ACCP" });
  var icm = p({ name: "FF", grade: "ICM" });
  var blank = p({ name: "GG", grade: "FY2" });
  var back = p({ name: "HH", grade: "IMT", start: "2026-08-10", returner: true });
  var rostered = p({ name: "II", grade: "FY2" });

  eq(S.tierOf(brandNew, DAY), "new", "a fortnight on the unit is new");
  eq(S.tierOf(atNinety, DAY), "new", "90 days is still new — the boundary is exclusive");
  eq(S.tierOf(atNinetyOne, DAY), "mid", "91 days crosses into mid");
  eq(S.tierOf(aYear, DAY), "settled", "over a year is settled");
  eq(S.tierOf(accp, DAY), "settled", "a substantive grade with no start date means years, not unknown");
  eq(S.tierOf(icm, DAY), "settled", "the same for ICM");
  eq(S.tierOf(blank, DAY), "unknown", "a rotational grade with no start date and no roster is unknown");
  eq(S.tierOf(back, DAY), "settled", "a returner is not a new starter, whatever the start date says");
  eq(S.tierOf(rostered, DAY, null, (function () { var f = {}; f[rostered.id] = "2024-08-27"; return f; })()),
    "settled", "with no start date the first rostered shift is used instead");
  /* The real case this was built for, in shape: an FY2 with no start date whose first rostered
     shift is 351 days back. Mid, not settled and not new — and getting it wrong in either
     direction was the whole argument about whether to trust the roster at all. */
  eq(S.tierOf(rostered, DAY, null, (function () { var f = {}; f[rostered.id] = "2025-08-27"; return f; })()),
    "mid", "351 days from the first rostered shift is mid, on the near side of a year");
  /* The measured relationship, asserted so it cannot quietly invert: a stated start always wins,
     even when the roster disagrees. Real data, 26.08.14: the first rostered shift is never earlier
     than a stated start (0 of 40) and runs a median 7 days later. */
  eq(S.tierOf(brandNew, DAY, null, (function () { var f = {}; f[brandNew.id] = "2024-01-01"; return f; })()),
    "new", "a stated start date beats the roster — the roster is the fallback, not the authority");
  eq(S.daysOn(atNinety, DAY), 90, "days on the unit are counted from the stated start");
  eq(S.daysOn(blank, DAY), null, "no date anywhere gives null rather than zero");

  /* ================= THE EVALUATOR ================= */
  function mkCtx(pods, opts) {
    opts = opts || {};
    var staff = [], counts = {}, k, i;
    for (k in pods) {
      counts[k] = [];
      for (i = 0; i < pods[k].length; i++) { staff.push(pods[k][i]); counts[k].push(pods[k][i].id); }
    }
    return {
      dateISO: DAY, byId: S.indexStaff(staff), counts: counts,
      prevCounts: opts.prev || null, issues: opts.issues || [], cfg: opts.cfg || null,
      firstSeen: opts.firstSeen || {}
    };
  }
  var vet = function (nm) { return p({ name: nm, grade: "ST", start: "2025-01-05" }); };
  var vetAir = function (nm) { return p({ name: nm, grade: "ST", start: "2025-01-05", airway: true, transfer: true }); };
  var vetAccp = function (nm) { return p({ name: nm, grade: "ACCP", transfer: true }); };

  /* ---- gates do not score ---- */
  (function () {
    var sc = S.scoreDay(mkCtx({ A: [vet("a1"), vet("a2")], B: [vet("b1")], C: [], D: [], E: [] },
      { issues: [{ hard: true, msg: "Pod B has 1 countable staff — minimum 2 (supernumeraries don't count)." }] }));
    ok(sc.pods.B.isBroken, "a pod below its minimum is broken");
    has(sc.pods.B.broken, "R01", "and the gate is named");
    ok(!sc.pods.A.isBroken, "the pod beside it is not");
    /* The whole reason gates are separate: if R01 scored, B would read as a percentage and a
       broken pod would average out against its met aims. */
    hasnt(sc.pods.B.met, "R01", "a gate never counts towards a percentage");
    hasnt(sc.pods.B.missed, "R01", "and never against one either");
  })();

  /* ---- what cannot be done leaves the denominator ---- */
  (function () {
    /* Three airway-trained across four pods that want one. Two pods hold one, a third holds the
       spare... no: three hold one each, the fourth cannot. Nothing could have been done. */
    var sc = S.scoreDay(mkCtx({
      A: [vetAir("a1"), vet("a2")], B: [vetAir("b1")], C: [vet("c1")], D: [vetAir("d1")], E: [vet("e1")] }));
    has(sc.pods.C.dropped, "R04", "with no airway to spare, the pod without one is not marked wrong");
    hasnt(sc.pods.C.missed, "R04", "it is out of the denominator, not a failure");
    has(sc.pods.A.met, "R04", "the pods that hold one still bank it");
    eq(sc.pods.D.pct, 100, "a pod that could not have done better reads 100");
  })();
  (function () {
    /* Same shape, but one pod holds TWO — so a move was available and the empty pod is charged. */
    var sc = S.scoreDay(mkCtx({
      A: [vetAir("a1"), vetAir("a2")], B: [vetAir("b1")], C: [vet("c1")], D: [vetAir("d1")], E: [vet("e1")] }));
    has(sc.pods.C.missed, "R04", "with a spare on the unit, the pod without one IS charged");
    hasnt(sc.pods.C.dropped, "R04", "and it is not quietly dropped");
    eq(S.donors(sc, "R04").length, 1, "the pod holding two is named as the donor");
    eq(S.donors(sc, "R04")[0].pod, "A", "and it is the right pod");
    eq(S.donors(sc, "R04")[0].spare, 1, "carrying one more than it needs");
  })();

  /* ---- the weakest pod carries the miss ---- */
  (function () {
    /* Two ACCPs, both in one pod. Three other pods lack one; only one of them could be helped, so
       exactly one is charged — and it must be the pod with least met already, not the first
       alphabetically. Pod C is made weak by failing N03 (everybody new). */
    var newOne = function (nm) { return p({ name: nm, grade: "IMT", start: "2026-08-10" }); };
    var sc = S.scoreDay(mkCtx({
      A: [vetAccp("a1"), vetAccp("a2")], B: [vet("b1")], C: [newOne("c1"), newOne("c2")], D: [vet("d1")], E: [vet("e1")] }));
    var charged = ["B", "C", "D", "E"].filter(function (q) { return sc.pods[q].missed.indexOf("N02") !== -1; });
    eq(charged.length, 1, "one spare ACCP charges exactly one pod, not four");
    eq(charged[0], "C", "and it is the weakest pod, which is the one a fix would actually help");
    has(sc.pods.C.missed, "N03", "the pod of two brand-new people fails the experience aim");
  })();

  /* ---- continuity ---- */
  (function () {
    var a1 = vet("a1"), a2 = vet("a2"), b1 = vet("b1");
    var kept = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] },
      { prev: { A: [a1.id, a2.id], B: [b1.id], C: [], D: [], E: [] } }));
    has(kept.pods.A.met, "N04", "a pod that kept both its people meets the continuity aim");
    var churned = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] },
      { prev: { A: [], B: [a1.id, a2.id, b1.id], C: [], D: [], E: [] } }));
    has(churned.pods.A.missed, "N04", "a pod rebuilt from scratch overnight does not");
    var firstDay = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] }));
    has(firstDay.pods.A.dropped, "N04", "with no yesterday held, continuity leaves the denominator");
    hasnt(firstDay.pods.A.missed, "N04", "rather than charging a pod for a day that does not exist");
  })();

  /* ---- an unknown tier is never charged ---- */
  (function () {
    var sc = S.scoreDay(mkCtx({ A: [p({ name: "ZZ", grade: "FY2" })], B: [], C: [], D: [], E: [] }));
    hasnt(sc.pods.A.missed, "N03", "a blank start date never makes a pod look worse");
    eq(sc.unknowns.length, 1, "it is surfaced instead, for the Attention page to ask about");
  })();

  /* ---- THURSDAY 13 AUGUST 2026, in shape ---- */
  (function () {
    /* A3 B2 C2 D2 E2. Three airway-trained, spread A B D. Five transfer-trained: A holds three,
       B and D one each. Both ACCPs in A. Pod C holds a newcomer and somebody a year in.
       The day every existing rule passed. */
    var A = [p({ name: "a1", grade: "ST", start: "2026-07-01", airway: true, transfer: true }),
             p({ name: "a2", grade: "ACCP", transfer: true }),
             p({ name: "a3", grade: "ACCP", transfer: true })];
    var B = [p({ name: "b1", grade: "ICM", airway: true, transfer: true }),
             p({ name: "b2", grade: "IMT", start: "2026-02-01" })];
    var C = [p({ name: "c1", grade: "IMT", start: "2026-07-20" }),
             p({ name: "c2", grade: "FY2", start: "2025-08-27" })];
    var D = [p({ name: "d1", grade: "JCF", start: "2026-06-01" }),
             p({ name: "d2", grade: "SCF", airway: true, transfer: true })];
    var E = [p({ name: "e1", grade: "IMT", start: "2026-03-01" }),
             p({ name: "e2", grade: "JCF", start: "2026-08-01" })];
    var prev = {};
    ["A", "B", "C", "D", "E"].forEach(function (k) { prev[k] = []; });
    var pods = { A: A, B: B, C: C, D: D, E: E };
    ["A", "B", "C", "D", "E"].forEach(function (k) {
      prev[k] = pods[k].map(function (x) { return x.id; });
    });
    var sc = S.scoreDay(mkCtx(pods, { prev: prev }));

    eq(sc.pods.A.pct, 100, "Pod A, holding everything, reads 100");
    ok(sc.pods.C.pct < sc.pods.A.pct, "Pod C reads lower than Pod A — the whole point of the day");
    has(sc.pods.C.missed, "N01", "Pod C is charged for having no transfer-trained, because two were spare");
    has(sc.pods.C.dropped, "R04", "but not for airway, which nothing could have fixed");
    hasnt(sc.pods.C.missed, "N03", "and not for experience — one of the two is a year in");
    eq(S.donors(sc, "N01")[0].pod, "A", "and Pod A is named as the pod with transfer to spare");
    ok(sc.day.pct < 100, "the day does not read as clean, which is what it did on the board");
    ok(!sc.pods.C.isBroken, "nothing is BROKEN — every existing hard rule really did pass");
  })();

  /* ================= COLOUR, AND WHAT THE RING SHOWS ================= */
  ok(/^rgb\(/.test(S.colourOf(0)), "0 has a colour");
  ok(/^rgb\(/.test(S.colourOf(100)), "100 has a colour");
  ok(S.colourOf(69) !== S.colourOf(71), "the ramp is continuous, so 69 and 71 are not the same colour");
  eq(S.colourOf(null), "#8a8f98", "no score is grey rather than red");
  eq(S.band(100), "ok", "100 bands ok");
  eq(S.band(75), "thin", "75 bands thin");
  eq(S.band(40), "bare", "40 bands bare");

  /* ================= HARD RULE 6 ================= */
  /* "The system records THAT somebody is not on. It never records why, and it must not be possible
     to work out why — from a field, a button label, a log message, a code path or a separate route
     through the UI." Asserted against the module's own source, because the risk is not that
     somebody adds a "reason" field on purpose — it is that a helpful-sounding word creeps into a
     label and quietly becomes a place to put one. */
  (function () {
    var src = (typeof require === "function")
      ? require("fs").readFileSync(require("path").join(__dirname, "..", "strength.js"), "utf8") : "";
    if (!src) { ok(true, "hard rule 6 source scan skipped in the browser"); return; }
    /* COMMENTS ARE STRIPPED FIRST, and that is not a loophole — it is the rule stated precisely.
       Hard rule 6 bans a reason from being RECORDED or INFERABLE: from a field, a button label, a
       log message, a code path or a route through the UI. Prose explaining why there is no such
       field is the opposite of a breach, and a scan that fails on it would push the explanation
       out of the file, which is how the rule gets forgotten. So: code and strings only. */
    var code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    var banned = ["sick", "sickness", "illness", "absent", "absence", "leave", "reason", "why",
      "unwell", "emergency", "excuse", "cause"];
    var found = [], i, w;
    for (i = 0; i < banned.length; i++) {
      w = banned[i];
      if (new RegExp("\\b" + w + "\\b", "i").test(code)) found.push(w);
    }
    eq(found.join(","), "", "no word for an absence or its cause appears in the evaluator's code or labels");
    /* And the shape of the data proves it: a pod is a list of people who ARE there. There is no
       field on the output for anybody who is not. */
    var sc = S.scoreDay(mkCtx({ A: [vet("a1")], B: [], C: [], D: [], E: [] }));
    eq(JSON.stringify(sc.pods.B.people), "[]", "an empty pod is an empty list, not a list of the missing");
  })();

  /* ================= EVERY WEIGHT IS EDITABLE (PROJECT RULE 1) ================= */
  (function () {
    var pods = { A: [vetAir("a1"), vetAir("a2")], B: [vet("b1")], C: [], D: [], E: [] };
    var base = S.scoreDay(mkCtx(pods));
    var heavier = S.scoreDay(mkCtx(pods, { cfg: { w: { R04: 5 } } }));
    ok(base.pods.B.pct !== heavier.pods.B.pct || base.pods.B.app !== heavier.pods.B.app,
      "raising a weight from the front end moves the number");
    var offCfg = S.scoreDay(mkCtx(pods, { cfg: { off: { R04: true } } }));
    hasnt(offCfg.pods.B.missed, "R04", "switching a requirement off stops it being asked");
    hasnt(offCfg.pods.B.met, "R04", "and takes it out of the denominator rather than passing it");
    var moved = S.scoreDay(mkCtx({ A: [p({ name: "x", grade: "IMT", start: "2026-06-20" })], B: [], C: [], D: [], E: [] },
      { cfg: { newDays: 300 } }));
    has(moved.pods.A.missed, "N03", "moving the tier boundary moves who counts as new");
  })();

  var out = "strength-tests: " + pass + " passed, " + fail + " failed";
  if (msgs.length) out += "\n" + msgs.join("\n");
  if (typeof module === "object" && module.exports) {
    console.log(out);
    if (fail) process.exit(1);
  } else if (typeof document !== "undefined") {
    var elx = document.getElementById("strength-results");
    if (elx) elx.textContent = out;
    else console.log(out);
  }
  return { pass: pass, fail: fail };
})();
