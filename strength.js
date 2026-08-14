/* strength.js — pod strength scoring for the Pod Board.
 *
 * WHY THIS EXISTS
 * Thu 13 Aug 2026: Pod C held Breslin (IMT, 3 weeks on the unit) and Gutierrez (FY2)
 * — no airway, no transfer, no phone — while Pod A held three transfer-trained people.
 * Head counts were A3 B2 C2 D2 E2, so checkDay passed the day clean. The board could
 * count people but had no idea what they could do. This module is that idea.
 *
 * ONE COPY OF THE MATHS. The browser loads this file; the replay harness and the unit
 * tests require() this same file. There is deliberately no second implementation to
 * drift out of step. If the nightly Python allocator ever scores days, it must be fed
 * from here (see tests/strength-tests.js) rather than reimplementing.
 *
 * PROJECT RULE 1 — every number below is editable from Setup by an authorised user.
 * The defaults are a starting point, not a specification. Nothing here requires a code
 * edit to retune.
 *
 * HARD RULE 6 — this module reads only what somebody CAN DO (skills, weeks on the
 * unit, grade). It never reads, stores or exposes why anybody is absent. A person who
 * is not on a day simply does not appear in the pod, and no score explains their
 * absence.
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    /* Experience — three tiers. Ali, 26.08.14: "experience just 3 tiers". */
    newWeeks: 3,      // under this many weeks on the unit = New
    settleWeeks: 12,  // under this many = Settling, at or over = Established
    newPts: -3,       // "< 3 weeks is a massive negative unless been there before"
    settlePts: 1,
    estPts: 2,

    /* Substantive grades never rotate, so a blank start date means "years", not
     * "unknown". Verified 26.08.14: ACCP 0/11, ICM 0/11, SCF 0/11 carry a start date,
     * while the rotational grades carry one for 44 of 47. */
    substantive: ["ACCP", "ICM", "SCF"],

    /* Skills. Transfer deliberately carries weight because it mostly captures the
     * ACCP role (Ali, 26.08.14). */
    airwayPts: 3,
    transferPts: 2,
    phonePts: 1,

    /* Per-pod floors. Pod E is a smaller pod and scoring it against A-D made it the
     * weakest pod on 5 of the 6 worst days in the 42-day replay — a signal that only
     * ever said "E", which is no signal at all. Each pod is judged against what that
     * pod needs. */
    /* E defaults to 3 because that is what E has actually run at across the 42 stored
     * days — a floor of 4 flagged E almost every day, which is the crying-wolf fault
     * this whole model exists to avoid. It is a starting point for tuning on the real
     * board, not a clinical judgement: what Pod E OUGHT to need is Ali's call, and it
     * is editable in Setup. */
    floors: { A: 8, B: 8, C: 8, D: 8, E: 3 },

    /* How the day score is derived from the pod scores. Three options live side by
     * side so they can be compared on the real board rather than from a mockup:
     *   "floor" — biggest shortfall against each pod's own floor  (recommended)
     *   "min"   — the lowest raw pod score
     *   "avg"   — the mean pod score
     */
    mode: "floor",

    /* An unknown start date on a ROTATIONAL grade is genuinely unknown, not
     * substantive. Gutierrez (FY2) is the only such case as at 26.08.14. Scoring him
     * as Established would be the wrong direction, so unknowns are held at 0 and
     * surfaced rather than guessed. */
    unknownPts: 0
  };

  function cfgOf(over) {
    var c = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) c[k] = DEFAULTS[k];
    if (over) for (k in over) if (Object.prototype.hasOwnProperty.call(over, k) && over[k] != null) c[k] = over[k];
    c.floors = c.floors || DEFAULTS.floors;
    return c;
  }

  function weeksOn(person, onDate) {
    if (!person || !person.start) return null;
    var a = new Date(person.start), b = new Date(onDate);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.floor((b - a) / 604800000);
  }

  /* A returner is somebody back for a further block. It cannot be derived from data
   * held today: the board only has pod history from 27 Jul 2026, so a returner and a
   * genuinely new trainee look identical. It is a tick box on the person, and it
   * lifts New to Established — Ali, 26.08.14: "a massive negative unless been there
   * before". */
  function tierOf(person, onDate, cfg) {
    cfg = cfgOf(cfg);
    if (!person) return { tier: "unknown", pts: cfg.unknownPts };
    if (cfg.substantive.indexOf(person.grade) !== -1) return { tier: "established", pts: cfg.estPts };
    if (person.returner) return { tier: "established", pts: cfg.estPts };
    var w = weeksOn(person, onDate);
    if (w == null) return { tier: "unknown", pts: cfg.unknownPts };
    if (w < cfg.newWeeks) return { tier: "new", pts: cfg.newPts };
    if (w < cfg.settleWeeks) return { tier: "settling", pts: cfg.settlePts };
    return { tier: "established", pts: cfg.estPts };
  }

  function personScore(person, onDate, cfg) {
    cfg = cfgOf(cfg);
    var t = tierOf(person, onDate, cfg), pts = t.pts, has = [];
    if (person && person.airway) { pts += cfg.airwayPts; has.push("airway"); }
    if (person && person.transfer) { pts += cfg.transferPts; has.push("transfer"); }
    if (person && person.phoneHolder) { pts += cfg.phonePts; has.push("phone"); }
    return { pts: pts, tier: t.tier, skills: has };
  }

  function podScore(assign, staffById, onDate, pod, cfg) {
    cfg = cfgOf(cfg);
    var pts = 0, people = [], gaps = [], nAir = 0, nTrans = 0, nNew = 0, i, p, s;
    assign = assign || [];
    for (i = 0; i < assign.length; i++) {
      p = staffById[assign[i].id];
      s = personScore(p, onDate, cfg);
      pts += s.pts;
      if (p && p.airway) nAir++;
      if (p && p.transfer) nTrans++;
      if (s.tier === "new") nNew++;
      people.push({ id: assign[i].id, shift: assign[i].shift, pts: s.pts, tier: s.tier, skills: s.skills });
    }
    var floor = (cfg.floors && cfg.floors[pod] != null) ? cfg.floors[pod] : 8;

    /* The reasons carried on the dial. These are what turn a number into an action —
     * a bare score tells nobody which person to move. */
    if (!assign.length) gaps.push("empty");
    else {
      if (!nAir) gaps.push("no airway");
      if (!nTrans) gaps.push("no transfer");
      if (nNew && nNew === assign.length) gaps.push(assign.length === 1 ? "only person is new" : "everybody new");
    }

    return {
      pod: pod, pts: pts, floor: floor,
      short: Math.max(0, floor - pts),
      meets: pts >= floor,
      airway: nAir, transfer: nTrans, newcomers: nNew,
      gaps: gaps, people: people
    };
  }

  function dayScore(day, staffById, onDate, cfg) {
    cfg = cfgOf(cfg);
    var pods = {}, list = [], order = ["A", "B", "C", "D", "E"], i, pod, sc;
    for (i = 0; i < order.length; i++) {
      pod = order[i];
      var cell = (day && day.pods && day.pods[pod]) || null;
      if (!cell) continue;
      sc = podScore(cell.assign, staffById, onDate, pod, cfg);
      pods[pod] = sc;
      list.push(sc);
    }
    if (!list.length) return { pods: pods, score: null, weakest: null, mode: cfg.mode, empty: true };

    var byShort = list.slice().sort(function (a, b) { return b.short - a.short || a.pts - b.pts; });
    var byPts = list.slice().sort(function (a, b) { return a.pts - b.pts; });
    var mean = list.reduce(function (a, b) { return a + b.pts; }, 0) / list.length;

    var score, weakest;
    if (cfg.mode === "avg") { score = Math.round(mean * 10) / 10; weakest = byPts[0].pod; }
    else if (cfg.mode === "min") { score = byPts[0].pts; weakest = byPts[0].pod; }
    else { score = byShort[0].short; weakest = byShort[0].short > 0 ? byShort[0].pod : null; }

    return {
      pods: pods, score: score, weakest: weakest, mode: cfg.mode,
      min: byPts[0].pts, max: byPts[byPts.length - 1].pts,
      avg: Math.round(mean * 10) / 10,
      worstShort: byShort[0].short,
      ok: byShort[0].short === 0
    };
  }

  /* Band for colouring. Driven by shortfall so that a small pod meeting its own floor
   * reads the same green as a large one meeting its larger floor. */
  function band(podSc) {
    if (!podSc) return "unknown";
    if (podSc.short === 0) return "ok";
    if (podSc.short <= 3) return "thin";
    return "bare";
  }

  function indexStaff(staff) {
    var by = {}, i;
    staff = staff || [];
    for (i = 0; i < staff.length; i++) by[staff[i].id] = staff[i];
    return by;
  }

  var API = {
    DEFAULTS: DEFAULTS,
    cfgOf: cfgOf,
    weeksOn: weeksOn,
    tierOf: tierOf,
    personScore: personScore,
    podScore: podScore,
    dayScore: dayScore,
    band: band,
    indexStaff: indexStaff
  };

  if (typeof module === "object" && module.exports) module.exports = API;
  root.Strength = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
