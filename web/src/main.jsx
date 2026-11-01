// Initialize existing Clarity vanilla JS application
// This script loads all modules. Application bootstrap (init) is performed
// by js/app.js itself, so do NOT register a second DOMContentLoaded listener
// here — two listeners caused init() to run twice and every UI handler to
// be attached twice, cancelling each other out.

import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import ReactMarkdown from "react-markdown";
import katex from "katex";
import "katex/dist/katex.min.css";
import "katex/dist/contrib/mhchem.js";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { AnswerEngine } from "./answer-engine.ts";
import { ResponseDocumentBuilder } from "./response-document-builder.ts";

if (typeof window !== "undefined") {
  try {
    cytoscape.use(dagre);
  } catch (e) {
    console.warn("cytoscape dagre registration:", e);
  }
  window.cytoscape = cytoscape;
  window.katex = katex;
  window.Clarity = window.Clarity || {};
  window.Clarity.ReactMarkdown = ReactMarkdown;
  window.Clarity.ErrorBoundary = ErrorBoundary;
  window.Clarity.AnswerEngine = AnswerEngine;
  window.Clarity.ResponseDocumentBuilder = ResponseDocumentBuilder;
}

import "../js/lib/utils.js";
import "../js/lib/icons.js";
import "../js/lib/dom.js";
import "../js/lib/store.js";
import "../js/lib/highlighter.js";
import "../js/ui/code-viewer.js";
import "../js/lib/markdown.js";
import "../js/data/nav.js";
import "../js/data/providers.js";
import "../js/services/api-diagnostic.js";
import "../js/services/api.js";
import "../js/services/settings.js";
import "../js/services/theme.js";
import "../js/services/auth.js";
import "../js/services/speech.js";
import "../js/services/narration-sync.js";
import "../js/ui/visual-learning.js";
import "../js/ui/toast.js";
import "../js/ui/tooltip.js";
import "../js/ui/modal.js";
import "../js/ui/diagram-modal.js";
import "../js/ui/sources.js";
import "../js/ui/artifact.js";
import "../js/ui/composer.js";
import "../js/ui/chat.js";
import "../js/ui/model-selector.js";
import "../js/ui/sidebar.js";
import "../js/ui/topbar.js";
import "../js/pages/home.js";
import "../js/pages/document-studio.js";
import "../js/pages/presentation-studio.js";
import "../js/pages/knowledge.js";
import "../js/pages/collections.js";
import "../js/pages/history.js";
import "../js/pages/settings.js";
import "../js/pages/model.js";
import "../js/pages/project.js";
import "../js/app.js";
import "./project-workspace-mount.jsx";

// Initialize CSS
import "../css/tokens.css";
import "../css/base.css";
import "../css/layout.css";
import "../css/components.css";
import "../css/pages.css";
import "../css/artifacts.css";
import "../css/code-viewer.css";

// Hook/intercept window.Clarity.markdown.render to route all renders through ResponseDocumentBuilder
if (typeof window !== "undefined" && window.Clarity && window.Clarity.markdown) {
  const originalRender = window.Clarity.markdown.render;
  window.Clarity.markdown.render = function (text, options) {
    if (options && options.__intercepted) {
      return originalRender.call(window.Clarity.markdown, text, options);
    }
    return window.Clarity.ResponseDocumentBuilder.build(text, options);
  };
}

