/*
 * THE WEEK PLANNER — one file, no dependency on the board, drop-in.
 *
 * It replaces the way the pod board decides who goes where. The board decides one person at a
 * time, one day at a time, never looks back, and then runs four tidy-up passes that each move two
 * people to fix one thing. This decides the WHOLE WEEK at once, prices everything the unit cares
 * about, and keeps improving the week until it cannot find a better arrangement. Then it never
 * touches it again: a person off sick repairs that day and only that day.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULES IT OBEYS, in the order they give way (docs/POD-STRENGTH-ALGORITHM.md, ratified).
 * Everything above costs more than any combination of everything below it, so the search can
 * never buy a higher rule with a pile of lower ones.
 *
 *   1  a long day in every pod that has people in it            never yields
 *   2  airway, or failing that transfer, in A-D                 POD E IS EXCLUDED
 *   3  nobody on three pods in a week
 *   4  the day phone never on Pod E
 *   5  Pod E never the biggest, and no long day on E before A-D
 *   6  out and back in a week allowed, but it should be uncommon
 *
 * Supernumeraries are placed LAST and counted nowhere. Locums are counted like anybody else.
 * Where a pod genuinely cannot be covered the gap is left on Pod E, and said out loud.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS NEW HERE, over the from-scratch arm that won the 26.08.19 bake-off (85.4 against the
 * live board's 67.1). Each of these was one of that arm's three losing standards:
 *
 *   A SICK DAY REPAIRS THAT DAY ONLY.  `repairDay` never replans the week. The winning arm
 *      replanned, and one person going off moved fifteen others — a direct breach of a ratified
 *      rule and, on its own, a reason it could not ship.
 *
 *   THE WEEKEND MOVES WITHIN A PAIR.  If somebody must change pod between Saturday and Sunday,
 *      A-B and C-D are the cheap moves and everything else is priced.
 *
 *   THE FIVE PODS OVER A WHOLE PLACEMENT.  Not by shuffling people inside a week — that was
 *      tried, and it made both the churn and the share worse. The rotation happens BETWEEN weeks,
 *      in the choice of home pod: the pod you have done least of is the pod you are given next.
 *      It costs nothing inside a week and it is the only thing that ever moved this measure.
 *
 * Everything else is carried over deliberately, because it was swept rather than chosen: the
 * search itself, pricing every move and not just the ones past the cap, pricing a second pod, and
 * the restarts. See the header of docs/bench/claude-planner.js for those numbers.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PROJECT RULE 1 — nothing here needs a code edit. Every weight and every threshold is in CFG,
 * which the page overrides from Setup. The values below are the fallback, not the setting.
 */
(function (root) {
  "use strict";

  var PODS = ["A", "B", "C", "D", "E"];
  var AD = ["A", "B", "C", "D"];
  var PAIR = { A: "B", B: "A", C: "D", D: "C" };

  /* ── every number, all in one place ──────────────────────────────────────────────────────
     THE GAPS ARE THE BREAK ORDER, and they are strict: each rule costs more than every rule
     below it added together, several times over, so the search can never buy a broken rule with
     a bundle of cheap ones. `planner-tests.js` asserts that arithmetic, because the first draft
     of these numbers failed it — a cover gap could be bought with a third pod, a phone on Pod E
     and a couple of extra moves, which is exactly the trade the four old repair passes made
     every night. Strict pricing cost 1.5 points on the 19-week store data and gained 0.3 on the
     13-week Optima roster; the whole of that 1.5 was one weekend move out of two. */
  var CFG = {
    // rules, in break order
    noLongDay: 12000,         // 1 · a staffed pod with nobody on a long day
    coverNone: 4000,          // 2 · an A-D pod with neither airway nor transfer
    coverTransferOnly: 60,    //     transfer instead of airway: acceptable, not ideal
    thirdPod: 1400,           // 3 · a third pod in one week
    phoneOnE: 600,            // 4 · the day phone on Pod E
    eLongDayEarly: 520,       // 5 · Pod E takes a long day before A-D have one
    gapNotOnE: 800,          //     a pod left empty that is not Pod E
    eBiggest: 260,            //     Pod E the biggest — below a third pod, as measured 26.08.15
    extraMove: 90,            // 6 · out and back
    anyMove: 50,              //     ...and the first move is not free either
    secondPod: 70,            //     ...nor is a second pod

    // preferences — may never break a rule
    spread: 150,              // pods within one of each other
    weekendCross: 600,        // a Sat-to-Sun move that leaves the pair
    allNewPod: 300,           // a pod carried entirely by people in their first weeks
    noPhoneTrained: 40,       // an A-D pod with nobody phone-trained
    airwayOnE: 420,           // airway does a lower share of Pod E — 140 left it there on 16% of days
    airwayLDPairGap: 200,     // one side of the unit (A/B or C/D) has no airway long day while the
                              // other has one to spare — Ali, 26.08.25, after a 7-LD day left C/D
                              // bare: "aim to have 1 airway LD on A/B and C/D". Only charged when
                              // the day genuinely has enough airway long days to split (2+); a day
                              // with one airway long day on the whole unit cannot be fixed by
                              // moving anybody and is not charged for it.
    eUnfair: 2,               // per day of Pod E already carried recently
    neuroOffCD: 14,           // the 60-70% band, per person
    accpStack: 25,
    accpGap: 18,
    offHome: 20,              // a day spent outside your own home pod

    // home pods, chosen once a week, and the only place cross-week rotation happens
    rotate: 26,               // per day already spent in that pod over the whole stay
    rotateWindow: 60,         // ...counted over this many pod-days, so it forgets slowly

    // thresholds
    newDays: 91,              // inside this many days of starting = "new"
    eMemoryDecay: 0.88,       // how fast Pod E fairness forgets, per week
    phoneMaxPerWeek: 2,
    phoneMinShifts: 2,        // never the phone in your first two rostered shifts
    weekMoveCap: 1,           // moves per person per week before it costs extra
    nightEFrom: 5,            // Pod E is covered alone, by the phone holder, from this many on
    nightBalanceSides: true,  // keep A&B and C-D-E within one of each other
    restarts: 16,
    maxEvals: 6000,
    podMin: 2,                // A-D
    podEMin: 1
  };

  // ── small helpers ───────────────────────────────────────────────────────────────────────
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
  }
  function blankHistory() {
    return { eDays: {}, phoneHeld: {}, phoneElig: {}, podDays: {}, shifts: {}, home: {},
      nightPhone: {}, nightElig: {}, nightSide: {}, lastNightPhone: null };
  }

  /* Pods within one of each other, Pod E the smallest, and FREE WHICH POD CARRIES THE SPARE.
     The old board pinned each pod to an exact number and rotated the spare A-B-C-D by week,
     which is what makes somebody move on a Tuesday for no clinical reason. */
  function capsFor(n) {
    var base = Math.floor(n / 5), rem = n % 5, cap = {};
    for (var i = 0; i < PODS.length; i++) {
      var p = PODS[i];
      cap[p] = base + (p === "E" ? 0 : (rem > 0 ? 1 : 0));
    }
    if (rem === 0) cap.E = base;
    return cap;
  }

  /* ── who is on, and in what capacity ─────────────────────────────────────────────────────
     Counted staff and supernumeraries are separated here and never mixed again: a supernumerary
     cannot make a pod too big, too small or short of a long day, and must never compete for a
     place beside somebody who is counted. */
  function dutiesFor(weekKey, roster, staff, cfg) {
    var on = [], supers = [], isNew = {};
    for (var di = 0; di < 7; di++) {
      var iso = addDays(weekKey, di), r = roster[iso] || {}, m = {}, sup = [];
      for (var id in r) {
        if (r[id].kind !== "day") continue;
        var s = staff[id] || {};
        if (s.supernum) { sup.push(id); continue; }
        m[id] = String(r[id].code || "").toUpperCase().indexOf("LD") === 0 ? "LD" : "SD";
        if (isNew[id] === undefined)
          isNew[id] = !!(s.start && daysBetween(s.start, iso) < cfg.newDays);
      }
      on.push(m); supers.push(sup);
    }
    return { on: on, supers: supers, isNew: isNew };
  }

  /* ── 1 · HOME PODS, WEEKEND FIRST ────────────────────────────────────────────────────────
     Everybody gets one, including the 40% who work one or two days a week — it costs nothing
     and it stops a two-day person being split across two pods.

     The weekend is settled first because it has almost no freedom: nine to eleven people across
     five pods, in paired crews. Then Friday and Monday, which touch it. Then the midweek, which
     has the slack to absorb whatever is left.

     THIS IS ALSO WHERE THE FIVE-PODS-OVER-A-PLACEMENT AIM LIVES. A pod the person has done least
     of is cheaper than one they have done most of, so over a placement the home pod rotates by
     itself. Inside a week it changes nothing, which is exactly why it works where shuffling
     people mid-week did not. */
  function homePods(on, staff, hist, cfg) {
    var home = {}, ORDER = [5, 6, 4, 0, 1, 2, 3];
    var S = function (id) { return staff[id] || {}; };
    for (var oi = 0; oi < ORDER.length; oi++) {
      var di = ORDER[oi], ids = Object.keys(on[di]);
      if (!ids.length) continue;
      var cap = capsFor(ids.length);
      var cnt = {}, ld = {}, air = {}, accp = {}, ph = {};
      for (var i = 0; i < PODS.length; i++) { var p0 = PODS[i]; cnt[p0] = 0; ld[p0] = 0; air[p0] = 0; accp[p0] = 0; ph[p0] = 0; }
      var note = function (p, id) {
        cnt[p]++;
        if (on[di][id] === "LD") ld[p]++;
        if (S(id).airway) air[p]++;
        if (S(id).phoneHolder || S(id).phone) ph[p]++;
        if (S(id).grade === "ACCP") accp[p]++;
      };
      var todo = [];
      for (var k = 0; k < ids.length; k++) {
        var id2 = ids[k], h = home[id2];
        if (h && cnt[h] < cap[h]) note(h, id2); else todo.push(id2);
      }
      // long days first, then airway: the two things a pod cannot do without
      todo.sort(function (a, b) {
        return ((on[di][b] === "LD") - (on[di][a] === "LD")) ||
               ((S(b).airway ? 1 : 0) - (S(a).airway ? 1 : 0)) ||
               String(S(a).name || a).localeCompare(String(S(b).name || b));
      });
      for (var t = 0; t < todo.length; t++) {
        var id = todo[t], best = null, bs = -Infinity;
        var seen = hist.podDays[id] || {};
        var total = 0;
        for (var q = 0; q < PODS.length; q++) total += seen[PODS[q]] || 0;
        var scale = total > cfg.rotateWindow ? cfg.rotateWindow / total : 1;
        for (var pi = 0; pi < PODS.length; pi++) {
          var p = PODS[pi];
          if (cnt[p] >= cap[p]) continue;
          var sc = (cap[p] - cnt[p]) * 5;
          if (on[di][id] === "LD") { if (!ld[p]) sc += 40; if (p === "E") sc -= 30; }
          if (S(id).airway) { if (p !== "E" && !air[p]) sc += 20; if (p === "E") sc -= 60; }
          else if (S(id).transfer && p !== "E" && !air[p]) sc += 8;
          if ((S(id).phoneHolder || S(id).phone) && p !== "E" && !ph[p]) sc += 6;
          if (S(id).neuro && (p === "C" || p === "D")) sc += 18;
          if (S(id).grade === "ACCP") { if (!accp[p]) sc += 10; else sc -= 12 * accp[p]; }
          if (p === "E") sc -= (hist.eDays[id] || 0) * 3;
          /* THE ROTATION, over the whole stay — and it runs across A-D only for airway-trained
             people, who are deliberately kept off Pod E. Rotating them onto E for fairness put an
             airway person there on 16% of days and cost more than the fairness was worth. */
          if (p !== "E" || !S(id).airway) sc -= ((seen[p] || 0) * scale) * (cfg.rotate / 10);
          if (sc > bs) { bs = sc; best = p; }
        }
        home[id] = best || "A";
        note(home[id], id);
      }
    }
    return home;
  }

  // ── 2 · seed each day from the home pods ────────────────────────────────────────────────
  function seed(on, home, shuffleRound) {
    var out = [];
    for (var di = 0; di < 7; di++) {
      var ids = Object.keys(on[di]), byPod = {};
      for (var i = 0; i < PODS.length; i++) byPod[PODS[i]] = [];
      if (!ids.length) { out.push(byPod); continue; }
      if (shuffleRound) {
        for (var j = ids.length - 1; j > 0; j--) {
          var m = (j * 2654435761 + shuffleRound * 40503 + ids.length) % (j + 1);
          var tmp = ids[j]; ids[j] = ids[m]; ids[m] = tmp;
        }
      }
      var cap = capsFor(ids.length), spill = [];
      for (var k = 0; k < ids.length; k++) {
        var h = home[ids[k]];
        if (h && byPod[h].length < cap[h]) byPod[h].push(ids[k]); else spill.push(ids[k]);
      }
      for (var s = 0; s < spill.length; s++) {
        var room = [];
        for (var q = 0; q < PODS.length; q++) if (byPod[PODS[q]].length < cap[PODS[q]]) room.push(PODS[q]);
        room.sort(function (a, b) { return byPod[a].length - byPod[b].length; });
        byPod[room[0] || "A"].push(spill[s]);
      }
      out.push(byPod);
    }
    return out;
  }

  /* ── 3 · WHAT A WEEK COSTS ───────────────────────────────────────────────────────────────
     Called tens of thousands of times by the search, so it keeps its allocations down: no Sets,
     no sorts, and the per-person pod list is a string because a week has five pods in it. */
  function weekCost(plan, on, home, staff, hist, isNew, cfg) {
    var cost = 0, podsOf = {}, lastPod = {}, moves = {}, neuroCD = {}, neuroTot = {};
    var S = function (id) { return staff[id] || {}; };
    var satPod = {}, sunPod = {};

    for (var di = 0; di < 7; di++) {
      var byPod = plan[di], m = on[di];
      var ids = Object.keys(m);
      if (!ids.length) continue;
      var size = {}, ld = {}, air = {}, ldAir = {}, tr = {}, accp = {}, phTrained = {}, allNew = {};
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi], list = byPod[p] || [];
        size[p] = list.length; ld[p] = false; air[p] = false; ldAir[p] = 0; tr[p] = false;
        accp[p] = 0; phTrained[p] = false; allNew[p] = list.length > 0;
        for (var li = 0; li < list.length; li++) {
          var id = list[li], s = S(id);
          if (m[id] === "LD") ld[p] = true;
          if (s.airway) air[p] = true;
          if (s.airway && m[id] === "LD") ldAir[p]++;
          if (s.transfer) tr[p] = true;
          if (s.phoneHolder || s.phone) phTrained[p] = true;
          if (s.grade === "ACCP") accp[p]++;
          if (!isNew[id]) allNew[p] = false;

          var had = podsOf[id] || (podsOf[id] = "");
          if (had.indexOf(p) < 0) podsOf[id] = had + p;
          if (lastPod[id] && lastPod[id] !== p) moves[id] = (moves[id] || 0) + 1;
          lastPod[id] = p;
          if (di === 5) satPod[id] = p;
          if (di === 6) sunPod[id] = p;

          if (p === "E") {
            cost += (hist.eDays[id] || 0) * cfg.eUnfair;
            if (s.airway) cost += cfg.airwayOnE;
          }
          if (s.neuro) {
            neuroTot[id] = (neuroTot[id] || 0) + 1;
            if (p === "C" || p === "D") neuroCD[id] = (neuroCD[id] || 0) + 1;
          }
        }
        if (size[p] > 0 && !ld[p]) cost += cfg.noLongDay;
        if (p !== "E" && size[p] > 0 && !air[p]) cost += tr[p] ? cfg.coverTransferOnly : cfg.coverNone;
        if (p !== "E" && size[p] > 0 && !phTrained[p]) cost += cfg.noPhoneTrained;
        if (size[p] > 0 && allNew[p]) cost += cfg.allNewPod;
        if (accp[p] >= 2) cost += cfg.accpStack * (accp[p] - 1);
      }
      /* ONE AIRWAY LONG DAY EACH SIDE — A&B and C&D — mirroring the night-team split below.
         Only charged when the day has two or more airway long days to work with; one airway
         long day on the whole unit cannot be split and is not the allocator's fault. */
      var abLdAir = (ldAir.A || 0) + (ldAir.B || 0), cdLdAir = (ldAir.C || 0) + (ldAir.D || 0);
      if (abLdAir === 0 && cdLdAir >= 2) cost += cfg.airwayLDPairGap;
      else if (cdLdAir === 0 && abLdAir >= 2) cost += cfg.airwayLDPairGap;
      var mx = -Infinity, mn = Infinity;
      for (var z = 0; z < PODS.length; z++) {
        var v = size[PODS[z]];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      if (mx - mn > 1) cost += cfg.spread * (mx - mn - 1);
      if (size.E === mx && size.E > mn) cost += cfg.eBiggest;
      /* WHERE A POD CANNOT BE STAFFED, THE GAP GOES ON POD E, because Pod E is the smallest
         (docs/POD-STRENGTH-ALGORITHM.md). Found 26.08.20 on Wednesday 5 August, a seven-person
         day the planner wrote as 0/2/2/2/1 — Pod A closed while Pod E ran. One day in 91, and
         wrong every time. */
      if (size.E > 0) for (var e1 = 0; e1 < AD.length; e1++) if (size[AD[e1]] === 0) { cost += cfg.gapNotOnE; break; }
      if (ld.E) for (var a1 = 0; a1 < AD.length; a1++) if (size[AD[a1]] > 0 && !ld[AD[a1]]) { cost += cfg.eLongDayEarly; break; }
      var gaps = 0, stacked = false;
      for (var a2 = 0; a2 < AD.length; a2++) {
        if (size[AD[a2]] > 0 && !accp[AD[a2]]) gaps++;
        if (size[AD[a2]] > 0 && accp[AD[a2]] > 1) stacked = true;
      }
      if (gaps && stacked) cost += cfg.accpGap * gaps;
    }

    /* THE WEEKEND. Somebody on both days should keep the same pod; if the numbers will not allow
       it, A-B and C-D are the moves that keep a crew together and anything else is priced. */
    for (var wid in satPod) {
      if (sunPod[wid] === undefined || sunPod[wid] === satPod[wid]) continue;
      if (PAIR[satPod[wid]] !== sunPod[wid]) cost += cfg.weekendCross;
    }

    /* 60-70% of a neuro trainee's shifts on C and D, PER PERSON — a band, not a maximum.
       Charging per shift off C/D just drives it to 100%, which is not what was asked for and
       costs every other pod that person's skills. */
    for (var nid in neuroTot) {
      var tot = neuroTot[nid];
      if (tot < 2) continue;
      var share = (neuroCD[nid] || 0) / tot;
      if (share < 0.60) cost += cfg.neuroOffCD * (0.60 - share) * tot * 4;
      if (share > 0.75) cost += cfg.neuroOffCD * (share - 0.75) * tot * 4;
    }
    for (var id2 in podsOf) {
      var n = podsOf[id2].length;
      if (n > 2) cost += cfg.thirdPod * (n - 2);
      if (n > 1) cost += cfg.secondPod * (n - 1);
      var mv = moves[id2] || 0;
      cost += cfg.anyMove * mv;
      if (mv > cfg.weekMoveCap) cost += cfg.extraMove * (mv - cfg.weekMoveCap);
      if (home[id2] && podsOf[id2].indexOf(home[id2]) < 0) cost += cfg.offHome;
    }
    return cost;
  }

  /* FIRST improvement, not best improvement. Best-improvement scans every pair before committing
     to anything — around 950 whole-week evaluations per single swap — and took longer than the
     entire test suite. Taking the first swap that helps and starting again lands in the same
     place for a fraction of the work: it is the cost function, not the search order, that decides
     the answer. */
  function improve(plan, on, home, staff, hist, isNew, cfg) {
    var cost = weekCost(plan, on, home, staff, hist, isNew, cfg);
    var evals = 0, improved = true;
    while (improved && evals < cfg.maxEvals) {
      improved = false;
      for (var di = 0; di < 7 && evals < cfg.maxEvals; di++) {
        var byPod = plan[di], ids = Object.keys(on[di]);
        if (ids.length < 2) continue;
        var where = {}, cap = capsFor(ids.length);
        for (var pi = 0; pi < PODS.length; pi++)
          for (var li = 0; li < byPod[PODS[pi]].length; li++) where[byPod[PODS[pi]][li]] = PODS[pi];
        /* A straight move as well as a swap. Swap-only cannot reach an arrangement that needs one
           pod to grow by one and another to shrink, which is most of what "free which pod carries
           the spare person" is for. */
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i], from = where[id];
          for (var pj = 0; pj < PODS.length; pj++) {
            var to = PODS[pj];
            if (to === from || byPod[to].length >= cap[to]) continue;
            evals++;
            byPod[from].splice(byPod[from].indexOf(id), 1); byPod[to].push(id);
            var c2 = weekCost(plan, on, home, staff, hist, isNew, cfg);
            if (c2 < cost) { cost = c2; where[id] = to; improved = true; break; }
            byPod[to].pop(); byPod[from].push(id);
          }
        }
        for (var a = 0; a < ids.length; a++) {
          for (var b = a + 1; b < ids.length; b++) {
            var A = ids[a], B = ids[b], pa = where[A], pb = where[B];
            if (!pa || !pb || pa === pb) continue;
            evals++;
            swapIn(byPod, pa, A, pb, B);
            var c = weekCost(plan, on, home, staff, hist, isNew, cfg);
            if (c < cost) { cost = c; where[A] = pb; where[B] = pa; improved = true; }
            else swapIn(byPod, pa, B, pb, A);
            if (evals >= cfg.maxEvals) break;
          }
          if (evals >= cfg.maxEvals) break;
        }
      }
    }
    return plan;
  }
  function swapIn(byPod, pa, A, pb, B) {
    byPod[pa][byPod[pa].indexOf(A)] = B;
    byPod[pb][byPod[pb].indexOf(B)] = A;
  }

  /* ── 4 · THE PHONE ───────────────────────────────────────────────────────────────────────
     A long day · never Pod E · never three days running · at most twice in one week · never in
     somebody's first two rostered shifts. Then the person who has held it least PER ELIGIBLE
     LONG DAY, so the rate evens out rather than the raw count — somebody who works one day a
     week is not owed as many turns as somebody who works five.

     Only the last two conditions ever relax, and only when the alternative is nobody at all. */
  function pickPhone(plan, on, staff, hist, cfg, weekKey) {
    var S = function (id) { return staff[id] || {}; };
    /* "First two rostered shifts" means new to the unit, not new to this run of the planner. A
       person with a start date well behind us has done their two shifts whether or not this
       process watched them do it. */
    var shiftsOf = function (id) {
      if (hist.shifts[id] != null) return hist.shifts[id];
      var st = S(id).start;
      return (st && weekKey && daysBetween(st, weekKey) > 14) ? 99 : 0;
    };
    var week = {}, out = [], run = null;
    for (var di = 0; di < 7; di++) {
      var m = on[di], all = [];
      for (var id in m) if ((S(id).phoneHolder || S(id).phone) && m[id] === "LD") all.push(id);
      for (var i = 0; i < all.length; i++) {
        hist.phoneHeld[all[i]] = hist.phoneHeld[all[i]] || 0;
        hist.phoneElig[all[i]] = (hist.phoneElig[all[i]] || 0) + 1;
      }
      var onE = plan[di].E || [];
      var cands = all.filter(function (x) { return onE.indexOf(x) < 0; });
      var strict = cands.filter(function (x) {
        return (week[x] || 0) < cfg.phoneMaxPerWeek &&
               shiftsOf(x) >= cfg.phoneMinShifts &&
               !(run && run.id === x && run.n >= 2);
      });
      if (!strict.length) strict = cands.filter(function (x) {
        return (week[x] || 0) < cfg.phoneMaxPerWeek && !(run && run.id === x && run.n >= 2);
      });
      if (!strict.length) strict = cands.filter(function (x) { return (week[x] || 0) < cfg.phoneMaxPerWeek; });
      if (!strict.length) strict = cands;
      if (!strict.length) { out.push(null); run = null; continue; }
      strict.sort(function (a, b) {
        var ra = hist.phoneHeld[a] / (hist.phoneElig[a] || 1), rb = hist.phoneHeld[b] / (hist.phoneElig[b] || 1);
        return ra - rb || (hist.phoneHeld[a] - hist.phoneHeld[b]) ||
               String(S(a).name || a).localeCompare(String(S(b).name || b));
      });
      var pick = strict[0];
      hist.phoneHeld[pick]++;
      week[pick] = (week[pick] || 0) + 1;
      run = (run && run.id === pick) ? { id: pick, n: run.n + 1 } : { id: pick, n: 1 };
      out.push(pick);
    }
    return out;
  }

  /* ── 5 · THE NIGHT TEAM ──────────────────────────────────────────────────────────────────
     Nights are NOT five pods. The board splits the team into two sides — A&B, and C-D-E — and
     when five are on, one person covers Pod E alone and that person is the phone holder. So
     there are three things to get right, and all three are standards:

       · AN AIRWAY-TRAINED PERSON ON EACH SIDE. Neither half of the unit should be bare at three
         in the morning. Where only one airway person is on nights at all, this cannot be done and
         is not held against the night.
       · THE PHONE CHANGES HANDS between consecutive nights. Four nights running is a week nobody
         should have.
       · EVERYBODY ELSE KEEPS THEIR SIDE across the run. Moving to Pod E to take the phone is the
         one allowed exception — it is the phone that moved, not the person's team.

     A run of nights is worked by the same small group night after night, so the side is decided
     ONCE, on the first night of the run, and then held. That is why this needs no search. */
  function planNights(weekKey, roster, staff, hist, cfg) {
    var S = function (id) { return staff[id] || {}; };
    /* A run of nights does not respect Monday. Re-dealing the sides at every week boundary moved
       people for nothing on thirteen nights in thirteen weeks, so the side is carried in the
       history like everything else. */
    var out = [], side = Object.assign({}, hist.nightSide || {}), lastPhone = hist.lastNightPhone || null;
    for (var di = 0; di < 7; di++) {
      var iso = addDays(weekKey, di), r = roster[iso] || {};
      var team = [], sup = [];
      for (var id in r) {
        if (r[id].kind !== "night") continue;
        if (S(id).supernum) { sup.push(id); continue; }
        team.push(id);
      }
      if (!team.length) { out.push({ phone: null, AB: [], CDE: [], E: [], super: sup }); lastPhone = null; continue; }
      team.sort(function (a, b) { return String(S(a).name || a).localeCompare(String(S(b).name || b)); });

      /* The phone: qualified, and never the same person as last night if there is anybody else.
         Then whoever has held it least per night worked, so the rate evens out. */
      /* Nights keep their OWN fairness counters. Sharing them with the day phone was a real bug:
         a night eligibility counted against somebody's day-phone rate, and the day spread went
         from 0.14 to 0.25 without a single day changing. */
      var elig = team.filter(function (x) { return S(x).phoneHolder || S(x).phone; });
      hist.nightElig = hist.nightElig || {};
      for (var e = 0; e < elig.length; e++) hist.nightElig[elig[e]] = (hist.nightElig[elig[e]] || 0) + 1;
      var pick = null;
      /* It changes hands unless there is literally nobody else qualified on that night, which is
         a fact about the roster rather than a choice the allocator gets to make. */
      var fresh = elig.filter(function (x) { return x !== lastPhone; });
      var pool = fresh.length ? fresh : elig;
      pool.sort(function (a, b) {
        var ra = (hist.nightPhone && hist.nightPhone[a] || 0) / (hist.nightElig[a] || 1);
        var rb = (hist.nightPhone && hist.nightPhone[b] || 0) / (hist.nightElig[b] || 1);
        return ra - rb || String(S(a).name || a).localeCompare(String(S(b).name || b));
      });
      pick = pool[0] || null;
      if (pick) { hist.nightPhone = hist.nightPhone || {}; hist.nightPhone[pick] = (hist.nightPhone[pick] || 0) + 1; }

      /* Pod E: one person alone, and it is the phone holder — but only when five or more are on.
         With four the unit does not split off a fifth, so nobody stands alone on E. */
      var E = [], rest = team.slice();
      if (team.length >= cfg.nightEFrom && pick) {
        E = [pick];
        rest = rest.filter(function (x) { return x !== pick; });
      }

      /* Sides. Anybody who was on a side last night keeps it. The rest are dealt out so the two
         sides differ by at most one — C-D-E takes the extra, because it covers three pods — and
         so that each side gets an airway-trained person before either gets a second. */
      var AB = [], CDE = [], spare = [];
      for (var i = 0; i < rest.length; i++) {
        var who = rest[i];
        if (side[who] === "AB") AB.push(who);
        else if (side[who] === "CDE") CDE.push(who);
        else spare.push(who);
      }
      spare.sort(function (a, b) { return (S(b).airway ? 1 : 0) - (S(a).airway ? 1 : 0) ||
        String(S(a).name || a).localeCompare(String(S(b).name || b)); });
      var capAB = Math.floor(rest.length / 2);
      for (var s2 = 0; s2 < spare.length; s2++) {
        var x = spare[s2];
        var abAir = AB.some(function (y) { return S(y).airway; });
        var cdAir = CDE.some(function (y) { return S(y).airway; });
        var to;
        if (S(x).airway && !abAir && cdAir) to = "AB";
        else if (S(x).airway && !cdAir && abAir) to = "CDE";
        else if (AB.length < capAB) to = "AB";
        else to = "CDE";
        (to === "AB" ? AB : CDE).push(x);
      }
      /* The two sides should be within one of each other. Keeping your side is a preference and
         it can leave A&B with one person and C-D-E with three, which is neither fair nor safe. */
      for (var bal = 0; bal < 4 && cfg.nightBalanceSides; bal++) {
        if (AB.length - CDE.length > 1) CDE.push(AB.pop());
        else if (CDE.length - AB.length > 1) AB.push(CDE.pop());
        else break;
      }

      /* AN AIRWAY PERSON ON EACH SIDE — meaning A&B and C&D. Ali, 26.08.19: "if 5 people the
         phone holder goes on E. If only 4 and 2 airways on try and split them between A/B and
         C/D." Pod E is not a side: whoever is there is standing alone with the phone.

         AND THE PHONE HOLDER IS ALWAYS AIRWAY-TRAINED — every one of the 32 phone-trained people
         on the unit is airway-trained, with no exceptions. So with five on, one airway person is
         spoken for before the sides are dealt at all, and the split is only achievable when there
         are TWO MORE besides. That is 41 of the 91 nights in this roster, not 81; measuring it
         against the team's total airway count flattered it and hid the nights it could not be
         done. Where it cannot be done, one side is bare and that is the rota, not the allocator.

         Splitting outranks keeping your side, because it is cover at three in the morning. */
      var isAir = function (y) { return S(y).airway; };
      for (var g = 0; g < 4; g++) {
        var abAir = AB.filter(isAir).length, cdAir = CDE.filter(isAir).length;
        var donor = null, taker = null;
        if (abAir === 0 && cdAir >= 2) { donor = CDE; taker = AB; }
        else if (cdAir === 0 && abAir >= 2) { donor = AB; taker = CDE; }
        else break;
        var give = donor.filter(isAir)[donor.filter(isAir).length - 1];
        if (!give) break;
        var take = taker.filter(function (y) { return !isAir(y); })[0];
        if (take) { donor[donor.indexOf(give)] = take; taker[taker.indexOf(take)] = give; }
        else { donor.splice(donor.indexOf(give), 1); taker.push(give); }
      }

      for (var a2 = 0; a2 < AB.length; a2++) side[AB[a2]] = "AB";
      for (var c2 = 0; c2 < CDE.length; c2++) side[CDE[c2]] = "CDE";
      if (E.length) side[E[0]] = side[E[0]] || "CDE";     // remembered by their side, not by Pod E
      lastPhone = pick;
      out.push({ phone: pick, AB: AB, CDE: CDE, E: E, super: sup });
    }
    hist.lastNightPhone = lastPhone;
    hist.nightSide = side;
    return out;
  }

  /* ── THE SPARE LONG DAY SITS BESIDE THE PHONE HOLDER ─────────────────────────────────────
     A PREFERENCE, not a rule (docs/POD-STRENGTH-ALGORITHM.md), so it may break nothing at all:
     the swap is taken only when every rule still holds and the week is no worse on anything
     else. Where a pod has two long days and the phone holder's pod has one, the second long day
     is more use beside the phone — the holder is answering referrals, not standing a bed. */
  function spareLongDayToPhone(plan, on, home, staff, hist, isNew, cfg, phone) {
    var base = weekCost(plan, on, home, staff, hist, isNew, cfg);
    for (var di = 0; di < 7; di++) {
      var who = phone[di];
      if (!who) continue;
      var byPod = plan[di];
      var hPod = null;
      for (var pi = 0; pi < PODS.length; pi++) if ((byPod[PODS[pi]] || []).indexOf(who) >= 0) hPod = PODS[pi];
      if (!hPod) continue;
      var ldIn = function (p) {
        var n = 0, list = byPod[p] || [];
        for (var i = 0; i < list.length; i++) if (on[di][list[i]] === "LD") n++;
        return n;
      };
      if (ldIn(hPod) >= 2) continue;
      for (var pj = 0; pj < PODS.length; pj++) {
        var from = PODS[pj];
        if (from === hPod || ldIn(from) < 2) continue;
        var donors = (byPod[from] || []).filter(function (x) { return on[di][x] === "LD"; });
        var takers = (byPod[hPod] || []).filter(function (x) { return x !== who && on[di][x] !== "LD"; });
        var done = false;
        for (var a = 0; a < donors.length && !done; a++) {
          for (var b = 0; b < takers.length && !done; b++) {
            swapIn(byPod, from, donors[a], hPod, takers[b]);
            var c = weekCost(plan, on, home, staff, hist, isNew, cfg);
            if (c <= base) { base = c; done = true; }
            else swapIn(byPod, from, takers[b], hPod, donors[a]);
          }
        }
        if (done) break;
      }
    }
    return plan;
  }

  /* ── 6 · SUPERNUMERARIES, LAST, COUNTED NOWHERE ──────────────────────────────────────────
     Sorted at the very end, where they cannot make a pod too big, too small or short of a long
     day. Neurology registrars are always supernumerary and go to C or D. */
  function placeSupers(plan, supers, staff) {
    var S = function (id) { return staff[id] || {}; };
    var out = [];
    for (var di = 0; di < 7; di++) {
      var list = supers[di] || [], byPod = plan[di], put = {};
      for (var i = 0; i < list.length; i++) {
        var id = list[i];
        var want = S(id).neuro ? ["C", "D"] : PODS.slice();
        want.sort(function (a, b) {
          return ((byPod[a] || []).length + (put[a] || 0)) - ((byPod[b] || []).length + (put[b] || 0));
        });
        var p = want[0] || "C";
        put[p] = (put[p] || 0) + 1;
        out.push({ di: di, id: id, pod: p });
      }
    }
    return out;
  }

  /* ── WHAT THE WEEK CANNOT DO ─────────────────────────────────────────────────────────────
     Said out loud rather than hidden by moving people around. A day with fewer long-day people
     rostered than there are pods to staff cannot have a long day in every pod, whoever writes it,
     and the gap belongs on Pod E because Pod E is the smallest. */
  function notesFor(plan, on, staff, cfg) {
    var S = function (id) { return staff[id] || {}; }, notes = [];
    for (var di = 0; di < 7; di++) {
      var m = on[di], ids = Object.keys(m);
      if (!ids.length) continue;
      var ldOn = 0;
      for (var i = 0; i < ids.length; i++) if (m[ids[i]] === "LD") ldOn++;
      var staffed = 0;
      for (var p1 = 0; p1 < PODS.length; p1++) if ((plan[di][PODS[p1]] || []).length) staffed++;
      if (ldOn < staffed) notes.push({ di: di, kind: "longDayFloor", text: "only " + ldOn + " long days rostered for " + staffed + " staffed pods" });
      for (var p2 = 0; p2 < AD.length; p2++) {
        var pod = AD[p2], list = plan[di][pod] || [];
        if (!list.length) continue;
        var hasAir = false, hasTr = false;
        for (var li = 0; li < list.length; li++) { if (S(list[li]).airway) hasAir = true; if (S(list[li]).transfer) hasTr = true; }
        if (!hasAir && !hasTr) notes.push({ di: di, kind: "noCover", text: "Pod " + pod + " has neither airway nor transfer" });
      }
    }
    return notes;
  }

  // ── the entry point: plan one week ──────────────────────────────────────────────────────
  function planWeek(input) {
    var cfg = Object.assign({}, CFG, input.cfg || {});
    var staff = input.staff || {};
    var hist = input.history || blankHistory();
    var d = dutiesFor(input.weekKey, input.roster || {}, staff, cfg);
    var home = homePods(d.on, staff, hist, cfg);
    var plan = improve(seed(d.on, home, 0), d.on, home, staff, hist, d.isNew, cfg);
    var best = weekCost(plan, d.on, home, staff, hist, d.isNew, cfg);
    /* First-improvement stops at the first arrangement it cannot better by one move, which is not
       necessarily the best one. Shuffle the seed, try again, keep whichever is lowest. Swept:
       0 restarts 1.173 pods per person per week, 16 gets 1.138, 30 gets 1.133, flat after. */
    for (var r = 1; r <= cfg.restarts; r++) {
      var alt = improve(seed(d.on, home, r), d.on, home, staff, hist, d.isNew, cfg);
      var c = weekCost(alt, d.on, home, staff, hist, d.isNew, cfg);
      if (c < best) { best = c; plan = alt; }
    }
    var phone = pickPhone(plan, d.on, staff, hist, cfg, input.weekKey);
    /* The spare long day goes beside the phone holder — after the phone is known, and only where
       it costs nothing. It is a preference and may break nothing. */
    plan = spareLongDayToPhone(plan, d.on, home, staff, hist, d.isNew, cfg, phone);
    var nights = planNights(input.weekKey, input.roster || {}, staff, hist, cfg);
    var supers = placeSupers(plan, d.supers, staff);

    var days = [];
    for (var di = 0; di < 7; di++) {
      var pods = {};
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi];
        pods[p] = (plan[di][p] || []).map(function (id) { return { id: id, shift: d.on[di][id] }; });
      }
      days.push({ pods: pods, phone: phone[di] || null, super: (d.supers[di] || []).slice(),
        night: nights[di] });
    }
    return {
      weekKey: input.weekKey, days: days, home: home, cost: best,
      supers: supers, notes: notesFor(plan, d.on, staff, cfg)
    };
  }

  /* Roll the memory forward after a week is written. Pod E fairness is a RECENT memory — evened
     out over a rolling eight weeks — so it decays; the pod-day counts, which drive the home-pod
     rotation, are the whole stay and do not. */
  function rollHistory(hist, week, staff, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    for (var id in hist.eDays) hist.eDays[id] *= cfg.eMemoryDecay;
    for (var di = 0; di < week.days.length; di++) {
      var day = week.days[di];
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi], list = day.pods[p] || [];
        for (var li = 0; li < list.length; li++) {
          var who = list[li].id;
          (hist.podDays[who] = hist.podDays[who] || {})[p] = (hist.podDays[who][p] || 0) + 1;
          if (p === "E") hist.eDays[who] = (hist.eDays[who] || 0) + 1;
          hist.shifts[who] = (hist.shifts[who] || 0) + 1;
        }
      }
    }
    hist.home = week.home || hist.home;
    return hist;
  }

  /* ── A SICK DAY REPAIRS THAT DAY ONLY ────────────────────────────────────────────────────
     Ratified: "one person off sick repairs that day only. It never triggers a replan of the
     week." So this does not call the planner. It takes the day as it stands, takes out whoever
     is no longer on, puts in whoever now is, and then makes the SMALLEST number of moves that
     puts the rules back — and stops the moment they hold.

     Nothing it does may put somebody on a third pod or past the move cap, because those are the
     rules the four old repair passes broke every night while fixing something lower down.

     It returns the moves it made so the board can show them; nobody who did not need to move,
     moves. */
  function repairDay(input) {
    var cfg = Object.assign({}, CFG, input.cfg || {});
    var staff = input.staff || {}, S = function (id) { return staff[id] || {}; };
    var di = input.dayIndex, day = input.day;
    var on = input.on || {};                    // id -> "LD" | "SD", counted staff only
    var home = input.home || {};
    var podsThisWeek = input.podsThisWeek || {}; // id -> { A:true, ... } from the OTHER six days
    var movesThisWeek = input.movesThisWeek || {};
    var moves = [];

    var byPod = {};
    for (var pi = 0; pi < PODS.length; pi++) byPod[PODS[pi]] = (day.pods[PODS[pi]] || []).map(function (a) { return a.id; }).filter(Boolean);

    // 1 · anybody no longer on the day comes out. That is not a move, it is an absence.
    for (var p1 = 0; p1 < PODS.length; p1++) {
      var pod = PODS[p1];
      byPod[pod] = byPod[pod].filter(function (id) { return on[id]; });
    }
    // 2 · anybody now on and not placed goes in — home pod first, then wherever is needed most.
    var placed = {};
    for (var p2 = 0; p2 < PODS.length; p2++)
      for (var li = 0; li < byPod[PODS[p2]].length; li++) placed[byPod[PODS[p2]][li]] = PODS[p2];
    var ids = Object.keys(on), cap = capsFor(ids.length);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (placed[id]) continue;
      var want = PODS.filter(function (q) { return byPod[q].length < cap[q]; });
      if (!want.length) want = PODS.slice();
      want.sort(function (a, b) {
        return need(b, id) - need(a, id) ||
               (a === home[id] ? -1 : 0) - (b === home[id] ? -1 : 0) ||
               byPod[a].length - byPod[b].length;
      });
      byPod[want[0]].push(id);
      placed[id] = want[0];
      moves.push({ id: id, from: null, to: want[0], why: "newly on" });
    }

    function need(p, id) {
      var list = byPod[p], score = 0;
      if (!list.length) return 0;
      var hasLD = false, hasCover = false;
      for (var k = 0; k < list.length; k++) {
        if (on[list[k]] === "LD") hasLD = true;
        if (S(list[k]).airway || S(list[k]).transfer) hasCover = true;
      }
      if (!hasLD && on[id] === "LD") score += 100;
      if (p !== "E" && !hasCover && (S(id).airway || S(id).transfer)) score += 60;
      if (p === home[id]) score += 10;
      return score;
    }

    /* 3 · the rules, in break order, each fixed by the smallest legal move. A candidate move is
       illegal if it gives somebody a third pod this week, takes them past the move cap, empties a
       pod below its minimum, or breaks a rule ranked above the one being fixed. */
    function state() {
      var st = { size: {}, ld: {}, cover: {}, air: {}, ldAir: {} };
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi], list = byPod[p];
        st.size[p] = list.length; st.ld[p] = false; st.cover[p] = false; st.air[p] = false; st.ldAir[p] = 0;
        for (var k = 0; k < list.length; k++) {
          if (on[list[k]] === "LD") st.ld[p] = true;
          if (S(list[k]).airway) { st.air[p] = true; st.cover[p] = true; }
          else if (S(list[k]).transfer) st.cover[p] = true;
          if (S(list[k]).airway && on[list[k]] === "LD") st.ldAir[p]++;
        }
      }
      return st;
    }
    function breaches(st) {
      var out = [];
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi];
        if (st.size[p] > 0 && !st.ld[p]) out.push({ rank: 1, pod: p, kind: "noLongDay" });
      }
      for (var a = 0; a < AD.length; a++)
        if (st.size[AD[a]] > 0 && !st.cover[AD[a]]) out.push({ rank: 2, pod: AD[a], kind: "noCover" });
      var mx = -Infinity, mn = Infinity;
      for (var z = 0; z < PODS.length; z++) { var v = st.size[PODS[z]]; if (v > mx) mx = v; if (v < mn) mn = v; }
      if (st.size.E === mx && st.size.E > mn) out.push({ rank: 5, pod: "E", kind: "eBiggest" });
      if (st.ld.E) for (var b = 0; b < AD.length; b++)
        if (st.size[AD[b]] > 0 && !st.ld[AD[b]]) { out.push({ rank: 5, pod: "E", kind: "eLongDayEarly" }); break; }
      /* ONE AIRWAY LONG DAY EACH SIDE, rank 6 — below every hard rule above, so it never
         disturbs a fix already made for cover, a long day, or Pod E. Only raised when the day
         has an airway long day to spare (2+ on the fuller side): one airway long day on the
         whole unit cannot be split and is not a breach. Ali, 26.08.25. */
      var abLdAir = (st.ldAir.A || 0) + (st.ldAir.B || 0), cdLdAir = (st.ldAir.C || 0) + (st.ldAir.D || 0);
      if (abLdAir === 0 && cdLdAir >= 2)
        out.push({ rank: 6, pod: (st.size.A <= st.size.B ? "A" : "B"), pair: "AB", donor: "CD", kind: "airwayLDPairGap" });
      else if (cdLdAir === 0 && abLdAir >= 2)
        out.push({ rank: 6, pod: (st.size.C <= st.size.D ? "C" : "D"), pair: "CD", donor: "AB", kind: "airwayLDPairGap" });
      out.sort(function (x, y) { return x.rank - y.rank; });
      return out;
    }
    function legal(id, to) {
      var seen = podsThisWeek[id] || {}, from = placed[id];
      var count = 0;
      for (var q = 0; q < PODS.length; q++) if (seen[PODS[q]] || byPod[PODS[q]].indexOf(id) >= 0) count++;
      if (!seen[to] && byPod[to].indexOf(id) < 0 && count >= 2) return false;   // would be a third
      if ((movesThisWeek[id] || 0) >= cfg.weekMoveCap && from !== to) return false;
      if (from && byPod[from].length <= (from === "E" ? cfg.podEMin : cfg.podMin)) return false;
      return true;
    }
    function apply(id, to) {
      var from = placed[id];
      byPod[from].splice(byPod[from].indexOf(id), 1);
      byPod[to].push(id);
      placed[id] = to;
      moves.push({ id: id, from: from, to: to, why: "repair" });
    }

    var guard = 0;
    while (guard++ < 12) {
      var st = state(), bad = breaches(st);
      if (!bad.length) break;
      var want = bad[0], fixed = false;
      // the smallest move that fixes it: one person, from a pod that can spare them
      var cands = [];
      for (var pi2 = 0; pi2 < PODS.length; pi2++) {
        var from2 = PODS[pi2];
        if (from2 === want.pod) continue;
        for (var k2 = 0; k2 < byPod[from2].length; k2++) {
          var who = byPod[from2][k2];
          if (!legal(who, want.pod)) continue;
          if (want.kind === "noLongDay" && on[who] !== "LD") continue;
          if (want.kind === "noCover" && !(S(who).airway || S(who).transfer)) continue;
          if (want.kind === "airwayLDPairGap" &&
              !(on[who] === "LD" && S(who).airway && want.donor.indexOf(from2) >= 0)) continue;
          if (want.kind === "eBiggest") continue;                       // fixed by taking OFF E
          cands.push({ id: who, from: from2 });
        }
      }
      if (want.kind === "eBiggest" || want.kind === "eLongDayEarly") {
        // move somebody OFF Pod E, into the pod that can take them
        for (var k3 = 0; k3 < byPod.E.length; k3++) {
          var e = byPod.E[k3];
          if (want.kind === "eLongDayEarly" && on[e] !== "LD") continue;
          for (var t = 0; t < AD.length; t++) {
            if (!legal(e, AD[t])) continue;
            var before = breaches(state()).length;
            apply(e, AD[t]);
            if (breaches(state()).length < before) { fixed = true; break; }
            apply(e, "E");
            moves.pop(); moves.pop();
          }
          if (fixed) break;
        }
      } else {
        cands.sort(function (x, y) {
          return (byPod[y.from].length - byPod[x.from].length) ||
                 ((x.from === home[x.id] ? 1 : 0) - (y.from === home[y.id] ? 1 : 0));
        });
        for (var c = 0; c < cands.length; c++) {
          var before2 = breaches(state());
          apply(cands[c].id, want.pod);
          var after = breaches(state());
          if (after.length < before2.length || (after.length && after[0].rank > before2[0].rank)) { fixed = true; break; }
          apply(cands[c].id, cands[c].from);
          moves.pop(); moves.pop();
        }
      }
      if (!fixed) break;   // it cannot be fixed by moving anybody. Say so rather than churn.
    }

    var pods = {};
    for (var pf = 0; pf < PODS.length; pf++) {
      var pp = PODS[pf];
      pods[pp] = byPod[pp].map(function (id) { return { id: id, shift: on[id] }; });
    }
    return { pods: pods, moves: moves, notes: breaches(state()) };
  }

  /* ── PASTING IT INTO THE BOARD ───────────────────────────────────────────────────────────
     The page keeps a week as `wk.roster[iso][staffId]` and `wk.days[di].pods[P].assign`, a list
     of slots each holding an id and a shift. These two functions are the whole of the join, and
     they are here rather than in index.html so that the algorithm stays in one file that can be
     tested on its own — which is the only reason `strength.js` has been tunable.

       1  add   <script src="planner.js?v=..."></script>   beside strength.js
       2  where the board writes a week (the nightly, and Write week):
              Planner.writeWeek(wk, data.staff, { history: data.plannerHistory });
       3  where the board fixes ONE day after a roster change:
              Planner.fixDay(wk, di, data.staff, { history: data.plannerHistory });
       4  keep `data.plannerHistory` in the store and pass it every time — it is what carries
          Pod E fairness, the phone rota and the home-pod rotation from week to week.

     Nothing else in index.html needs to change: the four repair passes and planDayFix become
     dead code the moment writeWeek is the thing that writes the week. Leave them until the
     board has run a fortnight on this, then delete them in one go. */
  function staffMap(staff) {
    if (!staff) return {};
    if (!staff.length) return staff;              // already a map
    var m = {};
    for (var i = 0; i < staff.length; i++) {
      var s = staff[i];
      m[s.id] = {
        id: s.id, name: s.name, grade: s.grade, start: s.start,
        airway: !!s.airway, transfer: !!s.transfer, neuro: !!s.neuro,
        phone: !!(s.phoneHolder || s.phone), supernum: !!s.supernum
      };
    }
    return m;
  }
  function pourInto(day, pods) {
    for (var pi = 0; pi < PODS.length; pi++) {
      var p = PODS[pi], want = pods[p] || [];
      var slot = day.pods[p] = day.pods[p] || { assign: [] };
      slot.assign = slot.assign || [];
      /* Keep the slot list at least as long as it was: the board draws empty slots, and a week
         that suddenly has fewer of them reads as though people have been removed. */
      var keep = Math.max(slot.assign.length, want.length);
      var next = [];
      for (var i = 0; i < keep; i++) {
        next.push(want[i] ? { id: want[i].id, shift: want[i].shift }
                          : { id: null, shift: null });
      }
      slot.assign = next;
    }
  }
  function writeWeek(wk, staff, opts) {
    opts = opts || {};
    var map = staffMap(staff);
    var hist = opts.history || blankHistory();
    var out = planWeek({ weekKey: wk.key || opts.weekKey, roster: wk.roster || {}, staff: map,
      history: hist, cfg: opts.cfg });
    for (var di = 0; di < 7; di++) {
      var day = wk.days[di] = wk.days[di] || { pods: {} };
      pourInto(day, out.days[di].pods);
      day.phone = out.days[di].phone;
      var n = out.days[di].night;
      day.night = day.night || { phone: null, AB: [], CDE: [], E: [], super: [] };
      day.night.phone = n.phone; day.night.AB = n.AB; day.night.CDE = n.CDE;
      day.night.E = n.E; day.night.super = n.super;
    }
    for (var si = 0; si < out.supers.length; si++) {
      var s = out.supers[si], d2 = wk.days[s.di];
      d2.pods[s.pod].super = d2.pods[s.pod].super || [];
      if (d2.pods[s.pod].super.indexOf(s.id) < 0) d2.pods[s.pod].super.push(s.id);
    }
    rollHistory(hist, out, map, opts.cfg);
    wk.plannerHome = out.home;
    return { notes: out.notes, history: hist, home: out.home };
  }
  /* One day's roster changed. Repair THAT DAY. The rest of the week is not touched, and the
     people who did not have to move do not move. */
  function fixDay(wk, di, staff, opts) {
    opts = opts || {};
    var map = staffMap(staff), cfg = Object.assign({}, CFG, opts.cfg || {});
    var iso = addDays(wk.key || opts.weekKey, di), r = (wk.roster || {})[iso] || {};
    /* THE ROSTER SAYS WHO ALLOCATE EXPECTS ON; day.removed SAYS WHO A HUMAN HAS TAKEN OFF THIS
       DAY — 26.08.25, found live: Dave Garwood taken off sick, Fix this day put him straight back
       in Pod D. The roster still (rightly) shows him on SD, because Allocate doesn't know he's
       sick — only the board does, via takeOffDay(). Every other read of "who's actually on today"
       (poolFor, in index.html) already deletes day.removed ids from its map; this one didn't, so
       a manual removal survived until the next repair undid it. Same fault as the airway/red
       history: one rule, enforced in one code path and not the other. */
    var removedToday = {};
    ((wk.days && wk.days[di] && wk.days[di].removed) || []).forEach(function (id) { removedToday[id] = true; });
    var on = {};
    for (var id in r) {
      if (r[id].kind !== "day" || (map[id] || {}).supernum || removedToday[id]) continue;
      on[id] = String(r[id].code || "").toUpperCase().indexOf("LD") === 0 ? "LD" : "SD";
    }
    var podsThisWeek = {}, movesThisWeek = {}, last = {};
    for (var dj = 0; dj < 7; dj++) {
      if (dj === di || !wk.days[dj]) continue;
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi], list = ((wk.days[dj].pods[p] || {}).assign) || [];
        for (var li = 0; li < list.length; li++) {
          var who = list[li].id;
          if (!who) continue;
          (podsThisWeek[who] = podsThisWeek[who] || {})[p] = true;
          if (last[who] && last[who] !== p) movesThisWeek[who] = (movesThisWeek[who] || 0) + 1;
          last[who] = p;
        }
      }
    }
    var day = { pods: {} };
    for (var pk = 0; pk < PODS.length; pk++)
      day.pods[PODS[pk]] = (((wk.days[di].pods[PODS[pk]] || {}).assign) || []).filter(function (a) { return a.id; });
    var fixed = repairDay({ dayIndex: di, day: day, on: on, staff: map,
      home: wk.plannerHome || (opts.history || {}).home || {},
      podsThisWeek: podsThisWeek, movesThisWeek: movesThisWeek, cfg: cfg });
    pourInto(wk.days[di], fixed.pods);
    if (wk.days[di].phone && !on[wk.days[di].phone]) wk.days[di].phone = null;
    return { moves: fixed.moves, notes: fixed.notes };
  }

  root.writeWeek = writeWeek;
  root.fixDay = fixDay;
  root.PODS = PODS;
  root.CFG = CFG;
  root.planWeek = planWeek;
  root.repairDay = repairDay;
  root.rollHistory = rollHistory;
  root.blankHistory = blankHistory;
  root.capsFor = capsFor;
  root.homePods = homePods;
  root.weekCost = weekCost;
  root.addDays = addDays;
})(typeof module !== "undefined" && module.exports ? module.exports
   : (typeof window !== "undefined" ? (window.Planner = {}) : this));
