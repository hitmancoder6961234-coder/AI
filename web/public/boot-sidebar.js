/* Restores the collapsed-sidebar preference before first paint. This used to be an inline <script>; it is a file so the
 * Content-Security-Policy can forbid inline scripts altogether. */
(function () {
  try {
    if (window.innerWidth >= 1024 && localStorage.getItem('darkness_sidebar_rail') === 'true') {
      document.addEventListener('DOMContentLoaded', function () {
        var sb = document.getElementById('sidebar');
        if (sb) sb.classList.add('is-rail');
      });
    }
  } catch (e) {}
})();
