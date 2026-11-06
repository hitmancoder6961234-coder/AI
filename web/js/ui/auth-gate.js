/**
 * Darkness sign-in gate.
 *
 * Left: a small stage. A character patrols, watches you type, covers its eyes for the password, stops to think
 * while the server answers, then walks through the opening gate on success or shakes its head on failure.
 * Right: the form - live validation, e-mail typo hints, caps-lock warning, strength meter, remembered e-mail - and a
 * banner that explains every way signing in can go wrong (wrong password, lock-out, offline, timeout, server down,
 * blocked request, session not stored, ...) with the right next step.
 *
 * State lives in data-state on the root: idle | typing | secret | thinking | success | error | locked | offline | outage
 */
(function () {
  "use strict";
  var D = (window.Darkness = window.Darkness || {});

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EMAIL_KEY = "darkness_last_email";
  var LOCK_KEY = "darkness_lock_until";
  var COMMON = ["password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890", "11111111", "00000000", "qwertyui", "qwerty123", "qwertyuiop", "iloveyou", "letmein1", "welcome1", "welcome123", "admin123", "administrator", "abc12345", "abcd1234", "darkness", "darkness123", "changeme", "trustno1", "football", "baseball", "monkey123", "dragon123", "superman", "master123", "sunshine", "princess1"];
  var DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com", "live.com", "yahoo.co.in", "rediffmail.com"];

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, reduce ? Math.min(ms, 60) : ms); }); }
  function mmss(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  var ICON = {
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-5.5 8-5.5s6.5 1.5 8 5.5"/></svg>',
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.8A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5v.01M3 3l18 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  };

  // ---------------------------------------------------------------------------------------------- artwork
  var CHAR_SVG =
    '<svg class="ag-svg" viewBox="0 0 120 170" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="agBody" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#434a8c"/><stop offset="1" stop-color="#15183a"/></linearGradient>' +
    '<radialGradient id="agHead" cx=".35" cy=".25" r=".95"><stop offset="0" stop-color="#5a62ad"/><stop offset=".55" stop-color="#262a58"/><stop offset="1" stop-color="#0f1126"/></radialGradient></defs>' +
    '<ellipse class="ag-shadow" cx="60" cy="166" rx="28" ry="5"/>' +
    '<g class="leg-l"><rect class="limb" x="42" y="110" width="12" height="42" rx="6"/><rect class="limb" x="37" y="148" width="22" height="11" rx="5.5"/></g>' +
    '<g class="leg-r"><rect class="limb" x="66" y="110" width="12" height="42" rx="6"/><rect class="limb" x="61" y="148" width="22" height="11" rx="5.5"/></g>' +
    '<g class="body-g"><rect class="torso" x="32" y="84" width="56" height="36" rx="17"/><circle class="core" cx="60" cy="102" r="5.5"/>' +
    '<g class="head-g"><line class="antenna" x1="60" y1="24" x2="60" y2="13"/><circle class="bulb" cx="60" cy="10" r="4"/>' +
    '<g class="orbit"><circle cx="60" cy="2" r="2.4"/><circle cx="74" cy="12" r="2"/><circle cx="46" cy="12" r="1.8"/></g>' +
    '<ellipse class="head" cx="60" cy="52" rx="35" ry="31"/><rect class="visor" x="34" y="38" width="52" height="28" rx="14"/>' +
    '<g class="pupils"><g class="eye-wrap"><ellipse class="eye" cx="48" cy="52" rx="6.4" ry="7.6"/></g><g class="eye-wrap"><ellipse class="eye" cx="72" cy="52" rx="6.4" ry="7.6"/></g>' +
    '<path class="eye-happy" d="M42 55q6-9 12 0M66 55q6-9 12 0"/><path class="eye-sad" d="M42 51q6 7 12 0M66 51q6 7 12 0"/></g>' +
    '<path class="mouth mouth-smile" d="M52 72q8 7 16 0"/><path class="mouth mouth-flat" d="M53 74h14"/><path class="mouth mouth-frown" d="M52 77q8-7 16 0"/><ellipse class="mouth mouth-o" cx="60" cy="75" rx="4" ry="4.5"/></g></g>' +
    '<g class="arm arm-l"><rect class="limb" x="29" y="90" width="10" height="38" rx="5"/><circle class="hand" cx="34" cy="130" r="7.5"/></g>' +
    '<g class="arm arm-r"><rect class="limb" x="81" y="90" width="10" height="38" rx="5"/><circle class="hand" cx="86" cy="130" r="7.5"/></g></svg>';

  var GATE_SVG =
    '<svg viewBox="0 0 160 220" aria-hidden="true" focusable="false"><defs><linearGradient id="agLight" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#d9fff0"/><stop offset="1" stop-color="#6ee7b7"/></linearGradient></defs>' +
    '<path class="g-frame" d="M6 216V84C6 34 40 6 80 6s74 28 74 78v132z"/>' +
    '<path class="g-light" d="M22 216V88C22 46 48 22 80 22s58 24 58 66v128z"/>' +
    '<g clip-path="inset(0)"><path class="g-door g-door-l" d="M22 216V88C22 46 48 22 80 22v194z"/><path class="g-door g-door-r" d="M138 216V88C138 46 112 22 80 22v194z"/></g>' +
    '<path class="g-rune" d="M40 130l10-14 10 14M100 130l10-14 10 14M52 170h56M64 192h32"/>' +
    '<g class="g-lock"><path class="shackle" d="M68 108V98a12 12 0 0 1 24 0v10"/><rect class="body" x="58" y="106" width="44" height="34" rx="8"/><circle cx="80" cy="120" r="4.5" fill="#05060f"/><rect x="78" y="122" width="4" height="9" rx="2" fill="#05060f"/></g>' +
    '<path class="g-chain" d="M10 70L150 190M150 70L10 190"/></svg>';

  // ---------------------------------------------------------------------------------------------- validation
  function lev(a, b) {
    var m = [], i, j;
    for (i = 0; i <= a.length; i++) { m[i] = [i]; }
    for (j = 1; j <= b.length; j++) { m[0][j] = j; }
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  function suggestDomain(email) {
    var at = email.lastIndexOf("@");
    if (at < 1) return null;
    var dom = email.slice(at + 1).toLowerCase();
    if (!dom || DOMAINS.indexOf(dom) >= 0) return null;
    var best = null, bd = 3;
    DOMAINS.forEach(function (d) { var x = lev(dom, d); if (x < bd && x > 0 && Math.abs(dom.length - d.length) <= 2) { bd = x; best = d; } });
    return best ? email.slice(0, at + 1) + best : null;
  }
  /** returns a message or "" */
  function emailProblem(v) {
    v = v.trim();
    if (!v) return "Enter your email address";
    if (v.length > 254) return "That email address is too long";
    if (/\s/.test(v)) return "An email address can't contain spaces";
    if (v.indexOf("@") < 0) return "Your email needs an @, like name@example.com";
    if (v.split("@").length > 2) return "Only one @ is allowed in an email address";
    var p = v.split("@"), local = p[0], dom = p[1];
    if (!local) return "Add the part before the @";
    if (!dom) return "Add the domain after the @, like example.com";
    if (/\.\./.test(v) || /^\.|\.$/.test(local) || /^\.|\.$/.test(dom)) return "That email has a misplaced dot";
    if (dom.indexOf(".") < 0) return "The domain needs a dot, like example.com";
    if (dom.split(".").pop().length < 2) return "The ending of that domain looks too short";
    if (/[<>()\[\]\\,;:"]/.test(v)) return "That email has a character that isn't allowed";
    return "";
  }
  function strength(pw, email) {
    var local = (email || "").split("@")[0].toLowerCase();
    var checks = {
      len: pw.length >= 8,
      mix: (/[a-z]/i.test(pw) && /\d/.test(pw)) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) || /[^a-z0-9]/i.test(pw) && pw.length >= 8,
      common: COMMON.indexOf(pw.toLowerCase()) < 0 && !/^(.)\1+$/.test(pw) && !/^(0123|1234|2345|abcd|qwer)/i.test(pw),
      personal: !(local.length >= 3 && pw.toLowerCase().indexOf(local) >= 0),
    };
    var score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 0.5;
    if (/\d/.test(pw)) score += 0.5;
    if (/[^a-z0-9]/i.test(pw)) score += 0.5;
    if (new Set(pw.split("")).size < Math.min(5, pw.length)) score -= 1;
    if (!checks.common || !checks.personal) score = Math.min(score, 1);
    return { checks: checks, score: pw ? Math.max(1, Math.min(4, Math.round(score))) : 0 };
  }

  // ---------------------------------------------------------------------------------------------- instance
  var G = null; // the live gate (one at a time)

  function destroy() {
    if (!G) return;
    G.dead = true;
    walker = null;
    G.timers.forEach(clearInterval);
    G.timeouts.forEach(clearTimeout);
    if (G.raf) cancelAnimationFrame(G.raf);
    G.off.forEach(function (f) { try { f(); } catch (e) { /* gone */ } });
    if (G.ctrl) try { G.ctrl.abort(); } catch (e) { /* done */ }
    G = null;
  }

  function render(opts) {
    destroy();
    var main = document.getElementById("main");
    if (!main) return;
    opts = opts || {};
    main.innerHTML =
      '<div class="ag" id="ag" data-state="idle" data-mode="login">' +
      '<div class="ag-bg" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<div class="ag-wrap">' +
      '<section class="ag-stage" aria-hidden="true">' +
      '<div class="ag-brand"><img src="/brand/darkness-logo.svg" alt="" /><div><b>Darkness AI</b><small>Private multi-model workspace</small></div></div>' +
      '<div class="ag-scene" id="agScene"><div class="ag-stars" id="agStars"></div><div class="ag-moon"></div><div class="ag-hills"></div><div class="ag-ground"></div><div class="ag-beam"></div>' +
      '<div class="ag-gate" id="agGate">' + GATE_SVG + '</div>' +
      '<div class="ag-char" id="agChar"><div class="ag-bubble" id="agBubble"></div>' + CHAR_SVG + '</div><div class="ag-flash" id="agFlash"></div></div>' +
      '<div class="ag-caption" id="agCaption"></div>' +
      '<div class="ag-chips"><span class="ag-chip" id="chipSec"><i></i><span>Checking connection</span></span><span class="ag-chip" id="chipSrv"><i></i><span>Contacting server</span></span><span class="ag-chip ok"><i></i><span>Sessions last 30 days</span></span></div>' +
      '</section>' +
      '<section class="ag-card" id="agCard" aria-labelledby="agTitle">' +
      '<div class="ag-tabs" role="tablist" aria-label="Sign in or create an account"><span class="pill"></span><button type="button" role="tab" id="tabLogin" data-tab="login" aria-selected="true">Sign in</button><button type="button" role="tab" id="tabSignup" data-tab="signup" aria-selected="false">Create account</button></div>' +
      '<div class="ag-formwrap"><h1 id="agTitle">Welcome back</h1><p class="sub" id="agSub">Sign in to continue to your workspace.</p>' +
      '<div class="ag-banner" id="agBanner" role="alert" hidden></div>' +
      '<form id="agForm" novalidate autocomplete="on" method="post" action="#">' +
      '<div class="ag-field is-collapsed" id="fName"><div><label for="agName">Name <small>(optional)</small></label><div class="ag-input">' + ICON.user + '<input id="agName" name="name" type="text" autocomplete="name" maxlength="80" placeholder="What should we call you?" /></div></div></div>' +
      '<div class="ag-field" id="fEmail"><div><label for="agEmail">Email</label><div class="ag-input" id="boxEmail">' + ICON.mail + '<input id="agEmail" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="254" placeholder="you@example.com" aria-describedby="hintEmail" required /></div><div class="ag-hint" id="hintEmail" aria-live="polite"></div></div></div>' +
      '<div class="ag-field" id="fPass"><div><label for="agPass"><span>Password</span><span class="ag-caps" id="agCaps">Caps Lock is on</span></label><div class="ag-input" id="boxPass">' + ICON.lock + '<input id="agPass" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" maxlength="256" placeholder="Your password" aria-describedby="hintPass" required /><button class="eye" id="agEye" type="button" aria-pressed="false" aria-label="Show password">' + ICON.eye + '</button></div>' +
      '<div class="ag-hint" id="hintPass" aria-live="polite"></div><div id="agStrength" hidden><div class="ag-meter" id="agMeter" data-s="0"><i></i><i></i><i></i><i></i></div><ul class="ag-checks" id="agChecks"><li data-c="len">8+ characters</li><li data-c="mix">letters &amp; numbers</li><li data-c="common">not a common password</li><li data-c="personal">not your email</li></ul></div></div></div>' +
      '<div class="ag-field is-collapsed" id="fPass2"><div><label for="agPass2">Confirm password</label><div class="ag-input" id="boxPass2">' + ICON.lock + '<input id="agPass2" name="confirm" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" maxlength="256" placeholder="Type it once more" aria-describedby="hintPass2" /></div><div class="ag-hint" id="hintPass2" aria-live="polite"></div></div></div>' +
      '<div class="ag-row"><label><input type="checkbox" id="agRemember" /> Remember my email</label><button type="button" class="ag-link" id="agHelpBtn" aria-expanded="false" aria-controls="agHelp">Trouble signing in?</button><a class="ag-link" id="agForgot" href="/reset.html">Forgot password?</a></div>' +
      '<button class="ag-submit" id="agSubmit" type="submit"><span class="spin" aria-hidden="true"></span><span id="agSubmitLabel">Sign in</span><span class="bar" aria-hidden="true"></span></button>' +
      '</form>' +
      '<div class="ag-help" id="agHelp" hidden><b>Things that usually fix it</b><ul><li>Check the email for typos - sign-in is by exact email.</li><li>Turn off Caps Lock and use the eye icon to see what you typed.</li><li>Password managers sometimes fill an old password; type it by hand once.</li><li>Cookies and site storage must be allowed for this address.</li><li>After several wrong passwords the account pauses for a minute, then longer. Waiting is the only fix.</li><li>New here? Choose <b>Create account</b> above.</li></ul></div></div>' +
      '<div class="ag-done" id="agDone" aria-live="polite"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="30"/><path d="M27 41l9 9 18-20"/></svg><h2 id="doneTitle">Welcome back</h2><p id="doneText">Opening your workspace...</p></div>' +
      '<div class="ag-foot"><span id="agNotice">Private by design. No tracking.</span><a href="/api/privacy/policy" target="_blank" rel="noopener">Privacy policy</a></div>' +
      '</section></div><div class="ag-sr" id="agLive" aria-live="polite"></div></div>';

    var root = document.getElementById("ag");
    G = {
      root: root, mode: "login", state: "idle", busy: false, ctrl: null, dead: false, fails: 0, locked: 0, shown: false,
      timers: [], timeouts: [], off: [], thinkTimers: [], touched: {}, serverFails: 0, banner: null, pingMs: 0,
      els: {
        scene: root.querySelector("#agScene"), char: root.querySelector("#agChar"), bubble: root.querySelector("#agBubble"), gate: root.querySelector("#agGate"),
        flash: root.querySelector("#agFlash"), caption: root.querySelector("#agCaption"), banner: root.querySelector("#agBanner"), card: root.querySelector("#agCard"),
        form: root.querySelector("#agForm"), name: root.querySelector("#agName"), email: root.querySelector("#agEmail"), pass: root.querySelector("#agPass"), pass2: root.querySelector("#agPass2"),
        eye: root.querySelector("#agEye"), submit: root.querySelector("#agSubmit"), label: root.querySelector("#agSubmitLabel"), live: root.querySelector("#agLive"),
        remember: root.querySelector("#agRemember"), caps: root.querySelector("#agCaps"), strength: root.querySelector("#agStrength"), meter: root.querySelector("#agMeter"),
      },
    };
    wire(opts);
  }

  // ---------------------------------------------------------------------------------------------- helpers on the live instance
  function $(id) { return G && G.root.querySelector("#" + id); }
  function later(fn, ms) { var t = setTimeout(function () { if (G && !G.dead) fn(); }, ms); G.timeouts.push(t); return t; }
  function listen(target, ev, fn, o) { target.addEventListener(ev, fn, o); G.off.push(function () { target.removeEventListener(ev, fn, o); }); }
  function announce(text) { if (G) { G.els.live.textContent = ""; later(function () { G.els.live.textContent = text; }, 30); } }

  var CAPTIONS = {
    idle: "Dusk is on patrol. The vault opens for the right credentials.",
    typing: "Dusk is watching - politely.",
    secret: "Eyes covered. Your password stays between you and the server.",
    thinking: "Checking with the vault...",
    success: "Gate open. Welcome in.",
    error: "The gate stayed shut.",
    locked: "Too many wrong tries - the gate is chained for a moment.",
    offline: "No connection - the gate can't be reached.",
    outage: "The gate keeper isn't answering right now.",
  };

  // ---- character & scene ----
  var walker = null;
  function startWalker() {
    var el = G.els.char, scene = G.els.scene;
    walker = { x: 0.08, dir: 1, mode: reduce ? "still" : "patrol", pause: 0, last: 0, walking: false, goto: null, onArrive: null };
    function tick(t) {
      if (!G || G.dead) return;
      G.raf = requestAnimationFrame(tick);
      var dt = Math.min(0.05, (t - (walker.last || t)) / 1000);
      walker.last = t;
      if (document.hidden) return;
      var moving = false;
      if (walker.mode === "patrol") {
        if (t < walker.pause) moving = false;
        else {
          moving = true;
          walker.x += walker.dir * 0.04 * dt;
          if (walker.x >= 0.5) { walker.x = 0.5; walker.dir = -1; walker.pause = t + 1500 + Math.random() * 1500; }
          else if (walker.x <= 0.08) { walker.x = 0.08; walker.dir = 1; walker.pause = t + 1200 + Math.random() * 1500; }
        }
      } else if (walker.mode === "goto") {
        var d = walker.goto - walker.x;
        if (Math.abs(d) < 0.006) { walker.mode = "still"; var cb = walker.onArrive; walker.onArrive = null; if (cb) cb(); }
        else { moving = true; walker.dir = d > 0 ? 1 : -1; walker.x += walker.dir * 0.17 * dt; }
      }
      if (moving !== walker.walking) { walker.walking = moving; el.classList.toggle("is-walking", moving); }
      el.style.setProperty("--dir", walker.dir);
      el.style.left = (walker.x * 100).toFixed(2) + "%";
      if (G.state === "idle" && moving) look(walker.dir * 2.6, 0);
    }
    G.raf = requestAnimationFrame(tick);
  }
  function look(x, y) { if (G) { G.els.char.style.setProperty("--lx", x + "px"); G.els.char.style.setProperty("--ly", y + "px"); } }
  function bubble(text, tone, ms) {
    var b = G.els.bubble;
    clearTimeout(G.bubbleT);
    if (!text) { b.classList.remove("show"); return; }
    b.className = "ag-bubble show" + (tone ? " " + tone : "");
    b.innerHTML = text;
    if (ms) G.bubbleT = setTimeout(function () { if (G && !G.dead) b.classList.remove("show"); }, ms);
  }
  function setState(s) {
    if (!G) return;
    G.state = s;
    G.root.dataset.state = s;
    G.els.caption.textContent = CAPTIONS[s] || "";
    if (walker) walker.mode = s === "idle" ? (reduce ? "still" : "patrol") : walker.mode === "goto" ? "goto" : "still";
    if (s === "idle") { bubble(""); look(0, 0); G.els.char.classList.remove("is-hopping"); }
    if (s === "typing") look(2.8, 1.5);
    if (s === "secret") look(0, 0);
    if (s === "error") { look(0, 2); bubble("Hmm, no.", "bad", 2600); }
    if (s === "locked") bubble('<span id="bubbleCount"></span>', "warn");
    if (s === "offline") bubble("No signal...", "warn");
    if (s === "outage") bubble("Something's broken!", "warn");
    if (s !== "thinking") stopThinking();
  }

  var THINK = ["Checking your details", "Knocking on the vault door", "Asking the server", "Securing your session"];
  function startThinking(signup) {
    stopThinking();
    var steps = signup ? ["Reading your details", "Preparing your vault", "Creating the account", "Securing your session"] : THINK;
    bubble('<span class="dots"><i></i><i></i><i></i></span> ' + steps[0], "");
    steps.slice(1).forEach(function (txt, i) { G.thinkTimers.push(later(function () { if (G.state === "thinking") bubble('<span class="dots"><i></i><i></i><i></i></span> ' + txt, ""); }, 900 * (i + 1) + 200)); });
    G.thinkTimers.push(later(function () { if (G.state === "thinking") { bubble("Still working - slow connection?", "warn"); showBanner({ tone: "info", title: "This is taking a little longer", text: "Your connection or the server is slow. You can keep waiting or cancel.", actions: [{ label: "Cancel", fn: function () { if (G.ctrl) G.ctrl.abort(); } }] }); } }, 7000));
  }
  function stopThinking() { if (G) { G.thinkTimers.forEach(clearTimeout); G.thinkTimers = []; } }

  function sparks(n) {
    var sc = G.els.scene, r = G.els.gate.getBoundingClientRect(), s = sc.getBoundingClientRect();
    for (var i = 0; i < n; i++) {
      var p = document.createElement("i");
      p.className = "ag-spark";
      p.style.left = (r.left - s.left + r.width / 2) + "px"; p.style.top = (r.top - s.top + r.height * 0.55) + "px";
      p.style.setProperty("--dx", (Math.random() * 240 - 120) + "px"); p.style.setProperty("--dy", (-Math.random() * 150 - 20) + "px");
      p.style.background = ["#6ee7b7", "#a5b4fc", "#fcd34d", "#67e8f9"][i % 4];
      sc.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 1300); })(p);
    }
  }

  // ---- banner ----
  function showBanner(b) {
    var el = G.els.banner;
    var tone = b.tone || "bad";
    el.className = "ag-banner " + tone;
    el.setAttribute("role", tone === "bad" || tone === "warn" ? "alert" : "status");
    el.innerHTML = '<span class="ic">' + (tone === "ok" ? ICON.check : tone === "info" ? ICON.info : tone === "warn" ? ICON.clock : ICON.alert) + '</span><div class="tx"><b>' + esc(b.title) + "</b><span>" + (b.html || esc(b.text || "")) + "</span>" +
      (b.countdown ? '<div class="ag-count" id="agCount">' + mmss(b.countdown) + "</div>" : "") +
      (b.actions && b.actions.length ? '<div class="acts">' + b.actions.map(function (a, i) { return '<button type="button" data-i="' + i + '">' + esc(a.label) + "</button>"; }).join("") + "</div>" : "") +
      (b.details ? "<details><summary>Technical details</summary><code>" + esc(b.details) + "</code></details>" : "") + "</div>";
    el.hidden = false;
    G.banner = b;
    Array.prototype.forEach.call(el.querySelectorAll("[data-i]"), function (btn) { btn.addEventListener("click", function () { b.actions[Number(btn.getAttribute("data-i"))].fn(); }); });
    announce(b.title + ". " + (b.text || ""));
    if (b.autoHide) later(function () { if (G.banner === b) clearBanner(); }, b.autoHide);
  }
  function clearBanner() { if (G) { G.els.banner.hidden = true; G.els.banner.innerHTML = ""; G.banner = null; } }

  // ---- field feedback ----
  function fieldMsg(name, msg, tone) {
    var hint = $("hint" + name), box = $("box" + name);
    if (!hint) return;
    hint.className = "ag-hint" + (tone ? " " + tone : "");
    if (hint.dataset.msg !== (msg || "")) { hint.dataset.msg = msg || ""; hint.innerHTML = msg || ""; }
    if (box) { box.classList.toggle("bad", tone === "bad"); box.classList.toggle("good", tone === "good"); }
    var input = box && box.querySelector("input");
    if (input) { if (tone === "bad") input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  }
  function shake(el) { if (!el || reduce) return; el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); setTimeout(function () { el.classList.remove("shake"); }, 500); }

  function checkEmail(final) {
    var v = G.els.email.value, p = emailProblem(v);
    if (!v.trim() && !final) { fieldMsg("Email", "", ""); return true; }
    if (p) { fieldMsg("Email", p, "bad"); return false; }
    var sug = suggestDomain(v.trim());
    if (sug) { fieldMsg("Email", 'Did you mean <button type="button" data-use="' + esc(sug) + '">' + esc(sug) + "</button>?", "warn"); } else fieldMsg("Email", "", "good");
    return true;
  }
  function checkPassword(final) {
    var v = G.els.pass.value, signup = G.mode === "signup";
    if (!v) { fieldMsg("Pass", final ? "Enter your password" : "", final ? "bad" : ""); return !final; }
    if (v.length > 256) { fieldMsg("Pass", "That password is too long (256 characters at most)", "bad"); return false; }
    if (signup) {
      var s = strength(v, G.els.email.value);
      G.els.meter.setAttribute("data-s", String(s.score));
      Array.prototype.forEach.call($("agChecks").children, function (li) { li.classList.toggle("ok", !!s.checks[li.getAttribute("data-c")]); });
      var bad = !s.checks.len ? "Use at least 8 characters" : !s.checks.common ? "That password is too easy to guess" : !s.checks.personal ? "Don't use your email in your password" : "";
      if (bad) { fieldMsg("Pass", bad, final || v.length >= 8 ? "bad" : "warn"); return false; }
      fieldMsg("Pass", ["", "Weak - add length or mix it up", "Okay - a bit longer is better", "Good", "Strong"][s.score] || "", s.score >= 3 ? "good" : "warn");
      return true;
    }
    if (/^\s|\s$/.test(v)) fieldMsg("Pass", "Heads up: your password starts or ends with a space", "warn");
    else fieldMsg("Pass", "", "");
    return true;
  }
  function checkConfirm(final) {
    if (G.mode !== "signup") return true;
    var a = G.els.pass.value, b = G.els.pass2.value;
    if (!b) { fieldMsg("Pass2", final ? "Type the password again" : "", final ? "bad" : ""); return !final; }
    if (a !== b) { fieldMsg("Pass2", "The two passwords don't match", "bad"); return false; }
    fieldMsg("Pass2", "Passwords match", "good");
    return true;
  }

  function setMode(m, keepBanner) {
    G.mode = m;
    G.root.dataset.mode = m;
    var signup = m === "signup";
    $("tabLogin").setAttribute("aria-selected", String(!signup)); $("tabSignup").setAttribute("aria-selected", String(signup));
    $("tabLogin").tabIndex = signup ? -1 : 0; $("tabSignup").tabIndex = signup ? 0 : -1;
    $("agTitle").textContent = signup ? "Create your account" : "Welcome back";
    $("agSub").textContent = signup ? "A private workspace for your chats, projects and documents." : "Sign in to continue to your workspace.";
    G.els.label.textContent = signup ? "Create account" : "Sign in";
    [$("fName"), $("fPass2")].forEach(function (f) { f.classList.toggle("is-collapsed", !signup); if (signup) f.removeAttribute("inert"); else f.setAttribute("inert", ""); });
    $("agStrength").hidden = !signup;
    G.els.pass.setAttribute("autocomplete", signup ? "new-password" : "current-password");
    G.els.pass.placeholder = signup ? "At least 8 characters" : "Your password";
    G.fails = 0;
    ["Email", "Pass", "Pass2"].forEach(function (n) { fieldMsg(n, "", ""); });
    if (!keepBanner) clearBanner();
    if (G.pendingAfterMode) { var f = G.pendingAfterMode; G.pendingAfterMode = null; f(); }
  }

  // ---------------------------------------------------------------------------------------------- failure handling
  function describe(e) {
    var st = e.status || 0, code = e.code || "";
    var tech = [st ? "HTTP " + st : e.kind, code].filter(Boolean).join(" - ");
    if (e.kind === "offline") return { state: "offline", tone: "warn", title: "You're offline", text: "Connect to the internet and try again. Your details are still in the form.", actions: [{ label: "Try again", fn: retry }], details: tech };
    if (e.kind === "timeout") return { state: "outage", tone: "warn", title: "The server took too long", text: "It didn't answer within 20 seconds. Your password was not necessarily checked - it's safe to try again.", actions: [{ label: "Try again", fn: retry }], details: tech };
    if (e.kind === "network") return { state: "outage", tone: "warn", title: "Can't reach the server", text: "The request never arrived. It may be a network problem, a firewall or VPN, or the service may be down. We'll keep checking and tell you when it's back.", actions: [{ label: "Try again", fn: retry }], details: tech + (e.cause ? " - " + String(e.cause.message || e.cause) : ""), poll: true };
    if (e.kind === "parse") return { state: "error", tone: "bad", title: "Unexpected reply", text: "The server answered, but not in a format this app understands. If this keeps happening, the app and server versions may not match.", actions: [{ label: "Try again", fn: retry }], details: tech };
    if (code === "SESSION_NOT_SAVED") return { state: "error", tone: "bad", title: "Signed in, but the browser didn't keep it", text: "Cookies or site storage are blocked for this address (private mode, strict settings or an extension). Allow them for this site, then try again.", actions: [{ label: "Try again", fn: retry }], details: tech };
    if (code === "ACCOUNT_LOCKED" || st === 429) return { lock: e.retryAfter || 60, details: tech };
    if (code === "EMAIL_TAKEN") return { state: "error", tone: "info", title: "You already have an account", text: "That email is registered. Sign in instead - your data is waiting.", actions: [{ label: "Sign in instead", fn: function () { var em = G.els.email.value; G.pendingAfterMode = function () { G.els.email.value = em; G.els.pass.focus(); }; setMode("login"); } }], field: "Email", fieldText: "This email already has an account" };
    if (st === 400 || code === "VALIDATION_ERROR" || code === "WEAK_PASSWORD") {
      var f = e.field === "password" ? "Pass" : e.field === "name" ? "Name" : "Email";
      return { state: "error", tone: "bad", title: code === "WEAK_PASSWORD" ? "Choose a stronger password" : "Check the highlighted field", text: e.message, field: f, fieldText: e.message, details: tech };
    }
    if (code === "INVALID_CREDENTIALS" || st === 401) {
      var left = typeof e.attemptsLeft === "number" ? e.attemptsLeft : null;
      var acts = [];
      if (G.els.pass.type === "password") acts.push({ label: "Show password", fn: function () { toggleEye(true); G.els.pass.focus(); } });
      if (G.fails >= 2) acts.push({ label: "Create an account", fn: function () { var em = G.els.email.value; G.pendingAfterMode = function () { G.els.email.value = em; G.els.pass.focus(); }; setMode("signup"); } });
      return { state: "error", tone: "bad", title: "That email and password don't match", text: "Check for typos, Caps Lock, or an autofilled old password." + (left !== null && left <= 2 ? " " + left + (left === 1 ? " attempt" : " attempts") + " left before a short lock-out." : ""), actions: acts, focus: "Pass" };
    }
    if (st === 403) return { state: "error", tone: "bad", title: "The request was blocked", text: "A firewall, extension or the server's access rules refused it. Open the app from its official address and try again.", actions: [{ label: "Try again", fn: retry }], details: tech };
    if (st === 404) return { state: "outage", tone: "bad", title: "Sign-in service not found", text: "This address doesn't serve the sign-in API. The app may be misconfigured or still deploying.", actions: [{ label: "Try again", fn: retry }], details: tech, poll: true };
    if (st === 413) return { state: "error", tone: "bad", title: "That was too much data", text: "Shorten the name, email or password and try again.", details: tech };
    if (st >= 500 || e.nonJson) return { state: "outage", tone: "warn", title: st === 503 ? "Sign-in is temporarily unavailable" : "The server ran into a problem", text: "This isn't about your password. It's usually brief - try again in a few seconds. We'll let you know when the service responds.", actions: [{ label: "Try again", fn: retry }], details: tech, poll: true };
    return { state: "error", tone: "bad", title: "Couldn't sign you in", text: e.message || "Something unexpected happened.", actions: [{ label: "Try again", fn: retry }], details: tech };
  }

  function retry() { clearBanner(); if (G.state === "outage" || G.state === "offline") setState("idle"); G.els.form.requestSubmit ? G.els.form.requestSubmit() : submit(); }

  function lock(seconds, remember) {
    stopLock();
    var until = Date.now() + seconds * 1000;
    G.locked = until;
    if (remember !== false) lsSet(LOCK_KEY, String(until));
    setState("locked");
    G.els.submit.disabled = true;
    showBanner({ tone: "warn", title: "Too many attempts - the gate is paused", text: "For your account's safety, sign-in is paused. Typing the right password later will work; trying again now won't.", countdown: seconds });
    function tickLock() {
      var left = Math.ceil((G.locked - Date.now()) / 1000);
      var c = $("agCount"), b = $("bubbleCount");
      if (c) c.textContent = mmss(left);
      if (b) b.textContent = "Back in " + mmss(left);
      G.els.label.textContent = left > 0 ? "Try again in " + mmss(left) : G.mode === "signup" ? "Create account" : "Sign in";
      if (left <= 0) {
        stopLock(); lsDel(LOCK_KEY); G.locked = 0; G.fails = 0;
        G.els.submit.disabled = false; setState("idle");
        showBanner({ tone: "ok", title: "You can try again", text: "The pause is over.", autoHide: 6000 });
        G.els.pass.focus();
      }
    }
    G.lockTimer = setInterval(tickLock, 500);
    G.timers.push(G.lockTimer);
    tickLock();
  }
  function stopLock() { if (G && G.lockTimer) { clearInterval(G.lockTimer); G.lockTimer = null; } }

  // ---------------------------------------------------------------------------------------------- submit
  function validateAll() {
    var ok = true, first = null;
    if (!checkEmail(true)) { ok = false; first = first || G.els.email; }
    if (!checkPassword(true)) { ok = false; first = first || G.els.pass; }
    if (!checkConfirm(true)) { ok = false; first = first || G.els.pass2; }
    return ok ? null : first;
  }

  async function submit() {
    if (!G || G.busy) return;
    if (G.locked && G.locked > Date.now()) return;
    clearBanner();
    var bad = validateAll();
    if (bad) {
      setState("error"); bubble("Check the red field", "bad", 2600); shake(G.els.card); bad.focus();
      announce("Please fix the highlighted field."); later(function () { if (G.state === "error") setState("idle"); }, 2800);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { applyFailure(describe(new D.AuthError("offline", "offline"))); return; }

    var signup = G.mode === "signup";
    var email = G.els.email.value.trim(), password = G.els.pass.value, name = G.els.name.value.trim();
    G.busy = true; G.els.submit.disabled = true; G.ctrl = new AbortController();
    setState("thinking"); startThinking(signup); announce(signup ? "Creating your account" : "Signing in");
    var started = Date.now(), user = null, err = null;
    try {
      user = signup ? await D.auth.signup(email, password, name, { deferEmit: true, signal: G.ctrl.signal }) : await D.auth.login(email, password, { deferEmit: true, signal: G.ctrl.signal });
    } catch (e) { err = e; }
    if (!G || G.dead) return; // the gate was replaced while waiting (e.g. signed in from another tab)
    var spent = Date.now() - started;
    if (spent < 1100) await sleep(1100 - spent); // let the "thinking" beat register on fast connections
    if (!G || G.dead) return;
    G.busy = false; G.ctrl = null; G.els.submit.disabled = false;
    if (err) {
      if (err.kind === "aborted") { setState("idle"); showBanner({ tone: "info", title: "Cancelled", text: "Nothing was changed. Your details are still in the form.", autoHide: 4000 }); return; }
      applyFailure(describe(err));
      return;
    }
    G.fails = 0; stopLock(); lsDel(LOCK_KEY);
    if (G.els.remember.checked) lsSet(EMAIL_KEY, email); else lsDel(EMAIL_KEY);
    await succeed(user, signup);
  }

  function applyFailure(d) {
    G.els.submit.disabled = false;
    if (d.lock) { lock(d.lock); return; }
    G.fails += d.focus === "Pass" ? 1 : 0;
    setState(d.state || "error");
    shake(G.els.card);
    showBanner({ tone: d.tone, title: d.title, text: d.text, actions: d.actions, details: d.details });
    if (d.field) fieldMsg(d.field, d.fieldText || d.text, "bad");
    var target = d.focus || d.field;
    if (target) { var inp = { Pass: G.els.pass, Email: G.els.email, Name: G.els.name }[target]; if (inp) { inp.focus(); if (d.focus === "Pass") inp.select(); } }
    if (d.state === "error") later(function () { if (G && G.state === "error") setState("idle"); }, 3600);
    if (d.poll) startOutagePoll();
  }

  async function succeed(user, signup) {
    var nm = (user && (user.name || String(user.email || "").split("@")[0])) || "";
    $("doneTitle").textContent = signup ? "Account created" : nm ? "Welcome back, " + nm.split(" ")[0] : "Welcome back";
    $("doneText").textContent = "Opening your workspace...";
    setState("success"); announce(signup ? "Account created. Opening your workspace." : "Signed in. Opening your workspace.");
    G.els.char.classList.add("is-hopping");
    // walk to the open gate
    var sr = G.els.scene.getBoundingClientRect(), gr = G.els.gate.getBoundingClientRect(), cr = G.els.char.getBoundingClientRect();
    var targetX = (gr.left + gr.width / 2 - cr.width / 2 - sr.left) / sr.width;
    await sleep(500);
    if (!G || G.dead) return;
    G.els.char.classList.remove("is-hopping");
    await new Promise(function (res) {
      if (reduce) return res();
      walker.mode = "goto"; walker.goto = targetX; walker.onArrive = res;
      G.timeouts.push(setTimeout(res, 4500)); // never wait forever (hidden tab, odd layout)
    });
    if (!G || G.dead) return;
    G.els.char.classList.add("is-entering"); sparks(18); G.els.flash.classList.add("go");
    await sleep(850);
    if (!G || G.dead) return;
    G.root.style.transition = "opacity .35s"; G.root.style.opacity = "0";
    await sleep(380);
    D.auth.commit();
  }

  // ---------------------------------------------------------------------------------------------- connection awareness
  function setChip(id, cls, text) { var c = $(id); if (c) { c.className = "ag-chip " + cls; c.lastChild.textContent = text; } }
  function secureContext() { var h = location.hostname; return location.protocol === "https:" || h === "localhost" || h === "127.0.0.1" || h === "[::1]"; }
  async function ping() {
    if (!G) return null;
    var t = performance.now(), ok = false;
    try {
      var r = await D.auth._fetch("/api/health", { cache: "no-store", anon: true, signal: window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined });
      ok = r.ok;
    } catch (e) { ok = false; }
    if (!G || G.dead) return null;
    G.pingMs = Math.round(performance.now() - t);
    if (ok) { setChip("chipSrv", G.pingMs > 1500 ? "warn" : "ok", G.pingMs > 1500 ? "Slow server " + (G.pingMs / 1000).toFixed(1) + " s" : "Server " + G.pingMs + " ms"); G.serverFails = 0; }
    else { G.serverFails++; setChip("chipSrv", "bad", navigator.onLine === false ? "Offline" : "Server unreachable"); }
    return ok;
  }
  function startOutagePoll() {
    if (G.outagePoll) return;
    G.outagePoll = setInterval(async function () {
      if (!G || G.dead) return;
      if (G.state !== "outage") { clearInterval(G.outagePoll); G.outagePoll = null; return; }
      var ok = await ping();
      if (!G || G.dead) return;
      if (ok && (G.state === "outage")) {
        clearInterval(G.outagePoll); G.outagePoll = null; setState("idle");
        showBanner({ tone: "ok", title: "The service is back", text: "You can sign in now.", autoHide: 6000 });
      }
    }, 5000);
    G.timers.push(G.outagePoll);
  }

  function toggleEye(on) {
    var show = typeof on === "boolean" ? on : G.els.pass.type === "password";
    G.els.pass.type = show ? "text" : "password"; if (G.mode === "signup") G.els.pass2.type = show ? "text" : "password";
    G.els.eye.setAttribute("aria-pressed", String(show)); G.els.eye.setAttribute("aria-label", show ? "Hide password" : "Show password"); G.els.eye.innerHTML = show ? ICON.eyeOff : ICON.eye;
    G.root.dataset.peek = show ? "1" : "0";
  }

  // ---------------------------------------------------------------------------------------------- wiring
  function wire(opts) {
    var els = G.els;
    // stars
    var stars = "";
    for (var i = 0; i < 46; i++) stars += '<i style="left:' + (Math.random() * 100).toFixed(1) + "%;top:" + (Math.random() * 62).toFixed(1) + "%;animation-delay:-" + (Math.random() * 4).toFixed(2) + "s;opacity:" + (0.3 + Math.random() * 0.6).toFixed(2) + '"></i>';
    $("agStars").innerHTML = stars;
    if (!reduce) startWalker(); else { els.char.style.left = "20%"; }
    setState("idle");

    // remembered email, security context
    var last = lsGet(EMAIL_KEY);
    if (last) { els.email.value = last; els.remember.checked = true; } else els.remember.checked = true;
    var storageOk = lsSet("__ag_probe", "1"); lsDel("__ag_probe");
    var notes = [];
    if (!secureContext()) notes.push("This page isn't using HTTPS - don't enter a real password on a public network.");
    if (!storageOk) notes.push("Browser storage is blocked, so you may need to sign in again after reloading.");
    if (notes.length) { $("agNotice").textContent = notes.join(" "); $("agNotice").style.color = "var(--ag-warn)"; }
    setChip("chipSec", secureContext() ? "ok" : "warn", secureContext() ? "Encrypted connection" : "Not encrypted (HTTP)");
    if (navigator.onLine === false) { setState("offline"); setChip("chipSrv", "bad", "Offline"); } else ping();
    var iv = setInterval(function () { if (!document.hidden && G.state !== "success") ping(); }, 30000); G.timers.push(iv);

    // reasons the gate is showing
    if (opts.reason === "expired") showBanner({ tone: "info", title: "Your session ended", text: "For your security you were signed out. Sign in again to pick up where you left off.", autoHide: 12000 });
    else if (opts.reason === "logout") showBanner({ tone: "ok", title: "You've been signed out", text: "See you soon. Your data stays in your account.", autoHide: 6000 });
    else if (opts.reason === "other-tab") showBanner({ tone: "info", title: "Signed out in another tab", text: "You ended this session from another window.", autoHide: 9000 });
    var until = parseInt(lsGet(LOCK_KEY) || "0", 10);
    if (until > Date.now() + 1000) lock(Math.ceil((until - Date.now()) / 1000), false);
    else if (until) lsDel(LOCK_KEY);

    // online / offline
    listen(window, "offline", function () { if (G.busy) return; setState("offline"); showBanner({ tone: "warn", title: "You went offline", text: "Reconnect to sign in. What you typed is kept." }); setChip("chipSrv", "bad", "Offline"); });
    listen(window, "online", function () { if (G.state === "offline") setState("idle"); showBanner({ tone: "ok", title: "You're back online", text: "You can sign in now.", autoHide: 4000 }); ping(); });

    // tabs
    Array.prototype.forEach.call(G.root.querySelectorAll("[data-tab]"), function (b) { listen(b, "click", function () { if (!G.busy) setMode(b.getAttribute("data-tab")); }); });
    listen($("tabLogin").parentNode, "keydown", function (e) { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { var m = G.mode === "login" ? "signup" : "login"; setMode(m); $(m === "login" ? "tabLogin" : "tabSignup").focus(); } });

    // fields
    listen(els.email, "input", function () { clearFieldErr("Email"); G.touched.email = true; if (G.state === "idle" || G.state === "typing" || G.state === "error") setState("typing"); look(2.8, Math.min(3, 0.5 + els.email.value.length / 12)); if (els.email.value.length > 6) checkEmailSoft(); if (G.mode === "signup" && els.pass.value) checkPassword(false); });
    listen(els.email, "blur", function () { if (els.email.value) checkEmail(false); });
    listen(els.pass, "input", function () { clearFieldErr("Pass"); if (G.mode === "signup" || els.pass.value.length > 0) checkPassword(false); if (G.mode === "signup" && els.pass2.value) checkConfirm(false); });
    listen(els.pass, "blur", function () { if (els.pass.value) checkPassword(false); });
    listen(els.pass2, "input", function () { clearFieldErr("Pass2"); checkConfirm(false); });
    listen(els.pass2, "blur", function () { if (els.pass2.value) checkConfirm(false); });
    [els.name, els.email, els.pass, els.pass2].forEach(function (inp) {
      listen(inp, "focus", function () {
        if (G.silent || G.busy || G.locked > Date.now() || G.state === "success") return;
        if (G.state === "offline" || G.state === "outage") return;
        setState(inp === els.pass || inp === els.pass2 ? "secret" : "typing");
      });
      listen(inp, "blur", function () { later(function () { if (!G.busy && (G.state === "typing" || G.state === "secret") && !G.root.contains(document.activeElement && document.activeElement.tagName === "INPUT" ? document.activeElement : null)) setState("idle"); }, 400); });
    });
    // caps lock
    function caps(e) { if (e.getModifierState) els.caps.classList.toggle("on", e.getModifierState("CapsLock")); }
    listen(els.pass, "keydown", caps); listen(els.pass, "keyup", caps); listen(els.pass, "blur", function () { els.caps.classList.remove("on"); });
    // typo suggestion button
    function useSuggestion(e) { var b = e.target.closest("[data-use]"); if (!b) return; e.preventDefault(); els.email.value = b.getAttribute("data-use"); checkEmail(false); els.pass.focus(); }
    listen($("hintEmail"), "mousedown", useSuggestion);
    listen($("hintEmail"), "click", function (e) { if (e.detail === 0) useSuggestion(e); }); // keyboard (Enter/Space) activation
    listen(els.eye, "click", function () { toggleEye(); els.pass.focus(); });
    listen($("agHelpBtn"), "click", function () { var h = $("agHelp"); h.hidden = !h.hidden; $("agHelpBtn").setAttribute("aria-expanded", String(!h.hidden)); });
    listen(G.root, "keydown", function (e) { if (e.key === "Escape" && !$("agHelp").hidden) { $("agHelp").hidden = true; $("agHelpBtn").setAttribute("aria-expanded", "false"); $("agHelpBtn").focus(); } });
    // submit
    listen(els.form, "submit", function (e) { e.preventDefault(); submit(); });
    // pasted text with stray spaces
    listen(els.email, "paste", function () { later(function () { els.email.value = els.email.value.trim(); checkEmail(false); }, 0); });

    setMode("login", true);
    G.silent = true; // focusing the first field for convenience must not stop the patrol
    (els.email.value ? els.pass : els.email).focus({ preventScroll: true });
    G.silent = false;
  }
  function clearFieldErr(n) { var box = $("box" + n); if (box && box.classList.contains("bad")) fieldMsg(n, "", ""); if (G.banner && G.banner.tone === "bad" && !G.busy && G.state !== "locked") clearBanner(); }
  var softT;
  function checkEmailSoft() { clearTimeout(softT); softT = setTimeout(function () { if (G && !G.dead && G.els.email.value) { var sug = suggestDomain(G.els.email.value.trim()); if (sug) fieldMsg("Email", 'Did you mean <button type="button" data-use="' + esc(sug) + '">' + esc(sug) + "</button>?", "warn"); else if (!emailProblem(G.els.email.value)) fieldMsg("Email", "", "good"); } }, 450); }

  D.authGate = { render: render, destroy: destroy, _validators: { emailProblem: emailProblem, suggestDomain: suggestDomain, strength: strength } };
})();
