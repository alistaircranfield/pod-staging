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
function logDet(e){
  if (e && e.d && typeof e.d === "object") return e.d;
  return deriveDet(e && e.msg);
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
    return { act: "off", subj: x[1].trim(), from: x[2] || "", why: "rota" };
  if ((x = m.match(/^Sickness fix [^:]*:\s*removed (.+?)(?: from (?:Pod ([A-E])|(.+)))?$/)))
    return { act: "off", subj: x[1].trim(), from: x[2] || "", why: "sick" };
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
  return null;
}

let logBy = "made", logFilter = "all", logWhen = "ahead";

/* Two segmented controls, no sentence explaining them (hard rule 2). The left one names the
   thing the groups below are keyed on, so the headings are the explanation. */
function logControls(redraw){
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
  wrap.append(
    pick("Group by", [["made", "When changed"], ["affects", "Rota day"]], () => logBy, v => logBy = v),
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
function inferFroms(list){
  const seen = {};
  const out = new Map();
  const chron = (list || []).slice().reverse();          // stored newest-first
  for (const e of chron) {
    const d = logDet(e);
    if (!d || d.act !== "move" || !d.subj) continue;
    const key = d.subj + "|" + logOn(e);
    if (!d.from && !d.bench && seen[key]) out.set(e, seen[key]);
    if (d.to) seen[key] = d.to;
  }
  return out;
}
function logGroups(list, cap){
  const out = __el("div");
  let groups = groupLog((list || []).slice(0, cap || 400), logBy, logFilter);
  if (!groups.length) { out.append(__el("div", { class: "empty" }, "Nothing to show.")); return out; }
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
  const reason = w => w === "sick" ? chip("sick", "#fdf8ef", "var(--podCb)")
                    : w === "rota" ? chip("off rota", "#fdf4f6", "var(--podEb)")
                    : chip(w || "off", "var(--hair)", "var(--muted)");

  const cell = (kids, style) => __el("td", { style: "padding:.42rem .3rem;vertical-align:top;" + (style || "") }, ...kids);

  for (const g of groups) {
    const head = __el("div", { class: "loghead" }, logDayLabel(g.date, today), __el("span", {}, String(g.entries.length)));
    if (g.date === today) head.dataset.today = "1";
    out.append(head);
    const tbl = __el("table", { style: "width:100%;table-layout:fixed;border-collapse:collapse;font-size:.85rem;margin-bottom:.4rem" });
    /* Without this you cannot tell which chip is where they came FROM and which is where they
       went TO — the columns were carrying meaning nothing declared. */
    const th = t => __el("th", { style: "text-align:left;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 .3rem .25rem" }, t);
    const thC = t => __el("th", { style: "text-align:center;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 .3rem .25rem" }, t);
    tbl.append(__el("tr", {}, th(logBy === "made" ? "Rota day" : ""), th("Person"), thC("From"), thC("To"),
      __el("th", { style: "text-align:right;font-weight:500;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 .3rem .25rem" }, "By")));
    for (const e of g.entries) {
      const d0 = logDet(e);
      const inferred = d0 && !d0.from && !d0.bench ? inferredFrom.get(e) : null;
      const d = inferred ? Object.assign({}, d0, { fromInferred: inferred }) : d0;
      const other = (logBy === "made") ? logOn(e) : logMade(e);
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
        : d.fromUnknown ? __el("span", { style: "color:var(--muted);font-size:.7rem;font-style:italic",
            title: "Older entries only recorded where the person went, never where they came from" }, "not recorded")
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
        row.append(lead, cell([open, "Day tidied"], "width:30%;color:var(--muted)"),
                   cell([chip(kidList.length ? kidList.length + " move" + (kidList.length === 1 ? "" : "s") : "fixed",
                              "#eef7f1", "var(--podBb)")], "width:24%;text-align:center"));
        row.children[1].colSpan = 2;
        row.append(when, by);
        kidList.forEach(k => {
          const kr = __el("tr", { style: "border-top:1px solid var(--hair);display:none;background:var(--hair)" },
            __el("td", {}),
            cell([" \u2937 " + k.subj], "width:30%;padding-left:1.4rem"),
            cell([k.from ? pod(k.from) : "\u2014"], "width:12%;text-align:center"),
            cell([k.to ? pod(k.to) : reason(k.why)], "width:12%;text-align:center"),
            __el("td", {}), __el("td", {}));
          kidRows.push(kr);
        });
        open.onclick = () => {
          const show = kidRows.length && kidRows[0].style.display === "none";
          kidRows.forEach(r => r.style.display = show ? "" : "none");
          open.textContent = show ? "\u25be" : "\u25b8";
        };
        tbl.append(row); kidRows.forEach(r => tbl.append(r));
        continue;
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
