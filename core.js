/* ============================================================================
   core.js — shared truths. Loaded before k.js on every page.

   Two jobs.

   1. DECIDE WHETHER THIS IS THE LIVE SITE, from the address rather than from a
      build step. Previously build-test.sh *inserted* window.__POD_TEST into a
      copy of the file, which meant the test site and the live site could never
      be byte-identical — so no diff between them was meaningful, and the only
      record of what was waiting to go live was somebody's memory.
      Now: one host is live, everything else is a sandbox. It fails safe — an
      unrecognised address is treated as a sandbox, never as live.

   2. SHOW WHAT IS WAITING TO GO LIVE, on the page, on the test site only.
      Reads pending.json next to it. If that file is missing the chip simply
      doesn't appear.

   3. READ THE CHANGE LOG. Both boards keep a log of the same shape, and both
      offer the same two ways of reading it, so the sorting and filtering live
      here once rather than drifting apart in two files.
   ============================================================================ */

var LIVE_HOST = "rota.salford.icu";

/* The live site is that one host over http(s). A local file keeps its own
   behaviour (it saves to the file via the File System API, so it must not be
   diverted into browser storage). An explicit window.__POD_TEST set by a build
   still wins, so rota.salford.icu/test.html carries on working. */
window.__POD_TEST = (window.__POD_TEST === true) ||
  (location.protocol !== "file:" && location.hostname !== LIVE_HOST);

/* Stamped by hand when pushing to staging. Shown next to the pending list so
   there is never a question about which build you are looking at. */
window.__POD_BUILD = "2026-08-03-03";

/* ---------------------------------------------------------------------------
   CHANGE LOG — reading entries of the shape { t, who, msg, kind, on }.

   t   when the change was made.
   on  which rota day it changed. Different from t: fixing next Tuesday on a
       Monday afternoon is one entry with two dates. Null when the change isn't
       about a particular day at all — a password, a new starter.
   kind "manual" (a person decided) or "auto" (auto-fill, the retention sweep,
       an import, or the background sync). Stamping the software's decisions
       with whoever happened to be in edit mode was misleading.

   Entries written before kind and on existed carry neither, and there are
   months of them. They are never rewritten — read forgivingly instead:
   unstamped means a person did it, undated falls back to when it was made.
   --------------------------------------------------------------------------- */

function logKind(e){ return (e && e.kind === "auto") ? "auto" : "manual"; }
function logMade(e){ return (e && e.t) ? String(e.t).slice(0, 10) : ""; }
function logOn(e){ return (e && e.on) ? String(e.on).slice(0, 10) : logMade(e); }

/* Who an entry is ABOUT, which is not the same as who made it. Empty for the entries that are
   genuinely not about one person: an import, a password, a whole day reworked. */
function logSubject(e){
  var d = logDet(e);
  return (d && d.subj) ? String(d.subj) : "";
}

/* Filter, then bucket. by = "made" | "affects" | "person"; filter = "all" | "manual" | "auto".
   Returns [{ date, entries }], newest date first, newest entry first inside each date —
   the log arrives newest-first and bucketing preserves that order.

   PERSON is the third way of reading it, and it is a different question from the other two.
   Both date modes answer "what happened then"; twelve rows under TODAY are twelve facts with no
   thread between them, and the thread is what somebody actually wants — Ali, 8 Aug: "nothing ties
   the rows together", looking at five rows that were one Optima change. Bucketing by subject ties
   them, and then two things flip:
     - the groups run by MOST RECENTLY TOUCHED, not alphabetically, so whoever has just been moved
       is at the top where the question usually starts;
     - inside a group the entries run OLDEST FIRST, because a series reads forwards. Newest-first
       is right for "what just happened" and wrong for "how did we get here".
   The unnamed bucket sorts last under its own heading rather than being dropped: an entry the
   reader cannot see is worse than one they can see is not about anybody.
   Pure: list in, list out, so it can be held still by a test. */
function groupLog(list, by, filter){
  var buckets = {}, order = [], last = {};
  (list || []).forEach(function(e){
    if (!e) return;
    var k = logKind(e);
    if (filter === "manual" && k !== "manual") return;
    if (filter === "auto" && k !== "auto") return;
    var d = (by === "person") ? logSubject(e)
          : (by === "affects") ? logOn(e) : logMade(e);
    if (!buckets[d]) { buckets[d] = []; order.push(d); }
    buckets[d].push(e);
    var t = (e && e.t) ? String(e.t) : "";
    if (!last[d] || t > last[d]) last[d] = t;
  });
  if (by === "person") {
    return order.sort(function(a, b){
      if (!a !== !b) return a ? -1 : 1;                        // the unnamed bucket last
      if (last[a] !== last[b]) return last[a] < last[b] ? 1 : -1;
      return a < b ? -1 : 1;                                   // same instant: alphabetical
    }).map(function(d){
      return { date: d, person: true, entries: buckets[d].slice().sort(function(x, y){
        var a = String((x && x.t) || ""), b = String((y && y.t) || "");
        return a < b ? -1 : a > b ? 1 : 0;
      }) };
    });
  }
  return order.sort(function(a, b){ return a < b ? 1 : a > b ? -1 : 0; })
              .map(function(d){ return { date: d, entries: buckets[d] }; });
}

/* "Monday 3 August" for a group heading; today and yesterday say so instead, because that is
   how someone scanning for what just happened actually thinks about it. */
function logDayLabel(iso, todayIso){
  if (!iso) return "Undated";
  var today = todayIso || new Date().toISOString().slice(0, 10);
  if (iso === today) return "Today";
  var y = new Date(today + "T12:00:00"); y.setDate(y.getDate() - 1);
  if (iso === y.toISOString().slice(0, 10)) return "Yesterday";
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-GB",
      { weekday: "long", day: "numeric", month: "long" });
  } catch (err) { return iso; }
}

/* ---------------------------------------------------------------------------
   THE DAY STRIP — ONE COMPONENT, BOTH BOARDS.

   Ali, 10 Aug, on being told the two boards had two different strips: "tey dont
   need to be thoguh do they, and shiould be." Correct. They were never meant to
   diverge; the Pod Board grew a scrolling strip of wide pills with status dots
   and Cover grew a fixed seven-across of small two-line ones, and nobody chose
   that. logPanel and groupLog already live here for exactly this reason, so the
   strip joins them and the boards stop being able to drift apart.

   ALL SEVEN, NOTHING SCROLLS (Ali chose this over a smoother scroller, 10 Aug).
   The scrolling version generated three separate complaints — every press
   selected the next day instead of scrolling, it was unclear whether today
   should sit left or centred, and a new week did not land on its Monday. None
   of the three is a bug in the scroller: they are all consequences of there
   being a scroller. Seven pills that always fit have no scroll position to get
   wrong, no question of where today belongs, and nothing to default to.

   STYLED INLINE, ON PURPOSE. There is no shared stylesheet — core.css is a
   different file on each board — so a class-based strip would need the same
   rules maintained in two places, which is the exact failure this is undoing.
   The only thing it takes from the page is var(--accent), which is blue on the
   Pod Board and amber on Cover, so today's ring matches whichever board it is
   drawn on without being told.

   FOUR SIGNALS THAT DO NOT COLLIDE: chosen is solid, today is a ring, the past
   is faded, the weekend is tinted. They are on independent properties, so a
   Saturday that has already been still reads as both.
   --------------------------------------------------------------------------- */
var DAYSTRIP_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var DAYSTRIP_DOT   = { hard: "#e2504e", soft: "#e6b84c", ok: "#7fc99a", none: "#e2e4e8" };

/* dates: seven ISO days. sel: index currently shown. opts.dot(iso, i) returns
   "hard"|"soft"|"ok"|"none" or nothing at all — Cover passes one for days that
   need attention, the Pod Board for days with issues, and a board that has
   nothing to say simply omits it and gets the spacer instead, so the pills stay
   the same height either way. */
function dayStrip(dates, sel, opts){
  opts = opts || {};
  var today = opts.today || __todayISO();
  /* NO `display` HERE, deliberately. The component owns how the pills look; the PAGE owns whether
     the strip is shown at all, because that is a question about the page's layout and not about
     the component. Setting display:flex inline made the strip beat `.daystrip{display:none}` in
     the stylesheet — inline style wins — and seven bare pills appeared above the desktop table.
     That is the 9 Aug fault exactly, arriving by a different route: the rule was written, and the
     component overrode it. Both boards set display:flex inside their phone media query. */
  var wrap  = __el("div", { class: "daystrip",
    style: "gap:3px;margin:0 0 .6rem;align-items:stretch" });
  (dates || []).forEach(function(iso, i){
    var wknd = false, num = "", nm = "";
    try {
      var dt = new Date(iso + "T12:00:00");
      wknd = (dt.getDay() === 0 || dt.getDay() === 6);
      num  = String(dt.getDate());
      nm   = DAYSTRIP_NAMES[dt.getDay()];
    } catch (err) {}
    var act = (i === sel), isToday = (iso === today), past = (iso < today);
    var b = __el("button", {
      type: "button", "data-di": String(i), "aria-pressed": act ? "true" : "false",
      class: "daypill" + (act ? " active" : "") + (wknd ? " wknd" : "") +
             (past ? " past" : "") + (isToday ? " today" : ""),
      style: "flex:1 1 0;min-width:0;padding:.42rem .1rem;border-radius:10px;cursor:pointer;" +
             "font:inherit;font-size:.72rem;font-weight:600;line-height:1.2;text-align:center;" +
             "background:" + (act ? "var(--ink)" : wknd ? "var(--hair)" : "var(--card)") + ";" +
             "color:" + (act ? "#fff" : wknd ? "var(--muted)" : "var(--ink)") + ";" +
             "border:0.5px solid " + (act ? "var(--ink)" : "var(--line)") + ";" +
             (isToday && !act ? "box-shadow:inset 0 0 0 1.5px var(--accent);" : "") +
             (past && !act ? "opacity:.45;" : "")
    });
    b.append(nm, __el("span", { style: "display:block;font-size:.68rem;font-weight:500;opacity:.72" }, num));
    var state = opts.dot ? opts.dot(iso, i) : null;
    b.append(state
      ? __el("span", { class: "statusdot " + state,
          style: "display:block;width:6px;height:6px;border-radius:50%;margin:.2rem auto 0;cursor:inherit;" +
                 "background:" + (act ? "rgba(255,255,255,.85)" : (DAYSTRIP_DOT[state] || "transparent")) })
      : __el("span", { style: "display:block;height:9px" }));
    if (opts.onPick) b.onclick = function(){ opts.onPick(i, iso); };
    wrap.append(b);
  });
  return wrap;
}

/* The week card's second line. On the current week it is the hint that the title
   is tappable; anywhere else it becomes the way back, so "This week" is never a
   dead control sitting in a row of its own (Ali, 10 Aug, on it being hidden
   outright on phones: "agree it should be"). */
function weekCardSub(weekKey, todayIso, onBack){
  var today = todayIso || __todayISO();
  var mon = today;
  try {
    var d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    mon = d.toISOString().slice(0, 10);
  } catch (err) {}
  if (String(weekKey || "") === mon) {
    return __el("span", { class: "wcsub",
      style: "font-size:.6rem;letter-spacing:.09em;color:var(--muted)" }, "TAP TO PICK A DATE");
  }
  var b = __el("button", { type: "button", class: "wcsub wcback",
    style: "font:inherit;font-size:.6rem;letter-spacing:.09em;padding:.1rem .6rem;border-radius:999px;" +
           "border:0.5px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer" },
    "← THIS WEEK");
  if (onBack) b.onclick = onBack;
  return b;
}

/* The hairline under a sticky header should mean "there is content under here", so it has to know
   whether the page has moved. One class on <body>, set once for both boards, and the CSS decides
   what to do with it — a board that wants no line simply never styles body.scrolled.
   Passive, and it only touches the DOM when the answer actually changes. */
(function(){
  if (typeof window === "undefined" || !window.addEventListener) return;
  var on = false;
  var read = function(){
    var now = (window.scrollY || window.pageYOffset || 0) > 4;
    if (now === on) return;
    on = now;
    if (document.body) document.body.classList.toggle("scrolled", on);
  };
  window.addEventListener("scroll", read, { passive: true });
  document.addEventListener("DOMContentLoaded", read);
})();

document.addEventListener("DOMContentLoaded", function(){
  if (!window.__POD_TEST) return;

  fetch("pending.json?t=" + Date.now(), { cache: "no-store" })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(p){
      if (!p || !Array.isArray(p.changes)) return;

      /* pending.json is generated from `git log live/main..HEAD`, so each change is an object,
         not a string — printing it straight gave a column of [object Object]. It also contains
         the workflow's own "regenerated" commits, which are bookkeeping and not a change to the
         board, so they are dropped: this list answers "what would go live", and a commit that
         only rewrote this very file is not part of the answer. */
      var real = p.changes.filter(function(c){
        return c && c.msg && !/^What is pending/.test(c.msg);
      });
      if (!real.length) return;

      var chip = document.createElement("button");
      chip.id = "pendingChip";
      chip.textContent = real.length + " change" + (real.length === 1 ? "" : "s") + " not yet live";

      var panel = document.createElement("div");
      panel.id = "pendingList";
      var h = document.createElement("h4");
      h.textContent = "On this test site, not on rota.salford.icu";
      var ul = document.createElement("ul");
      real.forEach(function(c){
        var li = document.createElement("li");
        var when = "";
        try { when = new Date(c.when).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); } catch (e) {}
        li.textContent = c.msg + (when ? "  ·  " + when : "");
        ul.appendChild(li);
      });
      var bld = document.createElement("div");
      bld.className = "bld";
      /* The build the tab is actually running, taken from the generated file rather than a
         hand-typed constant — a stale tab is what made the same import happen twice on 3 Aug. */
      bld.textContent = "test build " + (p.build || window.__POD_BUILD || "?") +
                        (p.liveBuild ? " · live build " + p.liveBuild : "");
      panel.appendChild(h); panel.appendChild(ul); panel.appendChild(bld);

      /* It opened but there was no way to shut it: the chip toggles, but nothing said so and
         the panel covers the board. A close control, Escape, and clicking away all dismiss it. */
      var x = document.createElement("button");
      x.className = "pclose"; x.type = "button"; x.setAttribute("aria-label", "Close");
      x.textContent = "\u00d7";
      x.style.cssText = "position:absolute;top:.35rem;right:.5rem;border:0;background:transparent;" +
        "font-size:1.1rem;line-height:1;cursor:pointer;color:inherit;opacity:.6";
      panel.insertBefore(x, panel.firstChild);

      function close(){ panel.style.display = "none"; }
      x.onclick = function(ev){ ev.stopPropagation(); close(); };
      chip.onclick = function(ev){
        ev.stopPropagation();
        panel.style.display = panel.style.display === "block" ? "none" : "block";
      };
      document.addEventListener("keydown", function(ev){ if (ev.key === "Escape") close(); });
      document.addEventListener("click", function(ev){
        if (panel.style.display === "block" && !panel.contains(ev.target) && ev.target !== chip) close();
      });
      /* The resident page has a fixed gold band across the bottom, which sat on top of a
         free-floating chip and hid it. Where a band exists the chip belongs inside it — one place
         to look, nothing overlapping. Where there isn't one, it floats bottom-right. */
      var bar = document.getElementById("testbar");
      if (bar) { chip.className = "inbar"; bar.insertBefore(chip, bar.lastElementChild); }
      else { document.body.appendChild(chip); }
      document.body.appendChild(panel);
    })
    .catch(function(){ /* no pending file — nothing to show */ });
});

/* ===== SHARED LOG READING AND RENDERING ====================================================
   Lifted out of the resident page on 4 Aug so the consultant page draws its log with the same
   code instead of a second implementation that drifts. Both pages already load this file.
   el() and fmtDate() belong to the pages and are resolved when a function RUNS, not when it is
   defined, so a page that lacks one gets a plain fallback rather than a crash. */
function __el(){
  if (typeof el === "function") return el.apply(null, arguments);
  var n = document.createElement(arguments[0] || "div");
  var a = arguments[1];
  if (a && typeof a === "object") for (var k in a) {
    if (k === "style") n.setAttribute("style", a[k]);
    else if (k === "class") n.className = a[k];
    else if (typeof a[k] === "function") n[k] = a[k];
    else if (a[k] != null) n.setAttribute(k, a[k]);
  }
  for (var i = 2; i < arguments.length; i++) if (arguments[i] != null) n.append(arguments[i]);
  return n;
}
function __todayISO(){
  if (typeof todayISO === "function") return todayISO();
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function __fmtDate(iso){
  if (typeof fmtDate === "function") return fmtDate(iso);
  try { return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
  catch (e) { return String(iso || ""); }
}
/* Reader, so every call site agrees on the shape. */
/* A `kids` entry, whichever way it was written. Some call sites pass objects ({subj, from, to});
   trialSkillFrom passes the STRINGS that diffWeeks produces, and the renderer read .subj off them
   — so an expandable row drew "⤷ undefined — not on" once per child, four times over, which is
   what Ali was looking at on 11 Aug. "not on" was the worst part: it is the removal chip, so the
   row actively claimed four people had been taken off when they had merely moved pod.
   Parsed here rather than fixed at the writer alone, so the entries already stored come good too. */
function kidFields(k){
  if (k && typeof k === "object") return k;
  var s = String(k || ""), m;
  if ((m = s.match(/^(.+?):\s*Pod ([A-E])\s*(?:→|->)\s*Pod ([A-E])/)))
    return { subj: m[1].trim(), from: m[2], to: m[3] };
  if ((m = s.match(/^(Night phone|Phone):\s*(.+?)\s*(?:→|->)\s*(.+?)(?:\s+on\s|$)/)))
    return { subj: m[1], from: m[2] === "nobody" ? "" : m[2], to: m[3] === "nobody" ? "" : m[3], plain: true };
  return { subj: s, plain: true };          // unrecognised: show the sentence, invent no columns
}
function logDet(e){
  if (e && e.d && typeof e.d === "object") return e.d;
  /* `old` means "these fields were read back out of a sentence, not written as fields". Stamped
     here rather than inside deriveDet so it is true of EVERY parsed shape, including the three
     that predate the table, and so a test can prove the parser is not quietly standing in for a
     writer that should be passing `d` itself. */
  var d = deriveDet(e && e.msg);
  if (d) d.old = true;
  return d;
}
/* Months of entries were written before the fields existed, and they are the bulk of the log —
   so a table that only fills in for NEW entries is a table nobody sees the point of. The old
   messages are not free prose though: they came from a handful of call sites and have a handful
   of shapes. They are read back into fields HERE, at display time. Nothing is rewritten, so the
   stored log is untouched and this is reversible by deleting the function. A shape that is not
   recognised falls through to the plain wide row, which is the honest outcome. */
function deriveDet(msg){
  const m = String(msg || "");
  let x;
  if ((x = m.match(/^Off the Optima rota\s*[—-]\s*(.+?) removed from the day(?:\s*\(Pod ([A-E])[^)]*\))?/)))
    return { act: "off", subj: x[1].trim(), from: x[2] || "" };
  /* The old "Sickness fix …" message shape. Nothing writes it any more, and this no longer
     reconstructs a reason from it — reading a health fact back out of a historic string is the
     same disclosure as having stored it. Matched only so the row still finds its person and pod. */
  if ((x = m.match(/^Sickness fix [^:]*:\s*removed (.+?)(?: from (?:Pod ([A-E])|(.+)))?$/)))
    return { act: "off", subj: x[1].trim(), from: x[2] || "" };
  if ((x = m.match(/^(.+?) taken off \d{4}-\d{2}-\d{2}(?: — was (?:Pod ([A-E])|(.+)))?$/)))
    return { act: "off", subj: x[1].trim(), from: x[2] || "" };
  /* These shapes only ever recorded a DESTINATION. A dash in the From column claimed the person
     came from nowhere, which is not what happened — the old message simply never carried it. */
  if ((x = m.match(/^(.+?)\s*(?:→|->)\s*night Pod ([A-E])(?:\s*&\s*([A-E]))?/)))
    return { act: "move", subj: x[1].trim(), to: x[2] + (x[3] ? "&" + x[3] : ""), night: true, fromUnknown: true };
  if ((x = m.match(/^(.+?)\s*(?:→|->)\s*Pod ([A-E])/)))
    return { act: "move", subj: x[1].trim(), to: x[2], fromUnknown: true };
  if ((x = m.match(/^(.+?):\s*Pod ([A-E]) to Pod ([A-E])/)))
    return { act: "move", subj: x[1].trim(), from: x[2], to: x[3] };
  if ((x = m.match(/^Fixed .+?\(minimal changes\)/)))
    return { act: "fix", n: 0, kids: [] };
  for (var s = 0; s < LOG_SHAPES.length; s++) {
    var hit = m.match(LOG_SHAPES[s][0]);
    if (hit) { var got = LOG_SHAPES[s][1](hit); if (got) return got; }
  }
  return null;
}

/* ---------------------------------------------------------------------------
   READING THE OLD ENTRIES BACK INTO FIELDS.

   Ali, 10 Aug: "make sure all historic events get rewritten with new eassy to
   use change log format please somehow. wont take no, find a way."

   This is the way, and it is the one that does not cost anything. The rows are
   not rewritten — they are PARSED, here, at the moment they are drawn. The 330
   stored entries keep the exact bytes they were written with, so the log has
   still never edited its own past, which matters because a log that revises
   itself is not evidence of anything. Delete this table and every row falls
   back to the sentence it always was.

   It is only possible because the old messages are not free prose. Every one of
   them came out of a template at one of about sixty call sites across the two
   boards, so there is a finite list of shapes and each one can be read back
   into the same fields a new entry would have carried. Where a shape genuinely
   never recorded a fact, the field is left absent rather than guessed — an
   invented From is worse than a blank one.

   `old: true` is stamped on everything that comes through here so the renderer
   can tell a parsed row from a natively structured one, and so a test can prove
   the parser is not quietly taking over from the writers.

   ADDING A SHAPE: put the regex nearest the top that cannot be matched by an
   earlier one, and return the fields you can actually justify from the text.
   --------------------------------------------------------------------------- */
function _cap(s){ s = String(s || "").trim(); return s.replace(/\s*\((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\)\s*$/i, "").trim(); }
function _num(s){ var n = parseInt(s, 10); return isNaN(n) ? 0 : n; }

var LOG_SHAPES = [
  /* ---- SET: a named facet of a person, a pod or the day changed ---- */
  [/^(.+?):\s*(SD|LD|N)\s*(?:→|->)\s*(SD|LD|N)\b/,
    function(x){ return { act: "set", subj: _cap(x[1]), facet: "shift", from: x[2], to: x[3] }; }],
  [/^(.+?)\s*\(Fairfield\)\s*shift\s*(?:→|->)\s*(\S+)/,
    function(x){ return { act: "set", subj: _cap(x[1]), facet: "Fairfield shift", to: x[2] }; }],
  [/^Pod ([A-E]) consultant:\s*(.+?)\s*$/,
    function(x){ var v = _cap(x[2]); return { act: "set", subj: "Pod " + x[1], facet: "consultant",
      to: /^cleared$/i.test(v) ? "" : v, cleared: /^cleared$/i.test(v) }; }],
  [/^On call:\s*(.+?)\s*$/,
    function(x){ var v = _cap(x[1]); return { act: "set", subj: "On call", facet: "",
      to: /^cleared$/i.test(v) ? "" : v, cleared: /^cleared$/i.test(v) }; }],
  [/^(Night phone|Shadowing phone|Phone)\s*(?:→|->)\s*(.+?)\s*$/,
    function(x){ return { act: "set", subj: x[1], facet: "", to: _cap(x[2]) }; }],
  [/^(Night phone|Phone) cleared/,
    function(x){ return { act: "set", subj: x[1], facet: "", to: "", cleared: true }; }],
  [/^Stopped shadowing phone:\s*(.+?)\s*$/,
    function(x){ return { act: "set", subj: "Shadowing phone", facet: "", from: _cap(x[1]), to: "", cleared: true }; }],
  /* Cover. Its writers pass no fields at all today, so every Cover row in the
     store is one of these — this is the whole of Cover's history. */
  [/^Consultant swap \S+\s+(.+?):\s*(.+?)\s*(?:→|->)\s*(.+?)\s*$/,
    function(x){ return { act: "set", subj: _cap(x[1]), facet: "consultant",
      from: x[2] === "—" ? "" : _cap(x[2]), to: x[3] === "—" ? "" : _cap(x[3]) }; }],
  [/^Pod swap \S+:\s*(\S+)\s+(.+?)\s*$/,
    function(x){ return { act: "set", subj: _cap(x[2]), facet: "consultant", to: _cap(x[1]) }; }],
  [/^Taken off (.+?) on .+?:\s*(.+?)\s*$/,
    function(x){ return { act: "set", subj: _cap(x[1]), facet: "consultant", from: _cap(x[2]), to: "", cleared: true }; }],
  [/^([^:]+?) covers (.+?) on .+$/,
    function(x){ return { act: "set", subj: _cap(x[2]), facet: "consultant", to: _cap(x[1]) }; }],
  [/^([^:]+?) moves to (.+?) on .+$/,
    function(x){ return { act: "set", subj: _cap(x[2]), facet: "consultant", to: _cap(x[1]) }; }],
  [/^Pod left empty on .+?—\s*nobody available/,
    function(){ return { act: "set", subj: "A pod", facet: "consultant", to: "", cleared: true, warn: true }; }],
  [/^Finish swap \S+:\s*(.+?)\s+(\d{1,2}:\d{2})\s*↔\s*(.+?)\s+(\d{1,2}:\d{2})\s*$/,
    function(x){ return { act: "set", subj: _cap(x[1]) + " ↔ " + _cap(x[3]), facet: "finish",
      from: x[2], to: x[4] }; }],
  [/^Renamed (\S+):\s*(.+?)\s*(?:→|->)\s*(.+?)\s*$/,
    function(x){ return { act: "set", subj: x[1], facet: "name", from: _cap(x[2]), to: _cap(x[3]) }; }],
  [/^(\S+) named as (.+?)\s*$/,
    function(x){ return { act: "set", subj: x[1], facet: "name", to: _cap(x[2]) }; }],

  /* ---- PERSON: the staff list, not a rota day ---- */
  [/^(Added|Edited) staff:\s*(.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[2]), facet: "staff list", did: x[1].toLowerCase() }; }],
  [/^Deleted staff:\s*(.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list", did: "deleted" }; }],
  [/^Checked new starter:\s*(.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list", did: "checked" }; }],
  [/^([^:]+?) brought back to the current staff list/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list", did: "brought back" }; }],
  [/^([^:]+?) merged into (.+?)\s*—\s*(\d+) allocation/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list",
      did: "merged into " + _cap(x[2]), note: x[3] + " moved" }; }],
  [/^([^:]+?) gains (.+?) now — auto-fill starts using them (.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "skills",
      did: "gains " + _cap(x[2]), note: "counts from " + _cap(x[3]) }; }],
  [/^([^:]+?) added to the staff list\s*—\s*grade still to set/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list", did: "added", note: "grade to set" }; }],
  [/^([^:]+?) kept as one-off cover/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list", did: "one-off cover" }; }],
  [/^([^:]+?) taken off (\d+) day\(s\)\s*—\s*will be asked again/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "staff list",
      did: "declined", note: x[2] + " day(s)" }; }],
  [/^Locum named:\s*(.+?) on \S+ is (.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "locum", did: "named", note: _cap(x[2]) }; }],
  [/^Added (.+?) \(locum\/bank\)\s*—\s*(.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "locum/bank", did: "added", note: _cap(x[2]) }; }],
  [/^Skills change started for (.+?)\s*—\s*weeks from (.+?)\s*$/,
    function(x){ return { act: "person", subj: _cap(x[1]), facet: "skills", did: "change started",
      note: "from " + _cap(x[2]) }; }],

  /* ---- BATCH: the software did something to many things at once ---- */
  [/^Auto-filled week (.+?)\s*$/,
    function(x){ return { act: "batch", subj: "Auto-fill", facet: "week " + _cap(x[1]) }; }],
  [/^Auto-allocated (\d+) new day\(s\)/,
    function(x){ return { act: "batch", subj: "Auto-fill", facet: "new days", n: _num(x[1]), unit: "day" }; }],
  [/^Auto-allocated \S+/,
    function(){ return { act: "batch", subj: "Auto-fill", facet: "untouched day", n: 1, unit: "day" }; }],
  /* "Fixed N day(s) this week (minimal changes)" is deliberately NOT here. It is caught further
     up by the older `fix` shape, which renders the expandable Day-tidied row — richer than a
     batch count, so the earlier match is the better one and this must not overtake it. */
  [/^Imported Optima roster for week (\S+) \((\d+) matched(?:,\s*(\d+) added)?\)/,
    function(x){ return { act: "batch", subj: "Optima import", facet: "roster",
      n: _num(x[2]), unit: "matched", extra: x[3] ? x[3] + " added" : "" }; }],
  [/^Imported consultant allocations \((\d+) week/,
    function(x){ return { act: "batch", subj: "Consultant import", facet: "allocations",
      n: _num(x[1]), unit: "week" }; }],
  [/^Optima sync:\s*(\d+) added/,
    function(x){ return { act: "batch", subj: "Optima added", facet: "too many to name",
      n: _num(x[1]), unit: "person" }; }],
  [/^Optima newcomers reviewed:\s*(\d+) added to the staff list,\s*(\d+) kept/,
    function(x){ return { act: "batch", subj: "Newcomers reviewed", facet: "",
      n: _num(x[1]), unit: "added", extra: x[2] + " one-off" }; }],
  [/^Auto-deleted (\d+) week\(s\) older than/,
    function(x){ return { act: "batch", subj: "Housekeeping", facet: "retention",
      n: _num(x[1]), unit: "week removed" }; }],
  [/^Released (\d+) phone allocation/,
    function(x){ return { act: "batch", subj: "Phone", facet: "released",
      n: _num(x[1]), unit: "allocation" }; }],
  [/^Reset skills to grade defaults for (\d+) staff/,
    function(x){ return { act: "batch", subj: "Skills reset", facet: "grade defaults",
      n: _num(x[1]), unit: "person" }; }],
  [/^PICC line marked for (\d+) ACCP/,
    function(x){ return { act: "batch", subj: "PICC", facet: "one-off", n: _num(x[1]), unit: "ACCP" }; }],
  [/^Supernumeraries moved out of the counted numbers on (\d+) day/,
    function(x){ return { act: "batch", subj: "Supernumeraries", facet: "uncounted",
      n: _num(x[1]), unit: "day" }; }],
  [/^Rota worked out again from (.+?) for (.+?)\s*—\s*(\d+)/,
    function(x){ return { act: "batch", subj: "Reworked", facet: _cap(x[2]),
      n: _num(x[3]), unit: "move" }; }],
  [/^Draft weeks handed back to the algorithm\s*—\s*(\d+) hand-made/,
    function(x){ return { act: "batch", subj: "Handed back", facet: "draft weeks",
      n: _num(x[1]), unit: "kept" }; }],
  [/^Consultant allocation worked out again for \S+/,
    function(){ return { act: "batch", subj: "Reworked", facet: "consultant cover" }; }],
  [/^Rota change on .+? sorted out/,
    function(){ return { act: "batch", subj: "Reworked", facet: "after a rota change" }; }],
  [/^(Accepted|Re-opened) check \((.+?)\):/,
    function(x){ return { act: "batch", subj: "Check " + x[1].toLowerCase(), facet: _cap(x[2]) }; }],
  [/^Optima check \S+ (.+?):/,
    function(x){ return { act: "batch", subj: "Optima check", facet: _cap(x[1]) }; }],
  [/^Optima disagrees on (.+?):/,
    function(x){ return { act: "batch", subj: "Optima disagreed", facet: _cap(x[1]), warn: true }; }],
  [/^Saved print copy\s*—\s*week (.+?)\s*$/,
    function(x){ return { act: "batch", subj: "Print copy", facet: "week " + _cap(x[1]) }; }],
  [/^Staff-list password set/,  function(){ return { act: "batch", subj: "Access", facet: "staff-list password" }; }],
  [/^Shared saving link set/,   function(){ return { act: "batch", subj: "Setup",  facet: "saving link" }; }],
  [/^Sync requested/,           function(){ return { act: "batch", subj: "Sync",   facet: "requested by hand" }; }]
];

let logBy = "made", logFilter = "all", logWhen = "ahead", logQuery = "";

/* Everything an entry can be searched BY, as one lowercase string: the person, where they came
   from and went to, whoever made the change, and the original message for older entries that
   never had fields. Built per entry at search time — the log is capped at 500, so there is
   nothing here worth indexing for. */
function logHaystack(e){
  const d = logDet(e) || {};
  return [d.subj, d.from, d.to, d.why, e.who, e.msg, logOn(e)]
    .filter(Boolean).join(" ").toLowerCase();
}
function logMatches(e){
  const q = logQuery.trim().toLowerCase();
  return !q || logHaystack(e).indexOf(q) >= 0;
}

/* Two segmented controls, no sentence explaining them (hard rule 2). The left one names the
   thing the groups below are keyed on, so the headings are the explanation. */
function logControls(redraw, onSearch){
  const wrap = __el("div", { style: "display:flex;gap:.9rem;flex-wrap:wrap;align-items:center;margin:0 0 .9rem" });
  const pick = (label, opts, get, set) => {
    const sel = __el("select", { style: "font-size:.82rem",
      onchange: e => { set(e.target.value); redraw(); } });
    opts.forEach(([v, l]) => {
      const o = __el("option", { value: v }, l);
      if (v === get()) o.selected = true;
      sel.append(o);
    });
    return __el("label", { style: "display:inline-flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--muted)" }, label, sel);
  };
  /* A search box, because scrolling is not a way to answer "what happened to Ambrose?" — Ali,
     4 Aug. Filters as you type and keeps focus, so the box does not fight the redraw. */
  const box = __el("input", { type: "text", placeholder: "Search the change log",
    "aria-label": "Search the change log",
    style: "flex:1;min-width:11rem;max-width:20rem" });
  box.value = logQuery;
  /* Typing must NOT rebuild this input. The first version called the page's full redraw on every
     keystroke, which wiped the whole log panel — including the box you were typing into — and
     then hunted the new one down to restore focus. It dropped characters and felt broken (Ali,
     5 Aug: "can only type one letter at a time, unusably slow").

     Now the search repaints only the GROUPS, so the input is never destroyed and never loses
     focus or its cursor position. The other two controls still do a full redraw, because
     changing the grouping adds and removes a third control. */
  let typing = null;
  box.addEventListener("input", () => {
    logQuery = box.value;
    clearTimeout(typing);
    // A short pause, so holding a key down repaints once rather than once per character.
    typing = setTimeout(() => { (onSearch || redraw)(); }, 120);
  });
  wrap.append(box);
  wrap.append(
    pick("Group by", [["made", "When changed"], ["affects", "Rota day"], ["person", "Person"]], () => logBy, v => logBy = v),
    pick("Show", [["all", "All changes"], ["manual", "Manual only"], ["auto", "Automatic only"]], () => logFilter, v => logFilter = v)
  );
  if (logBy === "affects")
    wrap.append(pick("Days", [["ahead", "Today and ahead"], ["past", "Already been"]], () => logWhen, v => logWhen = v));
  return wrap;
}
/* Answering "surely there must be some memory of it": there is, in the log itself. If somebody
   was moved into Pod C on Tuesday and moved again later that same Tuesday, the earlier entry
   says where the later one started. Walking the log oldest-first per person and rota day
   recovers the from-pod for every move except the first in each chain. Read-only — nothing is
   written back, so this is a lens over the stored log, not a migration of it. */
/* Where somebody was before a move that never recorded it. Walks the day forwards and remembers
   the last place each person was PUT, so the next entry about them starts from a known spot.

   Widened 4 Aug (Ali: "why are there still so many not recorded, this isnt acceptable"): it used
   to learn only from earlier MOVES, so the first move of the day was always unknowable even when
   the entry directly above it said where the sync had just put them. `act:"on"` — the sync
   putting somebody on the rota, which carries the pod it chose — now seeds the position too.

   This is inference and is shown as such (fainter, with a tooltip saying so): it is what the log
   implies, not what the log recorded, and the two should not look identical. */
function inferFroms(list){
  const seen = {};
  const out = new Map();
  const chron = (list || []).slice().reverse();          // stored newest-first
  for (const e of chron) {
    const d = logDet(e);
    if (!d || !d.subj) continue;
    const key = d.subj + "|" + logOn(e);
    if (d.act === "move") {
      if (!d.from && !d.bench && seen[key]) out.set(e, seen[key]);
      if (d.to) seen[key] = d.to; else delete seen[key];      // moved to the bench: nowhere now
    } else if (d.act === "on" || d.act === "shift") {
      if (d.to) seen[key] = d.to;
    } else if (d.act === "off") {
      delete seen[key];
    }
  }
  return out;
}
/* Controls + groups as one unit, with the groups in their own container so the search can
   repaint them without touching the controls. Both boards call this instead of assembling the
   two halves themselves, which is what let them drift apart in the first place. */
function logPanel(list, cap, fullRedraw){
  const wrap = __el("div");
  const groups = __el("div");
  const paint = () => { groups.innerHTML = ""; groups.append(logGroups(list, cap)); };
  wrap.append(logControls(fullRedraw, paint), groups);
  paint();
  return wrap;
}
function logGroups(list, cap){
  const out = __el("div");
  const all = (list || []).slice(0, cap || 400);
  const shown = all.filter(logMatches);
  let groups = groupLog(shown, logBy, logFilter);
  if (logQuery.trim()) {
    out.append(__el("div", { style: "font-size:.8rem;color:var(--muted);margin:0 0 .7rem" },
      shown.length + " of " + all.length + " entries match \u201c" + logQuery.trim() + "\u201d"));
  }
  if (!groups.length) {
    out.append(__el("div", { class: "empty" },
      logQuery.trim() ? "Nothing matches that." : "Nothing to show."));
    return out;
  }
  const today = __todayISO();
  const inferredFrom = inferFroms(list);

  /* Read by rota day, the useful order is not "newest first" — it is TODAY, then the days
     coming up, and the past underneath. Someone opening this wants to know what has been done
     to the shifts they are about to work, not what happened three weeks ago. Read by when the
     change was made, newest-first is right and is left alone. */
  if (logBy === "affects") {
    /* A change to a day already worked is history — nobody can act on it, so it gets its own
       view instead of burying today under a year of it. */
    groups = logWhen === "past"
      ? groups.filter(g => g.date <  today).sort((a, b) => a.date > b.date ? -1 : 1)
      : groups.filter(g => g.date >= today).sort((a, b) => a.date < b.date ? -1 : 1);
    if (!groups.length) {
      out.append(__el("div", { class: "empty" }, logWhen === "past"
        ? "Nothing recorded against days already worked." : "Nothing recorded against today or the days ahead."));
      return out;
    }
  }

  const podTint = { A: "var(--podA)", B: "var(--podB)", C: "var(--podC)", D: "var(--podD)", E: "var(--podE)" };
  const podInk  = { A: "var(--podAb)", B: "var(--podBb)", C: "var(--podCb)", D: "var(--podDb)", E: "var(--podEb)" };
  const chip = (txt, tint, ink, outline) => __el("span", { style:
    "font-size:.72rem;font-weight:600;padding:.1rem .5rem;border-radius:999px;white-space:nowrap;" +
    (outline ? "border:1px solid " + ink + ";color:" + ink + ";background:transparent"
             : "background:" + tint + ";color:" + ink) }, txt);
  const pod = p => chip(p, podTint[p] || "var(--hair)", podInk[p] || "var(--muted)");
  /* ONE CHIP FOR EVERY REMOVAL — hard rule 6, sharpened 8 Aug after the DPIA.
     This drew three: amber "sick", pink "off rota", grey for the rest. Two problems with that.
     The obvious one is that "sick" is a health record rendered on screen. The less obvious one is
     that the OTHERS gave it away too: once a roster change has its own chip, a removal without one
     means "not a roster change", which narrows it to something about the person. A distinction
     anywhere in the set is an inference channel for the whole set, so the set has to be one.
     What the row still says is WHO did it and WHEN, which is accountability rather than reason. */
  const reason = () => chip("not on", "var(--hair)", "var(--muted)");

  const cell = (kids, style) => __el("td", { style: "padding:.42rem .3rem;vertical-align:top;" + (style || "") }, ...kids);

  for (const g of groups) {
    /* A person's name IS the heading in person mode — there is no date to label, and the bucket
       with no subject says what it is rather than appearing as a blank bar. */
    const headTxt = g.person ? (g.date || "Not about one person") : logDayLabel(g.date, today);
    const head = __el("div", { class: "loghead" }, headTxt, __el("span", {}, String(g.entries.length)));
    if (!g.person && g.date === today) head.dataset.today = "1";
    out.append(head);
    const tbl = __el("table", { style: "width:100%;table-layout:fixed;border-collapse:collapse;font-size:.85rem;margin-bottom:.4rem" });
    /* Without this you cannot tell which chip is where they came FROM and which is where they
       went TO — the columns were carrying meaning nothing declared. */
    const th = t => __el("th", { style: "text-align:left;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 .3rem .25rem" }, t);
    const thC = t => __el("th", { style: "text-align:center;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 .3rem .25rem" }, t);
    tbl.append(__el("tr", {}, th(logBy === "affects" ? "" : "Rota day"), th("Person"), thC("From"), thC("To"),
      __el("th", { style: "text-align:right;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 .3rem .25rem" }, "By")));
    for (const e of g.entries) {
      const d0 = logDet(e);
      const inferred = d0 && !d0.from && !d0.bench ? inferredFrom.get(e) : null;
      const d = inferred ? Object.assign({}, d0, { fromInferred: inferred }) : d0;
      /* The lead pill carries whichever date the heading is NOT already saying. Grouped by rota
         day it is when the change was made; grouped by when, or by person, it is the rota day —
         which is what a person's series is a series OF. */
      const other = (logBy === "affects") ? logMade(e) : logOn(e);
      const stamp = new Date(e.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const by = __el("td", { style: "padding:.42rem .3rem;text-align:right;color:var(--muted);font-size:.78rem;white-space:nowrap;vertical-align:top;width:26%" },
        stamp + " · " + (e.who || "?"));
      /* The day the change is ABOUT leads the row as a pill — it is what people scan for, and
         trailing it off the end in grey buried it. */
      const otherTxt = other ? __fmtDate(other) : "";
      const lead = __el("td", { style: "padding:.42rem .3rem;vertical-align:top;width:14%" },
        otherTxt ? __el("span", { style: "background:var(--hair);color:var(--ink);font-size:.72rem;font-weight:600;padding:.1rem .5rem;border-radius:999px;white-space:nowrap" }, otherTxt) : "");
      const when = __el("td", { style: "display:none" });
      const row = __el("tr", { class: "logrow" + (logKind(e) === "auto" ? " auto" : ""),
        style: "border-top:1px solid var(--hair)" });

      const src = !d ? null
        : d.from ? pod(d.from)
        : d.bench ? __el("span", { style: "color:var(--muted);font-size:.72rem" , title: "Was unallocated" }, "bench")
        : d.fromInferred ? __el("span", { style: "color:var(--muted);opacity:.8", title: "Worked out from an earlier entry the same day" }, pod(d.fromInferred))
        /* An empty cell, not the words. "not recorded" is true but it is the same eight
           characters repeated down a whole column, and a column of identical apologies buries the
           rows that DO say something (Ali, 4 Aug). Nothing new can land here — every place that
           writes a move now records where the person came from — so this is only ever history,
           and history that has nothing to add should take up no room. The title still answers it
           for anyone who wonders why the cell is blank. */
        : d.fromUnknown ? __el("span", { style: "color:var(--muted);opacity:.45",
            title: "This entry is from before the log recorded where people came from" }, "")
        : __el("span", { style: "color:var(--muted)", title: "From the bench" }, "\u2014");
      /* Was written as fromCell() calling fromCell() — a blind string replace rewrote the body
         of the very helper it was defining, so every move row recursed until the stack blew. */
      const fromCell = () => {
        const c = cell([src], "width:12%;text-align:center");
        c.className = "logfrom";
        return c;
      };
      if (d && d.act === "move") {
        const dest = !d.to ? "\u2014"
          : d.night ? chip(d.to, "", "var(--podAb)", true)
          : pod(d.to);
        row.append(lead, cell([d.subj], "width:30%"), fromCell(),
                   cell([dest, d.night ? __el("span", { style: "font-size:.6rem;color:var(--muted);margin-left:.2rem" }, "night") : null],
                        "width:12%;text-align:center"), when, by);
      } else if (d && (d.act === "on" || d.act === "shift")) {
        /* The sync putting somebody on the rota, or changing what they are down for. Added
           6 Aug: the sync used to write "Optima sync: 1 added" and nothing else, which told
           you a number and not a person (Ali). Two facts have to fit in one row — what shift
           they are on, and which pod they landed in — so the SHIFT rides on the name as the
           same pill the board draws in every pod cell, and the To column stays what it is
           everywhere else in this table: where they ended up. Ali chose this over a second
           chip in To, and it is the better call: the row needs no column it doesn't already
           have, and the pill is already the thing people read on the board itself. */
        const code = c2 => __el("span", { class: "tagx " + String(c2 || "").replace(/[^A-Za-z]/g, ""),
          style: "font-size:.66rem;font-weight:600;border-radius:999px;padding:.1rem .45rem;" +
                 "border:1px solid var(--hair);white-space:nowrap" }, c2);
        const named = d.shift
          ? __el("span", { class: "rpill" },
              __el("span", { class: "sh" }, d.shift), __el("span", { class: "nm" }, d.subj))
          : d.subj;
        if (d.act === "on") {
          /* There is no maximum on a pod, so somebody added always lands in one — the dash is
             only for entries written before the sync placed people at all. */
          const dest = d.to ? pod(d.to)
            : __el("span", { style: "color:var(--muted)", title: "On the rota, not yet in a pod" }, "\u2014");
          row.append(lead, cell([named], "width:30%"),
                     cell([__el("span", { style: "color:var(--muted)",
                            title: "Was not on the rota for this day" }, "\u2014")],
                          "width:12%;text-align:center"),
                     cell([dest, d.night ? __el("span", { style: "font-size:.6rem;color:var(--muted);margin-left:.2rem" }, "night") : null],
                          "width:12%;text-align:center"), when, by);
        } else {
          row.append(lead, cell([d.subj], "width:30%"),
                     cell([d.from ? code(d.from) : "\u2014"], "width:12%;text-align:center"),
                     cell([d.to ? code(d.to) : "\u2014"], "width:12%;text-align:center"), when, by);
        }
      } else if (d && d.act === "off") {
        row.append(lead, cell([d.subj], "width:30%"), fromCell(),
                   cell([reason(d.why)], "width:12%;text-align:center"), when, by);
      } else if (d && d.act === "fix") {
        /* Entries written before the moves were kept have no count. Saying "0 moves" and
           offering a triangle with nothing behind it states something untrue. */
        const kidList = d.kids || [];
        const open = kidList.length
          ? __el("button", { style: "border:0;background:transparent;padding:0;margin-right:.35rem;cursor:pointer;color:var(--muted)" }, "\u25b8")
          : __el("span", { style: "margin-right:.35rem;opacity:.3" }, "\u2022");
        const kidRows = [];
        /* The label is the entry's, not this renderer's: the same expanding row now carries a
           day that was TIDIED (a couple of moves to clear a red) and a day that was ALLOCATED
           from scratch (twenty-odd placements). Calling both "Day tidied" would have been a
           small lie in the one place people go to find out what happened. */
        const fixLabel = d.label || "Day tidied";
        const unit = d.label ? " placed" : (kidList.length === 1 ? " move" : " moves");
        row.append(lead, cell([open, fixLabel], "width:30%;color:var(--muted)"),
                   cell([chip(kidList.length ? kidList.length + unit : "fixed",
                              "#eef7f1", "var(--podBb)")], "width:24%;text-align:center"));
        row.children[1].colSpan = 2;
        row.append(when, by);
        kidList.forEach(k0 => {
          const k = kidFields(k0);
          /* A child that could not be parsed gets its sentence across the row rather than three
             invented columns \u2014 and crucially never the "not on" chip, which would say somebody had
             been taken off the rota when nothing of the sort happened. */
          const kr = k.plain && !k.from && !k.to
            ? __el("tr", { style: "border-top:1px solid var(--hair);display:none;background:var(--hair)" },
                __el("td", {}), cell([" \u2937 " + k.subj], "width:54%;padding-left:1.4rem"),
                __el("td", {}), __el("td", {}))
            : __el("tr", { style: "border-top:1px solid var(--hair);display:none;background:var(--hair)" },
                __el("td", {}),
                cell([" \u2937 " + (k.subj || "")], "width:30%;padding-left:1.4rem"),
                cell([k.from ? (k.plain ? chip(k.from, "var(--hair)", "var(--ink)") : pod(k.from)) : "\u2014"], "width:12%;text-align:center"),
                cell([k.to ? (k.plain ? chip(k.to, "var(--hair)", "var(--ink)") : pod(k.to))
                           : (k.plain ? "\u2014" : reason(k.why))], "width:12%;text-align:center"),
                __el("td", {}), __el("td", {}));
          if (k.plain && !k.from && !k.to) kr.children[1].colSpan = 3;
          kidRows.push(kr);
        });
        open.onclick = () => {
          const show = kidRows.length && kidRows[0].style.display === "none";
          kidRows.forEach(r => r.style.display = show ? "" : "none");
          open.textContent = show ? "\u25be" : "\u25b8";
        };
        tbl.append(row); kidRows.forEach(r => tbl.append(r));
        continue;
      } else if (d && (d.act === "set" || d.act === "person" || d.act === "batch")) {
        /* THE OTHER THREE FAMILIES (Ali, 10 Aug: "make sure all events that arent moves like that
           also have smooth well desifgned thoguh through and easily nderstandable displays").

           Every writer on both boards lands in one of four families, and the columns are the same
           for all of them — the row never changes shape, only what sits in the middle. What makes
           that possible is splitting the Person column into a SUBJECT and a FACET: "Pod A" +
           "consultant", "Dan Gill" + "shift", "Day" + "phone". Once a row names which facet of the
           subject moved, a consultant swap and a phone handover can use the same From → To arrows
           the pod moves already use, instead of each needing a sentence of its own.

           Ali, 9 Aug, and it governs all of this: "i prefer th nice coloured pods and arrows that
           are there now. thats the best bit and simplest to understand A -> B." So nothing here
           replaces the arrows — it extends them to the rows that never had them. */
        const named = __el("span", {}, d.subj || "",
          d.facet ? __el("span", { style: "color:var(--muted);font-size:.75rem;margin-left:.4rem" }, d.facet) : null);
        /* A value is drawn as a pod chip when it IS a pod, so Cover's consultant columns and the
           board's own pods share one visual language rather than two. */
        const val = v => {
          if (v === "" || v == null) return null;
          const p = String(v).match(/^(?:Pod )?([A-E])$/);
          return p ? pod(p[1]) : chip(String(v), "var(--hair)", "var(--ink)");
        };
        if (d.act === "set") {
          const gone = __el("span", { style: "color:var(--muted)",
            title: "Cleared — nobody is down for this" }, "—");
          row.append(lead, cell([named], "width:30%"),
            cell([val(d.from) || __el("span", { style: "color:var(--muted);opacity:.45",
                   title: "This entry is from before the log recorded what it changed from" }, "")],
                 "width:12%;text-align:center"),
            cell([d.cleared ? gone : (val(d.to) || gone)], "width:12%;text-align:center"), when, by);
        } else if (d.act === "person") {
          const act2 = chip(d.did || "changed", "var(--accent-bg)", "var(--accent)");
          const note = d.note ? __el("span", { style: "color:var(--muted);font-size:.75rem;margin-left:.45rem" }, d.note) : null;
          const mid = cell([act2, note], "width:24%");
          mid.colSpan = 2;
          row.append(lead, cell([named], "width:30%"), mid, when, by);
        } else {
          /* A batch says how much it did, or says nothing rather than "0". A count of zero and a
             count that was never recorded look identical on screen and are not the same fact. */
          const cnt = d.n
            ? chip(d.n + " " + (d.unit || "") + (d.n === 1 || /d$/.test(d.unit || "") ? "" : "s"), "#eef7f1", "var(--podBb)")
            : null;
          const extra = d.extra ? __el("span", { style: "color:var(--muted);font-size:.75rem;margin-left:.45rem" }, d.extra) : null;
          const mid = cell([cnt, extra], "width:24%;text-align:center");
          mid.colSpan = 2;
          row.append(lead, cell([named], "width:30%;color:var(--muted)"), mid, when, by);
        }
      } else {
        /* Anything written before the fields existed, and anything that genuinely is not about
           one person — an import, a password change. One wide cell, no invented columns. */
        const wide = cell([String(e.msg || "")], "width:54%");
        wide.colSpan = 3;
        row.append(lead, wide, when, by);
      }
      tbl.append(row);
    }
    out.append(tbl);
  }
  return out;
}
