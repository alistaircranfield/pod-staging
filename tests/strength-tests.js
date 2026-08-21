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
  eq(S.REGISTER.length, 27, "the register holds 27 requirements");
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
      if (["pod", "day", "night", "week"].indexOf(r.scope) === -1) bad++;
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

  /* ---- what the pod HAS, and separately what could have been done ---- */
  (function () {
    /* Three airway-trained across four pods that want one. Nothing could have been done for the
       fourth — and it is still marked short, because the score says what a pod HOLDS. What it is
       NOT is blamed: `unfixable` names it, and the ceiling drops to say so. */
    var sc = S.scoreDay(mkCtx({
      A: [vetAir("a1"), vet("a2")], B: [vetAir("b1")], C: [vet("c1")], D: [vetAir("d1")], E: [vet("e1")] }));
    has(sc.pods.C.missed, "R04", "a pod with no airway is short of airway, whatever was available");
    has(sc.pods.C.unfixable, "R04", "and it is named as something no move could have fixed");
    ok(sc.pods.C.ceiling < 100, "so the pod's ceiling for the day drops below 100");
    ok(sc.pods.C.pct <= sc.pods.C.ceiling, "and a pod never scores above its own ceiling");
    has(sc.pods.A.met, "R04", "the pods that hold one read met on the list");
  })();
  (function () {
    /* Same shape, but one pod holds TWO — so a move was available and nobody is unfixable. */
    var sc = S.scoreDay(mkCtx({
      A: [vetAir("a1"), vetAir("a2")], B: [vetAir("b1")], C: [vet("c1")], D: [vetAir("d1")], E: [vet("e1")] }));
    has(sc.pods.C.missed, "R04", "the pod without one is still short");
    hasnt(sc.pods.C.unfixable, "R04", "but a spare existed, so it was not out of reach");
    eq(S.donors(sc, "R04").length, 1, "the pod holding two is named as the donor");
    eq(S.donors(sc, "R04")[0].pod, "A", "and it is the right pod");
  })();

  /* ---- ACCPs are not asked for, only counted when stacked ---- */
  (function () {
    var newOne = function (nm) { return p({ name: nm, grade: "IMT", start: "2026-08-10" }); };
    var sc = S.scoreDay(mkCtx({
      A: [vetAccp("a1"), vetAccp("a2")], B: [vet("b1")], C: [newOne("c1"), newOne("c2")], D: [vetAccp("d1")], E: [vet("e1")] }));
    has(sc.pods.A.missed, "N02", "two ACCPs in one pod is the thing that costs");
    has(sc.pods.B.met, "N02", "a pod with none is asked nothing and reads met");
    has(sc.pods.D.met, "N02", "and so is a pod with exactly one");
    hasnt(sc.pods.B.missed, "N02", "having no ACCP is never a shortfall — transfer covers what they bring");
    ok(sc.pods.C.pct < sc.pods.B.pct, "the pod of two newcomers still scores below the pod of one veteran");
  })();
  (function () {
    /* Three in one pod is worse than two, and the scale says so rather than flattening. */
    var one = S.scoreDay(mkCtx({ A: [vetAccp("x1"), vet("x2")], B: [], C: [], D: [], E: [] })).pods.A;
    var two = S.scoreDay(mkCtx({ A: [vetAccp("y1"), vetAccp("y2")], B: [], C: [], D: [], E: [] })).pods.A;
    var three = S.scoreDay(mkCtx({ A: [vetAccp("z1"), vetAccp("z2"), vetAccp("z3")], B: [], C: [], D: [], E: [] })).pods.A;
    ok(one.pct > two.pct, "two ACCPs scores below one");
    ok(two.pct > three.pct, "and three scores below two");
  })();

  /* ---- continuity ---- */
  (function () {
    var a1 = vet("a1"), a2 = vet("a2"), b1 = vet("b1");
    var kept = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] },
      { prev: { A: [a1.id, a2.id], B: [b1.id], C: [], D: [], E: [] } }));
    has(kept.pods.A.met, "N04", "a pod that kept both its people meets the continuity aim");
    /* REWRITTEN 26.08.16. This used to put pod A's yesterday at EMPTY and expect N04 missed —
       "rebuilt from scratch". Under the retention reading that is the same case as an empty
       previous day: A had nobody, so it kept nobody, and there was nothing to keep. The honest
       version of "rebuilt from scratch" is a pod that HAD people and lost them all. */
    var churned = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] },
      { prev: { A: ["gone1", "gone2"], B: [a1.id, a2.id, b1.id], C: [], D: [], E: [] } }));
    has(churned.pods.A.missed, "N04", "a pod that lost everybody it had does not keep its people");
    /* An empty yesterday is not a yesterday. Five empty lists mean nobody has filled that day in,
       not that every pod lost everybody — and treating them as the latter made continuity fail on
       all five pods of the first day the board holds. */
    var emptyPrev = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] },
      { prev: { A: [], B: [], C: [], D: [], E: [] } }));
    has(emptyPrev.pods.A.dropped, "N04", "a previous day nobody allocated drops continuity");
    hasnt(emptyPrev.pods.A.missed, "N04", "rather than charging every pod for it");
    /* THE WEEKEND SEAM. The unit re-forms its pods around the weekend, so Monday against Sunday is
       not a fair comparison and charging it made "pod broken up" the loudest thing on the board.
       13 Aug 2026 is a Thursday and 10 Aug a Monday; the fixture dates below say which is which. */
    var mkAt = function (iso, prev) {
      var c = mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] }, { prev: prev });
      c.dateISO = iso; return c;
    };
    /* A must have HAD somebody yesterday or N04 is not asked at all and the seam tests below
       would pass for the wrong reason. */
    var churned2 = { A: ["gone1", "gone2"], B: [a1.id, a2.id, b1.id], C: [], D: [], E: [] };
    var mon = S.scoreDay(mkAt("2026-08-10", churned2));           // Monday, yesterday is Sunday
    has(mon.pods.A.dropped, "N04", "a Monday does not carry continuity over from the Sunday");
    hasnt(mon.pods.A.missed, "N04", "so the weekend re-form is never charged to a pod");
    var sat = S.scoreDay(mkAt("2026-08-15", churned2));           // Saturday, yesterday is Friday
    has(sat.pods.A.dropped, "N04", "nor a Saturday from the Friday — the same seam, other end");
    var tue = S.scoreDay(mkAt("2026-08-11", churned2));           // Tuesday, yesterday is Monday
    has(tue.pods.A.missed, "N04", "but a Tuesday is still measured against the Monday");
    var sun = S.scoreDay(mkAt("2026-08-16", churned2));           // Sunday, yesterday is Saturday
    has(sun.pods.A.missed, "N04", "and a Sunday against the Saturday — both are weekend days");
    var forced = S.scoreDay((function () { var c = mkAt("2026-08-10", churned2);
      c.cfg = { continuityAcrossWeekend: true }; return c; })());
    has(forced.pods.A.missed, "N04", "and the seam can be switched off from the front end");

    var firstDay = S.scoreDay(mkCtx({ A: [a1, a2], B: [b1], C: [], D: [], E: [] }));
    has(firstDay.pods.A.dropped, "N04", "with no yesterday held, continuity is not asked at all");
    hasnt(firstDay.pods.A.missed, "N04", "rather than charging a pod for a day that does not exist");
  })();

  /* ---- an unknown tier is never charged ---- */
  (function () {
    var sc = S.scoreDay(mkCtx({ A: [p({ name: "ZZ", grade: "FY2" })], B: [], C: [], D: [], E: [] }));
    eq(sc.pods.A.missed.indexOf("N03"), -1, "a blank start date never makes a pod look worse");
    eq(sc.unknowns.length, 1, "it is surfaced instead, for the Attention page to ask about");
  })();

  /* ---- THURSDAY 13 AUGUST 2026, in shape ---- */
  (function () {
    /* A3 B2 C2 D2 E2. Three airway-trained, spread A B D. Five transfer-trained: A holds three,
       B and D one each. Both ACCPs in A. Pod C holds a newcomer and somebody a year in.
       The day every existing rule passed. */
    var A = [p({ name: "a1", grade: "ST", start: "2026-07-01", airway: true, transfer: true, phoneHolder: true }),
             p({ name: "a2", grade: "ACCP", transfer: true }),
             p({ name: "a3", grade: "ACCP", transfer: true })];
    var B = [p({ name: "b1", grade: "ICM", airway: true, transfer: true, phoneHolder: true }),
             p({ name: "b2", grade: "IMT", start: "2026-02-01" })];
    var C = [p({ name: "c1", grade: "IMT", start: "2026-07-20" }),
             p({ name: "c2", grade: "FY2", start: "2025-08-27" })];
    var D = [p({ name: "d1", grade: "JCF", start: "2026-06-01" }),
             p({ name: "d2", grade: "SCF", airway: true, transfer: true, phoneHolder: true })];
    var E = [p({ name: "e1", grade: "IMT", start: "2026-03-01" }),
             p({ name: "e2", grade: "JCF", start: "2026-08-01" })];
    var prev = {};
    ["A", "B", "C", "D", "E"].forEach(function (k) { prev[k] = []; });
    var pods = { A: A, B: B, C: C, D: D, E: E };
    ["A", "B", "C", "D", "E"].forEach(function (k) {
      prev[k] = pods[k].map(function (x) { return x.id; });
    });
    var sc = S.scoreDay(mkCtx(pods, { prev: prev }));

    ok(sc.pods.A.pct > 80, "Pod A, holding everything, reads high");
    ok(sc.pods.A.pct < 100, "but not 100 — one of its three is in their first weeks, and its two ACCPs are stacked");
    has(sc.pods.A.missed, "N02", "and the two ACCPs sitting together is exactly what it is marked down for");
    ok(sc.pods.C.pct < sc.pods.A.pct, "Pod C reads lower than Pod A — the whole point of the day");
    has(sc.pods.C.missed, "N01", "Pod C is short of a transfer-trained person");
    hasnt(sc.pods.C.missed, "N02", "and is NOT marked down for having no ACCP — that is not asked");
    has(sc.pods.C.unfixable, "R04", "airway is named as the thing no move could have fixed");
    /* Ceiling loosened 26.08.15: N07 ("no airway means transfer at least") adds weight to a pod
       without airway, so C's denominator grew and its ceiling with it. The property being tested
       is that the ceiling is CLEARLY short of 100 because airway cannot be got — not the exact
       number, which now moves whenever the register does. */
    ok(sc.pods.C.ceiling < 85, "so Pod C's ceiling for the day is well under 100");
    hasnt(sc.pods.C.missed, "N03", "and not for experience — one of the two is a year in");
    eq(S.donors(sc, "N01")[0].pod, "A", "and Pod A is named as the pod with transfer to spare");
    ok(sc.day.pct < 100, "the day does not read as clean, which is what it did on the board");
    ok(!sc.pods.C.isBroken, "nothing is BROKEN — every existing hard rule really did pass");
  })();

  /* ---- A SCARCE PERSON PARKED IN THE POD THAT WANTS THEM LEAST IS STILL AVAILABLE ----
     Monday 17 August in shape: three airway-trained on, one of them in Pod E, and Pods A and D
     with none. The old sum said "three on, three pods hold one, nothing spare" and told A and D
     nothing could be moved — while the obvious move sat in the pod that values airway least. */
  (function () {
    var bare = function (nm) { return p({ name: nm, grade: "IMT", start: "2025-01-05" }); };
    var sc = S.scoreDay(mkCtx({
      A: [bare("a1"), bare("a2")], B: [vetAir("b1"), bare("b2")], C: [vetAir("c1"), bare("c2")],
      D: [bare("d1"), bare("d2")], E: [vetAir("e1"), bare("e2")] }));
    has(sc.pods.A.missed, "R04", "Pod A is short of airway");
    hasnt(sc.pods.A.unfixable, "R04", "and it is NOT out of reach — Pod E holds one and wants it least");
    hasnt(sc.pods.D.unfixable, "R04", "nor is Pod D");
    ok(sc.pods.A.ceiling > sc.pods.A.pct, "so Pod A's ceiling stays above its score: there is something to do");
  })();
  (function () {
    /* But when the three are spread across three pods that ALL value it equally, there really is
       nothing to move, and the board must still be able to say so. */
    var bare = function (nm) { return p({ name: nm, grade: "IMT", start: "2025-01-05" }); };
    var sc = S.scoreDay(mkCtx({
      A: [vetAir("a1"), bare("a2")], B: [vetAir("b1"), bare("b2")], C: [vetAir("c1"), bare("c2")],
      D: [bare("d1"), bare("d2")], E: [bare("e1"), bare("e2")] }));
    has(sc.pods.D.unfixable, "R04", "with all three in equal-weight pods, Pod D really is out of reach");
  })();

  /* ---- POD E IS ASKED THE SAME QUESTIONS AND ITS ANSWERS ARE WORTH LESS ----
     Ali, 26.08.15: "E needs to be weighted differently somehoe or iwll aleways look terrible. the
     airway skill should cary less weight for pod E only." Leaving E out of the question altogether
     was the earlier, blunter version of this — and it meant an airway-trained person standing in
     Pod E counted for nothing anywhere, which is its own kind of wrong. */
  (function () {
    var bare = function (nm) { return p({ name: nm, grade: "IMT", start: "2025-01-05" }); };
    var sc = S.scoreDay(mkCtx({
      A: [vetAir("a1"), vetAir("a2")], B: [vetAir("b1")], C: [vetAir("c1")], D: [vetAir("d1")], E: [bare("e1"), bare("e2")] }));
    has(sc.pods.E.missed, "R04", "Pod E with no airway is still SHORT of airway — the list is the same everywhere");
    /* E here has neither airway nor transfer, so it now takes N07 as well — at half weight, which
       is E's lighter treatment applied to the fallback. Still clearly not "terrible", which is the
       point of the pod weights, but lower than before the fallback existed. */
    ok(sc.pods.E.pct > 35, "but it does not read terrible for it, because E wants less of that thing");

    /* The multiplier is what does the work, and it has to be visible in the arithmetic. */
    ok(S.wFor(S.cfgOf(null), "R04", "E") < S.wFor(S.cfgOf(null), "R04", "A"),
      "airway is worth less in E than in A");
    /* This used to read "and transfer is worth less again in E". It no longer can: the 26.08.15
       sweep took E's airway multiplier to 0, so E is the one pod that asks for transfer and does
       not ask for airway at all. That is the deliberate shape — a bare Pod E is what Ali has said
       he does not mind, and asking E for airway was pulling scarce carriers away from A-D. Both
       are still worth less in E than the same requirement is in A, which is the actual rule. */
    eq(S.wFor(S.cfgOf(null), "R04", "E"), 0,
      "E does not ask for airway at all — it is the pod that goes without when cover is short");
    ok(S.wFor(S.cfgOf(null), "N01", "E") < S.wFor(S.cfgOf(null), "N01", "A"),
      "and transfer is worth less in E than in A — \u201cno transfer on E not important\u201d");
    eq(S.wFor(S.cfgOf(null), "N03", "E"), S.wFor(S.cfgOf(null), "N03", "A"),
      "experience is worth the same in E as anywhere: a newcomer is a newcomer");

    /* And the credit works in the other direction, which exclusion could never do. */
    var withAir = S.scoreDay(mkCtx({
      A: [vetAir("q1")], B: [], C: [], D: [], E: [vetAir("q2"), bare("q3")] }));
    var without = S.scoreDay(mkCtx({
      A: [vetAir("r1")], B: [], C: [], D: [], E: [bare("r2"), bare("r3")] }));
    ok(withAir.pods.E.pct > without.pods.E.pct,
      "an airway-trained person standing in Pod E is worth something, which exclusion denied");
  })();

  /* ---- the night team is scored like a pod ---- */
  (function () {
    var na = p({ name: "na", grade: "ST", start: "2025-01-05", airway: true });
    var nb = p({ name: "nb", grade: "IMT", start: "2026-08-01", airway: true });
    var nc = p({ name: "nc", grade: "ST", start: "2025-01-05" });
    var c = mkCtx({ A: [], B: [], C: [], D: [], E: [] });
    c.byId = S.indexStaff([na, nb, nc]);
    c.nightCounts = [na.id, nb.id, nc.id];
    c.prevNightCounts = [na.id, nb.id, nc.id];
    var sc = S.scoreDay(c);
    ok(!!sc.night, "the night team is scored at all");
    ok(sc.night.pct > 80, "a night team that keeps its people and has a mix reads high");
    /* ── A RULE OF ALI'S THAT HE HAS SINCE REVERSED, AND THE REVERSAL IS RIGHT ────────────────
       This used to assert `pct < 100` — his 26.08.15 rule, "nights even with 5 and 3 airways
       cant be 100% if even one of them is inexperienced." It was a fair reading of the old model,
       where experience was a mean and a newcomer always dragged it down.

       He overturned it the same week, looking at what that arithmetic actually did: "how can
       moving a newish person off improve the pod coming off... even a new person is worth
       something." Both statements are true of different things. A newcomer with NOBODY to ask is
       a real problem; a newcomer standing beside two experienced people is not, and a model that
       marks the team down for having them is telling the unit not to train anybody.

       So the assertion is inverted deliberately, and the old wording is kept here so nobody
       "restores" it in six months without knowing it was a decision. */
    ok(sc.night.pct === 100 || sc.night.pct > 95,
      "and a supervised newcomer costs the team nothing — the mean-based rule is overturned");
    has(sc.night.met, "R14", "with two airway-trained on, the split aim is asked and met");
    var thin = S.scoreDay((function () { var x = mkCtx({ A: [], B: [], C: [], D: [], E: [] });
      x.byId = S.indexStaff([na, nc]); x.nightCounts = [na.id, nc.id]; x.prevNightCounts = [na.id, nc.id]; return x; })());
    has(thin.night.dropped, "R14", "with only one airway-trained, the split is not a thing to ask");
    var brk = S.scoreDay((function () { var x = mkCtx({ A: [], B: [], C: [], D: [], E: [] });
      x.byId = S.indexStaff([na, nc]); x.nightCounts = [na.id, nc.id];
      x.issues = [{ hard: true, msg: "Night team has 2 countable staff — minimum 4 (one doubles up to cover Pod E)." }];
      return x; })());
    ok(brk.night.isBroken, "a night team under its minimum is broken, exactly as a pod would be");
    /* The day percentage must not move when the night does — they are drawn on different parts of
       the screen and a number that changes for invisible reasons is worse than no number. */
    eq(sc.day.pct, S.scoreDay(mkCtx({ A: [], B: [], C: [], D: [], E: [] })).day.pct,
      "the night score never leaks into the day score");
  })();

  /* ---- part marks, so the scale is a spectrum rather than four steps ---- */
  (function () {
    var a1 = vet("k1"), a2 = vet("k2"), a3 = vet("k3"), a4 = vet("k4");
    /* REWRITTEN 26.08.16 for the retention reading. Yesterday pod A held all four; today it holds
       only the ones it KEPT, and the rest have gone to B. The old fixture did the opposite — it
       varied yesterday and held today at four — which measured how much of today was familiar,
       and that is the thing that charged a pod for gaining somebody. */
    var all4 = [a1, a2, a3, a4];
    var ctx = function (kept) {
      var here = all4.slice(0, kept);
      var c = mkCtx({ A: here, B: all4.slice(kept), C: [], D: [], E: [] },
        { prev: { A: all4.map(function (x) { return x.id; }), B: [], C: [], D: [], E: [] } });
      c.dateISO = "2026-08-13"; return c;
    };
    var one = S.scoreDay(ctx(1)).pods.A,
        two  = S.scoreDay(ctx(2)).pods.A, all = S.scoreDay(ctx(4)).pods.A;
    var n04f = function (pd) { var r = pd.part.filter(function (x) { return x.id === "N04"; });
      return r.length ? r[0].f : (pd.met.indexOf("N04") !== -1 ? 1 : 0); };
    ok(n04f(one) < n04f(two), "keeping two of four beats keeping one");
    eq(n04f(two), n04f(all), "at keepShare and above it is full marks — the setting keeps its meaning");
    ok([one.pct, two.pct, all.pct].join(",").indexOf("NaN") === -1, "and every step is a real number");
  })();

  /* ---- a staffed pod is never nothing ---- */
  (function () {
    /* Two people, both brand new, both moved in from another pod overnight, on a day with no
       airway, transfer or ACCP anywhere to move. Every relative aim is unmeetable. This read ZERO
       before unmeetable aims were awarded rather than removed, which is what Ali called codswallop:
       the pod is doing as well as the day allows on three of its five requirements. */
    var n1 = p({ name: "z1", grade: "IMT", start: "2026-08-12" }), n2 = p({ name: "z2", grade: "IMT", start: "2026-08-12" });
    var c = mkCtx({ A: [n1, n2], B: [], C: [], D: [], E: [] },
      { prev: { A: [], B: [n1.id, n2.id], C: [], D: [], E: [] } });
    c.dateISO = "2026-08-13";
    var sc = S.scoreDay(c);
    ok(sc.pods.A.pct > 0, "a pod with two people in it never reads zero — they are worth something");
    ok(sc.pods.A.pct < 50, "but it reads LOW, because it holds none of the things a pod wants");
    eq(sc.pods.A.unfixable.length, 3, "and all three skills are named as out of reach today");
    ok(sc.pods.A.ceiling > sc.pods.A.pct, "its ceiling is higher, because experience COULD have been better");
    ok(sc.pods.A.ceiling < 60, "but the ceiling is low too — none of the four skills were on to be had");
  })();

  /* ---- nothing ever reads below zero ---- */
  (function () {
    var empty = S.scoreDay(mkCtx({ A: [], B: [], C: [], D: [], E: [] }));
    eq(empty.pods.A.pct, 0, "a pod with nobody in it reads zero, not null and never a minus");
    var i, worst = S.scoreDay(mkCtx({ A: [p({ name: "n1", grade: "IMT", start: "2026-08-12" })], B: [], C: [], D: [], E: [] }));
    ok(worst.pods.A.pct >= 0, "and the worst a pod can read is zero");
  })();

  /* ================= COLOUR, AND WHAT THE RING SHOWS ================= */
  ok(/^hsl\(/.test(S.colourOf(0)), "0 has a colour");
  ok(/^hsl\(/.test(S.colourOf(100)), "100 has a colour");
  ok(S.colourOf(69) !== S.colourOf(71), "the ramp is continuous, so 69 and 71 are not the same colour");
  eq(S.colourOf(null), "#8a8f98", "no score is grey rather than red");
  eq(S.band(100), "ok", "100 bands ok");
  eq(S.band(85), "ok", "85 bands ok — a good day, not a middling one");
  eq(S.band(75), "thin", "75 bands thin");
  eq(S.band(40), "bare", "40 bands bare");

  /* ── THE RING TAKES ONE OF FIVE COLOURS AND NOTHING BETWEEN (Ali, 26.08.15, "option 3") ─────
     The old ramp was continuous, which meant nothing was ever red — 40% came out orange — and
     55 to 72 was one indistinguishable yellow. These assert the two properties that fixed it. */
  (function () {
    var seen = {}, v;
    for (v = 0; v <= 100; v++) seen[S.colourOf(v)] = 1;
    eq(Object.keys(seen).length, 5, "the whole range uses exactly five colours");

    eq(S.colourOf(35), S.colourOf(54), "everything under the first cut is the same colour");
    ok(S.colourOf(54) !== S.colourOf(55), "and it changes at the cut, not around it");
    ok(/hsl\(2,/.test(S.colourOf(40)), "a bad day is RED — the old ramp never got there");
    ok(/hsl\(130,/.test(S.colourOf(95)), "and a strong day is properly green");

    /* THE NUMBER MUST NOT BE BANDED WITH THE COLOUR. Ali: "you still display the % it's only the
       ring colour that should change." */
    ok(S.colourOf(71) === S.colourOf(81), "71 and 81 draw the same colour");

    /* Colour and word are one decision, not two that drift apart. */
    ok(S.band(54) === "bare" && S.band(55) !== "bare", "the word changes on the same cut as the colour");

    /* Editable from the front end, like every other number. */
    var moved = S.cfgOf({ bands: [[90, "hsl(2,72%,48%)"], [101, "hsl(130,58%,33%)"]] });
    ok(S.colourOf.length >= 1, "colourOf takes a percentage");
    ok(moved.bands.length === 2, "the cut list is overridable from config");
  })();
  /* HUE ONLY EVER GOES FORWARD. Written for the old continuous ramp as strictly increasing, which
     is the wrong assertion for bands: 0 and 50 are both red now, so hue(50) > hue(0) is false and
     SHOULD be. What must still hold is that a better day is never a warmer colour — the property
     the old test was really protecting. */
  (function () {
    var hue = function (v) { return Number((S.colourOf(v).match(/hsl\((\d+)/) || [])[1]); };
    ok(hue(85) > 75, "85 is properly green rather than a yellow-green sludge");
    ok(hue(75) < 55, "75 is still gold, so the two are clearly different things");
    var back = 0, v;
    for (v = 1; v <= 100; v++) if (hue(v) < hue(v - 1)) back++;
    eq(back, 0, "and a better day is never a warmer colour than a worse one");
  })();

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

  /* ================= A POD IS NEVER CHARGED FOR GAINING SOMEBODY ==================
     Ali, 26.08.16: "its alwats better to have an extra person." Two requirements had scaled their
     denominator with TODAY's pod size, so an arrival could lower a pod that had lost nobody. N03
     was fixed on 26.08.15; N04 was found on the live board on 26.08.16, Pod A 93% -> 87% purely
     because Louise Hall joined it. The rule, written down so it cannot come back a third time:
     ADDING A PERSON MAY FAIL TO IMPROVE A POD. IT MUST NEVER MAKE IT WORSE. */
  (function () {
    var k1 = p({ id: "k1", name: "k1", grade: "ST", start: "2025-01-05" });
    var k2 = p({ id: "k2", name: "k2", grade: "ST", start: "2025-01-05" });
    var nn = p({ id: "n1", name: "n1", grade: "ST", start: "2025-01-05" });
    var y  = { A: ["k1", "k2"] };
    var n04 = function (sc) {
      var r = sc.pods.A.part.filter(function (x) { return x.id === "N04"; });
      if (r.length) return r[0].f;
      return sc.pods.A.met.indexOf("N04") !== -1 ? 1 : (sc.pods.A.missed.indexOf("N04") !== -1 ? 0 : null);
    };
    var two   = S.scoreDay(mkCtx({ A: [k1, k2] },     { prev: y }));
    var three = S.scoreDay(mkCtx({ A: [k1, k2, nn] }, { prev: y }));
    eq(n04(two), 1, "a pod that kept both of yesterday's people has full continuity");
    eq(n04(three), 1, "and still has it when a third person joins - the pod lost nobody");
    ok(three.pods.A.got >= two.pods.A.got - 1e-9,
      "gaining a person never lowers what the pod scored");

    /* THE OTHER DIRECTION STILL HAS TO WORK, or the fix is just a constant. */
    var lost = S.scoreDay(mkCtx({ A: [k1, nn] }, { prev: { A: ["k1", "k2", "x3", "x4"] } }));
    ok(n04(lost) < 1, "a pod that kept only one of four is still marked down");

    /* Nothing to keep is not a failure to keep it - the unmeetable-aim rule, 26.08.14. */
    var fresh = S.scoreDay(mkCtx({ A: [k1, k2] }, { prev: { B: ["z1"] } }));
    ok(fresh.pods.A.dropped.indexOf("N04") !== -1,
      "a pod that had nobody yesterday is not asked about continuity at all");
  })();

  /* ================= EVERY WEIGHT IS EDITABLE (PROJECT RULE 1) ================= */
  (function () {
    var pods = { A: [vetAir("a1"), vetAir("a2")], B: [vet("b1")], C: [], D: [], E: [] };
    var base = S.scoreDay(mkCtx(pods));
    /* 7, not 5: 5 is the default now, and a test that sets a weight to the value it already has
       proves nothing about whether the front end can move it. */
    var heavier = S.scoreDay(mkCtx(pods, { cfg: { w: { R04: 7 } } }));
    ok(base.pods.B.pct !== heavier.pods.B.pct || base.pods.B.app !== heavier.pods.B.app,
      "raising a weight from the front end moves the number");
    var offCfg = S.scoreDay(mkCtx(pods, { cfg: { off: { R04: true } } }));
    hasnt(offCfg.pods.B.missed, "R04", "switching a requirement off stops it being asked");
    hasnt(offCfg.pods.B.met, "R04", "and takes it out of the denominator rather than passing it");
    var moved = S.scoreDay(mkCtx({ A: [p({ name: "x", grade: "IMT", start: "2026-06-20" })], B: [], C: [], D: [], E: [] },
      { cfg: { newDays: 300 } }));
    has(moved.pods.A.missed, "N03", "moving the tier boundary moves who counts as new");
  })();

  /* ── NEURO, ADDED 26.08.15 AFTER A TEN-YEAR SIMULATION CAUGHT ITS ABSENCE ───────────────
     The fault these guard against is not a wrong number, it is a requirement the planner cannot
     see: R20 is week-scope, never enters the day percentage, and the planner optimises the day
     percentage. Every assertion below is about N06 being visible to that number. */
  (function () {
    var neuro = function (o) { o = o || {}; o.neuro = true; return p(o); };
    var plain = function (o) { return p(o || {}); };

    var onA = S.scoreDay(mkCtx({ A: [neuro({ name: "n1" }), plain({ name: "x1" })],
      B: [plain({ name: "x2" })], C: [plain({ name: "x3" })], D: [plain({ name: "x4" })], E: [plain({ name: "x5" })] }));
    has(onA.pods.A.missed, "N06", "a neuro placement on Pod A is a miss");

    var onC = S.scoreDay(mkCtx({ A: [plain({ name: "x1" })], B: [plain({ name: "x2" })],
      C: [neuro({ name: "n1" }), plain({ name: "x3" })], D: [plain({ name: "x4" })], E: [plain({ name: "x5" })] }));
    hasnt(onC.pods.C.missed, "N06", "the same person on Pod C is not");
    hasnt(onC.pods.C.met, "N06", "and C is not handed a free point for it either");

    var noneOn = S.scoreDay(mkCtx({ A: [plain({ name: "x1" })], B: [plain({ name: "x2" })],
      C: [plain({ name: "x3" })], D: [plain({ name: "x4" })], E: [plain({ name: "x5" })] }));
    hasnt(noneOn.pods.A.missed, "N06", "a pod holding nobody on a placement is never asked");
    hasnt(noneOn.pods.C.met, "N06", "and neither is C when there is no neuro trainee on at all");

    /* THE ASSERTION THAT MATTERS: moving them must change the number, or the planner still cannot
       see it however well the row is worded. Compared with the pods held at IDENTICAL sizes and
       skills, so the only thing that differs between the two worlds is which pod the neuro
       placement is standing in — otherwise this would be measuring headcount. */
    var mk = function (neuroOn) {
      var sk = { airway: true, transfer: true, start: "2024-01-01" };
      var mkP = function (nm, isN) {
        var o = { name: nm, grade: "ST", airway: sk.airway, transfer: sk.transfer, start: sk.start };
        if (isN) o.neuro = true;
        return p(o);
      };
      return S.scoreDay(mkCtx({
        A: [mkP("a1", neuroOn === "A"), mkP("a2")],
        B: [mkP("b1"), mkP("b2")],
        C: [mkP("c1", neuroOn === "C"), mkP("c2")],
        D: [mkP("d1"), mkP("d2")],
        E: [mkP("e1"), mkP("e2")]
      }));
    };
    var wrongPod = mk("A"), rightPod = mk("C");
    ok(rightPod.pods.A.pct > wrongPod.pods.A.pct, "Pod A scores better without them than with them");
    ok(rightPod.day.pct > wrongPod.day.pct, "and the DAY score moves too, which is what the planner reads");

    var two = S.scoreDay(mkCtx({ A: [neuro({ name: "n1" }), neuro({ name: "n2" })],
      B: [plain({ name: "x2" })], C: [plain({ name: "x3" })], D: [plain({ name: "x4" })], E: [plain({ name: "x5" })] }));
    ok(two.pods.A.pct < onA.pods.A.pct, "two of them on the wrong pod costs more than one");

    var offCfg = S.scoreDay(mkCtx({ A: [neuro({ name: "n1" })], B: [plain({ name: "x2" })],
      C: [plain({ name: "x3" })], D: [plain({ name: "x4" })], E: [plain({ name: "x5" })] }, { cfg: { off: { N06: true } } }));
    hasnt(offCfg.pods.A.missed, "N06", "and it can be switched off from the front end like everything else");
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
