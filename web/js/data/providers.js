// Canonical Provider Registry for Darkness AI
// Single source of truth for all supported AI providers, endpoints, and credentials

(function () {
  const PROVIDERS = [
    {
      id: "gemini",
      label: "Google Gemini",
      defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai/",
      needsKey: true,
      isBaseEditable: true,
      adapter: "gemini",
      modelIdPlaceholder: "gemini-3.8-flash",
      keyPlaceholder: "AIzaSy...",
      description: "Google's Gemini models with high speed and multimodal reasoning.",
    },
    {
      id: "openai",
      label: "OpenAI",
      defaultBase: "https://api.openai.com/v1",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "gpt-4o",
      keyPlaceholder: "sk-proj-...",
      description: "OpenAI GPT-4o, GPT-4o-mini, and o-series models.",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      defaultBase: "https://openrouter.ai/api/v1",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "meta-llama/llama-3.3-70b-instruct",
      keyPlaceholder: "sk-or-v1-...",
      description: "Universal unified API for open & closed source models.",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      defaultBase: "https://api.anthropic.com/v1",
      needsKey: true,
      isBaseEditable: true,
      adapter: "anthropic",
      modelIdPlaceholder: "claude-3-5-sonnet-20241022",
      keyPlaceholder: "sk-ant-...",
      description: "Claude 3.5 Sonnet, Claude 3.5 Haiku, and Claude 3 Opus.",
    },
    {
      id: "groq",
      label: "Groq",
      defaultBase: "https://api.groq.com/openai/v1",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "llama-3.3-70b-versatile",
      keyPlaceholder: "gsk_...",
      description: "Ultra-fast LPU inference for Llama and Mixtral models.",
    },
    {
      id: "mistral",
      label: "Mistral AI",
      defaultBase: "https://api.mistral.ai/v1",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "mistral-large-latest",
      keyPlaceholder: "your-mistral-api-key",
      description: "Mistral Large, Codestral, and Pixtral models.",
    },
    {
      id: "together",
      label: "Together AI",
      defaultBase: "https://api.together.xyz/v1",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      keyPlaceholder: "your-together-api-key",
      description: "Open-source model cloud inference platform.",
    },
    {
      id: "z.ai",
      label: "Z.ai (GLM)",
      defaultBase: "https://api.z.ai/api/paas/v4",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "glm-4-plus",
      keyPlaceholder: "your-z-ai-api-key",
      description: "Zhipu AI GLM-4 and GLM-5 models.",
    },
    {
      id: "ollama",
      label: "Ollama (local)",
      defaultBase: "http://localhost:11434/v1",
      needsKey: false,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "llama3.2",
      keyPlaceholder: "(No API key required for local Ollama)",
      description: "Self-hosted local models running via Ollama.",
    },
    {
      id: "azure",
      label: "Azure OpenAI",
      defaultBase: "",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "your-deployment-name",
      keyPlaceholder: "your-azure-api-key",
      description: "Microsoft Azure OpenAI Service deployment endpoint.",
    },
    {
      id: "custom",
      label: "Custom / Other (OpenAI-compatible)",
      defaultBase: "",
      needsKey: true,
      isBaseEditable: true,
      adapter: "openai-compatible",
      modelIdPlaceholder: "custom-model-id",
      keyPlaceholder: "sk-...",
      description: "Any custom OpenAI-compatible server or proxy.",
    },
  ];

  function getProvider(providerId) {
    if (!providerId) return null;
    const cleanId = String(providerId).toLowerCase().trim();
    return PROVIDERS.find((p) => p.id === cleanId) || null;
  }

  function getDefaultBaseUrl(providerId) {
    const p = getProvider(providerId);
    return p ? p.defaultBase : "";
  }

  function getKeyPlaceholder(providerId) {
    const p = getProvider(providerId);
    return p ? p.keyPlaceholder : "sk-...";
  }

  function getModelIdPlaceholder(providerId) {
    const p = getProvider(providerId);
    return p ? p.modelIdPlaceholder : "model-id";
  }

  const Registry = {
    PROVIDERS,
    getProvider,
    getDefaultBaseUrl,
    getKeyPlaceholder,
    getModelIdPlaceholder,
  };

  if (typeof window !== "undefined") {
    window.Darkness = window.Darkness || {};
    window.Darkness.providers = Registry;
    window.MODEL_PROVIDERS = PROVIDERS;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Registry;
  }
})();
