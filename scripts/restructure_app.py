"""
Restructure index.html from a long-scroll landing page into a
ChatGPT-style app with:
  - Fixed left sidebar (logo, menu, auth buttons)
  - Page-based navigation (show/hide sections)
  - ChatGPT-style home (centered greeting + mode tabs + input + suggestions)

Transformations:
  1. Replace the <nav class="nav"> block with sidebar HTML + <main class="app-main">
  2. Add class="app-page" + data-page="..." to each section
  3. Add class="active" to home elements (hero, stats, cta, footer)
  4. Close </main> before <script>
  5. Replace hero content with ChatGPT-style home layout
"""
from pathlib import Path

HTML_PATH = Path('/home/z/my-project/index.html')
html = HTML_PATH.read_text()

# ── 1. Replace nav block with sidebar + open main ──────────────────────
nav_start_marker = '<!-- ===== NAVIGATION ===== -->'
hero_marker = '<!-- ===== HERO ===== -->'
nav_start = html.index(nav_start_marker)
hero_start = html.index(hero_marker)

SIDEBAR_HTML = """<!-- ===== SIDEBAR (ChatGPT-style app navigation) ===== -->
<button class="mobile-menu-toggle" id="mobileMenuToggle" aria-label="Open menu">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
</button>
<aside class="app-sidebar" id="appSidebar">
  <div class="sidebar-header">
    <a href="#" class="sidebar-logo" data-page="home">
      <span class="logo-mark"></span>
      <span>DARKNESS</span>
    </a>
    <button class="sidebar-close" id="sidebarClose" aria-label="Close menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>

  <button class="sidebar-new-chat" data-page="home">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    New Chat
  </button>

  <nav class="sidebar-menu">
    <div class="sidebar-menu-label">Navigation</div>
    <a href="#" class="sidebar-item active" data-page="home">
      <span class="si-icon">🏠</span>
      <span class="si-label">Home</span>
    </a>
    <a href="#" class="sidebar-item" data-page="capabilities">
      <span class="si-icon">⚡</span>
      <span class="si-label">Capabilities</span>
    </a>
    <a href="#" class="sidebar-item" data-page="orchestrator">
      <span class="si-icon">🔀</span>
      <span class="si-label">Multi-AI</span>
    </a>
    <a href="#" class="sidebar-item" data-page="think">
      <span class="si-icon">🧠</span>
      <span class="si-label">Think Modes</span>
    </a>
    <a href="#" class="sidebar-item" data-page="chat">
      <span class="si-icon">💬</span>
      <span class="si-label">AI Assistant</span>
    </a>
    <a href="#" class="sidebar-item" data-page="workflow">
      <span class="si-icon">📋</span>
      <span class="si-label">Workflow</span>
    </a>
    <a href="#" class="sidebar-item" data-page="engine">
      <span class="si-icon">🎯</span>
      <span class="si-label">Idea Engine</span>
    </a>
    <a href="#" class="sidebar-item" data-page="github">
      <span class="si-icon">🐙</span>
      <span class="si-label">GitHub Push</span>
    </a>
    <a href="#" class="sidebar-item" data-page="ppt">
      <span class="si-icon">📊</span>
      <span class="si-label">PPT Studio</span>
    </a>
  </nav>

  <div class="sidebar-footer">
    <button class="sidebar-footer-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Settings
    </button>
    <div class="sidebar-auth">
      <button class="btn btn-ghost btn-sm">Sign in</button>
      <button class="btn btn-primary btn-sm">Get Started</button>
    </div>
  </div>
</aside>
<div class="sidebar-overlay" id="sidebarOverlay"></div>

<main class="app-main">

<!-- ===== HERO ===== -->"""

html = html[:nav_start] + SIDEBAR_HTML + html[hero_start + len(hero_marker):]

# ── 2. Add app-page + data-page classes to each section ────────────────
replacements = [
    # Hero → home page (active)
    ('<section class="hero">',
     '<section class="hero app-page active" data-page="home">'),

    # Stats → home page (active)
    ('<div class="stats">',
     '<div class="stats app-page active" data-page="home">'),

    # Capabilities
    ('<section id="capabilities">',
     '<section id="capabilities" class="app-page" data-page="capabilities">'),

    # Multi-AI Orchestrator
    ('<section class="feature-section feature-section-orch" id="orchestrator">',
     '<section class="feature-section feature-section-orch app-page" id="orchestrator" data-page="orchestrator">'),

    # Think Modes
    ('<section class="feature-section feature-section-think" id="think">',
     '<section class="feature-section feature-section-think app-page" id="think" data-page="think">'),

    # AI Assistant
    ('<section class="feature-section feature-section-chat" id="chat">',
     '<section class="feature-section feature-section-chat app-page" id="chat" data-page="chat">'),

    # Workflow
    ('<section class="workflow" id="workflow">',
     '<section class="workflow app-page" id="workflow" data-page="workflow">'),

    # Idea Engine
    ('<section class="engine" id="engine">',
     '<section class="engine app-page" id="engine" data-page="engine">'),

    # GitHub
    ('<section class="feature-section" id="github">',
     '<section class="feature-section app-page" id="github" data-page="github">'),

    # PPT Studio
    ('<section class="feature-section feature-section-alt" id="ppt">',
     '<section class="feature-section feature-section-alt app-page" id="ppt" data-page="ppt">'),

    # CTA → home page (active)
    ('<section class="cta">',
     '<section class="cta app-page active" data-page="home">'),

    # Footer → home page (active)
    ('<footer>',
     '<footer class="app-page active" data-page="home">'),
]

for old, new in replacements:
    if old not in html:
        print(f'WARNING: Could not find: {old[:60]}')
    else:
        html = html.replace(old, new, 1)

# ── 3. Close </main> before <script> ───────────────────────────────────
html = html.replace('</footer>\n\n<script>', '</footer>\n</main>\n\n<script>')

HTML_PATH.write_text(html)
print('Structural changes applied. File size:', len(html), 'chars')
