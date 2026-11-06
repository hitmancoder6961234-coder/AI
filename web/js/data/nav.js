window.Darkness = window.Darkness || {};

/**
 * Navigation configuration.
 * Every entry here maps to a real implemented route in js/app.js.
 */
window.Darkness.data = {
  nav: [
    { id: 'home', label: 'Overview', href: '#/home', icon: 'house', group: 'Workspace' },
    { id: 'chat', label: 'Chat', href: '#/chat', icon: 'chat', group: 'Workspace' },
    { id: 'copilot', label: 'Copilot', href: '/copilot.html', icon: 'zap', group: 'Workspace' },
    { id: 'history', label: 'History', href: '#/history', icon: 'clock', group: 'Workspace' },

    { id: 'builder', label: 'Project Studio', href: '#/builder', icon: 'sparkles', group: 'Create' },
    { id: 'document-studio', label: 'Word Studio', href: '#/document-studio', icon: 'file-text', group: 'Create' },
    { id: 'presentation-studio', label: 'Slide Studio', href: '#/presentation-studio', icon: 'monitor', group: 'Create' },
    { id: 'agent', label: 'Agent', href: '/agent.html', icon: 'bot', group: 'Create' },
    { id: 'prompts', label: 'Prompt Studio', href: '#/prompts', icon: 'wand', group: 'Create' },
    { id: 'agents', label: 'Agent workflow', href: '#/agents', icon: 'network', group: 'Create' },

    { id: 'knowledge', label: 'My Library', href: '#/knowledge', icon: 'book', group: 'Knowledge' },
    { id: 'project', label: 'Projects', href: '#/project', icon: 'folder', group: 'Knowledge' },

    { id: 'usage', label: 'Usage', href: '#/usage', icon: 'chart', group: 'Manage' },
    { id: 'memory', label: 'Memory', href: '#/memory', icon: 'brain', group: 'Manage' },
    { id: 'compare', label: 'Compare models', href: '#/compare', icon: 'columns', group: 'Manage' },
    { id: 'system', label: 'System status', href: '#/system', icon: 'activity', group: 'Manage' },
    { id: 'model', label: 'Models', href: '#/model', icon: 'cpu', group: 'Manage' },
    { id: 'classic', label: 'Classic Darkness', href: '/classic/', icon: 'globe', group: 'Manage' }
  ],
  secondaryNav: [
    { id: 'account', label: 'Account', href: '#/account', icon: 'user' },
    { id: 'settings', label: 'Settings', href: '#/settings', icon: 'gear' }
  ]
};
