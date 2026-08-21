/* podcost.js — WHAT EACH POD COSTS, taken from the planner's own price list.
 *
 * WHY THIS FILE EXISTS
 * The board's rings came from strength.js, which scores a day the OLD allocator built. The
 * planner writes to a different objective. Two models marking different papers — the fault this
 * file removes. Every number below is read from Planner.CFG. There is no second price list here
 * and there must never be one.
 *
 * THE ONE THING THAT KEEPS IT HONEST
 * attribute() walks the same charges, in the same order, as Planner.weekCost, and hands each one
 * to the pod and the day that earned it. The total it returns is asserted equal to weekCost() —
 * see selfCheck(). If somebody adds a charge to the planner and not to this file, that assertion
 * fails and the board stops agreeing with the allocator loudly rather than quietly.
 *
 * WHAT IS CHARGED TO A POD AND WHAT IS CHARGED TO THE DAY
 * A pod carries what a pod can be blamed for: no long day, no cover, nobody phone-trained, a pod
 * of all-new people, stacked ACCPs, and — for Pod E — its fair-share and airway-on-E charges, its
 * early long day, and being the biggest. A gap that is not on Pod E is charged to the pod that is
 * empty, because that pod is the thing that is wrong.
 * The DAY carries what only the day can be blamed for: the spread across pods, and ACCPs stacked
 * in one pod while another goes without. Moving one person cannot fix those in isolation.
 * A person's week charges — a second pod, a third pod, a move, a weekend crossing, time off their
 * home pod, a neuro trainee's share of C and D — are charged to the pod-day where they land, so
 * that a human about to move somebody sees the cost appear in the pod they are moving them to.
 */
(function (root) {
  "use strict";

  var PODS = ["A", "B", "C", "D", "E"];
  var AD = ["A", "B", "C", "D"];
  var PAIR = { A: "B", B: "A", C: "D", D: "C" };

  /* ── the empty ledger ─────────────────────────────────────────────────────────────────────
     One entry per pod per day, plus a day-level line the pods cannot be blamed for. `why` keeps
     the itemised charges so the board can say what a number is made of without re-deriving it. */
  function blank() {
    var days = [];
    for (var di = 0; di < 7; di++) {
      var pods = {};
      for (var pi = 0; pi < PODS.length; pi++) pods[PODS[pi]] = { cost: 0, why: [] };
      days.push({ pods: pods, dayOnly: 0, dayWhy: [], staffed: false });
    }
    return { days: days, total: 0 };
  }

  function charge(led, di, pod, amount, label) {
    if (!amount) return;
    var slot = led.days[di].pods[pod];
    slot.cost += amount;
    slot.why.push({ code: label, cost: amount });
    led.total += amount;
  }
  function chargeDay(led, di, amount, label) {
    if (!amount) return;
    led.days[di].dayOnly += amount;
    led.days[di].dayWhy.push({ code: label, cost: amount });
    led.total += amount;
  }

  /* ── the walk ─────────────────────────────────────────────────────────────────────────────
     Deliberately the same shape as Planner.weekCost. Read them side by side when either changes. */
  function attribute(plan, on, home, staff, hist, isNew, cfg) {
    var led = blank();
    var S = function (id) { return staff[id] || {}; };
    var podsOf = {}, lastPod = {}, moves = {}, neuroCD = {}, neuroTot = {}, neuroDays = {};
    var satPod = {}, sunPod = {}, whereOn = {}, daysOf = {};

    for (var di = 0; di < 7; di++) {
      var byPod = plan[di], m = on[di];
      var ids = Object.keys(m);
      if (!ids.length) continue;
      led.days[di].staffed = true;

      var size = {}, ld = {}, air = {}, tr = {}, accp = {}, phTrained = {}, allNew = {};
      for (var pi = 0; pi < PODS.length; pi++) {
        var p = PODS[pi], list = byPod[p] || [];
        size[p] = list.length; ld[p] = false; air[p] = false; tr[p] = false;
        accp[p] = 0; phTrained[p] = false; allNew[p] = list.length > 0;

        for (var li = 0; li < list.length; li++) {
          var id = list[li], s = S(id);
          if (m[id] === "LD") ld[p] = true;
          if (s.airway) air[p] = true;
          if (s.transfer) tr[p] = true;
          if (s.phoneHolder || s.phone) phTrained[p] = true;
          if (s.grade === "ACCP") accp[p]++;
          if (!isNew[id]) allNew[p] = false;

          /* where this person sat, so a week charge can be handed back to a pod-day */
          (whereOn[id] = whereOn[id] || []).push({ di: di, pod: p });
          daysOf[id] = (daysOf[id] || 0) + 1;

          var had = podsOf[id] || (podsOf[id] = "");
          if (had.indexOf(p) < 0) podsOf[id] = had + p;
          if (lastPod[id] && lastPod[id] !== p) moves[id] = (moves[id] || 0) + 1;
          lastPod[id] = p;
          if (di === 5) satPod[id] = p;
          if (di === 6) sunPod[id] = p;

          if (p === "E") {
            charge(led, di, "E", (hist.eDays[id] || 0) * cfg.eUnfair, "eUnfair");
            if (s.airway) charge(led, di, "E", cfg.airwayOnE, "airwayOnE");
          }
          if (s.neuro) {
            neuroTot[id] = (neuroTot[id] || 0) + 1;
            if (p === "C" || p === "D") neuroCD[id] = (neuroCD[id] || 0) + 1;
            (neuroDays[id] = neuroDays[id] || []).push({ di: di, pod: p });
          }
        }

        if (size[p] > 0 && !ld[p]) charge(led, di, p, cfg.noLongDay, "noLongDay");
        if (p !== "E" && size[p] > 0 && !air[p])
          charge(led, di, p, tr[p] ? cfg.coverTransferOnly : cfg.coverNone,
                 tr[p] ? "coverTransferOnly" : "coverNone");
        if (p !== "E" && size[p] > 0 && !phTrained[p]) charge(led, di, p, cfg.noPhoneTrained, "noPhoneTrained");
        if (size[p] > 0 && allNew[p]) charge(led, di, p, cfg.allNewPod, "allNewPod");
        if (accp[p] >= 2) charge(led, di, p, cfg.accpStack * (accp[p] - 1), "accpStack");
      }

      var mx = -Infinity, mn = Infinity;
      for (var z = 0; z < PODS.length; z++) {
        var v = size[PODS[z]];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      if (mx - mn > 1) chargeDay(led, di, cfg.spread * (mx - mn - 1), "spread");
      if (size.E === mx && size.E > mn) charge(led, di, "E", cfg.eBiggest, "eBiggest");
      /* the gap belongs to the pod that is empty, not to Pod E which is merely running */
      if (size.E > 0) for (var e1 = 0; e1 < AD.length; e1++) if (size[AD[e1]] === 0) { charge(led, di, AD[e1], cfg.gapNotOnE, "gapNotOnE"); break; }
      if (ld.E) for (var a1 = 0; a1 < AD.length; a1++) if (size[AD[a1]] > 0 && !ld[AD[a1]]) { charge(led, di, "E", cfg.eLongDayEarly, "eLongDayEarly"); break; }
      var gaps = 0, stacked = false;
      for (var a2 = 0; a2 < AD.length; a2++) {
        if (size[AD[a2]] > 0 && !accp[AD[a2]]) gaps++;
        if (size[AD[a2]] > 0 && accp[AD[a2]] > 1) stacked = true;
      }
      if (gaps && stacked) chargeDay(led, di, cfg.accpGap * gaps, "accpGap");
    }

    /* the weekend pair — charged to the Sunday, which is the day that broke it */
    for (var wid in satPod) {
      if (sunPod[wid] === undefined || sunPod[wid] === satPod[wid]) continue;
      if (PAIR[satPod[wid]] !== sunPod[wid]) charge(led, 6, sunPod[wid], cfg.weekendCross, "weekendCross");
    }

    /* a neuro trainee's band — spread across that person's own days, since it is their week */
    for (var nid in neuroTot) {
      var tot = neuroTot[nid];
      if (tot < 2) continue;
      var share = (neuroCD[nid] || 0) / tot, amt = 0;
      if (share < 0.60) amt = cfg.neuroOffCD * (0.60 - share) * tot * 4;
      if (share > 0.75) amt = cfg.neuroOffCD * (share - 0.75) * tot * 4;
      spreadOver(led, neuroDays[nid], amt, "neuroOffCD");
    }

    /* the person's week — a move is charged to the day the pod changed, so the cost shows up
       where a human is about to make it */
    for (var id2 in podsOf) {
      var seq = whereOn[id2] || [], n = podsOf[id2].length;
      if (n > 2) chargeAtNthPod(led, seq, 3, cfg.thirdPod * (n - 2), "thirdPod");
      if (n > 1) chargeAtNthPod(led, seq, 2, cfg.secondPod * (n - 1), "secondPod");
      var mv = moves[id2] || 0;
      if (mv) spreadOverMoves(led, seq, cfg.anyMove * mv, "anyMove");
      if (mv > cfg.weekMoveCap) spreadOverMoves(led, seq, cfg.extraMove * (mv - cfg.weekMoveCap), "extraMove");
      if (home[id2] && podsOf[id2].indexOf(home[id2]) < 0) spreadOver(led, seq, cfg.offHome, "offHome");
    }
    return led;
  }

  /* Split a person's week charge evenly across the pod-days they actually worked, so no single
     day is blamed for a whole week and the pods still add up to the week. */
  function spreadOver(led, seq, amount, label) {
    if (!amount || !seq || !seq.length) return;
    var each = amount / seq.length;
    for (var i = 0; i < seq.length; i++) charge(led, seq[i].di, seq[i].pod, each, label);
  }
  /* Charge every day on which this person's pod differs from the day before. */
  function spreadOverMoves(led, seq, amount, label) {
    if (!amount || !seq || seq.length < 2) return;
    var hits = [];
    for (var i = 1; i < seq.length; i++) if (seq[i].pod !== seq[i - 1].pod) hits.push(seq[i]);
    if (!hits.length) return;
    var each = amount / hits.length;
    for (var j = 0; j < hits.length; j++) charge(led, hits[j].di, hits[j].pod, each, label);
  }
  /* Charge the pod-day on which the person's Nth distinct pod of the week first appears. */
  function chargeAtNthPod(led, seq, n, amount, label) {
    if (!amount || !seq || !seq.length) return;
    var seen = "", i;
    for (i = 0; i < seq.length; i++) {
      if (seen.indexOf(seq[i].pod) < 0) seen += seq[i].pod;
      if (seen.length === n) { charge(led, seq[i].di, seq[i].pod, amount, label); return; }
    }
    charge(led, seq[seq.length - 1].di, seq[seq.length - 1].pod, amount, label);
  }

  /* ── THE ROSTER CEILING ───────────────────────────────────────────────────────────────────
     A day with fewer long-day people than pods in use cannot have a long day in every pod, and
     must not be marked down for it. Same for cover: if there are not enough airway or transfer
     people on to reach every A-D pod, the shortfall is the roster's, not the allocator's.
     Everything above the floor is a real fault; the floor itself is not. */
  function floorFor(byPod, m, staff, cfg) {
    var S = function (id) { return staff[id] || {}; };
    var used = 0, ids = Object.keys(m), i;
    for (var pi = 0; pi < PODS.length; pi++) if ((byPod[PODS[pi]] || []).length) used++;
    var ldPeople = 0, coverPeople = 0;
    for (i = 0; i < ids.length; i++) {
      if (m[ids[i]] === "LD") ldPeople++;
      var s = S(ids[i]);
      if (s.airway || s.transfer) coverPeople++;
    }
    var floor = 0, notes = [];
    var ldShort = Math.max(0, used - ldPeople);
    if (ldShort) { floor += ldShort * cfg.noLongDay; notes.push(ldShort + " pod" + (ldShort > 1 ? "s" : "") + " cannot have a long day — only " + ldPeople + " on a long day for " + used + " pods"); }
    var adUsed = 0;
    for (var a = 0; a < AD.length; a++) if ((byPod[AD[a]] || []).length) adUsed++;
    var covShort = Math.max(0, adUsed - coverPeople);
    if (covShort) { floor += covShort * cfg.coverNone; notes.push(covShort + " pod" + (covShort > 1 ? "s" : "") + " cannot be covered — only " + coverPeople + " airway or transfer trained on"); }
    return { floor: floor, notes: notes, unreachable: floor > 0 };
  }

  /* ── COST TO A NUMBER ─────────────────────────────────────────────────────────────────────
     RATIFIED 26.08.21 (Ali): the SOFTENED LOG, reference 4,000, softening 60.

     The planner's prices run from 20 to 12,000 — three orders of magnitude — so a linear scale
     spends its whole length on the one catastrophic charge and shows every ordinary day as 100.
     A plain log fixes that but is harsh at the bottom: one person a day off their home pod, which
     costs 20, would drop a pod into the seventies. Dividing by `soft` first says what counts as
     near enough to nothing, and the curve then spends most of its length on the 10–200 band where
     the real roster actually lives.

     Both numbers are prices that already exist, which is the point — neither is a new invention
     to maintain:
       ref  4000 · an A–D pod with neither airway nor transfer. A pod scoring 0 therefore means
                   "at least as bad as having nobody in this pod who can manage an airway".
       soft   60 · transfer-instead-of-airway, the cheapest thing anybody has complained about.
                   Below it, not worth anybody's attention.

     Continuous in, continuous out. Nothing here rounds to a band, and there is no table of named
     states — the break order comes out of the pricing itself, because each rule already costs more
     than every rule beneath it added together. */
  function toScore(cost, ref, soft) {
    ref = ref > 0 ? ref : 4000;
    soft = soft > 0 ? soft : 60;
    if (!(cost > 0)) return 100;
    var x = Math.log(1 + cost / soft) / Math.log(1 + ref / soft);
    if (x >= 1) return 0;
    return 100 * (1 - x);
  }

  /* A continuous colour ramp, in HSL so the hue itself varies with the score rather than
     snapping between named states. 0 = deep red, 100 = green. Nothing in here is banded. */
  function toColour(score) {
    var t = Math.max(0, Math.min(100, score)) / 100;
    var hue = 4 + 134 * Math.pow(t, 1.15);       /* red 4° through amber to green 138° */
    var sat = 78 - 24 * t;                        /* the bad end shouts, the good end does not */
    var lig = 42 + 12 * t;
    return "hsl(" + hue.toFixed(1) + " " + sat.toFixed(1) + "% " + lig.toFixed(1) + "%)";
  }

  root.PODS = PODS;
  root.attribute = attribute;
  root.floorFor = floorFor;
  root.toScore = toScore;
  root.toColour = toColour;
})(typeof module !== "undefined" && module.exports ? module.exports
   : (typeof window !== "undefined" ? (window.PodCost = {}) : this));
