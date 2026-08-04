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

/* Filter, then bucket by date. by = "made" | "affects"; filter = "all" | "manual" | "auto".
   Returns [{ date, entries }], newest date first, newest entry first inside each date —
   the log arrives newest-first and bucketing preserves that order.
   Pure: list in, list out, so it can be held still by a test. */
function groupLog(list, by, filter){
  var buckets = {}, order = [];
  (list || []).forEach(function(e){
    if (!e) return;
    var k = logKind(e);
    if (filter === "manual" && k !== "manual") return;
    if (filter === "auto" && k !== "auto") return;
    var d = (by === "affects") ? logOn(e) : logMade(e);
    if (!buckets[d]) { buckets[d] = []; order.push(d); }
    buckets[d].push(e);
  });
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
      panel.style.position = "relative";
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
