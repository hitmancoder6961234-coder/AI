window.Clarity = window.Clarity || {};

window.Clarity.uiTooltip = (function () {
  let activeTip = null;
  let hideTimer = null;
  let currentTarget = null;
  let onScrollOrResize = null;

  function create() {
    const el = document.createElement("div");
    el.className = "ui-tip";
    el.setAttribute("role", "tooltip");
    el.setAttribute("data-placement", "right");
    document.body.appendChild(el);
    return el;
  }

  function clear() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (activeTip) {
      activeTip.classList.remove("is-visible");
    }
    if (onScrollOrResize) {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      onScrollOrResize = null;
    }
    currentTarget = null;
  }

  function position(tip, target, placement) {
    if (!tip || !target || !tip.style) return;
    const r = target.getBoundingClientRect();
    const tipR = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 10;

    let top_y = 0, left = 0;
    let actualPlacement = placement;

    // Try the requested placement, but flip if it would overflow.
    const candidates = [placement, "right", "left", "top", "bottom"];
    for (const p of candidates) {
      const pt = computePlacement(r, tipR, p, gap);
      if (pt.top >= 4 && pt.left >= 4 && pt.top + tipR.height <= vh - 4 && pt.left + tipR.width <= vw - 4) {
        top_y = pt.top;
        left = pt.left;
        actualPlacement = p;
        break;
      }
    }
    if (left === 0 && top_y === 0) {
      // none fit cleanly; default to right anyway, clamped.
      const pt = computePlacement(r, tipR, "right", gap);
      left = Math.max(4, Math.min(pt.left, vw - tipR.width - 4));
      top_y = Math.max(4, Math.min(pt.top, vh - tipR.height - 4));
      actualPlacement = "right";
    }

    tip.style.top = top_y + "px";
    tip.style.left = left + "px";
    tip.setAttribute("data-placement", actualPlacement);
  }

  function computePlacement(r, tipR, placement, gap) {
    let top_y = 0, left = 0;
    if (placement === "right") {
      left = r.right + gap;
      top_y = r.top + r.height / 2 - tipR.height / 2;
    } else if (placement === "left") {
      left = r.left - gap - tipR.width;
      top_y = r.top + r.height / 2 - tipR.height / 2;
    } else if (placement === "top") {
      left = r.left + r.width / 2 - tipR.width / 2;
      top_y = r.top - gap - tipR.height;
    } else if (placement === "bottom") {
      left = r.left + r.width / 2 - tipR.width / 2;
      top_y = r.bottom + gap;
    }
    return { top: top_y, left };
  }

  function show(target, text, opts = {}) {
    if (!target || !text) return;
    if (window.innerWidth < 1024 || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) return;
    if (!activeTip) activeTip = create();
    if (!activeTip || !activeTip.style) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    currentTarget = target;
    activeTip.textContent = text;
    activeTip.style.maxWidth = (opts.maxWidth || 320) + "px";
    // Allow measurement before positioning.
    activeTip.style.top = "0px";
    activeTip.style.left = "0px";
    activeTip.classList.add("is-visible");
    requestAnimationFrame(() => {
      position(activeTip, target, opts.placement || "right");
    });

    onScrollOrResize = () => {
      if (currentTarget && activeTip) {
        position(activeTip, currentTarget, activeTip.getAttribute("data-placement") || "right");
      }
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
  }

  function scheduleHide(delay = 80) {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      clear();
    }, delay);
  }

  function shouldShow(el) {
    if (window.innerWidth < 1024) return false;
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return false;
    const sidebar = el.closest(".sidebar");
    if (sidebar && sidebar.classList.contains("is-rail")) return true;
    // For elements outside the sidebar (e.g. topbar avatar), show on desktop only.
    if (!sidebar) return true;
    return false;
  }

  function bind(el, opts = {}) {
    if (!el) return;
    if (el.getAttribute("data-tip-bound") === "1") return;
    el.setAttribute("data-tip-bound", "1");
    if (el.getAttribute("title")) {
      el.removeAttribute("title");
    }
    el.addEventListener("mouseenter", () => {
      if (!shouldShow(el)) return;
      show(el, opts.text || el.getAttribute("data-tooltip") || el.getAttribute("aria-label") || el.getAttribute("title") || "", opts);
    });
    el.addEventListener("mouseleave", () => {
      scheduleHide();
    });
    el.addEventListener("focus", () => {
      if (!shouldShow(el)) return;
      show(el, opts.text || el.getAttribute("data-tooltip") || el.getAttribute("aria-label") || el.getAttribute("title") || "", opts);
    });
    el.addEventListener("blur", () => {
      scheduleHide();
    });
  }

  // Auto-bind any element marked with data-tooltip, but ONLY when the sidebar
  // is collapsed (rail mode). This avoids showing duplicates when labels are
  // visible next to the icon.
  function bindSidebar(sidebarEl) {
    if (!sidebarEl) return;
    const items = sidebarEl.querySelectorAll("[data-tooltip]");
    items.forEach((el) => bind(el, { placement: "right" }));
  }

  function refresh(sidebarEl) {
    if (!activeTip) return;
    clear();
  }

  return { bind, bindSidebar, show, scheduleHide, clear, refresh };
})();
