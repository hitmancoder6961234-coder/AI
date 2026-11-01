window.Darkness = window.Darkness || {};

/**
 * Authentication Gate:
 * Exact Pose Matching Uploaded Reference:
 * - Confident 3D robot standing on left
 * - 4 Fingers hooked naturally over the top horizontal border of the Login Card
 * - Thumbs-up hand held outward to the left with comfortable spacing from the head
 * - Happy glowing curved arch eyes & bright cyan smile
 */
window.Darkness.auth = {
  _user: null,
  _listeners: new Set(),

  get user() {
    return this._user;
  },

  get isAuthenticated() {
    return !!this._user;
  },

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },

  _emit() {
    this._listeners.forEach(fn => {
      try { fn(this._user); } catch (e) { console.error(e); }
    });
  },

  _fetch(path, options) {
    const opts = Object.assign({ credentials: "include" }, options || {});
    let token = null;
    try { token = localStorage.getItem("darkness_token"); } catch (e) {}
    const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};
    opts.headers = Object.assign({}, authHeaders, opts.headers || {});

    let url = path;
    if (window.Darkness?.api?._url) {
      url = window.Darkness.api._url(path);
    }
    return fetch(url, opts);
  },

  async refresh() {
    try {
      const resp = await this._fetch("/api/auth/me", { credentials: "include" });
      const json = await resp.json().catch(() => ({}));
      this._user = json.user || null;
      if (json.token) {
        try { localStorage.setItem("darkness_token", json.token); } catch (e) {}
      }
      if (this._user) {
        try { localStorage.setItem("darkness_user", JSON.stringify(this._user)); } catch (e) {}
      }
    } catch (e) {
      this._user = null;
    }
    this._emit();
    return this._user;
  },

  async signup(email, password, name) {
    const r = await this._fetch("/api/auth/signup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Sign up failed");
    }
    const data = await r.json();
    this._user = data.user || { email, name };
    if (data.token) {
      try { localStorage.setItem("darkness_token", data.token); } catch (e) {}
    }
    if (this._user) {
      try { localStorage.setItem("darkness_user", JSON.stringify(this._user)); } catch (e) {}
    }
    this._emit();
    return this._user;
  },

  async login(email, password) {
    const r = await this._fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "Login failed");
    }
    const data = await r.json();
    this._user = data.user || { email, name: email.split("@")[0] };
    if (data.token) {
      try { localStorage.setItem("darkness_token", data.token); } catch (e) {}
    }
    if (this._user) {
      try { localStorage.setItem("darkness_user", JSON.stringify(this._user)); } catch (e) {}
    }
    this._emit();
    return this._user;
  },

  async logout() {
    try {
      await this._fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) {}
    try { localStorage.removeItem("darkness_token"); } catch (e) {}
    try { localStorage.removeItem("darkness_user"); } catch (e) {}
    this._user = null;
    this._emit();
  },

  clearGate() {
    const app = document.getElementById("app");
    if (app) {
      app.classList.remove("is-gated");
      app.hidden = false;
      app.removeAttribute("hidden");
    }
  },

  /** Render the exact reference pose matching user's image */
                renderGate() {
    const main = document.getElementById("main");
    const app = document.getElementById("app");
    if (app) {
      app.classList.add("is-gated");
      app.hidden = false;
      app.removeAttribute("hidden");
    }
    if (!main) return;

    main.innerHTML = `
      <div class="auth-gate-scene" id="authGateScene">
        <!-- Studio White Floor & Ambient Lighting -->
        <div class="auth-studio-bg">
          <div class="studio-light--top"></div>
          <div class="studio-light--side"></div>
          <div class="studio-floor-reflection"></div>
        </div>

        <div class="auth-stage-container" id="authStageContainer">

          <!-- Confident 3D Standing Robot on the Left with Spaced-Out Thumbs Up -->
          <div class="auth-robot-standing-wrap" id="authRobotStandingWrap">
            <div class="robot-standing-mesh">
              <svg id="robotSvgRoot" viewBox="0 0 460 560" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="robot-svg">
  <defs>
    <!-- Soft Black Floor Contact Shadows -->
    <radialGradient id="groundShadowL" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.42"/>
      <stop offset="40%" stop-color="#000000" stop-opacity="0.20"/>
      <stop offset="75%" stop-color="#000000" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="groundShadowR" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.38"/>
      <stop offset="40%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="75%" stop-color="#000000" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="groundShadowAmbient" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.14"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadowBlur" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.5"/>
    </filter>

    <!-- 3D White Chassis & Head Shading -->
    <radialGradient id="headShading" cx="30%" cy="20%" r="80%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="35%" stop-color="#f8fafc"/>
      <stop offset="70%" stop-color="#e2e8f0"/>
      <stop offset="95%" stop-color="#94a3b8"/>
      <stop offset="100%" stop-color="#64748b"/>
    </radialGradient>

    <radialGradient id="torsoShading" cx="35%" cy="25%" r="75%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#f1f5f9"/>
      <stop offset="80%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </radialGradient>

    <radialGradient id="limbShading" cx="30%" cy="20%" r="70%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </radialGradient>

    <linearGradient id="fingerShading" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#f1f5f9"/>
      <stop offset="85%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>

    <!-- Dark Metal Joint Shading -->
    <linearGradient id="metalJoint" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#64748b"/>
      <stop offset="40%" stop-color="#334155"/>
      <stop offset="80%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- Vibrant Cyan Accent Rings & Glow -->
    <linearGradient id="cyanAccent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7dd3fc"/>
      <stop offset="50%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>

    <!-- Visor Screen -->
    <radialGradient id="visorScreen" cx="40%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="60%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#020617"/>
    </radialGradient>

    <!-- Glowing Cyan Face Filter -->
    <filter id="cyanGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3.5" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <style>
      /* 1. Periodic Expressive "Ishara" Gesture towards Email Box */
      @keyframes robotSuggestiveLoginGesture {
        0%, 55% {
          /* Default: looking straight at the user */
          transform: translate(0px, 0px);
        }
        60% {
          /* Quick lively glance towards the email box */
          transform: translate(22px, 12px);
        }
        67% {
          /* Expressive suggestive nod / ishara pulse */
          transform: translate(26px, 15px);
        }
        72% {
          transform: translate(22px, 12px);
        }
        82% {
          /* Hold glance at card */
          transform: translate(22px, 12px);
        }
        88%, 100% {
          /* Smoothly return to looking straight at the user */
          transform: translate(0px, 0px);
        }
      }

      /* 2. Head Tilt synchronized with the gesture */
      @keyframes headSuggestiveNod {
        0%, 55% {
          transform: rotate(0deg) translate(0px, 0px);
        }
        60% {
          transform: rotate(2.5deg) translate(5px, 2px);
        }
        67% {
          transform: rotate(4deg) translate(8px, 4px);
        }
        72%, 82% {
          transform: rotate(2.5deg) translate(5px, 2px);
        }
        88%, 100% {
          transform: rotate(0deg) translate(0px, 0px);
        }
      }

      /* 3. Natural Eye Blinking */
      @keyframes eyeBlinkCycle {
        0%, 25%, 31%, 56%, 80%, 86%, 92%, 100% {
          transform: scaleY(1);
          opacity: 1;
        }
        28%, 83% {
          /* Quick natural blink */
          transform: scaleY(0.08);
          opacity: 0.95;
        }
      }

      .rig-head-gesture {
        transform-origin: 225px 190px;
        animation: headSuggestiveNod 7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }

      .robo-face-gesture {
        transform-origin: 225px 135px;
        animation: robotSuggestiveLoginGesture 7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }

      .robo-eyes-blink {
        transform-origin: 225px 125px;
        animation: eyeBlinkCycle 7s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      }

      /* Live Input Focus State */
      .is-focused-input .rig-head-gesture {
        animation: none !important;
        transform: rotate(3deg) translate(6px, 3px) !important;
      }
      .is-focused-input .robo-face-gesture {
        animation: none !important;
        transform: translate(24px, 14px) !important;
      }
    </style>
  </defs>

  <!-- Soft Black Ground Contact Shadows -->
  <g class="ground-shadows-ambient">
    <ellipse cx="205" cy="510" rx="98" ry="15" fill="url(#groundShadowAmbient)"/>
  </g>
  <g class="ground-shadow-left">
    <!-- Diffuse soft black foot shadow -->
    <ellipse cx="140" cy="515" rx="56" ry="14" fill="url(#groundShadowL)"/>
    <!-- Direct sole contact black shadow -->
    <ellipse cx="143" cy="514" rx="42" ry="7" fill="#000000" opacity="0.32" filter="url(#shadowBlur)"/>
  </g>
  <g class="ground-shadow-right">
    <!-- Diffuse soft black foot shadow -->
    <ellipse cx="266" cy="505" rx="48" ry="12" fill="url(#groundShadowR)"/>
    <!-- Direct sole contact black shadow -->
    <ellipse cx="264" cy="503" rx="36" ry="6" fill="#000000" opacity="0.28" filter="url(#shadowBlur)"/>
  </g>

  <!-- ================= 1. RIGHT LEG ================= -->
  <g class="rig-leg-right">
    <circle cx="265" cy="328" r="14" fill="url(#metalJoint)"/>
    <circle cx="265" cy="328" r="7" fill="url(#cyanAccent)"/>
    <rect x="254" y="332" width="22" height="56" rx="10" fill="url(#limbShading)" stroke="#cbd5e1"/>

    <g class="rig-knee-right">
      <circle cx="265" cy="392" r="15" fill="url(#metalJoint)"/>
      <circle cx="265" cy="392" r="8" fill="url(#cyanAccent)"/>
      <path d="M 252 402 Q 248 442 252 472 L 278 468 Q 282 438 278 402 Z" fill="url(#limbShading)" stroke="#cbd5e1" stroke-width="1.5"/>
      <path d="M 256 426 Q 265 432 274 422" fill="none" stroke="#0ea5e9" stroke-width="3"/>

      <g class="rig-foot-right">
        <circle cx="258" cy="468" r="5" fill="#0ea5e9"/>
        <path d="M 244 472 L 288 466 Q 298 490 286 500 L 238 502 Q 232 485 244 472 Z" fill="url(#limbShading)" stroke="#cbd5e1"/>
        <path d="M 236 498 Q 262 508 288 497 L 288 503 Q 262 514 236 504 Z" fill="url(#cyanAccent)"/>
      </g>
    </g>
  </g>

  <!-- ================= 2. LEFT LEG ================= -->
  <g class="rig-leg-left">
    <circle cx="185" cy="328" r="15" fill="url(#metalJoint)"/>
    <circle cx="185" cy="328" r="8" fill="url(#cyanAccent)"/>
    <path d="M 174 334 L 146 388 Q 158 396 172 388 L 194 334 Z" fill="url(#limbShading)" stroke="#cbd5e1"/>

    <g class="rig-knee-left">
      <circle cx="158" cy="394" r="16" fill="url(#metalJoint)"/>
      <circle cx="158" cy="394" r="8.5" fill="url(#cyanAccent)"/>
      <path d="M 144 404 Q 130 448 128 482 L 166 476 Q 172 440 170 404 Z" fill="url(#torsoShading)" stroke="#cbd5e1" stroke-width="1.5"/>
      <path d="M 140 436 Q 152 444 162 432" fill="none" stroke="#0ea5e9" stroke-width="3"/>

      <g class="rig-foot-left">
        <circle cx="146" cy="472" r="5" fill="#0ea5e9"/>
        <path d="M 124 482 L 174 476 Q 186 502 174 512 L 112 514 Q 106 495 124 482 Z" fill="url(#headShading)" stroke="#cbd5e1"/>
        <path d="M 110 510 Q 142 522 174 508 L 174 515 Q 142 528 110 517 Z" fill="url(#cyanAccent)"/>
      </g>
    </g>
  </g>

  <!-- ================= 3. PELVIS & TORSO ================= -->
  <ellipse cx="225" cy="318" rx="38" ry="16" fill="url(#metalJoint)"/>
  <ellipse cx="225" cy="321" rx="30" ry="10" fill="url(#cyanAccent)"/>

  <g class="rig-torso">
    <path d="M 172 205 Q 158 245 168 295 Q 225 316 282 292 Q 292 240 276 205 Q 225 195 172 205 Z" fill="url(#torsoShading)" stroke="#cbd5e1" stroke-width="2"/>

    <circle cx="226" cy="242" r="20" fill="url(#metalJoint)" stroke="#cbd5e1" stroke-width="2"/>
    <circle cx="226" cy="242" r="16" fill="#ffffff" stroke="#0ea5e9" stroke-width="4.5"/>
    <circle cx="226" cy="242" r="10" fill="url(#torsoShading)"/>

    <g stroke="#334155" stroke-width="3.2" stroke-linecap="round">
      <line x1="210" y1="272" x2="242" y2="272"/>
      <line x1="212" y1="279" x2="240" y2="279"/>
      <line x1="216" y1="286" x2="236" y2="286"/>
    </g>

    <path d="M 170 225 Q 182 235 178 252" stroke="#0ea5e9" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <path d="M 278 225 Q 266 235 270 252" stroke="#0ea5e9" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  </g>

  <!-- ================= 4. CARD-HOLDING RIGHT HAND (4 FINGERS BEHIND CARD BACK) ================= -->
  <g class="rig-arm-card">
    <circle cx="280" cy="230" r="17" fill="url(#metalJoint)"/>
    <circle cx="280" cy="230" r="9" fill="url(#cyanAccent)"/>

    <path d="M 280 230 Q 312 240 338 250" stroke="url(#metalJoint)" stroke-width="16" stroke-linecap="round" fill="none"/>
    <path d="M 284 229 Q 312 239 336 249" stroke="url(#limbShading)" stroke-width="12" stroke-linecap="round" fill="none"/>

    <g class="rig-forearm-card">
      <circle cx="338" cy="250" r="14" fill="url(#metalJoint)"/>
      <circle cx="338" cy="250" r="7" fill="url(#cyanAccent)"/>

      <path d="M 338 250 Q 365 258 392 262" stroke="url(#metalJoint)" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M 338 250 Q 365 257 390 261" stroke="url(#limbShading)" stroke-width="12" stroke-linecap="round" fill="none"/>

      <g class="rig-hand-card">
        <ellipse cx="400" cy="262" rx="14" ry="10" fill="url(#metalJoint)" stroke="#cbd5e1" stroke-width="1.5"/>

        <!-- 4 REAR FINGERS BEHIND CARD -->
        <g class="finger-1">
          <rect x="396" y="222" width="10.5" height="38" rx="5.2" fill="url(#fingerShading)" stroke="#94a3b8" stroke-width="1.4"/>
          <ellipse cx="401.2" cy="226" rx="4.2" ry="5" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="2"/>
          <circle cx="400" cy="224" r="1.2" fill="#ffffff"/>
          <line x1="397" y1="244" x2="406" y2="244" stroke="#94a3b8" stroke-width="1.2"/>
        </g>

        <g class="finger-2">
          <rect x="408" y="214" width="11" height="46" rx="5.5" fill="url(#fingerShading)" stroke="#94a3b8" stroke-width="1.4"/>
          <ellipse cx="413.5" cy="218" rx="4.4" ry="5.2" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="2"/>
          <circle cx="412" cy="216" r="1.3" fill="#ffffff"/>
          <line x1="409" y1="240" x2="418.5" y2="240" stroke="#94a3b8" stroke-width="1.2"/>
        </g>

        <g class="finger-3">
          <rect x="420.5" y="220" width="10.5" height="40" rx="5.2" fill="url(#fingerShading)" stroke="#94a3b8" stroke-width="1.4"/>
          <ellipse cx="425.7" cy="224.5" rx="4.2" ry="5" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="2"/>
          <circle cx="424.5" cy="222.5" r="1.2" fill="#ffffff"/>
          <line x1="421.5" y1="243" x2="430.5" y2="243" stroke="#94a3b8" stroke-width="1.2"/>
        </g>

        <g class="finger-4">
          <rect x="432.5" y="228" width="9.5" height="32" rx="4.7" fill="url(#fingerShading)" stroke="#94a3b8" stroke-width="1.4"/>
          <ellipse cx="437.2" cy="232" rx="3.8" ry="4.5" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="1.8"/>
          <circle cx="436" cy="230.5" r="1" fill="#ffffff"/>
          <line x1="433.5" y1="248" x2="441" y2="248" stroke="#94a3b8" stroke-width="1.2"/>
        </g>

        <circle cx="390" cy="263" r="12" fill="url(#metalJoint)" stroke="#cbd5e1" stroke-width="1.5"/>
        <circle cx="390" cy="263" r="6" fill="url(#cyanAccent)"/>
      </g>
    </g>
  </g>

  <!-- ================= 5. CONFIDENT THUMBS-UP OUTER HAND ================= -->
  <g class="rig-arm-thumbsup">
    <circle cx="165" cy="225" r="18" fill="url(#metalJoint)"/>
    <circle cx="165" cy="225" r="9" fill="url(#cyanAccent)"/>

    <path d="M 165 225 L 108 266" stroke="url(#limbShading)" stroke-width="16" stroke-linecap="round"/>
    <path d="M 165 225 L 108 266" stroke="url(#metalJoint)" stroke-width="11" stroke-linecap="round"/>

    <g class="rig-forearm-thumbsup">
      <circle cx="106" cy="268" r="14" fill="url(#metalJoint)"/>
      <circle cx="106" cy="268" r="7" fill="url(#cyanAccent)"/>

      <path d="M 106 268 L 84 218" stroke="url(#limbShading)" stroke-width="17" stroke-linecap="round"/>
      <path d="M 104 246 L 94 242" stroke="#0ea5e9" stroke-width="3.5" stroke-linecap="round"/>

      <g class="rig-hand-thumbsup">
        <circle cx="84" cy="216" r="12" fill="url(#metalJoint)" stroke="#cbd5e1" stroke-width="1.6"/>

        <rect x="66" y="197" width="28" height="28" rx="8" fill="url(#headShading)" stroke="#94a3b8" stroke-width="1.8"/>
        <line x1="69" y1="204" x2="91" y2="204" stroke="#475569" stroke-width="2" stroke-linecap="round"/>
        <line x1="68" y1="211" x2="92" y2="211" stroke="#475569" stroke-width="2" stroke-linecap="round"/>
        <line x1="69" y1="218" x2="91" y2="218" stroke="#475569" stroke-width="2" stroke-linecap="round"/>
        <line x1="72" y1="199.5" x2="88" y2="199.5" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
        <line x1="72" y1="206.5" x2="88" y2="206.5" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
        <line x1="72" y1="213.5" x2="88" y2="213.5" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
        <line x1="72" y1="220.5" x2="88" y2="220.5" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>

        <path d="M 78 197 L 78 167 Q 78 160 84 160 Q 90 160 90 167 L 90 197 Z" fill="url(#headShading)" stroke="#94a3b8" stroke-width="1.8"/>
        <ellipse cx="84" cy="164" rx="5.5" ry="6.5" fill="url(#cyanAccent)" stroke="#38bdf8" stroke-width="1.4"/>
        <circle cx="82.5" cy="162" r="2" fill="#ffffff" opacity="0.9"/>
      </g>
    </g>
  </g>

  <!-- ================= 6. RIGGED HEAD WITH PERIODIC "ISHARA" GESTURE ================= -->
  <ellipse cx="225" cy="195" rx="24" ry="9" fill="url(#cyanAccent)"/>
  <ellipse cx="225" cy="190" rx="18" ry="7" fill="url(#metalJoint)"/>

  <g class="rig-head rig-head-gesture">
    <!-- Left Ear Pod -->
    <g class="ear-pod-left">
      <ellipse cx="134" cy="122" rx="18" ry="30" fill="url(#headShading)" stroke="#cbd5e1" stroke-width="2"/>
      <ellipse cx="134" cy="122" rx="10" ry="20" fill="url(#cyanAccent)"/>
      <circle cx="134" cy="122" r="6" fill="#0f172a"/>
    </g>

    <!-- Right Ear Pod -->
    <g class="ear-pod-right">
      <ellipse cx="316" cy="122" rx="18" ry="30" fill="url(#headShading)" stroke="#cbd5e1" stroke-width="2"/>
      <ellipse cx="316" cy="122" rx="10" ry="20" fill="url(#cyanAccent)"/>
      <circle cx="316" cy="122" r="6" fill="#0f172a"/>
    </g>

    <!-- Outer White Head Pod -->
    <path d="M 152 82 Q 225 60 298 82 Q 330 114 324 155 Q 308 196 225 196 Q 142 196 126 155 Q 120 114 152 82 Z" fill="url(#headShading)" stroke="#cbd5e1" stroke-width="2.5"/>

    <!-- Top Antenna / Cap Accent -->
    <path d="M 210 68 Q 225 64 240 68" stroke="#0ea5e9" stroke-width="4.5" fill="none" stroke-linecap="round"/>

    <!-- Cyan Visor Outer Frame -->
    <rect x="146" y="84" width="158" height="106" rx="36" fill="none" stroke="#0ea5e9" stroke-width="7"/>
    <!-- Deep Glass Visor Inner Screen -->
    <rect x="151" y="89" width="148" height="96" rx="31" fill="url(#visorScreen)" stroke="#0f172a" stroke-width="3"/>

    <!-- Visor Glass Diagonal Reflection -->
    <path d="M 164 96 Q 225 88 286 96 Q 272 120 286 134 Q 225 108 164 134 Z" fill="#ffffff" opacity="0.18"/>

    <!-- Glowing Cyan Face: Defaults to looking directly at USER, then periodic gesture towards card -->
    <g filter="url(#cyanGlow)">
      <g class="robo-face-gesture">
        <g class="robo-eyes-blink">
          <!-- Left Eye (Straightforward symmetrical cheerful arch looking at USER) -->
          <g class="eye-front-left">
            <path d="M 172 130 Q 188 108 204 130" fill="none" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M 172 130 Q 188 108 204 130" fill="none" stroke="#e0f2fe" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
            <!-- Bright Pupil Highlight looking directly at user -->
            <circle cx="188" cy="118" r="2.8" fill="#ffffff" opacity="0.95"/>
          </g>

          <!-- Right Eye (Straightforward symmetrical cheerful arch looking at USER) -->
          <g class="eye-front-right">
            <path d="M 246 130 Q 262 108 278 130" fill="none" stroke="#38bdf8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M 246 130 Q 262 108 278 130" fill="none" stroke="#e0f2fe" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
            <!-- Bright Pupil Highlight looking directly at user -->
            <circle cx="262" cy="118" r="2.8" fill="#ffffff" opacity="0.95"/>
          </g>
        </g>

        <!-- Symmetrical Friendly Smile -->
        <path d="M 205 156 Q 225 174 245 156" fill="none" stroke="#38bdf8" stroke-width="6.5" stroke-linecap="round"/>
        <path d="M 208 156 Q 225 170 242 156" fill="none" stroke="#e0f2fe" stroke-width="3.5" stroke-linecap="round" opacity="0.95"/>
      </g>
    </g>
  </g>
</svg>
            </div>
          </div>

          <!-- Exact Reference Login & Sign Up Card -->
          <div class="auth-card-stage" id="authCardStage">
            <!-- Front Thumb Firmly Clamping Over Front Face of Card (Compact & Proportional) -->
            <div class="robot-card-front-thumb" aria-hidden="true">
              <svg viewBox="0 0 50 28" width="44" height="24" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="thumbGradFront" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#ffffff"/>
                    <stop offset="35%" stop-color="#f8fafc"/>
                    <stop offset="70%" stop-color="#e2e8f0"/>
                    <stop offset="100%" stop-color="#94a3b8"/>
                  </linearGradient>
                  <linearGradient id="metalJointFront" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#64748b"/>
                    <stop offset="40%" stop-color="#334155"/>
                    <stop offset="100%" stop-color="#0f172a"/>
                  </linearGradient>
                  <filter id="thumbDropShadow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.22"/>
                  </filter>
                </defs>
                <g filter="url(#thumbDropShadow)">
                  <!-- Dark metal wrist/knuckle ring connecting to robot arm -->
                  <rect x="0" y="6" width="10" height="15" rx="4" fill="url(#metalJointFront)" stroke="#cbd5e1" stroke-width="1"/>
                  <circle cx="5" cy="13.5" r="3" fill="#0ea5e9"/>

                  <!-- Compact Glossy White Robot Thumb Capsule -->
                  <rect x="6" y="7" width="34" height="13" rx="6.5" fill="url(#thumbGradFront)" stroke="#94a3b8" stroke-width="1.3"/>
                  <!-- Top specular white highlight -->
                  <line x1="10" y1="10" x2="33" y2="10" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>
                  <!-- Thumb joint knuckle line -->
                  <line x1="20" y1="7.5" x2="20" y2="19.5" stroke="#cbd5e1" stroke-width="1"/>
                  <!-- Luminous Cyan Thumb Tip Ring Sensor -->
                  <ellipse cx="33" cy="13.5" rx="3" ry="4.2" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="1.6"/>
                  <circle cx="32" cy="12.2" r="1.1" fill="#ffffff"/>
                </g>
              </svg>
            </div>
            <div class="auth-card-3d">

              <!-- Brand Header matching reference with Darkness logo & wordmark -->
              <div class="auth-card-header">
                <div class="auth-brand-badge">
                  <img src="/brand/darkness-logo.svg" alt="Darkness AI" class="auth-brand-logo" />
                  <span class="auth-brand-title">Darkness</span>
                </div>
              </div>

              <!-- Pill Tabs: Sign in & Create account -->
              <div class="auth-card-tabs" role="tablist">
                <button class="auth-card-tab is-active" type="button" data-tab="login" role="tab" aria-selected="true">Sign in</button>
                <button class="auth-card-tab" type="button" data-tab="signup" role="tab" aria-selected="false">Create account</button>
              </div>

              <!-- Interactive Form -->
              <form id="authForm" class="auth-card-form" autocomplete="on">
                <div class="auth-input-group" data-show="signup" hidden>
                  <label for="authName">Full Name</label>
                  <div class="auth-input-wrap">
                    <input type="text" id="authName" name="name" autocomplete="name" placeholder="John Doe" />
                  </div>
                </div>

                <div class="auth-input-group">
                  <label for="authEmail">Email</label>
                  <div class="auth-input-wrap">
                    <input type="email" id="authEmail" name="email" required autocomplete="email" placeholder="you@example.com" />
                  </div>
                </div>

                <div class="auth-input-group">
                  <label for="authPassword">Password</label>
                  <div class="auth-input-wrap">
                    <input type="password" id="authPassword" name="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters" />
                  </div>
                </div>

                <div class="auth-error-badge" id="authError" hidden></div>

                <button class="btn btn--primary auth-action-btn" type="submit" id="authSubmit">
                  <span>Sign in</span>
                </button>
              </form>

              <div class="auth-card-footer">
                <span>Secure access to your AI workspace & projects</span>
              </div>

            </div>
          </div>

        </div>
      </div>
    `;

    this._bindFormEvents();
  },

  _bindFormEvents() {
    const form = document.getElementById("authForm");
    const errEl = document.getElementById("authError");
    const submit = document.getElementById("authSubmit");
    const nameGroup = form ? form.querySelector('[data-show="signup"]') : null;
    if (!form || !submit) return;

    // Tab Switching: Login vs Signup
    const setMode = (mode) => {
      submit.querySelector("span").textContent = mode === "login" ? "Sign in" : "Create account";
      if (nameGroup) nameGroup.hidden = mode !== "signup";
      if (form.elements.email) form.elements.email.autocomplete = mode === "login" ? "email" : "email";
      if (form.elements.password) form.elements.password.autocomplete = mode === "login" ? "current-password" : "new-password";
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = "";
      }
    };

    document.querySelectorAll(".auth-card-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        document.querySelectorAll(".auth-card-tab").forEach(b => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", String(active));
        });
        setMode(tab);
      });
    });

    // Interactive Robot Eye Tracking: Glance towards form inputs on focus
    const robotStandingWrap = document.querySelector('.auth-robot-standing-wrap');
    const authInputs = form.querySelectorAll('input');
    authInputs.forEach(input => {
      input.addEventListener('focus', () => {
        if (robotStandingWrap) robotStandingWrap.classList.add('is-focused-input');
      });
      input.addEventListener('blur', () => {
        if (robotStandingWrap) robotStandingWrap.classList.remove('is-focused-input');
      });
    });

    // Form Submission
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (errEl) errEl.hidden = true;
      submit.disabled = true;
      submit.classList.add("is-loading");

      const activeTab = document.querySelector(".auth-card-tab.is-active");
      const mode = activeTab ? activeTab.getAttribute("data-tab") : "login";
      const fd = new FormData(form);
      const payload = {
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || ""),
        name: String(fd.get("name") || "").trim(),
      };

      try {
        if (mode === "signup") {
          await window.Darkness.auth.signup(payload.email, payload.password, payload.name);
        } else {
          await window.Darkness.auth.login(payload.email, payload.password);
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || "Authentication failed";
          errEl.hidden = false;
        }
        submit.disabled = false;
        submit.classList.remove("is-loading");
        return;
      }

      submit.disabled = false;
      submit.classList.remove("is-loading");

      // Clear gate and navigate into workspace
      window.Darkness.app && window.Darkness.app.afterLogin && window.Darkness.app.afterLogin();
    });
  }
};
