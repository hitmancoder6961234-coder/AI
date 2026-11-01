window.Darkness = window.Darkness || {};
window.Darkness.dom = {
  empty(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  },
  html(node, markup) {
    if (!node) return;
    node.innerHTML = markup;
  },
  append(node, child) {
    if (!node || !child) return;
    node.appendChild(child);
  }
};
