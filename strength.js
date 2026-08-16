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
 *  2. THE SCORE SAYS WHAT THE POD HAS. IT DOES NOT SAY WHOSE FAULT THAT IS.
 *     This one has been wrong twice, in opposite directions, and the third version is the first
 *     that answers the question a reader is actually asking.
 *
 *     v1 removed an unmeetable requirement from the DENOMINATOR. On a thin day three of a pod's
 *     five aims dropped out, the pod was judged on the two that remained, and one bad answer
 *     halved it — a staffed pod could read 0. Ali: "total codswallop."
 *
 *     v2 kept it in the denominator and gave it full marks. That produced the opposite absurdity,
 *     and Ali caught it on the real board: "That cannot be an 80% day when no airway and no
 *     transfer, somethings off." He is right, and it is not a tuning problem. A pod with no airway
 *     and no transfer is a WEAK POD. That the rota could not have fixed it does not make it strong.
 *
 *     The mistake underneath both was cramming two different questions into one number: "how good
 *     is this pod" and "could anybody have done better". They are not the same question and they
 *     have different readers. So:
 *
 *       THE PERCENTAGE ANSWERS ONLY THE FIRST. Every requirement asked of a pod is scored on what
 *       the pod actually holds. No airway means no airway, whatever was available.
 *
 *       WHETHER IT COULD HAVE BEEN FIXED IS A SEPARATE FACT, carried beside the row — "nothing on
 *       today could be moved" against "Pod A has 2 spare" — and it is what the planner reads and
 *       what stops the board nagging about arithmetic nobody can beat. It changes the ADVICE. It
 *       never changes the score.
 *
 *     A pod that is thin because the day is thin still reads thin, and it should: somebody looking
 *     at Thursday needs to see that Pod C was weak, not that Pod C was blameless.
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
    { id: "R04", scope: "pod",  kind: "aim",  label: "Airway-trained in the pod", rel: true, trait: "airway", short: "no airway" },
    { id: "N01", scope: "pod",  kind: "aim",  label: "Transfer-trained in the pod", rel: true, trait: "transfer", short: "no transfer" },
    { id: "N05", scope: "pod",  kind: "aim",  label: "Phone-trained in the pod", rel: true, trait: "phoneHolder", short: "no phone-trained" },
    /* NOT A THING TO HAVE — A THING NOT TO STACK. Ali, 26.08.15: "the ACCP thing just is
       complicatin it. as long as transfer i saccoubnted thats whats needed. remove that from
       algorithm, just penalise having >1 accp per pod."

       Asking every pod for an ACCP was wrong twice over. There are 11 of them against 37
       airway-trained, so on most days most pods cannot have one and the requirement was noise; and
       what an ACCP actually brings to a pod is already counted, because 9 of the 11 are
       transfer-trained and transfer is scored on its own. So the positive requirement is gone.

       What remains is the real failure mode, which is the opposite one: two ACCPs sitting in the
       same pod is a scarce thing used twice where it could have been used once — the same fault as
       Pod A's three transfer-trained on 13 August, in a different currency. Nothing is asked of a
       pod with one or none. */
    { id: "N02", scope: "pod",  kind: "aim",  label: "No more than one ACCP in the pod", short: "two ACCPs stacked" },
    /* NEURO IS A PENALTY, NOT A PRESENCE — and it is here because a ten-year simulation caught
       the model quietly wrecking it. Added 26.08.15.

       R20 asks that neuro placements sit mostly on Pods C and D, and R20 is scope "week", so it
       never enters the day percentage. The planner optimises the day percentage. Neuro was
       therefore INVISIBLE to every decision the planner made, and moving a neuro trainee off C to
       buy a point of transfer cover cost nothing. Simulated over ten independent years with
       sickness and trainee churn, that is exactly what happened: 62% of neuro shifts on C/D under
       the old acceptance rule, 54% under the new one, against an aim of 70%. Consistent across
       all ten years. Nobody would have seen it on a week's board.

       Shaped like N02 rather than like R04, and the reason matters. Asking every pod for a neuro
       person would hand C and D a free point on days when no neuro trainee is even on, and would
       ask A, B and E for something they must not have. What is actually wanted is the absence of a
       mistake: nothing is asked of a pod holding no neuro placement, nothing is asked of C or D at
       all, and a neuro placement standing on A, B or E costs. Halves per person, so one is 0.5 and
       two is 0 — the same curve as two ACCPs stacked, for the same reason.

       WEIGHT 1, CHOSEN BY MEASUREMENT RATHER THAN BY FEEL. Ali, on being shown the first result:
       "the weight too high, fix." It was — at 2 the simulated ten years came out at 88% on C/D
       against an aim of 70%, which is not a rota keeping neuro trainees mostly on C and D, it is
       one pinning them there and paying for it elsewhere. Re-run across six years at each setting:
       weight 2 gives 88%, 1.5 gives 84%, and 1 gives 77% — just above the aim, which is what
       "mostly" means — with the mean day score unmoved (88.9 against 88.8). So 1. Editable in
       Setup like everything else, and the three measurements are here so the next person changing
       it knows what each one buys.

       THE NEURO REGISTRAR IS NOT THIS. They are supernumerary and hard-locked to C and D by
       neuroPodOK, which refuses the move outright rather than pricing it. This row is about
       ordinary trainees on a neuro placement, who may go elsewhere and mostly should not. */
    /* ── THE FALLBACK RULE: NO AIRWAY MEANS TRANSFER AT THE VERY LEAST ──────────────────────
       Ali, 26.08.15: "if no airway must have transfer on."

       This is the first requirement in the register that is CONDITIONAL — it asks nothing of a
       pod that has airway cover, and asks firmly of one that does not. That shape matters, and
       it is why it could not be expressed by tuning N01's weight: raising transfer everywhere
       would push the planner to give every pod transfer whether it needed it or not, spending
       scarce people on pods that are already covered by the stronger skill.

       It works because of a fact about this unit, checked on the staff list: all 37 airway-trained
       people are also transfer-trained, and 9 more are transfer-only. So transfer is a strictly
       larger pool, and a pod that cannot be given airway can nearly always be given transfer. The
       rule says: if you cannot have the best cover, you will not be left with none.

       Weighted heavily rather than made a GATE, deliberately. A gate breaks the pod and refuses to
       score it, and on a genuinely thin day that would paint half the board red for a situation
       nobody could have avoided — the everything-is-broken fault in a new costume. A heavy aim
       makes it the loudest thing the planner chases without pretending the day is unworkable. */
    { id: "N07", scope: "pod",  kind: "aim",  label: "A pod without airway has transfer at least", short: "no airway, no transfer" },
    { id: "N06", scope: "pod",  kind: "aim",  label: "No neuro placement outside Pods C and D", short: "neuro off C/D" },
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

  /* Where a neuro placement belongs. Named rather than inlined because the board has its own copy
     (NEURO_PODS) for the registrar hard-lock, and two lists that must agree should at least be
     findable by the same search. */
  var NEURO_POD = ["C", "D"];

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
    /* NOT ALL THE SAME ANY MORE. Everything at 1 was why the ring could only ever land on a
       multiple of 20 (Ali: "still suspicious of algorithm with all the 100s and 80s and muliples
       of 10"). These are a proposal and the weakest part of the model — the override counter is
       what should set them, and it has only just started collecting. Editable from Setup. */
    /* R04 5, from 3, on the 26.08.15 sweep against the real roster. Airway is the binding
       constraint and transfer very nearly takes care of itself — every airway-trained person on
       this unit is transfer-trained, so R04 and N01 were charging twice for one capability at 3
       and 2. Moving the weight onto airway took days where an A-D pod has NEITHER from 7.1% to
       3.6% and two-or-more-of-A-D-bare from 4.3% to 2.9%, at no cost in churn. */
    w: { R04: 5, N01: 2, N05: 1, N02: 1, N03: 3, N04: 1, N06: 1, N07: 3,
         R05: 1, R06: 1, R07: 1, R14: 1, R15: 1, R17: 1, R18: 1, R19: 1, R20: 1 },

    /* WHAT ONE PERSON IS WORTH TO A POD'S EXPERIENCE. Ali, 26.08.15: "nights even with 5 and 3
       airways cant be 100% if even one of them is inexperienced." That is the sharpest statement
       anybody has made about this model, and it generalises: experience is not a threshold a team
       clears, it is a property every person on the team carries. So a pod scores the AVERAGE of
       these, and one newcomer among five costs real points that no amount of airway cover buys
       back. Unknown sits at the mid value rather than the bottom — a blank field must never make
       a pod look worse (see the Attention rows that ask instead). */
    tierValue: { "new": 0.35, mid: 0.75, settled: 1, unknown: 0.75 },

    /* HOW MANY OF A SKILL A POD OF n WANTS: one per this many people, minimum one. A pod of five
       with a single airway-trained person is thinner than a pod of two with one, and a yes/no tick
       cannot see the difference — which is the other half of why the old scale was so coarse.
       Ali's ruling was asked for on this number; 3 is the starting point, editable in Setup. */
    coverPer: 3,

    /* How steeply a second and third person carrying the same skill add value. 1 is linear; 0.5
       makes the first one worth most, which is how cover really behaves. */
    coverCurve: 0.5,

    /* SUPERVISION. How many newcomers one experienced person can carry, and whether somebody in
       their middle year counts as a full supervisor. Both are judgements the unit should make and
       both are editable — 2 and 1 are a starting point, not a finding. */
    newPerExp: 2,
    midSupervises: 1,

    /* ── POD E IS A DIFFERENT KIND OF POD AND IS NOW SCORED LIKE ONE ────────────────────────
       Ali, 26.08.15: "E needs to be weighted differently somehoe or iwll aleways look terrible. the
       airway skill should cary less weight for pod E only." And earlier: "no transfer on E not
       important."

       E was first dealt with by leaving it OUT of airway and transfer altogether, which is the
       blunt version of the same idea and wrong in a way that showed: a pod that is not asked for
       something cannot be credited when it has it either, so an airway-trained person standing in
       Pod E counted for nothing anywhere. This is the same fault as the old per-pod FLOORS, which
       were thrown out on 14 Aug for making E the weakest pod on almost every day — a signal that
       only ever says "E" is no signal at all.

       So E is asked the same questions as everywhere else and its answers are worth less. A
       multiplier of 1 is the default and means "same as any pod"; anything below it says this pod
       wants less of that thing. Per pod and per requirement, so if D ever needs its own treatment
       it is one line rather than a new mechanism. Editable from Setup like everything else. */
    /* N07 gets E's lighter treatment too. The fallback exists so a pod that cannot have the best
       cover is not left with none — but E is deliberately the pod that wants least of both, and
       charging it the full weight would have the rule fighting the pod weights three lines above
       it. Halved rather than zeroed: E having neither is still worth noticing. */
    /* E's airway weight is 0, from 0.4, on the 26.08.15 sweep. Ali has said plainly that an E
       without airway is not what worries him; a bare A-D pod is. Asking E for airway at all was
       pulling scarce carriers into the pod that wants them least. Pod E bare goes 30.7% -> 46.7%
       of its pod-days and that is the price, paid deliberately. */
    podWeight: { E: { R04: 0, N01: 0.25, N05: 0.6, N07: 0.5 } },

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
    capExperience: true,

    /* ── A STANDING SLOT IS RECOGNISED, NOT WAITED FOR ──────────────────────────────────────
       Ali, 26.08.15, reading the real Attention list: "why are locum and neurology still coming
       up — i thought we said ignore them."

       They were being ignored, by a `placeholder` flag that nobody had ever ticked. The flag was
       built on 15 Aug and the filter honours it correctly; the records on the live board simply
       do not carry it, because setting it is a manual act on every locum line that will ever
       exist. A rule that depends on somebody remembering to tick a box is not a rule, and the
       list Ali was looking at is what that costs.

       So the names are matched instead. These are STANDING SLOTS — a line on the rota that a
       different person fills each time — and asking one of them how long it has been on the unit
       is a category error, not a missing field. Editable from Setup because "what a locum line is
       called" is exactly the sort of thing that changes without warning, and a hard-coded list
       would put us straight back to a rule nobody can fix.

       The flag still wins where it is set: somebody may tick a slot this list does not recognise,
       and nothing here should un-tick them. */
    slotNames: ["locum", "neurology registrar", "neuro registrar", "bank ", "nhsp", "agency"],

    /* ── WHERE THE RING CHANGES COLOUR ──────────────────────────────────────────────────────
       Five flat bands, low to high, each `[below this, this colour]`. Editable from Setup, and
       deliberately the SAME list that band() reads, so the colour and the word are one decision
       rather than two that drift. Change a number here and the whole board moves together. */
    bands: [[55, "hsl(2,72%,48%)"],     /* under 55 — red, and it is actually red */
            [70, "hsl(28,88%,50%)"],    /* 55-69   — orange */
            [82, "hsl(46,94%,50%)"],    /* 70-81   — amber */
            [92, "hsl(88,62%,42%)"],    /* 82-91   — green */
            [101, "hsl(130,58%,33%)"]]  /* 92+     — deep green */
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
  /* The same weight, scaled by what THIS pod wants of it. Everything reads weights through here so
     a pod-specific multiplier cannot be honoured in one place and forgotten in another. */
  function wFor(cfg, id, pod) {
    var base = wOf(cfg, id);
    var m = (cfg.podWeight && cfg.podWeight[pod] && cfg.podWeight[pod][id]);
    m = Number(m);
    return (isFinite(m) && m >= 0) ? base * m : base;
  }

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
  /* A line on the rota rather than a person: the flag if somebody set it, otherwise the name.
   Exported, because the board's Attention list and this file's tiering must agree about who
   counts as a person — they disagreed until 26.08.15 and the symptom was three rows asking a
   locum line for its start date. */
function isSlot(person, cfg) {
  if (!person) return false;
  if (person.placeholder) return true;
  var list = (cfgOf(cfg).slotNames) || [], nm = String(person.name || "").toLowerCase(), i;
  for (i = 0; i < list.length; i++) if (nm.indexOf(String(list[i]).toLowerCase()) !== -1) return true;
  return false;
}
function tierOf(person, onDate, cfg, firstSeen) {
    cfg = cfgOf(cfg);
    if (!person) return "unknown";
    /* A STANDING SLOT HAS NO TIME ON THE UNIT, because it is not a person — it is a line on the
       rota that somebody different fills each time. Counted as settled rather than unknown so it
       never drags a pod's experience mix down, and never appears in the list of people to go and
       ask about. Ali, 26.08.15, on the locum and neurology registrar rows: "their attnetion things
       are annoying." */
    if (isSlot(person, cfg)) return "settled";
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
      pods[p] = { pod: p, got: 0, app: 0, met: [], missed: [], part: [], dropped: [], unfixable: [], broken: broken[p], people: [] };
      var ids = P[p] || [];
      for (j = 0; j < ids.length; j++) {
        var per = S(ids[j]), t = tierOf(per, iso, cfg, fs);
        pods[p].people.push({ id: ids[j], tier: t, name: per && per.name, grade: per && per.grade,
          airway: !!(per && per.airway), transfer: !!(per && per.transfer), neuro: !!(per && per.neuro),
          accp: !!(per && per.grade === "ACCP") });
        if (t === "unknown" && per) unknowns.push(per.id);
      }
    }

    /* ── TWO LAYERS, AND THIS IS THE HEART OF IT ─────────────────────────────────────────────
       Ali, 26.08.15: "yes like 41 things for the ring and the actual alogirthm for the lsit keep
       to simple things that are either present or not."

       So every requirement answers TWO questions and they are not the same question:

         has   present or not. Drives the LIST — the ticks and crosses, the grey line under a ring,
               the sentence in the log, and what the planner aims at. "No airway in Pod C" is true
               or it is false, and a coordinator at five in the morning needs it that way.

         val   0 to 1, by degree. Drives the RING and nothing else. A pod of five with one
               airway-trained person is thinner than a pod of two with one; a team carrying one
               newcomer is not the same as a team carrying three. This is what stopped the score
               landing on a multiple of twenty — 7 distinct values became 41 across the same days.

       A requirement can be PRESENT and still not score full: Pod A holds one airway person for
       three people and reads met on the list, 1.00 on the ring; the same one person in a pod of
       five reads met on the list and 0.50 on the ring. Nothing about the list gets fuzzy. */
    /* ── HOW MUCH OF A SKILL A POD OF n WANTS ────────────────────────────────────────────────
       Was `ceil(n / coverPer)`, which is a STEP: a pod of three wanted one airway person and
       scored 1.00, and the moment a fourth arrived it wanted two and scored 0.50. Adding a pair
       of hands halved the pod's airway score — the same "more people is worse" fault as the
       experience mean, wearing a different hat, and the two compounded.

       Now the requirement rises CONTINUOUSLY with size and the score is CONCAVE, so the first
       person carrying a skill delivers most of the value and each extra one adds less. That is
       how cover behaves: nobody to somebody is the difference that matters; two to three is a
       nicety. */
    var coverNeed = function (n) {
      var per = Number(cfg.coverPer);
      if (!isFinite(per) || per < 1) per = 3;
      return 1 + Math.max(0, n - 1) / per;
    };
    var coverVal = function (have, need) {
      if (!have) return 0;
      var k = Number(cfg.coverCurve);
      if (!isFinite(k) || k <= 0 || k > 1) k = 0.5;
      return Math.min(1, Math.pow(have / Math.max(1e-6, need), k));
    };
    var tierVal = function (t) {
      var v = (cfg.tierValue || {})[t];
      return isFinite(Number(v)) ? Number(v) : 0.75;
    };

    for (i = 0; i < order.length; i++) {
      p = order[i];
      var pe = pods[p].people;
      if (!pe.length) continue;

      /* Experience. Every person carries a value; the pod scores the average. Ali's night rule
         — "cant be 100% if even one of them is inexperienced" — falls out of this rather than
         being special-cased, and it applies to a pod for exactly the same reason. The LIST keeps
         the plain question: is anybody here past their first weeks? */
      if (isOn(cfg, "N03")) {
        /* ── ENOUGH PEOPLE TO CARRY THE NEWCOMERS, NOT AN AVERAGE ─────────────────────────────
           Ali, 26.08.15: "how can moving a newish person off improve the pod coming off and
           decrease score of pod going to? that's crazy — even a new person is worth something."

           He is right, and the old arithmetic was provably wrong rather than merely harsh. N03 was
           the MEAN of everybody's tier value, and a mean falls whenever you add anybody below it.
           Measured on the real board: Pod E holding a mid and a settled scored 0.88; add one
           newcomer and it scored 0.70. THE POD GOT WORSE BY GAINING A PERSON. No rota is improved
           by having fewer people on it, so a model that says so will keep producing answers
           somebody has to argue with.

           The real question is not how experienced a pod is ON AVERAGE. It is whether there are
           enough experienced people to CARRY the newcomers it has — which is what supervision
           means and what a consultant actually asks. So: no newcomers, nothing is asked and the
           pod scores 1; newcomers present, it wants one experienced person per `newPerExp` of
           them and scores the share of that it has.

           A newcomer joining a pod with spare supervision now costs NOTHING. A pod of newcomers
           with nobody experienced scores 0 rather than 0.35 — harsher and correct: that is Pod A
           on 13 Aug, two people three weeks in, the worst thing on the board, which the old model
           gave a third of a mark. */
        var nNew = 0, nExp = 0, midW = Number(cfg.midSupervises);
        if (!isFinite(midW) || midW < 0) midW = 1;
        for (j = 0; j < pe.length; j++) {
          if (pe[j].tier === "new") nNew++;
          else nExp += (pe[j].tier === "mid" ? midW : 1);
        }
        var perExp = Number(cfg.newPerExp);
        if (!isFinite(perExp) || perExp < 1) perExp = 2;
        var needExp = nNew ? Math.ceil(nNew / perExp) : 0;
        charge(pods[p], "N03", !nNew ? 1 : Math.min(1, nExp / needExp),
          nExp > 0 || !nNew, wFor(cfg, "N03", p));
      }

      /* ACCPs, counted as an EXCESS rather than a presence. One or none is what everybody gets; a
         second in the same pod costs, because it is a scarce person doing a job the first already
         covers. Halves per extra, so two is 0.5 and three is 0. */
      if (isOn(cfg, "N02")) {
        var accps = 0;
        for (j = 0; j < pe.length; j++) if (pe[j].accp) accps++;
        var over = Math.max(0, accps - 1);
        charge(pods[p], "N02", Math.max(0, 1 - over * 0.5), over === 0, wFor(cfg, "N02", p));
      }

      /* THE FALLBACK. Asked only of a pod that has no airway person; silent otherwise, so it
         never competes for people a covered pod does not need. */
      if (isOn(cfg, "N07")) {
        var hasAir = false, hasTr = false;
        for (j = 0; j < pe.length; j++) {
          if (pe[j].airway) hasAir = true;
          if (pe[j].transfer) hasTr = true;
        }
        if (!hasAir) charge(pods[p], "N07", hasTr ? 1 : 0, hasTr, wFor(cfg, "N07", p));
      }

      /* Neuro, counted the same way: what it costs to have somebody in the wrong place. C and D
         are never asked, and a pod holding nobody on a neuro placement is never asked. */
      if (isOn(cfg, "N06") && NEURO_POD.indexOf(p) === -1) {
        var nro = 0;
        for (j = 0; j < pe.length; j++) if (pe[j].neuro) nro++;
        if (nro) charge(pods[p], "N06", Math.max(0, 1 - nro * 0.5), false, wFor(cfg, "N06", p));
      }

      /* Continuity. Share of the pod that was in it yesterday, against the share we ask for. */
      if (isOn(cfg, "N04") && prevP) {
        var kept = 0;
        for (j = 0; j < pe.length; j++) if ((prevP[p] || []).indexOf(pe[j].id) !== -1) kept++;
        var want = Math.max(1, Math.ceil(pe.length * Number(cfg.keepShare)));
        charge(pods[p], "N04", Math.min(1, kept / want), kept >= want, wFor(cfg, "N04", p));
      } else if (isOn(cfg, "N04")) {
        pods[p].dropped.push("N04");
      }
    }

    var rank = order.slice().sort(function (a, b) {
      var ra = pods[a].app ? pods[a].got / pods[a].app : 1, rb = pods[b].app ? pods[b].got / pods[b].app : 1;
      return ra - rb || order.indexOf(a) - order.indexOf(b);
    });

    /* The skills. Supply is counted across the whole day shift, because a person in the wrong pod
       is supply a move can reach — that is what makes `unfixable` and the donor line meaningful. */
    for (r = 0; r < REGISTER.length; r++) {
      var reg = REGISTER[r];
      if (reg.scope !== "pod" || reg.kind !== "aim" || !reg.rel || !isOn(cfg, reg.id)) continue;
      var has = traitFn(reg.trait), want2 = reg.pods || order;
      var supply = 0, holds = [], missAll = [], countIn = {};
      for (i = 0; i < order.length; i++) {
        var lst = pods[order[i]].people, nHere = 0;
        for (j = 0; j < lst.length; j++) if (has(S(lst[j].id))) nHere++;
        countIn[order[i]] = nHere;
        supply += nHere;
        if (want2.indexOf(order[i]) === -1) continue;
        if (nHere > 0) holds.push(order[i]);
        else if (lst.length) missAll.push(order[i]);
        if (nHere > 1) (capacity[reg.id] = capacity[reg.id] || []).push({ pod: order[i], spare: nHere - 1 });
      }
      var spare = Math.max(0, supply - holds.length);
      var ordered = rank.filter(function (x) { return missAll.indexOf(x) !== -1; });
      /* ── A SCARCE PERSON PARKED WHERE THEY ARE WORTH LEAST IS STILL AVAILABLE ────────────────
         Ali, 26.08.15, looking at Monday 17 August: "looks wrong with Nabeel on E when there other
         pods with no airway - whats caused this."

         Three airway-trained were on. Pods B, C and E each held one, so `supply - holds.length`
         came out at zero and Pods A and D were told nothing could be moved. But one of the three
         was in POD E, which wants airway least of all the pods — moving them to A is not only
         possible, it is the obvious thing to do, and the board said it could not be done.

         So a pod is out of reach only if there is nowhere BETTER for the skill to come from: no
         pod holding a spare, and no pod holding one that values it less than this pod does. The
         weights that make E gentler must not also make E a place scarce people disappear into. */
      var betterHome = function (forPod) {
        var z, hp;
        for (z = 0; z < holds.length; z++) {
          hp = holds[z];
          if (wFor(cfg, reg.id, hp) < wFor(cfg, reg.id, forPod)) return true;
        }
        return false;
      };
      for (i = 0; i < order.length; i++) {
        p = order[i];
        if (want2.indexOf(p) === -1 || !pods[p].people.length) continue;
        /* Airway and transfer scale with the size of the pod; the phone and an ACCP are one each,
           because two phone-trained people in a pod is not twice the phone. */
        var scales = (reg.id === "R04" || reg.id === "N01");
        var wantN = scales ? coverNeed(pods[p].people.length) : 1;
        charge(pods[p], reg.id, scales ? coverVal(countIn[p], wantN) : Math.min(1, countIn[p] / wantN),
          countIn[p] > 0, wFor(cfg, reg.id, p));
      }
      for (i = spare; i < ordered.length; i++)
        if (!betterHome(ordered[i])) pods[ordered[i]].unfixable.push(reg.id);
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
      night = { pod: "N", got: 0, app: 0, met: [], missed: [], part: [], dropped: [], unfixable: [], broken: [], people: [] };
      for (nj = 0; nj < nIds.length; nj++) {
        var np = S(nIds[nj]);
        night.people.push({ id: nIds[nj], tier: tierOf(np, iso, cfg, fs), name: np && np.name, grade: np && np.grade,
          airway: !!(np && np.airway), transfer: !!(np && np.transfer), accp: !!(np && np.grade === "ACCP") });
      }
      night.broken = nightBroken.slice();
      if (isOn(cfg, "N03") && night.people.length) {
        /* Same supervision question as a pod — a night team is a pod that works in the dark. */
        var nNw = 0, nEx = 0, mW = Number(cfg.midSupervises);
        if (!isFinite(mW) || mW < 0) mW = 1;
        for (nj = 0; nj < night.people.length; nj++) {
          if (night.people[nj].tier === "new") nNw++;
          else nEx += (night.people[nj].tier === "mid" ? mW : 1);
        }
        var pEx = Number(cfg.newPerExp); if (!isFinite(pEx) || pEx < 1) pEx = 2;
        var needN = nNw ? Math.ceil(nNw / pEx) : 0;
        charge(night, "N03", !nNw ? 1 : Math.min(1, nEx / needN), nEx > 0 || !nNw, wOf(cfg, "N03"));
      }
      if (isOn(cfg, "R04") && night.people.length) {
        /* The night team wants airway cover in proportion to its size, exactly as a pod does. */
        var nAirC = 0;
        for (nj = 0; nj < night.people.length; nj++) if (night.people[nj].airway) nAirC++;
        charge(night, "R04", coverVal(nAirC, coverNeed(night.people.length)), nAirC > 0, wOf(cfg, "R04"));
      }
      if (isOn(cfg, "R14")) {
        /* Only asked when there are two to split. One airway-trained on a night team is not a
           spread problem, it is the whole of what the night has. */
        var nAir = 0;
        for (nj = 0; nj < night.people.length; nj++) if (night.people[nj].airway) nAir++;
        if (nAir >= 2) charge(night, "R14", aimFail.R14 ? 0 : 1, !aimFail.R14, wOf(cfg, "R14"));
        else night.dropped.push("R14");
      }
      if (isOn(cfg, "N04") && night.people.length && ctx.prevNightCounts && ctx.prevNightCounts.length) {
        var nKept = 0;
        for (nj = 0; nj < night.people.length; nj++) if (ctx.prevNightCounts.indexOf(night.people[nj].id) !== -1) nKept++;
        var nShare = nKept / night.people.length, nWant = Number(cfg.keepShare);
        charge(night, "N04", nWant > 0 ? Math.min(1, nShare / nWant) : 1, nShare >= nWant, wOf(cfg, "N04"));
      } else if (isOn(cfg, "N04") && night.people.length) night.dropped.push("N04");
      night.pct = night.app ? Math.max(0, Math.min(100, Math.round(night.got / night.app * 100))) : (night.people.length ? null : 0);
      night.isBroken = night.broken.length > 0;
      night.assessed = night.met.length + night.missed.length;
      night.possible = night.assessed + night.dropped.length;
      night.ceiling = night.app ? Math.max(0, Math.min(100, Math.round((night.app - unfixableWeight(night)) / night.app * 100))) : null;
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
      /* THE POD'S CEILING TODAY. Ali, 26.08.15: "use a dash to show the maximum for that pod - max
         doesnt need to be 100 there as fewer needs." This is the other half of rule 2 and the thing
         that makes an honest number readable: the score says what the pod HAS, and the dash on the
         ring says the best it could have been with the people who were actually on. A pod at 40
         against a ceiling of 40 has nothing to answer for; a pod at 40 against a ceiling of 100 has
         everything to answer for; and the two used to be indistinguishable.

         Everything except the requirements no move could reach is assumed winnable, which is what
         "ceiling" means — not a prediction, a limit. */
      pd.ceiling = pd.app ? Math.max(0, Math.min(100, Math.round((pd.app - unfixableWeight(pd)) / pd.app * 100))) : null;
      got += pd.got; app += pd.app;
    }
    /* A DAY WITH A BROKEN POD IS NOT A HUNDRED PER CENT DAY. Ali, 26.08.15: "a day cant be 100% if
       no LD A - impossible for most days but dont say its perfect when its not!" The day score was
       built from the day-wide aims plus the pod aims, and pod GATES were left out of it entirely —
       so Pod A could have nobody on a long day, draw its own red ring saying exactly that, and the
       day beside it could still read 100. A gate is a gate at every level: if any pod or the night
       team is broken, the day is broken, and it says so instead of a number. */
    var podBroken = [];
    for (i = 0; i < order.length; i++) if (pods[order[i]].broken.length) podBroken.push(order[i]);
    if (night && night.broken.length) podBroken.push("N");
    var dayPct = app ? Math.max(0, Math.min(100, Math.round(got / app * 100))) : null;
    var dCeilTop = dApp - 0, dCeilLost = 0;
    var dAssessed = 0, dPossible = 0;
    for (i = 0; i < order.length; i++) { dAssessed += pods[order[i]].assessed; dPossible += pods[order[i]].possible; }
    dAssessed += dayMet.length + dayMissed.length; dPossible += dayMet.length + dayMissed.length;
    for (i = 0; i < order.length; i++) dCeilLost += unfixableWeight(pods[order[i]]);
    var dayCeiling = app ? Math.max(0, Math.min(100, Math.round((app - dCeilLost) / app * 100))) : null;

    return {
      pods: pods, day: { pct: dayPct, got: got, app: app, met: dayMet, missed: dayMissed, broken: dayBroken,
             podBroken: podBroken, isBroken: (dayBroken.length + podBroken.length) > 0,
             ceiling: dayCeiling, assessed: dAssessed, possible: dPossible },
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
    /* How much of a pod's weight is out of reach today: an unfixable requirement is held at the
       value it actually scored, everything else is assumed winnable. That difference IS the dash
       on the ring. */
    function unfixableWeight(podSc) {
      var t = 0, q, id, w, f;
      for (q = 0; q < (podSc.unfixable || []).length; q++) {
        id = podSc.unfixable[q]; w = wFor(cfg, id, podSc.pod); f = 0;
        for (var z = 0; z < (podSc.part || []).length; z++) if (podSc.part[z].id === id) f = podSc.part[z].f;
        if (podSc.met.indexOf(id) !== -1 && f === 0) f = 1;
        t += w * (1 - f);
      }
      return t;
    }
    function charge(podSc, id, val, has, wt) {
      var f = Number(val);
      if (!isFinite(f)) f = 0;
      f = Math.max(0, Math.min(1, f));
      podSc.app += wt;
      podSc.got += wt * f;
      /* THE LIST IS BINARY AND STAYS BINARY. `has` decides the tick or the cross; `f` only ever
         moves the ring. A requirement can read met and still score 0.5 — that is the point. */
      if (has) podSc.met.push(id); else podSc.missed.push(id);
      if (f > 0 && f < 1) podSc.part.push({ id: id, f: f });
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
     Was a continuous ramp, on Ali's 26.08.14 instruction: "just give each score a % with a
     gradient colour", so a pod at 69 and one at 71 would not look like different kinds of thing.
     That reasoning was sound and the result was not — see the note inside colourOf. Replaced
     26.08.15 with five flat bands, and the original intent is recorded here because it is the
     thing the replacement had to answer: 69 and 71 DO now draw the same colour, which is what
     that sentence was asking for, but 55 and 81 no longer do. */
  function colourOf(pct) {
  if (pct == null) return "#8a8f98";
  /* ── FIVE FLAT BANDS, NOT A GRADIENT. Ali, 26.08.15: "colour spectrum is seriously weird for
     the rings... option 3", having been shown the alternatives side by side.

     He is right and the old ramp was measurably wrong rather than merely ugly. Interpolating
     continuously meant NOTHING WAS EVER RED — 40% came out orange at hue 22 — and 55 through 72
     were one indistinguishable yellow, which is the exact range where a pod is thin enough to
     need doing something about. A ramp that cannot say "bad" and cannot separate its own middle
     is not a signal, it is decoration.

     So the ring now takes one of five colours and nothing between. Two pods either match or they
     do not, which is the question somebody scanning a week is actually asking — "are these the
     same kind of day?" — and a continuous ramp answers it with a shrug.

     THE NUMBER IS UNCHANGED AND STAYS EXACT. Ali: "you still display the % it's only the ring
     colour that should change." Banding the colour must never band the score: 71 and 81 draw the
     same amber and still read 71 and 81, because the arithmetic is what makes the difference
     arguable and the colour is only what makes it noticeable.

     The cut points live in DEFAULTS and are editable from Setup like every other number, and the
     BANDS ARE THE SAME CUTS the words use — see band() — so the colour and the label can never
     disagree, which they quietly did while one was a ramp and the other was a threshold. */
  var cuts = (cfgOf(null).bands) || DEFAULTS.bands;
  var v = Math.max(0, Math.min(100, Number(pct))), i;
  for (i = 0; i < cuts.length; i++) if (v < cuts[i][0]) return cuts[i][1];
  return cuts[cuts.length - 1][1];
}
function band(pct) {
  if (pct == null) return "unknown";
  /* THE SAME CUTS THE COLOUR USES, so a ring can never be green and labelled thin. Three CSS
     names rather than five because the dial only needs to know red, amber or green — the fifth
     colour is a shade of the same judgement, not a different one. */
  var cuts = (cfgOf(null).bands) || DEFAULTS.bands;
  var v = Number(pct);
  if (v < cuts[0][0]) return "bare";
  if (v < cuts[2][0]) return "thin";
  return "ok";
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
    isSlot: isSlot,
  rowOf: rowOf, labelOf: labelOf, shortOf: shortOf, podNamedIn: podNamedIn,
    colourOf: colourOf, band: band, donors: donors, wFor: wFor,
    indexStaff: byIdOf, isOn: isOn, wOf: wOf
  };

  if (typeof module === "object" && module.exports) module.exports = API;
  root.Strength = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
