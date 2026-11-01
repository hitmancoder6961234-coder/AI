window.Darkness = window.Darkness || {};

/**
 * Navigation configuration.
 * Every entry here maps to a real implemented route in js/app.js.
 */
window.Darkness.data = {
  nav: [
    { id: 'chat', label: 'Chat', href: '#/chat', icon: 'chat' },
    { id: 'home', label: 'Home', href: '#/home', icon: 'house' },
    { id: 'document-studio', label: 'Word Studio', href: '#/document-studio', icon: 'file-text' },
    { id: 'presentation-studio', label: 'Slide Studio', href: '#/presentation-studio', icon: 'monitor' },
    { id: 'knowledge', label: 'My Library', href: '#/knowledge', icon: 'book' },
    { id: 'project', label: 'Projects', href: '#/project', icon: 'folder' },
    { id: 'history', label: 'History', href: '#/history', icon: 'clock' }
  ],
  secondaryNav: [
    { id: 'model', label: 'Model', href: '#/model', icon: 'cpu' },
    { id: 'settings', label: 'Settings', href: '#/settings', icon: 'gear' }
  ]
};
