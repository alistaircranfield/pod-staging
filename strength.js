/* strength.js — the requirement register and the one evaluator that reads it.
 *
 * WHY THIS EXISTS
 * Thu 13 Aug 2026: Pod C held Breslin (IMT, three weeks) and Gutierrez (FY2) with no airway,
 * no transfer and no phone between them, while Pod A held three transfer-trained people and
 * both of the day's ACCPs. Head counts were A3 B2 C2 D2 E2. checkDay returned one amber and
 * planDayFix proposed nothing. The board could count people and had no idea what they could do.
 *
 * WHAT THIS IS NOT — read before changing anything
 * The first attempt at this file was a parallel points economy (airway +3, transfer +2, phone
 * +1) with per-pod floors, and Ali threw out its foundations: "one system that serves both the
 * algorithm and gives each pod a % score and the day a % score." So there are no points and no
 * floors here. There is a REGISTER of requirements and one evaluator, and the percentage it
 * produces is meant to become the objective the allocator optimises — not a readout beside it.
 *
 * THREE RULES THAT SHAPE EVERY LINE BELOW
 *
 *  1. GATES DO NOT SCORE.  Weighting a breach by how bad it is put the hard rules in the
 *     average, and hard rules almost never break — 2 and 5 fires in 42 days. Every pod banked
 *     them and floated: the first cut read 86–100% and the day read 94, which is the
 *     everything-is-green fault this file exists to avoid, in a new costume. So a hard rule is
 *     a GATE: break it and the pod is broken, full stop, no percentage. The percentage is of
 *     the AIMS, and only the aims that were genuinely in question.
 *
 *  2. WHAT THE DAY COULD NOT SUPPLY IS NOT COUNTED AGAINST THE POD.  On 13 Aug only three
 *     airway-trained people were on the day shift for four pods that want one. A requirement the
 *     day could not supply is not a fault of a pod; scoring it as one is what made the board say
 *     "nothing can be moved to fix this automatically" and invited 42 minutes of hand-shuffling.
 *
 *     It was first built to leave the DENOMINATOR, which was wrong in a way only the real board
 *     showed: on a thin day three of a pod's five aims drop out, the pod is judged on the two that
 *     are left, and one bad answer halves it. Ali, 26.08.15, on a staffed pod reading zero: "all
 *     new · pod broken up score of 0 when 2 people on - total codswallop." He is right — a pod with
 *     two people in it, doing as well as the day allowed on three of five requirements, is not
 *     nothing. So an unmeetable requirement now stays in the denominator and is AWARDED: the pod
 *     did as well as it could, which is what full marks mean. Pods that could have done better are
 *     still the only ones charged, so the comparison between pods is unchanged — but the scale
 *     stops collapsing to two points on exactly the days somebody needs to read it.
 *
 *     THE WORD MATTERS AND "AWARDED" IS THE WRONG ONE. Ali, 26.08.15: "unmeetable and therefore
 *     awarded 0 i think that concept will confuse everybody." He is right — a tick beside "airway
 *     in the pod" on a pod with no airway person is a lie, however defensible the arithmetic. So
 *     the panel draws these with a DASH, says "none on today, not counted against this pod", and
 *     the total states its own basis: "80% of what was possible · 2 of 5 assessed". `assessed`
 *     below is that count, and it is what stops a 100 built on one requirement reading like a 100
 *     built on five.
 *
 *  3. WHERE SUPPLY IS SHORT, THE WEAKEST POD CARRIES THE MISS.  Two ACCPs both in Pod A: four
 *     pods lack one and only one of them could have been helped. Smearing the miss across four
 *     would say every pod is slightly wrong when three of them are as right as they could be.
 *     The miss goes to the pods with the least met already, so a percentage answers the
 *     question somebody actually has — "could THIS pod be better?" — truthfully. This is a
 *     judgement, not a measurement, and it is the one line here that is arguable.
 *
 * ONE COPY OF THE MATHS. The browser loads this file; the unit tests require() the same file.
 * The message-to-requirement mapping for day-level aims lives here too (dayAimFor), so the page
 * never has to know which checkDay sentence means which requirement.
 *
 * PROJECT RULE 1 — every weight, every switch and every threshold below is editable from the
 * front end by an authorised user. DEFAULTS is a starting point, never a specification.
 *
 * HARD RULE 6 — this module reads only what somebody CAN DO: skills, grade, and how long they
 * have been on the unit. It never reads, stores, infers or exposes why anybody is absent. A
 * person not on a day simply is not in the pod, no field here carries a reason, no code path
 * distinguishes one kind of absence from another, and the delta says only that a number moved.
 */
(function (root) {
  "use strict";

  /* ── THE REGISTER ────────────────────────────────────────────────────────────────────────
     24 rows. This is the single list: the evaluator walks it, the Setup page draws it, and the
     tap-through behind a ring reads its labels. A requirement that is not in here does not
     exist, and one that is in here cannot be silently skipped.

       kind  "gate"  breaking it makes the pod or the day broken; it never enters a percentage
             "aim"   scored, weight 1 by default
       rel   true    achievable-relative: it leaves the denominator when supply runs out
       from  "check" the answer comes from checkDay's own issue list rather than from here, so
                     there is exactly one implementation of each existing rule
  */
  var REGISTER = [
    { id: "R01", scope: "pod",  kind: "gate", label: "Headcount at or above the minimum", from: "check", short: "under minimum" },
    { id: "R02", scope: "pod",  kind: "gate", label: "Somebody on a long day", from: "check", short: "no long day" },
    { id: "R04", scope: "pod",  kind: "aim",  label: "Airway-trained in the pod", rel: true, pods: ["A","B","C","D"], trait: "airway", short: "no airway" },
    /* A–D, not E. Ali, 26.08.15: "no transfer on E not important." Pod E is a smaller pod by
       design — its own minimum is 1 against 2 — and asking a pod of one or two for a
       transfer-trained person is the "E is always the weakest" fault the old per-pod floors had,
       arriving through a different door. Same list as R04, for the same reason. */
    { id: "N01", scope: "pod",  kind: "aim",  label: "Transfer-trained in the pod", rel: true, pods: ["A","B","C","D"], trait: "transfer", short: "no transfer" },
    { id: "N02", scope: "pod",  kind: "aim",  label: "An ACCP in the pod", rel: true, trait: "accp", short: "no ACCP" },
    { id: "N03", scope: "pod",  kind: "aim",  label: "Not everybody in their first weeks", short: "all new" },
    { id: "N04", scope: "pod",  kind: "aim",  label: "Keeps its people from yesterday", short: "pod broken up" },

    { id: "R03", scope: "day",  kind: "gate", label: "Nobody in two pods", from: "check", short: "in two pods" },
    { id: "R08", scope: "day",  kind: "gate", label: "Day phone allocated", from: "check", short: "no day phone" },
    { id: "R09", scope: "day",  kind: "gate", label: "Phone holder trained, learner supervised", from: "check", short: "phone untrained" },
    { id: "R10", scope: "day",  kind: "gate", label: "Phone holder on a long day", from: "check", short: "phone not long day" },
    { id: "R11", scope: "night",  kind: "gate", label: "Night phone qualified and covering a pod", from: "check", short: "night phone" },
    { id: "R12", scope: "night",  kind: "gate", label: "Night team at or above the minimum", from: "check", short: "night team short" },
    { id: "R13", scope: "night",  kind: "gate", label: "Night team able to work nights", from: "check", short: "nights not flagged" },
    { id: "R16", scope: "day",  kind: "gate", label: "Nobody on both the day and the night", from: "check", short: "day and night" },
    { id: "R05", scope: "day",  kind: "aim",  label: "Pod E is the smallest", from: "check", short: "E not smallest" },
    { id: "R06", scope: "day",  kind: "aim",  label: "Phone holder where there is most cover", from: "check", short: "phone not with cover" },
    { id: "R07", scope: "day",  kind: "aim",  label: "Pods evenly spread", short: "uneven spread" },
    { id: "R14", scope: "night",  kind: "aim",  label: "Two airway on nights, one each side", from: "check", short: "night airway split" },
    { id: "R15", scope: "day",  kind: "aim",  label: "Transfer-trained on the day shift", from: "check", short: "transfer on days" },
    { id: "R17", scope: "day",  kind: "aim",  label: "Nobody standing in the wrong shift", from: "check", short: "wrong shift" },
    { id: "R18", scope: "week", kind: "aim",  label: "Day phone rotates", from: "check", short: "day phone stuck" },
    { id: "R19", scope: "week", kind: "aim",  label: "Night phone rotates where it can", from: "check", short: "night phone stuck" },
    { id: "R20", scope: "week", kind: "aim",  label: "Neuro-trained mostly on C and D", from: "check", short: "neuro off C/D" }
  ];

  var DEFAULTS = {
    /* Experience, three tiers — Ali, 26.08.14: "experience just 3 tiers". Days rather than weeks
     * because the measure behind them is a date, and the boundaries are editable because they are
     * a choice: 24 of 87 people sit within a week of one, and rotational intakes arrive together,
     * so a whole cohort crosses a boundary on the same morning. */
    newDays: 91,
    settleDays: 365,

    /* Substantive grades never rotate, so a blank start date means "years", not "unknown".
     * Measured 26.08.14: ACCP 0/11, ICM 0/11, SCF 0/11 carry a start date. */
    substantive: ["ACCP", "ICM", "SCF"],

    /* Every aim, seeded at 1. They stay at 1 until the override counter has something to say:
     * Ali, 26.08.15 — "the consequence is consultants get annoyed, we cover the safety aspects" —
     * so what a breach COSTS is how often somebody reaches in and fixes it by hand, which is a
     * thing to be measured rather than a thing to be judged. 312 manual log entries and 70
     * hand-made pod moves are the raw material; until that is counted per requirement, one. */
    w: { R04: 1, N01: 1, N02: 1, N03: 1, N04: 1,
         R05: 1, R06: 1, R07: 1, R14: 1, R15: 1, R17: 1, R18: 1, R19: 1, R20: 1 },

    /* Any requirement can be switched off from the front end. Off means not asked and not in the
     * denominator — never "asked and always passing", which would inflate every score. */
    off: {},

    /* N04, continuity. A pod keeps its people if at least this share of it was in the same pod
     * yesterday. Baseline measured over the 42 stored days: 37% of people change pod day to day
     * (83 of 227 consecutive-day pairs), so this starts at a half and is meant to be argued with. */
    keepShare: 0.5,

    /* CONTINUITY COMPARES LIKE DAYS. Ali, 26.08.15, on seeing "pod broken up" across most of
     * Monday and Tuesday on the real board: "doesnt need to carry over weekend that importantly."
     * The unit re-forms its pods around the weekend — a Monday is built from a different set of
     * people than the Sunday before it — so measuring Monday against Sunday charged every pod for
     * a turnover nobody could have avoided and nobody wanted avoided. That is the crying-wolf
     * fault: a term that fires on most days is one people stop reading, and it was burying the two
     * signals this whole exercise exists to raise (no transfer, no ACCP).
     *
     * So a weekday is compared with the weekday before it and a weekend day with the weekend day
     * before it; across the Fri→Sat and Sun→Mon seams the requirement DROPS OUT rather than fails,
     * exactly as an unmeetable one does. Set true and it goes back to comparing every consecutive
     * pair — the churn is real and somebody may want to see it. */
    continuityAcrossWeekend: false,

    /* N03, the experience mix. Full marks once this share of a pod is past its first weeks,
     * proportional below — the same shape as keepShare, and for the same reason: "everybody new or
     * not everybody new" is one bit of information about a thing that has four or five gradations,
     * and a scale built from bits lands on 0, 25, 33, 50, 67, 75 and 100 and nowhere else (Ali,
     * 26.08.15: "not real spectrum %"). Half is deliberately undemanding: the aim is that a pod is
     * not carried entirely by people in their first weeks, not that newcomers are spread thin.
     */
    mixShare: 0.5,

    /* An UNKNOWN tier never
     * counts as new: punishing a pod for a blank field is how Gutierrez would have been scored,
     * and a blank is a thing to go and fill in, not a thing to charge somebody for. It raises an
     * Attention row instead. */
    capExperience: true
  };

  function cfgOf(over) {
    var c = {}, k;
    for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) c[k] = DEFAULTS[k];
    if (over) for (k in over) if (Object.prototype.hasOwnProperty.call(over, k) && over[k] != null) c[k] = over[k];
    c.w = merge(DEFAULTS.w, over && over.w);
    c.off = merge({}, over && over.off);
    c.substantive = c.substantive || DEFAULTS.substantive;
    return c;
  }
  function merge(base, over) {
    var o = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) o[k] = base[k];
    if (over) for (k in over) if (Object.prototype.hasOwnProperty.call(over, k) && over[k] != null) o[k] = over[k];
    return o;
  }
  function isOn(cfg, id) { return !(cfg.off && cfg.off[id] === true); }
  function wOf(cfg, id) { var v = Number(cfg.w && cfg.w[id]); return isFinite(v) && v >= 0 ? v : 1; }

  /* ── TIME ON THE UNIT ────────────────────────────────────────────────────────────────────
     Stated start date first; failing that, the first shift the Optima roster ever gave them.
     The roster in the store runs from 18 Aug 2025 — 385 days, 5,026 entries — so this is a real
     measure and not a guess, and it takes coverage from 44 of 87 to 83 of 87.

     Measured 26.08.14, across the 40 people who have both: the first rostered shift is NEVER
     earlier than the stated start (0 of 40) and runs a median 7 days later, which is exactly what
     a start date means — the post begins, the shifts follow. Rounded into three tiers that
     disagreement moves exactly ONE person, so first-shift is safe to lean on.

     What it cannot do is spot a returner. Somebody back for a second block looks identical to
     somebody brand new, `returner` is written on nobody, and that error cannot be sized while the
     field is empty — hence capExperience, and hence the Attention row that asks. */
  function daysOn(person, onDate, firstSeen) {
    if (!person) return null;
    var from = person.start || (firstSeen && firstSeen[person.id]) || null;
    if (!from) return null;
    var a = new Date(from), b = new Date(onDate);
    if (isNaN(a) || isNaN(b)) return null;
    return Math.floor((b - a) / 86400000);
  }
  function tierOf(person, onDate, cfg, firstSeen) {
    cfg = cfgOf(cfg);
    if (!person) return "unknown";
    /* A STANDING SLOT HAS NO TIME ON THE UNIT, because it is not a person — it is a line on the
       rota that somebody different fills each time. Counted as settled rather than unknown so it
       never drags a pod's experience mix down, and never appears in the list of people to go and
       ask about. Ali, 26.08.15, on the locum and neurology registrar rows: "their attnetion things
       are annoying." */
    if (person.placeholder) return "settled";
    if (person.returner) return "settled";
    if (cfg.substantive.indexOf(person.grade) !== -1 && !person.start) return "settled";
    var d = daysOn(person, onDate, firstSeen);
    if (d == null) return "unknown";
    if (d < Number(cfg.newDays)) return "new";
    if (d < Number(cfg.settleDays)) return "mid";
    return "settled";
  }

  /* ── WHICH checkDay SENTENCE IS WHICH REQUIREMENT ────────────────────────────────────────
     checkDay owns the tests; this owns nothing but the naming. Kept here rather than in the page
     so the tests and the board agree by construction. An issue this does not recognise is
     returned as null and counted as an unnamed aim rather than dropped — a rule that stops being
     matched must make the score worse, never quietly vanish from the denominator. */
  var DAY_PATTERNS = [
    /* R01 before R12 would swallow it: "Pod C has 1 countable staff — minimum 2" and "Night team
       has 3 countable staff — minimum 4" share their tail, and only the head tells them apart. */
    [/^Pod [A-E] has .*countable staff — minimum/, "R01"], [/no long-day \(8-8\)/, "R02"],
    [/allocated to more than one pod/, "R03"],
    [/^No day referral-phone/, "R08"],
    [/isn't phone-trained|still learning the phone|not on the staff list/, "R09"],
    [/holds the phone but is on a short day/, "R10"],
    [/^Night phone|^No night phone/, "R11"],
    [/^Night team has/, "R12"], [/not flagged for nights/, "R13"],
    [/on both the day and night shift/, "R16"],
    [/E should be the smallest/, "R05"],
    [/where there's the most cover/, "R06"],
    [/Two airway-trained on nights/, "R14"],
    [/transfer-trained on the day shift/, "R15"],
    [/Optima has them on/, "R17"],
    [/holds the day phone 3\+/, "R18"],
    [/holds the night phone on consecutive/, "R19"],
    [/\(neuro\)/, "R20"],
    [/nobody airway-trained/, "R04"]
  ];
  function dayAimFor(msg) {
    var i;
    for (i = 0; i < DAY_PATTERNS.length; i++) if (DAY_PATTERNS[i][0].test(msg || "")) return DAY_PATTERNS[i][1];
    return null;
  }

  function byIdOf(staff) {
    var by = {}, i;
    staff = staff || [];
    for (i = 0; i < staff.length; i++) by[staff[i].id] = staff[i];
    return by;
  }
  function traitFn(trait) {
    if (trait === "accp") return function (s) { return !!s && s.grade === "ACCP"; };
    return function (s) { return !!s && !!s[trait]; };
  }

  /* ── THE EVALUATOR ───────────────────────────────────────────────────────────────────────
     ctx = { day, prev, byId, dateISO, firstSeen, issues, counts, cfg }
       day       the day being scored, already normalised by the caller
       prev      yesterday's day object, or null on the first day held — N04 then drops out
       counts    { A: [id,...] } countable people per pod; the caller owns "countable" because
                 supernumerary and neuro-reg rules live on the board, not here
       issues    checkDay's own output for this day (and week), used for every "from: check" row
  */
  function scoreDay(ctx) {
    ctx = ctx || {};
    var cfg = cfgOf(ctx.cfg), byId = ctx.byId || {}, iso = ctx.dateISO, fs = ctx.firstSeen || {};
    var P = ctx.counts || {}, prevP = ctx.prevCounts || null;
    var order = ["A", "B", "C", "D", "E"], i, j, p, r;
    var S = function (id) { return byId[id] || null; };

    /* Gates first, and separately, because a broken gate is not a low score — it is a broken pod,
       and the two must never be averaged into each other. */
    var broken = {}, dayBroken = [], nightBroken = [], aimFail = {};
    for (i = 0; i < order.length; i++) broken[order[i]] = [];
    var issues = ctx.issues || [];
    for (i = 0; i < issues.length; i++) {
      var it = issues[i];
      if (it.info) continue;
      var id = dayAimFor(it.msg), row = rowOf(id);
      var pod = podNamedIn(it.msg);
      if (row && row.kind === "gate") {
        /* A night gate belongs to the night team's own ring, not to the day's. Routed here rather
           than sorted out later, because "which thing is this breach about" is a property of the
           register row and reading it twice is how the two lists drift. */
        if (row.scope === "pod" && pod) broken[pod].push(id);
        else if (row.scope === "night") nightBroken.push(id);
        else dayBroken.push(id || "?");
      } else if (id !== "R04") {
        /* R04 is re-derived below against supply — checkDay's airway sentence predates
           achievability and fires on days where nothing could have been done. */
        aimFail[id || ("?" + i)] = true;
      }
    }

    /* A YESTERDAY THAT WAS NEVER ALLOCATED IS NOT A YESTERDAY. prevCounts arriving as five empty
       lists is not "the pod lost all its people" — it is a day nobody has filled in yet, and
       charging every pod for it made continuity fire on all five pods of the first day held.
       Found on staging 26.08.14 on Monday 10 Aug, whose predecessor is outside the stored range. */
    var prevHeld = 0;
    if (prevP) for (i = 0; i < order.length; i++) prevHeld += (prevP[order[i]] || []).length;
    if (!prevHeld) prevP = null;

    /* Same seam rule as above, decided here so there is one copy of it. getUTCDay because an ISO
       date string parses as UTC midnight, and a local-time reading turns a Monday into a Sunday
       west of Greenwich — the board is read in three timezones (see the render suite). */
    if (prevP && cfg.continuityAcrossWeekend !== true) {
      var t = new Date(iso), y = new Date(new Date(iso).getTime() - 86400000);
      var wknd = function (d) { var n = d.getUTCDay(); return n === 0 || n === 6; };
      if (!isNaN(t) && wknd(t) !== wknd(y)) prevP = null;
    }

    var pods = {}, capacity = {}, unknowns = [];
    for (i = 0; i < order.length; i++) {
      p = order[i];
      pods[p] = { pod: p, got: 0, app: 0, met: [], missed: [], part: [], dropped: [], broken: broken[p], people: [] };
      var ids = P[p] || [];
      for (j = 0; j < ids.length; j++) {
        var per = S(ids[j]), t = tierOf(per, iso, cfg, fs);
        pods[p].people.push({ id: ids[j], tier: t, name: per && per.name, grade: per && per.grade,
          airway: !!(per && per.airway), transfer: !!(per && per.transfer), accp: !!(per && per.grade === "ACCP") });
        if (t === "unknown" && per) unknowns.push(per.id);
      }
    }

    /* Absolute pod aims. N03 and N04 do not depend on anybody else being on, so they are settled
       before the relative ones — and their result is what ranks the pods for rule 3 above. */
    for (i = 0; i < order.length; i++) {
      p = order[i];
      var pe = pods[p].people;
      if (isOn(cfg, "N03") && pe.length) {
        /* Unknown counts as NOT new — a blank start date must never make a pod look worse, or the
           way to a better score becomes leaving fields empty. It raises an Attention row instead. */
        var settledEnough = 0;
        for (j = 0; j < pe.length; j++) if (pe[j].tier !== "new") settledEnough++;
        var mix = settledEnough / pe.length, wantMix = Number(cfg.mixShare);
        charge(pods[p], "N03", wantMix > 0 ? Math.min(1, mix / wantMix) : 1, wOf(cfg, "N03"));
      }
      if (isOn(cfg, "N04") && pe.length && prevP) {
        var kept = 0;
        for (j = 0; j < pe.length; j++) if ((prevP[p] || []).indexOf(pe[j].id) !== -1) kept++;
        /* Full marks at keepShare and above, proportional below it — so a pod that held on to two
           of three and a pod that held none are no longer the same answer. keepShare keeps its
           meaning: it is the point at which a pod is doing as well as anybody asks. */
        var share = kept / pe.length, want = Number(cfg.keepShare);
        charge(pods[p], "N04", want > 0 ? Math.min(1, share / want) : 1, wOf(cfg, "N04"));
      } else if (isOn(cfg, "N04") && pe.length) {
        pods[p].dropped.push("N04");
        charge(pods[p], "N04", true, wOf(cfg, "N04"));
      }
    }

    var rank = order.slice().sort(function (a, b) {
      var ra = pods[a].app ? pods[a].got / pods[a].app : 1, rb = pods[b].app ? pods[b].got / pods[b].app : 1;
      return ra - rb || order.indexOf(a) - order.indexOf(b);
    });

    /* Relative pod aims — rules 2 and 3. Supply is counted across the whole day shift, not per
       pod, because a person in the wrong pod is supply that a move could reach. */
    for (r = 0; r < REGISTER.length; r++) {
      var reg = REGISTER[r];
      if (reg.scope !== "pod" || reg.kind !== "aim" || !reg.rel || !isOn(cfg, reg.id)) continue;
      var has = traitFn(reg.trait), want = reg.pods || order;
      var supply = 0, holds = [], missAll = [];
      for (i = 0; i < order.length; i++) {
        var lst = pods[order[i]].people, n = 0;
        for (j = 0; j < lst.length; j++) if (has(S(lst[j].id))) n++;
        supply += n;
        if (want.indexOf(order[i]) === -1) continue;
        if (n > 0) holds.push(order[i]);
        else if (lst.length) missAll.push(order[i]);
        if (n > 1) (capacity[reg.id] = capacity[reg.id] || []).push({ pod: order[i], spare: n - 1 });
      }
      var spare = Math.max(0, supply - holds.length);
      var ordered = rank.filter(function (x) { return missAll.indexOf(x) !== -1; });
      for (i = 0; i < holds.length; i++) charge(pods[holds[i]], reg.id, true, wOf(cfg, reg.id));
      for (i = 0; i < ordered.length; i++) {
        if (i < spare) charge(pods[ordered[i]], reg.id, false, wOf(cfg, reg.id));
        else { pods[ordered[i]].dropped.push(reg.id); charge(pods[ordered[i]], reg.id, true, wOf(cfg, reg.id)); }
      }
    }

    /* Day and week aims. Same denominator, one level up, so a day that is fine pod by pod and
       wrong across the unit cannot read as 100%. */
    var dGot = 0, dApp = 0, dayMissed = [], dayMet = [];
    for (r = 0; r < REGISTER.length; r++) {
      var rg = REGISTER[r];
      /* DAY SCOPE ONLY. The week rows are in the register because Setup draws them and because a
         requirement missing from the list is a requirement nobody can see — but charging a week
         aim to each of seven days would count it seven times and swamp the day it belongs to. */
      if (rg.scope !== "day" || rg.kind !== "aim" || !isOn(cfg, rg.id)) continue;
      var wt = wOf(cfg, rg.id);
      dApp += wt;
      if (aimFail[rg.id]) dayMissed.push(rg.id); else { dGot += wt; dayMet.push(rg.id); }
    }

    /* ── THE NIGHT TEAM IS A POD TOO ────────────────────────────────────────────────────────
       Ali, 26.08.15: "nights have no score either." It had none because the five day pods were
       what Thursday was about, and the night team was left as a set of gates — allocated, trained,
       able to work nights — with nothing to say about how good a night team it actually is.

       It is scored exactly like a pod and for the same reasons: the same experience mix, the same
       continuity, plus the one aim that is only about nights (two airway-trained, one each side).
       Its gates behave like a pod's: break one and the night is BROKEN, no percentage. It does not
       enter the day score, because a day percentage that mixed the day board with the night team
       would move for reasons nobody could see on the screen they were looking at. */
    var night = null;
    if (ctx.nightCounts) {
      var nIds = ctx.nightCounts || [], nj;
      night = { pod: "N", got: 0, app: 0, met: [], missed: [], part: [], dropped: [], broken: [], people: [] };
      for (nj = 0; nj < nIds.length; nj++) {
        var np = S(nIds[nj]);
        night.people.push({ id: nIds[nj], tier: tierOf(np, iso, cfg, fs), name: np && np.name, grade: np && np.grade,
          airway: !!(np && np.airway), transfer: !!(np && np.transfer), accp: !!(np && np.grade === "ACCP") });
      }
      night.broken = nightBroken.slice();
      if (isOn(cfg, "R14")) {
        /* Only asked when there are two to split. One airway-trained on a night team is not a
           spread problem, it is the whole of what the night has. */
        var nAir = 0;
        for (nj = 0; nj < night.people.length; nj++) if (night.people[nj].airway) nAir++;
        if (nAir >= 2) charge(night, "R14", !aimFail.R14, wOf(cfg, "R14"));
        else night.dropped.push("R14");
      }
      if (isOn(cfg, "N03") && night.people.length) {
        var nMix = 0;
        for (nj = 0; nj < night.people.length; nj++) if (night.people[nj].tier !== "new") nMix++;
        charge(night, "N03", Number(cfg.mixShare) > 0 ? Math.min(1, (nMix / night.people.length) / Number(cfg.mixShare)) : 1, wOf(cfg, "N03"));
      }
      if (isOn(cfg, "N04") && night.people.length && ctx.prevNightCounts && ctx.prevNightCounts.length) {
        var nKept = 0;
        for (nj = 0; nj < night.people.length; nj++) if (ctx.prevNightCounts.indexOf(night.people[nj].id) !== -1) nKept++;
        var nShare = nKept / night.people.length, nWant = Number(cfg.keepShare);
        charge(night, "N04", nWant > 0 ? Math.min(1, nShare / nWant) : 1, wOf(cfg, "N04"));
      } else if (isOn(cfg, "N04") && night.people.length) night.dropped.push("N04");
      night.pct = night.app ? Math.max(0, Math.min(100, Math.round(night.got / night.app * 100))) : (night.people.length ? null : 0);
      night.isBroken = night.broken.length > 0;
      night.assessed = night.met.length + night.missed.length;
      night.possible = night.assessed + night.dropped.length;
    }

    var got = dGot, app = dApp;
    for (i = 0; i < order.length; i++) {
      var pd = pods[order[i]];
      /* Never below zero and never above a hundred. got is a sum of clamped fractions so it cannot
         escape on its own, but the floor is stated here because this is the number people read, and
         Ali, 26.08.15: "cant be a minus number, the bottom must be a zero when no people on." */
      pd.pct = pd.app ? Math.max(0, Math.min(100, Math.round(pd.got / pd.app * 100))) : (pd.people.length ? null : 0);
      pd.isBroken = pd.broken.length > 0;
      /* How much of this pod was actually judged. A pod whose airway, transfer and ACCP were all
         unsupplied is scored on two requirements, and a percentage off two requirements should not
         look like a percentage off five — that is the "Monday reads 100 everywhere" fault, and it
         is answered by saying so rather than by bending the arithmetic. */
      pd.assessed = pd.met.length + pd.missed.length;
      pd.possible = pd.assessed + pd.dropped.length;
      got += pd.got; app += pd.app;
    }
    var dayPct = app ? Math.max(0, Math.min(100, Math.round(got / app * 100))) : null;
    var dAssessed = 0, dPossible = 0;
    for (i = 0; i < order.length; i++) { dAssessed += pods[order[i]].assessed; dPossible += pods[order[i]].possible; }
    dAssessed += dayMet.length + dayMissed.length; dPossible += dayMet.length + dayMissed.length;

    return {
      pods: pods, day: { pct: dayPct, got: got, app: app, met: dayMet, missed: dayMissed, broken: dayBroken, assessed: dAssessed, possible: dPossible },
      night: night, capacity: capacity, unknowns: unknowns, register: REGISTER, cfg: cfg,
      empty: app === 0
    };

    /* PART MARKS, WHERE THE THING BEING ASKED IS ITSELF A PROPORTION. Ali, 26.08.15: "scores seem
       very stage 100 or 75. not real spectrum %." He is right, and the cause is arithmetic: four or
       five yes/no aims can only ever land on 0, 25, 33, 50, 67, 75, 80 or 100, so pods that are
       genuinely different distances from right draw the identical ring.

       The fix is not to invent more requirements. It is to stop throwing away information the
       evaluator already has: continuity is a SHARE of a pod that stayed put, and rounding it to a
       yes or a no at the halfway mark discards everything either side. `met` may now be a fraction
       between 0 and 1, and a fraction is banked as part of the weight. Anything genuinely binary —
       a pod either holds an airway-trained person or it does not — stays binary and passes 1 or 0,
       so nothing here makes a yes/no requirement mushy. */
    function charge(podSc, id, met, wt) {
      var f = (met === true) ? 1 : (met === false ? 0 : Number(met));
      if (!isFinite(f)) f = 0;
      f = Math.max(0, Math.min(1, f));
      podSc.app += wt;
      podSc.got += wt * f;
      if (f >= 1) { if (podSc.dropped.indexOf(id) === -1) podSc.met.push(id); }
      else if (f <= 0) podSc.missed.push(id);
      else { podSc.part.push({ id: id, f: f }); podSc.missed.push(id); }
    }
  }

  function rowOf(id) {
    var i;
    for (i = 0; i < REGISTER.length; i++) if (REGISTER[i].id === id) return REGISTER[i];
    return null;
  }
  function labelOf(id) { var r = rowOf(id); return r ? r.label : id; }
  /* The five-word form, for a pod corner where a full label would wrap to three lines. */
  function shortOf(id) { var r = rowOf(id); return r ? (r.short || r.label) : id; }
  /* "Pod C has 1 countable staff…" and "Pod(s) C, D have nobody…" both name their pod in the
     sentence, which is the only place the pod survives — checkDay returns strings, not records. */
  function podNamedIn(msg) {
    var m = /\bPod (?:\(s\) )?([A-E])\b/.exec(msg || "");
    return m ? m[1] : null;
  }

  /* ── COLOUR ──────────────────────────────────────────────────────────────────────────────
     Ali, 26.08.14: "just give each score a % with a gradient colour". A continuous ramp rather
     than three buckets, so a pod at 69 and a pod at 71 do not look like different kinds of thing.
     The stops are the board's own red, amber and green, so nothing new has to be learned. */
  function colourOf(pct) {
    if (pct == null) return "#8a8f98";
    var stops = [[0, 163, 45, 45], [60, 239, 159, 39], [100, 99, 153, 34]], i, a, b, t;
    var v = Math.max(0, Math.min(100, Number(pct)));
    for (i = 0; i < stops.length - 1; i++) {
      a = stops[i]; b = stops[i + 1];
      if (v <= b[0]) {
        t = (v - a[0]) / (b[0] - a[0]);
        return "rgb(" + Math.round(a[1] + (b[1] - a[1]) * t) + "," +
                        Math.round(a[2] + (b[2] - a[2]) * t) + "," +
                        Math.round(a[3] + (b[3] - a[3]) * t) + ")";
      }
    }
    return "rgb(99,153,34)";
  }
  function band(pct) {
    if (pct == null) return "unknown";
    if (pct >= 90) return "ok";
    if (pct >= 70) return "thin";
    return "bare";
  }

  /* ── THE DONOR SENTENCE ──────────────────────────────────────────────────────────────────
     Surplus is capacity, not score. "Pod A holds three transfer-trained, two more than it needs"
     is the fact that would have moved Gill to Pod C unprompted, and it is worth nothing as points
     — a pod is not better for hoarding. It is returned separately so the caller can put it where
     it is actionable. */
  function donors(sc, id) {
    var out = sc && sc.capacity && sc.capacity[id];
    return out ? out.slice() : [];
  }

  var API = {
    REGISTER: REGISTER, DEFAULTS: DEFAULTS, cfgOf: cfgOf,
    daysOn: daysOn, tierOf: tierOf,
    scoreDay: scoreDay, dayAimFor: dayAimFor,
    rowOf: rowOf, labelOf: labelOf, shortOf: shortOf, podNamedIn: podNamedIn,
    colourOf: colourOf, band: band, donors: donors,
    indexStaff: byIdOf, isOn: isOn, wOf: wOf
  };

  if (typeof module === "object" && module.exports) module.exports = API;
  root.Strength = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
