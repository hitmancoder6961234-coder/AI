window.Clarity = window.Clarity || {};
window.Clarity.pages = window.Clarity.pages || {};

window.Clarity.pages.home = async function renderHomePage() {
  const main = document.getElementById('main');
  if (!main) return;

  let conversations = [];
  let filesCount = 0;
  let projectsCount = 0;
  try {
    const c = await window.Clarity.api.get("/api/conversations");
    conversations = (c.conversations || []).slice(0, 5);
  } catch (e) {}
  try {
    const f = await window.Clarity.api.get("/api/files/shared");
    filesCount = (f.files || []).length;
  } catch (e) {}
  try {
    const p = await window.Clarity.api.get("/api/projects");
    projectsCount = (p.projects || []).length;
  } catch (e) {}

  const metrics = [
    { label: "Conversations", value: String(conversations.length) },
    { label: "Knowledge files", value: String(filesCount) },
    { label: "Projects", value: String(projectsCount) },
    { label: "Active model", value: (window.Clarity.modelSelector && window.Clarity.modelSelector.getActive()?.name) || "—" },
  ];

  main.innerHTML = [
    '<div class="page"><div class="page__inner">',
    '<header class="page__header"><div><h1 class="page__title">Welcome back</h1><p class="page__subtitle">Your knowledge workspace is ready for grounded answers.</p></div>',
    '<a class="btn btn--primary" href="#/chat">Open chat</a></header>',
    '<section class="hero card"><div class="card__body">',
      '<h1>Ask your knowledge with grounded context.</h1>',
      '<p class="hero__sub">Search across your documents, review recent activity, and ask follow-up questions with references to the most relevant sources.</p>',
      '<div class="hstack" style="margin-top:16px; gap:12px;">',
        '<a class="btn btn--primary" href="#/knowledge">Upload documents</a>',
        '<a class="btn btn--outline" href="#/project">Analyze a project</a>',
        '<a class="btn btn--outline" href="#/model">Manage models</a>',
      '</div>',
    '</div></section>',
    '<section class="metrics">',
    metrics.map(m => '<article class="metric card"><div class="card__body"><div class="metric__label">' + window.Clarity.utils.escapeHtml(m.label) + '</div><div class="metric__value">' + window.Clarity.utils.escapeHtml(m.value) + '</div></div></article>').join(''),
    '</section>',
    '<section class="grid-2">',
      '<div class="panel"><div class="panel__body">',
        '<div class="panel__head"><h2>Recent chats</h2><a class="muted" href="#/history">All</a></div>',
        conversations.length === 0
          ? '<div class="empty-state">No conversations yet. <a href="#/chat">Start a new chat</a>.</div>'
          : '<div class="list" style="margin-top:12px;">' + conversations.map(conv => recentChatHtml(conv)).join('') + '</div>',
      '</div></div>',
      '<div class="panel"><div class="panel__body">',
        '<h2>Darkness AI Document & Slide Workspace</h2><div class="list" style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">',
          '<div class="list__item" style="border-left: 4px solid var(--accent);"><div><div class="knowledge-item__title">Word Document Studio</div><div class="knowledge-item__desc">Write, edit, and draft professional Word reports & manuals.</div></div><a class="btn btn--primary btn--sm" href="#/document-studio" style="background:var(--accent); border-color:var(--accent);">Open Studio</a></div>',
          '<div class="list__item" style="border-left: 4px solid #f43f5e;"><div><div class="knowledge-item__title">PowerPoint Presentation Studio</div><div class="knowledge-item__desc">Design, preview, and export high-impact pitch decks.</div></div><a class="btn btn--primary btn--sm" href="#/presentation-studio" style="background:#f43f5e; border-color:#f43f5e;">Open Studio</a></div>',
        '</div><h2 style="margin-top:20px;">Quick actions</h2><div class="list" style="margin-top:12px;">',
          '<div class="list__item"><div><div class="knowledge-item__title">Upload knowledge</div><div class="knowledge-item__desc">Bring in documents for grounded answers.</div></div><a class="btn btn--outline btn--sm" href="#/knowledge">Upload</a></div>',
          '<div class="list__item"><div><div class="knowledge-item__title">Analyze a project</div><div class="knowledge-item__desc">Upload a ZIP and chat about the code.</div></div><a class="btn btn--outline btn--sm" href="#/project">Open</a></div>',
          '<div class="list__item"><div><div class="knowledge-item__title">Add a model</div><div class="knowledge-item__desc">Configure your own provider or API key.</div></div><a class="btn btn--outline btn--sm" href="#/model">Configure</a></div>',
        '</div></div></div>',
    '</section>',
    '</div></div>'
  ].join('');

  document.querySelectorAll('[data-open-conv]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.getAttribute('data-open-conv');
      window.location.hash = '#/chat/' + id;
    });
  });
};

function recentChatHtml(conv) {
  let title = conv.title || '';
  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }
  return '<a class="list__item" href="#/chat/' + conv.id + '" data-open-conv="' + conv.id + '" style="text-decoration:none;color:inherit;">' +
    '<div><div class="knowledge-item__title">' + window.Clarity.utils.escapeHtml(title || "New conversation") + '</div>' +
    '<div class="knowledge-item__desc">' + window.Clarity.utils.escapeHtml(String(conv.message_count || 0) + ' message' + (conv.message_count === 1 ? '' : 's')) + '</div></div>' +
    '<span class="tag">Open</span></a>';
}

