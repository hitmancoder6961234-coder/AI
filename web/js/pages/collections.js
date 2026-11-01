window.Clarity = window.Clarity || {};
window.Clarity.pages = window.Clarity.pages || {};

window.Clarity.pages.collections = async function renderCollectionsPage() {
  const main = document.getElementById('main');
  if (!main) return;

  let files = [];
  try {
    const data = await window.Clarity.api.get("/api/files/shared");
    files = data.files || [];
  } catch (e) {}

  const groups = {};
  for (const f of files) {
    const key = f.file_type || 'other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  const groupOrder = ['document', 'image', 'code', 'spreadsheet', 'archive', 'other'];
  const allKeys = Object.keys(groups);
  const ordered = groupOrder.filter(k => groups[k]).concat(allKeys.filter(k => !groupOrder.includes(k)));

  const groupLabels = {
    document: '📄 Documents',
    image: '🖼 Images',
    code: '💻 Code',
    spreadsheet: '📊 Spreadsheets',
    archive: '🗜 Archives',
    other: '📁 Other',
  };

  main.innerHTML = [
    '<div class="page"><div class="page__inner">',
    '<header class="page__header">',
      '<div><h1 class="page__title">Collections</h1>',
      '<p class="page__subtitle">Your knowledge automatically grouped by type. Use this view to scan and manage everything in one place.</p></div>',
      '<a class="btn btn--primary" href="#/knowledge">Upload</a>',
    '</header>',
    '<section class="collection-grid">',
    ordered.length === 0
      ? '<div class="empty-state">No files yet. <a href="#/knowledge">Upload documents</a> to create collections.</div>'
      : ordered.map(k => collectionCardHtml(k, groupLabels[k] || k, groups[k])).join(''),
    '</section>',
    '</div></div>'
  ].join('');
};

function collectionCardHtml(key, label, items) {
  return '<article class="collection-card" data-collection="' + key + '">' +
    '<div class="collection-card__top">' +
      '<div class="collection-card__icon">' + (label.split(' ')[0] || '📁') + '</div>' +
      '<span class="tag">' + window.Clarity.utils.escapeHtml(items.length + ' item' + (items.length === 1 ? '' : 's')) + '</span>' +
    '</div>' +
    '<div><h3>' + window.Clarity.utils.escapeHtml(label.replace(/^[^ ]+ /, '')) + '</h3>' +
    '<div class="collection-card__meta">' + items.slice(0, 4).map(f => window.Clarity.utils.escapeHtml(f.filename)).join(', ') + (items.length > 4 ? ', …' : '') + '</div></div>' +
    '<div class="spread"><a class="btn btn--outline btn--sm" href="#/knowledge">View all</a></div>' +
  '</article>';
}

