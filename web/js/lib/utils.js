window.Clarity = window.Clarity || {};

const _MIME_BY_EXT = {
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.jsx': 'text/javascript',
  '.tsx': 'text/typescript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.sql': 'application/sql',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-cpp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby',
  '.php': 'text/x-php',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.ps1': 'text/x-powershell',
  '.bat': 'text/x-batch',
};

window.Clarity.utils = {
  MIME_BY_EXT: _MIME_BY_EXT,

  getMimeType(ext) {
    return _MIME_BY_EXT[ext.toLowerCase()] || 'text/plain';
  },

  getExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(lastDot) : '';
  },

  qs(selector, parent) {
    return (parent || document).querySelector(selector);
  },
  qsa(selector, parent) {
    return Array.from((parent || document).querySelectorAll(selector));
  },
  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (char) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return map[char] || char;
    });
  },
  createTag(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  },
  formatDate(value) {
    if (!value) return 'Today';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
  },
  truncate(text, maxLength) {
    const value = String(text || '').trim();
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - 1)) + '…';
  },
  safeJson(data, fallback) {
    try {
      return JSON.parse(data || 'null') ?? fallback;
    } catch (error) {
      return fallback;
    }
  },
  routeFromHash() {
    const hash = (window.location.hash || '#/chat').trim();
    return hash.startsWith('#') ? hash : '#' + hash;
  },
  uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
  }
};

