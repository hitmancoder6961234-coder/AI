import React from "react";

export default function App() {
  return React.createElement(
    "div",
    { className: "app-root-vite", id: "app", hidden: true },
    React.createElement(
      "aside",
      { className: "sidebar", id: "sidebar", "aria-label": "Sidebar" },
      React.createElement(
        "div",
        { className: "sidebar__head" },
        React.createElement(
          "a",
          { className: "brand", href: "#/", "data-nav-home": true },
          React.createElement(
            "span",
            { className: "brand__mark", "aria-hidden": true },
            React.createElement(
              "img",
              {
                className: "brand__mark-img brand__mark-img--light",
                src: "/brand/darkness-logo.svg",
                alt: "",
              }
            ),
            React.createElement(
              "img",
              {
                className: "brand__mark-img brand__mark-img--dark",
                src: "/brand/darkness-logo.svg",
                alt: "",
              }
            )
          ),
          React.createElement("span", { className: "brand__name" }, "Darkness")
        ),
        React.createElement(
          "button",
          {
            className: "btn btn--ghost btn--icon-sm sidebar__collapse",
            id: "sidebarCollapse",
            type: "button",
            title: "Collapse sidebar",
            "data-tooltip": "Collapse sidebar",
            "aria-label": "Collapse sidebar",
          },
          React.createElement(
            "span",
            { className: "sr-only" },
            "Collapse sidebar"
          ),
          React.createElement(
            "svg",
            {
              className: "icon",
              viewBox: "0 0 24 24",
              width: "16",
              height: "16",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: "2",
              strokeLinecap: "round",
              strokeLinejoin: "round",
              "aria-hidden": true,
            },
            React.createElement("rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }),
            React.createElement("path", { d: "M9 3v18" }),
            React.createElement("path", { d: "m14 9 3 3-3 3" })
          )
        )
      ),
      React.createElement(
        "div",
        { className: "sidebar__scroll", id: "sidebarScroll" },
        React.createElement(
          "div",
          { className: "chat-sidebar__new", style: { padding: "0 var(--s-3) var(--s-2)" } },
          React.createElement(
            "button",
            {
              className: "btn btn--primary btn--sm w-full",
              id: "sidebarNewChat",
              type: "button",
              "data-tooltip": "New chat",
              title: "New chat",
              "aria-label": "New chat",
            },
            React.createElement(
              "svg",
              {
                className: "icon",
                viewBox: "0 0 24 24",
                "aria-hidden": true,
                style: { width: "16px", height: "16px", flex: "none" },
              },
              React.createElement("path", { d: "M12 5v14M5 12h14" })
            ),
            React.createElement("span", {}, "New chat")
          ),
        React.createElement("nav", { className: "nav", id: "primaryNav", "aria-label": "Main" }),
        React.createElement(
          "div",
          { className: "nav-section" },
          React.createElement(
            "div",
            { className: "nav-section__head" },
            React.createElement("span", { className: "nav-section__title" }, "Recent"),
            React.createElement(
              "a",
              { className: "nav-section__link", href: "#/history" },
              "All"
            )
          ),
          React.createElement("ul", { className: "recent", id: "recentList" })
        ),
        React.createElement(
          "div",
          { className: "sidebar__foot" },
          React.createElement("nav", { className: "nav", id: "secondaryNav", "aria-label": "Secondary" })
        )
      ),
      React.createElement("div", { className: "scrim", id: "scrim", hidden: true }),
      React.createElement(
        "div",
        { className: "shell" },
        React.createElement(
          "header",
          { className: "topbar" },
          React.createElement(
            "button",
            {
              className: "btn btn--ghost btn--icon-sm topbar__burger",
              id: "topbarBurger",
              type: "button",
              title: "Open navigation",
              "aria-label": "Open navigation",
            },
            React.createElement(
              "svg",
              {
                className: "icon",
                viewBox: "0 0 24 24",
                "aria-hidden": true,
              },
              React.createElement("path", { d: "M3 6h18M3 12h18M3 18h18" })
            )
          ),
          React.createElement(
            "div",
            { className: "crumbs" },
            React.createElement("span", { className: "crumbs__root" }, "Darkness"),
            React.createElement("span", { className: "crumbs__ctx", id: "crumbContext" })
          ),
          React.createElement(
            "div",
            { className: "topbar__right" },
            React.createElement(
              "div",
              {
                className: "model-chip",
                id: "modelChip",
                title: "Active model",
                role: "button",
                tabIndex: 0,
                "aria-haspopup": "listbox",
              },
              React.createElement("span", { className: "model-chip__name", id: "modelChipLabel" }, "Loading…")
            ),
            React.createElement(
              "div",
              { className: "dropdown", id: "modelDropdown" },
              React.createElement(
                "div",
                { className: "dropdown__menu", id: "modelSelectorDropdown", role: "listbox", hidden: true }
              )
            ),
            React.createElement(
              "button",
              {
                className: "btn btn--ghost btn--icon-sm topbar__theme-toggle",
                id: "themeToggleBtn",
                type: "button",
                title: "Toggle theme",
                "aria-label": "Toggle theme",
              },
              React.createElement(
                "svg",
                {
                  viewBox: "0 0 24 24",
                  width: "18",
                  height: "18",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: "2",
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  "aria-hidden": true,
                },
                React.createElement("circle", { cx: "12", cy: "12", r: "5" }),
                React.createElement("line", { x1: "12", y1: "1", x2: "12", y2: "3" }),
                React.createElement("line", { x1: "12", y1: "21", x2: "12", y2: "23" }),
                React.createElement("line", { x1: "4.22", y1: "4.22", x2: "5.64", y2: "5.64" }),
                React.createElement("line", { x1: "18.36", y1: "18.36", x2: "19.78", y2: "19.78" }),
                React.createElement("line", { x1: "1", y1: "12", x2: "3", y2: "12" }),
                React.createElement("line", { x1: "21", y1: "12", x2: "23", y2: "12" }),
                React.createElement("line", { x1: "4.22", y1: "19.78", x2: "5.64", y2: "18.36" }),
                React.createElement("line", { x1: "18.36", y1: "5.64", x2: "19.78", y2: "4.22" })
              )
            ),
            React.createElement(
              "button",
              {
                className: "user-chip",
                id: "userMenuBtn",
                type: "button",
                "aria-haspopup": "menu",
                "aria-expanded": "false",
              },
              React.createElement(
                "span",
                { className: "avatar avatar--sm user-chip__avatar", id: "userMenuAvatar", "aria-hidden": true },
                React.createElement("img", { id: "userMenuAvatarImg", src: "", alt: "", style: { display: "none" }, onError: (e) => { const p = e?.currentTarget?.parentElement || e?.target?.parentElement; if (p) { p.classList.add('avatar--fallback'); const initials = p.querySelector('.avatar__initials'); if (initials && initials.style) initials.style.display = 'flex'; } } }),
                React.createElement("span", { className: "avatar__initials", id: "userMenuInitial" })
              ),
              React.createElement(
                "svg",
                {
                  className: "user-chip__chevron",
                  viewBox: "0 0 24 24",
                  width: "14",
                  height: "14",
                  fill: "none",
                  stroke: "currentColor",
                  strokeWidth: "2",
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  "aria-hidden": true,
                },
                React.createElement("polyline", { points: "6 9 12 15 18 9" })
              ),
              React.createElement(
                "div",
                { className: "dropdown-menu user-menu", id: "userMenu", role: "menu", hidden: true },
                React.createElement(
                  "div",
                  { className: "user-menu__head" },
                  React.createElement(
                    "div",
                    { className: "user-menu__profile" },
                    React.createElement(
                      "span",
                      { className: "avatar avatar--md user-menu__avatar", id: "userMenuAvatarDropdown", "aria-hidden": true },
                      React.createElement("img", { id: "userMenuAvatarImgDropdown", src: "", alt: "", style: { display: "none" }, onError: (e) => { const p = e?.currentTarget?.parentElement || e?.target?.parentElement; if (p) { p.classList.add('avatar--fallback'); const initials = p.querySelector('.avatar__initials'); if (initials && initials.style) initials.style.display = 'flex'; } } }),
                      React.createElement("span", { className: "avatar__initials", id: "userMenuInitialDropdown" })
                    ),
                    React.createElement(
                      "div",
                      { className: "user-menu__info" },
                      React.createElement("span", { className: "user-menu__name", id: "userMenuName" }),
                      React.createElement("span", { className: "user-menu__mail", id: "userMenuEmailFull" })
                    )
                  )
                ),
                React.createElement("div", { className: "user-menu__sep", role: "separator" }),
                React.createElement(
                  "button",
                  { className: "menu__item", type: "button", role: "menuitem", "data-user-action": "settings" },
                  React.createElement(
                    "svg",
                    { className: "icon", viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
                    React.createElement("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }),
                    React.createElement("circle", { cx: "12", cy: "12", r: "3" })
                  ),
                  React.createElement("span", {}, "Settings")
                ),
                React.createElement("div", { className: "user-menu__sep", role: "separator" }),
                React.createElement(
                  "button",
                  { className: "menu__item menu__item--danger", type: "button", role: "menuitem", "data-user-action": "logout" },
                  React.createElement(
                    "svg",
                    { className: "icon", viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
                    React.createElement("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }),
                    React.createElement("polyline", { points: "16 17 21 12 16 7" }),
                    React.createElement("line", { x1: "21", y1: "12", x2: "9", y2: "12" })
                  ),
                  React.createElement("span", {}, "Sign out")
                )
              )
            )
          )
        ),
        React.createElement(
          "main",
          { className: "main", id: "main", tabIndex: -1 },
          React.createElement(
            "div",
            { className: "chat-shell" },
            React.createElement(
              "section",
              { className: "chat-panel", id: "chat-panel" },
              React.createElement("div", { className: "conversation", id: "conversationList" })
            )
          )
        ),
        React.createElement("aside", { className: "preview-panel", id: "filePreviewPanel", hidden: true }),
        React.createElement(
          "aside",
          { className: "source-panel", id: "sourcePanel", "aria-label": "Source preview", "aria-hidden": true }
        )
      )
    )
  )
);
}
