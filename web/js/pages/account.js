window.Darkness = window.Darkness || {};
window.Darkness.pages = window.Darkness.pages || {};

/**
 * Account: profile, password, signed-in devices, and your data. Every action says what it did and every failure says
 * why (wrong password with attempts left, pause with a countdown, weak password, network trouble).
 */
window.Darkness.pages.account = function renderAccountPage() {
  var D = window.Darkness, M = D.mg;
  var main = document.getElementById("main");
  if (!main) return;

  main.innerHTML =
    '<div class="page mg-page"><div class="page__inner page__inner--narrow" id="mgAccount">' +
    '<header class="mg-head"><div><h1 class="mg-title">Account</h1><p class="mg-sub">Your profile, security and data.</p></div></header>' +
    M.skeleton("list") + M.skeleton("list") + "</div></div>";
  var root = document.getElementById("mgAccount");
  var info = null, sessions = [];

  var fetchAll = function () {
    return Promise.all([D.api.get("/api/account"), D.api.get("/api/account/sessions")]).then(function (r) { return { account: r[0], sessions: r[1].sessions || [] }; });
  };

  function msgOf(e) {
    if (!e) return "Something went wrong.";
    if (e.status === 0) return "You appear to be offline. Check your connection and try again.";
    return (e.data && e.data.error) || e.message || "Something went wrong.";
  }
  function setNote(id, text, tone) {
    var el = root.querySelector("#" + id);
    if (!el) return;
    el.textContent = text || "";
    el.className = "mg-note-line" + (text ? " mg-note-line--" + (tone || "info") : "");
    el.hidden = !text;
  }

  function paint(data, st) {
    info = data.account; sessions = data.sessions;
    root.classList.toggle("is-repaint", !st.firstPaint);
    var u = info.user, others = sessions.filter(function (s) { return !s.current; });
    var min = info.passwordMinLength || 8;

    root.innerHTML = [
      '<header class="mg-head"><div><h1 class="mg-title">Account</h1><p class="mg-sub">Your profile, security and data.</p></div></header>',

      '<article class="mg-card mg-profile" style="--i:0"><div class="mg-avatar" aria-hidden="true">' + M.esc(M.initials(u.name)) + '</div>',
      '<div class="mg-profile__main"><form id="mgNameForm" class="mg-inline" novalidate><label class="mg-label" for="mgName">Display name</label>',
      '<div class="mg-inline__row"><input class="mg-input" id="mgName" name="name" maxlength="80" autocomplete="name" value="' + M.esc(u.name) + '" /><button class="btn btn--primary btn--sm" id="mgNameSave" type="submit" disabled>Save</button></div>',
      '<p class="mg-note-line" id="mgNameNote" hidden></p></form>',
      '<dl class="mg-kv mg-kv--tight"><div><dt>Email</dt><dd>' + M.esc(u.email) + "</dd></div><div><dt>Member since</dt><dd>" + M.esc(M.dateLong(u.createdAt)) + "</dd></div></dl></div></article>",

      '<article class="mg-card" style="--i:1"><header class="mg-card__head"><div><h2>Password</h2><p>' + (info.privacyStrict ? "At least " + min + " characters, and not a common password." : "At least " + min + " characters.") + "</p></div></header>",
      '<form id="mgPwForm" class="mg-form" novalidate autocomplete="off">',
      field("mgCur", "Current password", "current-password", "current"),
      field("mgNew", "New password", "new-password", "next"),
      '<div class="mg-strength" id="mgStrength" aria-live="polite"><div class="mg-strength__bars"><i></i><i></i><i></i><i></i></div><span id="mgStrengthText"></span></div>',
      field("mgNew2", "Confirm new password", "new-password", "confirm"),
      '<p class="mg-note-line" id="mgPwNote" hidden role="alert"></p>',
      '<div class="mg-form__foot"><button class="btn btn--primary btn--sm" id="mgPwSave" type="submit">Update password</button><span class="mg-muted">Changing it signs out your other devices.</span></div></form></article>',

      '<article class="mg-card" style="--i:2"><header class="mg-card__head"><div><h2>Devices</h2><p>Where you are signed in</p></div>',
      others.length ? '<button class="btn btn--outline btn--sm" id="mgRevoke" type="button">Sign out ' + others.length + " other" + (others.length === 1 ? "" : "s") + "</button>" : "",
      "</header><ul class=\"mg-list\">" + (sessions.length ? sessions.map(function (s) {
        return '<li class="mg-row mg-row--static"><span class="mg-row__ico">' + M.icon("laptop", 16) + '</span><span class="mg-row__main"><span class="mg-row__title">' + (s.current ? "This device" : "Another device") + (s.current ? ' <span class="mg-badge mg-badge--ok">Current</span>' : "") + '</span><span class="mg-row__sub">Signed in ' + M.esc(M.dateTime(s.createdAt)) + " · expires " + M.esc(M.dateLong(s.expiresAt)) + "</span></span></li>";
      }).join("") : '<li class="mg-row mg-row--static"><span class="mg-row__main"><span class="mg-row__sub">No saved sessions.</span></span></li>') + "</ul>",
      '<p class="mg-note-line" id="mgDevNote" hidden role="status"></p></article>',

      '<article class="mg-card" style="--i:3"><header class="mg-card__head"><div><h2>Your data</h2><p>You own it. Take a copy any time.</p></div></header>',
      '<div class="mg-actions mg-actions--left"><button class="btn btn--outline btn--sm" id="mgExport" type="button">' + M.icon("download", 15) + " <span>Download my data</span></button><a class=\"btn btn--outline btn--sm\" href=\"/api/privacy/policy\" target=\"_blank\" rel=\"noopener\"><span>Privacy policy</span></a></div>",
      '<p class="mg-note-line" id="mgDataNote" hidden role="status"></p></article>',

      '<article class="mg-card mg-card--danger" style="--i:4"><header class="mg-card__head"><div><h2>Sign out</h2><p>End the session on this device.</p></div><button class="btn btn--outline btn--sm btn--danger-outline" id="mgLogout" type="button">' + M.icon("logout", 15) + " <span>Sign out</span></button></header></article>",
    ].join("");
  }

  function field(id, label, auto, name) {
    return '<div class="mg-field" data-field="' + name + '"><label class="mg-label" for="' + id + '">' + label + '</label><div class="mg-pw"><input class="mg-input" id="' + id + '" type="password" autocomplete="' + auto + '" maxlength="1024" spellcheck="false" /><button type="button" class="mg-pw__eye" data-eye="' + id + '" aria-label="Show password" aria-pressed="false">' + M.icon("eye", 16) + "</button></div></div>";
  }

  var lockTimer = null;
  function lockFor(seconds, btn) {
    clearInterval(lockTimer);
    var until = Date.now() + seconds * 1000;
    var tick = function () {
      var left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (!btn.isConnected) { clearInterval(lockTimer); return; }
      if (left <= 0) { clearInterval(lockTimer); btn.disabled = false; btn.textContent = "Update password"; setNote("mgPwNote", ""); return; }
      btn.disabled = true; btn.textContent = "Try again in " + left + "s";
    };
    tick(); lockTimer = setInterval(tick, 1000);
  }

  var delegated = false;
  function bind() {
    if (delegated) return; delegated = true;

    root.addEventListener("input", function (e) {
      if (e.target.id === "mgName") {
        var save = root.querySelector("#mgNameSave");
        save.disabled = !e.target.value.trim() || e.target.value.trim() === (info && info.user.name);
        setNote("mgNameNote", "");
      }
      if (e.target.id === "mgNew") {
        var pw = e.target.value, s = D.authGate && D.authGate._validators ? D.authGate._validators.strength(pw, info && info.user.email) : { score: 0 };
        var el = root.querySelector("#mgStrength");
        el.dataset.score = String(pw ? s.score : 0);
        root.querySelector("#mgStrengthText").textContent = !pw ? "" : ["", "Weak", "Fair", "Good", "Strong"][s.score] || "";
      }
      if (e.target.closest && e.target.closest("#mgPwForm")) {
        e.target.closest(".mg-field") && e.target.closest(".mg-field").classList.remove("is-bad");
        setNote("mgPwNote", "");
      }
    });

    root.addEventListener("click", function (e) {
      var t = e.target;
      var eye = t.closest && t.closest("[data-eye]");
      if (eye) {
        var input = root.querySelector("#" + eye.getAttribute("data-eye"));
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.setAttribute("aria-pressed", String(show)); eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
        return;
      }
      if (t.closest("#mgRevoke")) {
        var b = t.closest("#mgRevoke");
        M.busy(b, "Signing out…", function () {
          return D.api.post("/api/account/sessions/revoke-others").then(function (r) {
            M.forget("account"); D.toast.show((r.revoked || 0) + " device" + (r.revoked === 1 ? "" : "s") + " signed out", "success");
            return refresh();
          });
        }).catch(function (err) { setNote("mgDevNote", msgOf(err), "bad"); });
        return;
      }
      if (t.closest("#mgExport")) {
        M.busy(t.closest("#mgExport"), "Preparing…", function () {
          return D.api.get("/api/privacy/export").then(function (data) {
            M.download("darkness-my-data.json", JSON.stringify(data, null, 2), "application/json");
            setNote("mgDataNote", "Your data was downloaded as darkness-my-data.json.", "ok");
          });
        }).catch(function (err) { setNote("mgDataNote", msgOf(err), "bad"); });
        return;
      }
      if (t.closest("#mgLogout")) {
        M.busy(t.closest("#mgLogout"), "Signing out…", function () { return D.auth.logout(); });
      }
    });

    root.addEventListener("submit", function (e) {
      e.preventDefault();
      if (e.target.id === "mgNameForm") return submitName();
      if (e.target.id === "mgPwForm") return submitPassword();
    });
  }

  function submitName() {
    var input = root.querySelector("#mgName"), value = input.value.trim();
    if (!value) { setNote("mgNameNote", "Enter a name.", "bad"); input.focus(); return; }
    M.busy(root.querySelector("#mgNameSave"), "Saving…", function () {
      return D.api.patch("/api/account", { name: value }).then(function (r) {
        info.user.name = r.name; M.forget("overview");
        var cached = M.peek("account"); if (cached) cached.data.account.user.name = r.name;
        try { D.auth.refresh(); D.uiTopbar.renderUserMenu(); } catch (err) {}
        root.querySelector(".mg-avatar").textContent = M.initials(r.name);
        input.value = r.name;
        setNote("mgNameNote", "Saved.", "ok");
      });
    }).catch(function (err) { setNote("mgNameNote", msgOf(err), "bad"); }).then(function () {
      var save = root.querySelector("#mgNameSave");
      if (save) save.disabled = input.value.trim() === (info && info.user.name);
    });
  }

  function submitPassword() {
    var cur = root.querySelector("#mgCur"), nw = root.querySelector("#mgNew"), nw2 = root.querySelector("#mgNew2"), btn = root.querySelector("#mgPwSave");
    var mark = function (name, text) {
      var f = root.querySelector('[data-field="' + name + '"]'); if (f) f.classList.add("is-bad");
      setNote("mgPwNote", text, "bad");
      var input = f && f.querySelector("input"); if (input) input.focus();
    };
    root.querySelectorAll(".mg-field").forEach(function (f) { f.classList.remove("is-bad"); });
    var min = (info && info.passwordMinLength) || 8;
    if (!cur.value) return mark("current", "Enter your current password.");
    if (!nw.value) return mark("next", "Enter a new password.");
    if (nw.value.length < min) return mark("next", "Use at least " + min + " characters.");
    if (nw.value === cur.value) return mark("next", "The new password must be different from the current one.");
    if (nw.value !== nw2.value) return mark("confirm", "The two new passwords don't match.");

    M.busy(btn, "Updating…", function () {
      return D.api.post("/api/account/password", { current: cur.value, next: nw.value }).then(function (r) {
        cur.value = nw.value = nw2.value = "";
        root.querySelector("#mgStrength").dataset.score = "0"; root.querySelector("#mgStrengthText").textContent = "";
        D.toast.show("Password updated", "success");
        var done = "Password updated" + (r.revokedSessions ? " and " + r.revokedSessions + " other device" + (r.revokedSessions === 1 ? "" : "s") + " signed out." : ".");
        // The device list changed; re-render it, then restore the confirmation the re-render wiped.
        return refresh().then(function () { setNote("mgPwNote", done, "ok"); });
      });
    }).catch(function (err) {
      var d = (err && err.data) || {};
      if (err && err.status === 429 && d.retryAfter) { setNote("mgPwNote", d.error || "Too many attempts.", "bad"); lockFor(d.retryAfter, btn); return; }
      if (d.field === "current") return mark("current", d.error + (d.attemptsLeft != null && d.attemptsLeft <= 2 ? " (" + d.attemptsLeft + " attempt" + (d.attemptsLeft === 1 ? "" : "s") + " left)" : ""));
      if (d.field === "next") return mark("next", d.error);
      setNote("mgPwNote", msgOf(err), "bad");
    });
  }

  function refresh() {
    M.forget("account");
    return M.load("account", fetchAll).then(function (data) { if (root.isConnected) paint(data, { firstPaint: false, fresh: true }); });
  }

  bind();
  M.swr(root, "account", fetchAll, paint, function (err) {
    root.innerHTML = M.errorPanel(msgOf(err), "mgRetry");
    var b = document.getElementById("mgRetry");
    if (b) b.addEventListener("click", function () { M.forget("account"); D.pages.account(); });
  }, { freshFor: 0 }); // security data (devices): always re-check, painting the cached copy meanwhile
};
