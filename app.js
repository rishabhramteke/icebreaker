(function () {
  "use strict";

  // ---- Config & storage keys ----
  var CHALLENGE_SECONDS = 5 * 60;
  var K_HISTORY = "icebreaker.history.v1";
  var K_ACTIVE = "icebreaker.active.v1";
  var K_RECENT = "icebreaker.recent.v1"; // recently shown line indexes, to reduce repeats

  var LINES = window.ICEBREAKER_LINES || ["Hi — I just wanted to come say hello."];

  // ---- Element refs ----
  var $ = function (id) { return document.getElementById(id); };
  var views = {
    deck: $("view-deck"),
    challenge: $("view-challenge"),
    history: $("view-history"),
  };
  var cardStack = $("card-stack");
  var timerEl = $("timer");
  var timerSub = $("timer-sub");
  var challengeLineEl = $("challenge-line");
  var challengeBadge = $("challenge-badge");
  var overlaySentiment = $("overlay-sentiment");
  var toastEl = $("toast");

  // ---- State ----
  var currentLine = null;
  var tickHandle = null;
  var pendingEntry = null; // entry awaiting sentiment

  // ---- Storage helpers ----
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function getHistory() { return load(K_HISTORY, []); }
  function setHistory(h) { save(K_HISTORY, h); }

  // ---- Line selection (avoid repeating the last few) ----
  function pickLine() {
    if (LINES.length === 1) return LINES[0];
    var recent = load(K_RECENT, []);
    var avoid = recent.slice(-Math.min(recent.length, Math.floor(LINES.length / 2)));
    var pool = LINES.filter(function (_, i) { return avoid.indexOf(i) === -1; });
    var idx;
    if (pool.length === 0) {
      idx = Math.floor(rand() * LINES.length);
    } else {
      var pick = pool[Math.floor(rand() * pool.length)];
      idx = LINES.indexOf(pick);
    }
    recent.push(idx);
    if (recent.length > LINES.length) recent.shift();
    save(K_RECENT, recent);
    return LINES[idx];
  }
  function rand() { return Math.random(); }

  // ---- View switching ----
  function show(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle("hidden", k !== name);
    });
    $("nav-deck").classList.toggle("active", name === "deck");
    $("nav-history").classList.toggle("active", name === "history");
    if (name === "history") renderHistory();
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.add("hidden"); }, 2400);
  }

  // ---- Deck card ----
  function renderCard() {
    currentLine = pickLine();
    cardStack.innerHTML = "";
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="tag go">Go</div>' +
      '<div class="tag nope">Pass</div>' +
      '<div class="quote-mark">&ldquo;</div>' +
      '<div class="line"></div>';
    card.querySelector(".line").textContent = currentLine;
    cardStack.appendChild(card);
    attachDrag(card);
  }

  // ---- Swipe / drag ----
  function attachDrag(card) {
    var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
    var goTag = card.querySelector(".tag.go");
    var nopeTag = card.querySelector(".tag.nope");
    var threshold = 110;

    function down(e) {
      dragging = true;
      var p = point(e);
      startX = p.x; startY = p.y;
      card.style.transition = "none";
    }
    function move(e) {
      if (!dragging) return;
      var p = point(e);
      dx = p.x - startX; dy = p.y - startY;
      var rot = dx / 18;
      card.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg)";
      goTag.style.opacity = dx > 20 ? Math.min(1, dx / threshold) : 0;
      nopeTag.style.opacity = dx < -20 ? Math.min(1, -dx / threshold) : 0;
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      card.style.transition = "transform .25s ease";
      if (dx > threshold) { flyOut(card, 1); accept(); }
      else if (dx < -threshold) { flyOut(card, -1); passLine(); }
      else {
        card.style.transform = "";
        goTag.style.opacity = 0;
        nopeTag.style.opacity = 0;
      }
    }
    card.addEventListener("pointerdown", function (e) { card.setPointerCapture(e.pointerId); down(e); });
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
  }
  function point(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }
  function flyOut(card, dir) {
    card.style.transform = "translate(" + (dir * 600) + "px, -40px) rotate(" + (dir * 30) + "deg)";
    card.style.opacity = "0";
  }

  // ---- Deck actions ----
  function passLine() {
    setTimeout(renderCard, 220);
  }
  function accept() {
    var line = currentLine;
    setTimeout(function () {
      renderCard();
      startChallenge(line);
    }, 220);
  }
  function programmaticSwipe(dir) {
    var card = cardStack.querySelector(".card");
    if (!card) return;
    card.style.transition = "transform .25s ease, opacity .25s ease";
    flyOut(card, dir);
    if (dir > 0) accept(); else passLine();
  }

  // ---- Challenge ----
  function startChallenge(line) {
    var active = { line: line, startedAt: Date.now() };
    save(K_ACTIVE, active);
    enterChallenge(active);
  }

  function enterChallenge(active) {
    challengeLineEl.textContent = active.line;
    show("challenge");
    runTimer(active.startedAt);
  }

  function runTimer(startedAt) {
    clearInterval(tickHandle);
    function tick() {
      var elapsed = Math.floor((Date.now() - startedAt) / 1000);
      var remaining = CHALLENGE_SECONDS - elapsed;
      if (remaining > 0) {
        timerEl.textContent = fmt(remaining);
        timerEl.classList.remove("up");
        challengeBadge.classList.remove("up");
        challengeBadge.textContent = "Challenge on";
        timerSub.textContent = "Go say it. You've got this.";
      } else {
        timerEl.textContent = "+" + fmt(-remaining);
        timerEl.classList.add("up");
        challengeBadge.classList.add("up");
        challengeBadge.textContent = "Time's up";
        timerSub.textContent = "Did you go for it? Mark it below.";
      }
    }
    tick();
    tickHandle = setInterval(tick, 1000);
  }

  function fmt(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function endChallenge() {
    clearInterval(tickHandle);
    tickHandle = null;
    localStorage.removeItem(K_ACTIVE);
  }

  // ---- Recording outcomes ----
  function finishChallenge(status) {
    var active = load(K_ACTIVE, null);
    if (!active) { show("deck"); return; }
    var elapsed = Math.floor((Date.now() - active.startedAt) / 1000);
    var entry = {
      id: String(active.startedAt),
      line: active.line,
      startedAt: active.startedAt,
      completedAt: Date.now(),
      durationSec: Math.min(elapsed, CHALLENGE_SECONDS * 4),
      status: status, // "done" | "missed"
      sentiment: null, // "good" | "bad" | null
      location: null,
    };
    endChallenge();

    // Save right away so the UI never waits on GPS.
    var h = getHistory();
    h.unshift(entry);
    setHistory(h);

    // Fill in the location in the background once the device responds.
    captureLocation(function (loc) {
      if (!loc) return;
      var hh = getHistory();
      for (var i = 0; i < hh.length; i++) {
        if (hh[i].id === entry.id) { hh[i].location = loc; break; }
      }
      setHistory(hh);
    });

    if (status === "done") {
      pendingEntry = entry;
      openSentiment();
    } else {
      show("deck");
      toast("Logged. No worries — next time.");
    }
  }

  function captureLocation(cb) {
    if (!navigator.geolocation) { cb(null); return; }
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; cb(null); } }, 7000);
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (done) return; done = true; clearTimeout(timer);
        cb({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6),
          accuracy: Math.round(pos.coords.accuracy || 0),
        });
      },
      function () { if (done) return; done = true; clearTimeout(timer); cb(null); },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
  }

  // ---- Sentiment ----
  function openSentiment() { overlaySentiment.classList.remove("hidden"); }
  function closeSentiment() { overlaySentiment.classList.add("hidden"); }
  function setSentiment(val) {
    if (pendingEntry) {
      var h = getHistory();
      for (var i = 0; i < h.length; i++) {
        if (h[i].id === pendingEntry.id) { h[i].sentiment = val; break; }
      }
      setHistory(h);
      pendingEntry = null;
    }
    closeSentiment();
    show("deck");
    if (val === "good") toast("Love that. Onto the next one.");
    else if (val === "bad") toast("Logged. Brave of you to try.");
    else toast("Logged.");
  }

  // ---- History & stats ----
  function renderHistory() {
    var h = getHistory();
    var done = h.filter(function (e) { return e.status === "done"; });
    var good = done.filter(function (e) { return e.sentiment === "good"; });
    var rate = done.length ? Math.round((good.length / done.length) * 100) : 0;

    $("stats").innerHTML =
      stat(h.length, "Attempts") +
      stat(done.length, "Did it") +
      stat(rate + "%", "Went well");

    var list = $("history-list");
    if (!h.length) {
      list.innerHTML = '<p class="empty">No attempts yet. Swipe a card and go be brave.</p>';
      return;
    }
    list.innerHTML = h.map(renderEntry).join("");
  }
  function stat(num, lbl) {
    return '<div class="stat"><dt class="lbl">' + lbl + '</dt><dd class="num">' + num + "</dd></div>";
  }
  function renderEntry(e) {
    var statusPill = e.status === "done"
      ? '<span class="pill done">Did it</span>'
      : '<span class="pill missed">Passed on it</span>';
    var sentiment = "";
    if (e.sentiment === "good") sentiment = '<span class="feel">went well</span>';
    else if (e.sentiment === "bad") sentiment = '<span class="feel">not great</span>';
    var loc = "";
    if (e.location) {
      var url = "https://www.google.com/maps?q=" + e.location.lat + "," + e.location.lng;
      loc = '<a href="' + url + '" target="_blank" rel="noopener">Map</a>';
    }
    return '<div class="entry">' +
      '<div class="e-line">' + escapeHtml(e.line) + "</div>" +
      '<div class="e-meta">' +
        statusPill + sentiment +
        "<span>" + fmtDate(e.completedAt) + "</span>" +
        loc +
      "</div></div>";
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    var opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    return d.toLocaleString(undefined, opts);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function clearHistory() {
    if (!confirm("Delete all your logged attempts? This can't be undone.")) return;
    setHistory([]);
    renderHistory();
    toast("History cleared.");
  }

  // ---- Wire up events ----
  $("nav-deck").addEventListener("click", function () {
    // If a challenge is in progress, resume it instead of the deck.
    var active = load(K_ACTIVE, null);
    if (active) enterChallenge(active); else show("deck");
  });
  $("nav-history").addEventListener("click", function () { show("history"); });

  $("btn-pass").addEventListener("click", function () { programmaticSwipe(-1); });
  $("btn-accept").addEventListener("click", function () { programmaticSwipe(1); });
  $("btn-shuffle").addEventListener("click", renderCard);

  $("btn-done").addEventListener("click", function () { finishChallenge("done"); });
  $("btn-missed").addEventListener("click", function () { finishChallenge("missed"); });
  $("btn-cancel").addEventListener("click", function () {
    endChallenge();
    show("deck");
    toast("Challenge cancelled.");
  });

  $("btn-good").addEventListener("click", function () { setSentiment("good"); });
  $("btn-bad").addEventListener("click", function () { setSentiment("bad"); });
  $("btn-skip-sentiment").addEventListener("click", function () { setSentiment(null); });

  $("btn-clear").addEventListener("click", clearHistory);

  // Keyboard shortcuts (desktop testing)
  document.addEventListener("keydown", function (e) {
    if (!views.deck.classList.contains("hidden")) {
      if (e.key === "ArrowRight") programmaticSwipe(1);
      if (e.key === "ArrowLeft") programmaticSwipe(-1);
    }
  });

  // ---- Boot ----
  function boot() {
    renderCard();
    var active = load(K_ACTIVE, null);
    if (active) enterChallenge(active);
    else show("deck");
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }
  boot();
})();
