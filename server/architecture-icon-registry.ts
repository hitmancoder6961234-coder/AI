/**
 * CLARITY — CANONICAL REAL-WORLD ARCHITECTURE & WORKFLOW ICON REGISTRY
 * 
 * Provides production-grade vector icons, technology intelligence metadata,
 * and deterministic icon resolution for system architecture, dataflow, RAG,
 * and file hierarchy diagrams.
 * 
 * ZERO emojis. ZERO generic placeholders. Authentic enterprise technical representation.
 */

export type TechnologyCategory =
  | "language"
  | "frontend"
  | "backend"
  | "database"
  | "ai_ml"
  | "cloud_infra"
  | "devtools"
  | "api_comm"
  | "storage"
  | "file_type"
  | "entity";

export interface TechnologyIconDefinition {
  id: string;
  name: string;
  officialName: string;
  category: TechnologyCategory;
  aliases: string[];
  fileExtensions?: string[];
  packageNames?: string[];
  configFiles?: string[];
  searchableTerms: string[];
  primaryColor: string;
  backgroundColor: string;
  borderColor: string;
  /**
   * SVG inner content designed to render inside a 32x32 coordinate space.
   */
  iconSvg: string;
}

export interface ResolvedIcon {
  id: string;
  name: string;
  officialName: string;
  category: TechnologyCategory;
  primaryColor: string;
  backgroundColor: string;
  borderColor: string;
  iconSvg: string;
  matchedBy: "exact_id" | "technology" | "framework" | "package" | "language" | "file_extension" | "config_file" | "alias" | "entity_type" | "fallback";
}

/**
 * Master Registry of Real-World Technical Architecture Icons
 */
export const ARCHITECTURE_ICON_REGISTRY: Record<string, TechnologyIconDefinition> = {
  // ==========================================
  // PROGRAMMING LANGUAGES
  // ==========================================
  typescript: {
    id: "typescript",
    name: "TypeScript",
    officialName: "TypeScript",
    category: "language",
    aliases: ["ts", "typescript", "tsc", "tsx"],
    fileExtensions: [".ts", ".tsx", ".mts", ".cts"],
    packageNames: ["typescript", "tsx", "ts-node", "@types/node"],
    configFiles: ["tsconfig.json", "tsconfig.base.json", "tsconfig.app.json"],
    searchableTerms: ["typescript", "ts", "type system", "typed javascript"],
    primaryColor: "#3178C6",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#3178C6"/>
      <path d="M6 13h10M11 13v13" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M26 16.5c-1-1-2.5-1.5-4.2-1.5-2.2 0-3.8 1.2-3.8 2.8 0 3.8 8 2.2 8 6.2 0 2-1.8 3-4.2 3-2.5 0-4.3-1-5.3-2.2" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>`
  },
  javascript: {
    id: "javascript",
    name: "JavaScript",
    officialName: "JavaScript (ES6+)",
    category: "language",
    aliases: ["js", "javascript", "ecmascript", "node-js", "vanillajs"],
    fileExtensions: [".js", ".jsx", ".mjs", ".cjs"],
    packageNames: ["javascript", "es6"],
    configFiles: ["jsconfig.json"],
    searchableTerms: ["javascript", "js", "ecmascript", "es6", "vanilla"],
    primaryColor: "#EAB308",
    backgroundColor: "#FEFCE8",
    borderColor: "#FEF08A",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#F7DF1E"/>
      <path d="M12 15v8c0 2-1.5 3-3.5 3-1.5 0-2.8-.5-3.5-1.5" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M26 16.5c-1-1-2.2-1.5-3.8-1.5-2 0-3.2 1-3.2 2.5 0 3.5 7 2 7 5.5 0 2-1.8 3-4 3-2.2 0-3.8-.8-4.8-2" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round"/>`
  },
  python: {
    id: "python",
    name: "Python",
    officialName: "Python 3",
    category: "language",
    aliases: ["py", "python", "python3", "cpython"],
    fileExtensions: [".py", ".pyw", ".ipynb"],
    packageNames: ["pytest", "setuptools", "wheel", "pip"],
    configFiles: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile", "poetry.lock"],
    searchableTerms: ["python", "python3", "py", "cpython", "django", "flask", "fastapi"],
    primaryColor: "#3776AB",
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
    iconSvg: `<g transform="scale(0.8) translate(4, 4)">
      <path d="M16 2c-7.7 0-7.2 3.3-7.2 3.3l.01 3.5h7.3v1h-10.2s-4.9.5-4.9 7.2c0 6.6 4.3 6.4 4.3 6.4h2.5v-3.6s-.1-4.3 4.2-4.3h7.2s4.1.1 4.1-3.9v-5.7s.6-4-7.3-4zm-4.1 2.3c.7 0 1.3.6 1.3 1.3s-.6 1.3-1.3 1.3-1.3-.6-1.3-1.3.6-1.3 1.3-1.3z" fill="#3776AB"/>
      <path d="M16 30c7.7 0 7.2-3.3 7.2-3.3l-.01-3.5h-7.3v-1h10.2s4.9-.5 4.9-7.2c0-6.6-4.3-6.4-4.3-6.4h-2.5v3.6s.1 4.3-4.2 4.3h-7.2s-4.1-.1-4.1 3.9v5.7s-.6 4 7.3 4zm4.1-2.3c-.7 0-1.3-.6-1.3-1.3s.6-1.3 1.3-1.3 1.3.6 1.3 1.3-.6 1.3-1.3 1.3z" fill="#FFD43B"/>
    </g>`
  },
  java: {
    id: "java",
    name: "Java",
    officialName: "Java / JVM",
    category: "language",
    aliases: ["java", "jvm", "jdk", "openjdk"],
    fileExtensions: [".java", ".jar", ".class"],
    packageNames: ["org.springframework", "com.google.guava"],
    configFiles: ["pom.xml", "build.gradle", "build.gradle.kts"],
    searchableTerms: ["java", "jvm", "jdk", "spring", "maven", "gradle"],
    primaryColor: "#EA2D2E",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<path d="M12 27c3 1.5 8 1.5 11 0M9 23c4 2 12 2 16 0M8 19c5 2.5 15 2.5 19 0" stroke="#5382A1" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M17 5c-3 3 2 6-1 10M21 3c-3 4 3 7-1 12" stroke="#EA2D2E" stroke-width="2.5" stroke-linecap="round" fill="none"/>`
  },
  golang: {
    id: "golang",
    name: "Go",
    officialName: "Go (Golang)",
    category: "language",
    aliases: ["go", "golang", "gopher"],
    fileExtensions: [".go"],
    packageNames: ["github.com/gin-gonic/gin", "github.com/gorilla/mux"],
    configFiles: ["go.mod", "go.sum"],
    searchableTerms: ["go", "golang", "gopher", "goroutine", "gin"],
    primaryColor: "#00ADD8",
    backgroundColor: "#F0FDFA",
    borderColor: "#99F6E4",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#00ADD8"/>
      <path d="M7 16c0-4 3.5-7 8-7 3.5 0 6 1.5 7 4h-4c-.8-.8-1.8-1.5-3-1.5-2.5 0-4.5 2-4.5 4.5s2 4.5 4.5 4.5c1.8 0 3-1 3.5-2h-3.5v-2.5h6.5V17c-1 3-3.5 5.5-6.5 5.5-4.5 0-8-3-8-6.5z" fill="#FFFFFF"/>
      <circle cx="25" cy="16" r="2.5" fill="#FFFFFF"/>`
  },
  rust: {
    id: "rust",
    name: "Rust",
    officialName: "Rust Lang",
    category: "language",
    aliases: ["rs", "rust", "cargo"],
    fileExtensions: [".rs"],
    packageNames: ["actix-web", "tokio", "serde", "axum"],
    configFiles: ["Cargo.toml", "Cargo.lock"],
    searchableTerms: ["rust", "cargo", "rs", "tokio", "memory-safe"],
    primaryColor: "#DEA584",
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
    iconSvg: `<circle cx="16" cy="16" r="13" fill="none" stroke="#262626" stroke-width="2.2"/>
      <circle cx="16" cy="16" r="4.5" fill="#262626"/>
      <path d="M16 3v4M16 25v4M3 16h4M25 16h4M7 7l3 3M22 22l3 3M7 25l3-3M22 10l3-3" stroke="#262626" stroke-width="2.2" stroke-linecap="round"/>`
  },
  csharp: {
    id: "csharp",
    name: "C#",
    officialName: "C# / .NET",
    category: "language",
    aliases: ["cs", "csharp", "dotnet", ".net", "c#"],
    fileExtensions: [".cs", ".csx"],
    packageNames: ["Microsoft.AspNetCore", "Microsoft.EntityFrameworkCore"],
    configFiles: [".csproj", ".sln", "global.json"],
    searchableTerms: ["c#", "csharp", "dotnet", "asp.net", "entity framework"],
    primaryColor: "#9B4993",
    backgroundColor: "#FAF5FF",
    borderColor: "#E9D5FF",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#9B4993"/>
      <path d="M15 11c-4 0-7 3-7 7s3 7 7 7c3 0 5-1.5 6-3.5h-3c-.8.8-1.8 1.5-3 1.5-2.5 0-4-2-4-5s1.5-5 4-5c1.2 0 2.2.7 3 1.5h3c-1-2-3-3.5-6-3.5z" fill="#FFFFFF"/>
      <path d="M21 13h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3z" fill="#FFFFFF"/>`
  },
  cpp: {
    id: "cpp",
    name: "C++",
    officialName: "C++",
    category: "language",
    aliases: ["cpp", "cplusplus", "c++", "cc", "cxx"],
    fileExtensions: [".cpp", ".cxx", ".cc", ".hpp", ".hxx", ".h"],
    packageNames: [],
    configFiles: ["CMakeLists.txt", "Makefile"],
    searchableTerms: ["c++", "cpp", "cplusplus", "cmake"],
    primaryColor: "#00599C",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#00599C"/>
      <path d="M12 11c-3.5 0-6 2.5-6 5.5s2.5 5.5 6 5.5c2.5 0 4.5-1.2 5.2-3h-2.8c-.5.8-1.3 1.2-2.4 1.2-2 0-3.3-1.5-3.3-3.7s1.3-3.7 3.3-3.7c1.1 0 1.9.4 2.4 1.2h2.8c-.7-1.8-2.7-3-5.2-3z" fill="#FFFFFF"/>
      <path d="M18 14h1.5v1.5h1.5v1.5h-1.5v1.5H18v-1.5h-1.5v-1.5H18V14zm6 0h1.5v1.5h1.5v1.5h-1.5v1.5H24v-1.5h-1.5v-1.5H24V14z" fill="#FFFFFF"/>`
  },
  c: {
    id: "c",
    name: "C",
    officialName: "C Language",
    category: "language",
    aliases: ["c", "clang", "gcc"],
    fileExtensions: [".c", ".h"],
    packageNames: [],
    configFiles: ["Makefile"],
    searchableTerms: ["c", "clang", "gcc", "posix"],
    primaryColor: "#A8B9CC",
    backgroundColor: "#F1F5F9",
    borderColor: "#CBD5E1",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#5C6BC0"/>
      <path d="M22 12c-1.5-2-4-3-7-3-5 0-9 4-9 9s4 9 9 9c3 0 5.5-1 7-3h-3.5c-1 1-2.2 1.5-3.5 1.5-4 0-6.5-3-6.5-7.5s2.5-7.5 6.5-7.5c1.3 0 2.5.5 3.5 1.5H22z" fill="#FFFFFF"/>`
  },
  php: {
    id: "php",
    name: "PHP",
    officialName: "PHP",
    category: "language",
    aliases: ["php", "laravel", "symfony", "wordpress"],
    fileExtensions: [".php", ".phtml"],
    packageNames: ["laravel/framework", "symfony/http-foundation"],
    configFiles: ["composer.json", "composer.lock"],
    searchableTerms: ["php", "composer", "lamp", "laravel"],
    primaryColor: "#777BB4",
    backgroundColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    iconSvg: `<ellipse cx="16" cy="16" rx="15" ry="9" fill="#777BB4"/>
      <text x="16" y="19" font-family="system-ui, sans-serif" font-size="9" font-weight="900" fill="#FFFFFF" text-anchor="middle">PHP</text>`
  },
  kotlin: {
    id: "kotlin",
    name: "Kotlin",
    officialName: "Kotlin",
    category: "language",
    aliases: ["kt", "kotlin", "android-kt"],
    fileExtensions: [".kt", ".kts"],
    packageNames: ["org.jetbrains.kotlin"],
    configFiles: ["build.gradle.kts"],
    searchableTerms: ["kotlin", "android", "jetbrains", "coroutines"],
    primaryColor: "#7F52FF",
    backgroundColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#7F52FF"/>
      <polygon points="6,6 16,6 6,16" fill="#FFFFFF"/>
      <polygon points="16,6 26,6 6,26 6,16" fill="#C757BC"/>
      <polygon points="6,26 26,6 26,26" fill="#00AFFF"/>`
  },
  swift: {
    id: "swift",
    name: "Swift",
    officialName: "Swift (Apple iOS/macOS)",
    category: "language",
    aliases: ["swift", "swiftui", "ios", "cocoapods"],
    fileExtensions: [".swift"],
    packageNames: [],
    configFiles: ["Package.swift", "Podfile"],
    searchableTerms: ["swift", "swiftui", "ios", "apple"],
    primaryColor: "#F05138",
    backgroundColor: "#FFF1F2",
    borderColor: "#FECDD3",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#F05138"/>
      <path d="M25 7c-3 4-8 8-14 11 3-1 6-3 8-6-6 4-11 10-13 14 5-3 11-4 17-2 2-3 4-8 2-17z" fill="#FFFFFF"/>`
  },
  r_lang: {
    id: "r_lang",
    name: "R",
    officialName: "R Statistics",
    category: "language",
    aliases: ["r", "rlang", "rscript"],
    fileExtensions: [".r", ".rmd"],
    packageNames: [],
    configFiles: ["DESCRIPTION"],
    searchableTerms: ["r", "rlang", "statistics", "ggplot2"],
    primaryColor: "#276DC3",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<ellipse cx="16" cy="16" rx="14" ry="11" fill="#C4C7C9"/>
      <ellipse cx="16" cy="16" rx="11" ry="8" fill="#FFFFFF"/>
      <path d="M12 11h6c3 0 5 1.5 5 4 0 2-1.5 3.5-3.5 3.8L23 23h-3.5l-3.2-4H15v4h-3V11zm3 3v3h3c1.2 0 2-.6 2-1.5s-.8-1.5-2-1.5h-3z" fill="#276DC3"/>`
  },
  ruby: {
    id: "ruby",
    name: "Ruby",
    officialName: "Ruby / Rails",
    category: "language",
    aliases: ["rb", "ruby", "rails", "gem"],
    fileExtensions: [".rb", ".erb", ".gemspec"],
    packageNames: ["rails", "sinatra"],
    configFiles: ["Gemfile", "Gemfile.lock", "Rakefile"],
    searchableTerms: ["ruby", "rails", "gem", "bundler"],
    primaryColor: "#CC342D",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<polygon points="16,4 28,10 24,28 8,28 4,10" fill="#CC342D"/>
      <polygon points="16,4 24,10 16,28 8,10" fill="#E8483F"/>
      <polygon points="16,4 20,10 16,15 12,10" fill="#FFFFFF" opacity="0.6"/>`
  },
  bash: {
    id: "bash",
    name: "Bash / Shell",
    officialName: "GNU Bash / POSIX Shell",
    category: "language",
    aliases: ["bash", "sh", "shell", "zsh"],
    fileExtensions: [".sh", ".bash", ".zsh"],
    packageNames: [],
    configFiles: [".bashrc", ".zshrc"],
    searchableTerms: ["bash", "shell", "cli", "script", "terminal"],
    primaryColor: "#4EAA25",
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#24292E"/>
      <path d="M8 11l6 5-6 5" stroke="#4EAA25" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <line x1="16" y1="21" x2="24" y2="21" stroke="#4EAA25" stroke-width="2.5" stroke-linecap="round"/>`
  },

  // ==========================================
  // FRONTEND FRAMEWORKS & UI
  // ==========================================
  react: {
    id: "react",
    name: "React",
    officialName: "React.js",
    category: "frontend",
    aliases: ["react", "reactjs", "react-dom", "jsx", "tsx", "react-router"],
    fileExtensions: [".jsx", ".tsx"],
    packageNames: ["react", "react-dom", "react-router", "react-router-dom", "@types/react"],
    configFiles: [],
    searchableTerms: ["react", "reactjs", "components", "jsx", "hooks", "spa"],
    primaryColor: "#00D8FF",
    backgroundColor: "#F0FDF4",
    borderColor: "#A7F3D0",
    iconSvg: `<ellipse cx="16" cy="16" rx="12" ry="4.5" fill="none" stroke="#00D8FF" stroke-width="1.8"/>
      <ellipse cx="16" cy="16" rx="12" ry="4.5" fill="none" stroke="#00D8FF" stroke-width="1.8" transform="rotate(60 16 16)"/>
      <ellipse cx="16" cy="16" rx="12" ry="4.5" fill="none" stroke="#00D8FF" stroke-width="1.8" transform="rotate(120 16 16)"/>
      <circle cx="16" cy="16" r="2.5" fill="#00D8FF"/>`
  },
  nextjs: {
    id: "nextjs",
    name: "Next.js",
    officialName: "Next.js Framework",
    category: "frontend",
    aliases: ["next", "nextjs", "next.js", "app-router"],
    fileExtensions: [],
    packageNames: ["next"],
    configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
    searchableTerms: ["next.js", "nextjs", "ssr", "ssg", "app router", "vercel"],
    primaryColor: "#000000",
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#000000"/>
      <path d="M12 9v14M20 9l-8 11" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M20 14v9" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>`
  },
  vue: {
    id: "vue",
    name: "Vue.js",
    officialName: "Vue.js",
    category: "frontend",
    aliases: ["vue", "vuejs", "vue3", "nuxt"],
    fileExtensions: [".vue"],
    packageNames: ["vue", "vuex", "pinia", "vue-router", "nuxt"],
    configFiles: ["vue.config.js", "nuxt.config.ts"],
    searchableTerms: ["vue", "vuejs", "vue3", "pinia", "nuxt"],
    primaryColor: "#42B883",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    iconSvg: `<path d="M16 27L3 5h5.5l7.5 13 7.5-13H29L16 27z" fill="#42B883"/>
      <path d="M16 20L8.5 7h4.5l3 5.5 3-5.5h4.5L16 20z" fill="#35495E"/>`
  },
  angular: {
    id: "angular",
    name: "Angular",
    officialName: "Angular",
    category: "frontend",
    aliases: ["angular", "angularjs", "ng"],
    fileExtensions: [],
    packageNames: ["@angular/core", "@angular/common", "@angular/router"],
    configFiles: ["angular.json"],
    searchableTerms: ["angular", "angularjs", "typescript", "google", "rxjs"],
    primaryColor: "#DD0031",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<path d="M16 2L3 7l2 18 11 5 11-5 2-18-13-5z" fill="#DD0031"/>
      <path d="M16 2v28l11-5 2-18-13-5z" fill="#C3002F"/>
      <path d="M16 6.5l-6 13.5h2.5l1.2-3h4.6l1.2 3H22L16 6.5zm-1.2 8.5l1.2-3 1.2 3h-2.4z" fill="#FFFFFF"/>`
  },
  svelte: {
    id: "svelte",
    name: "Svelte",
    officialName: "Svelte / SvelteKit",
    category: "frontend",
    aliases: ["svelte", "sveltekit"],
    fileExtensions: [".svelte"],
    packageNames: ["svelte", "@sveltejs/kit"],
    configFiles: ["svelte.config.js"],
    searchableTerms: ["svelte", "sveltekit", "reactive ui"],
    primaryColor: "#FF3E00",
    backgroundColor: "#FFF1F2",
    borderColor: "#FECDD3",
    iconSvg: `<path d="M24 7c-4-4-11-2-13 2-2 4 0 9 4 11l6 3c2 1 3 3 2 5-1 2-4 3-6 2-3-1-4-3-4-5l-4 1c0 4 3 7 7 8 5 1 10-1 12-5 2-4 0-9-4-11l-6-3c-2-1-3-3-2-5 1-2 4-3 6-2 3 1 4 3 4 5l5-1z" fill="#FF3E00"/>`
  },
  tailwind: {
    id: "tailwind",
    name: "Tailwind CSS",
    officialName: "Tailwind CSS",
    category: "frontend",
    aliases: ["tailwind", "tailwindcss", "tw"],
    fileExtensions: [],
    packageNames: ["tailwindcss", "@tailwindcss/vite", "@tailwindcss/postcss"],
    configFiles: ["tailwind.config.js", "tailwind.config.ts"],
    searchableTerms: ["tailwind", "tailwindcss", "utility-first css"],
    primaryColor: "#38BDF8",
    backgroundColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    iconSvg: `<path d="M8 12c1.5-3 4-4.5 7.5-4.5 5 0 6.5 3.5 9 4.5 2 1 3.5.5 5-.5-1.5 3-4 4.5-7.5 4.5-5 0-6.5-3.5-9-4.5-2-1-3.5-.5-5 .5zm-5 8c1.5-3 4-4.5 7.5-4.5 5 0 6.5 3.5 9 4.5 2 1 3.5.5 5-.5-1.5 3-4 4.5-7.5 4.5-5 0-6.5-3.5-9-4.5-2-1-3.5-.5-5 .5z" fill="#38BDF8"/>`
  },
  vite: {
    id: "vite",
    name: "Vite",
    officialName: "Vite Build Tool",
    category: "devtools",
    aliases: ["vite", "vitejs"],
    fileExtensions: [],
    packageNames: ["vite", "@vitejs/plugin-react", "@vitejs/plugin-vue"],
    configFiles: ["vite.config.js", "vite.config.ts", "vite.config.mjs"],
    searchableTerms: ["vite", "bundler", "esm dev server"],
    primaryColor: "#646CFF",
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    iconSvg: `<path d="M29 5L16 28 3 5l16 3 10-3z" fill="#646CFF"/>
      <path d="M16 28L7 6l9 2 9-2-9 22z" fill="#FFD43B"/>
      <path d="M16 11l-3 7h6l-3 7" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" fill="none"/>`
  },
  html5: {
    id: "html5",
    name: "HTML5",
    officialName: "HTML5 Standard",
    category: "frontend",
    aliases: ["html", "html5", "htm", "webpage"],
    fileExtensions: [".html", ".htm"],
    packageNames: [],
    configFiles: [],
    searchableTerms: ["html", "html5", "markup", "webpage"],
    primaryColor: "#E34F26",
    backgroundColor: "#FFF7ED",
    borderColor: "#FFEDD5",
    iconSvg: `<path d="M5 3l2.5 24 8.5 2.5 8.5-2.5L27 3H5z" fill="#E34F26"/>
      <path d="M16 27.2l6.8-2 2-20.2H16v22.2z" fill="#EF652A"/>
      <path d="M16 11.5H9.5l.3 3.5H16v-3.5zm0 7H9.8l.3 3.5h5.9v-3.5zm0-10.5h-9l.2 2.5h8.8V8zm0 17.7l-4.7-1.3-.3-3.4H8.5l.5 6.2 7 2v-3.5zm0-3.7v3.5l4.7-1.3.5-5.7H16v3.5zm6.3-7.5H16V8h8.8l-.8 9z" fill="#FFFFFF"/>`
  },
  css3: {
    id: "css3",
    name: "CSS3",
    officialName: "Cascading Style Sheets",
    category: "frontend",
    aliases: ["css", "css3", "styles", "scss", "sass"],
    fileExtensions: [".css", ".scss", ".sass", ".less"],
    packageNames: [],
    configFiles: [],
    searchableTerms: ["css", "css3", "styles", "stylesheet"],
    primaryColor: "#1572B6",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M5 3l2.5 24 8.5 2.5 8.5-2.5L27 3H5z" fill="#1572B6"/>
      <path d="M16 27.2l6.8-2 2-20.2H16v22.2z" fill="#33A9DC"/>
      <path d="M16 11.5H9.5l.3 3.5H16v-3.5zm0 7H9.8l.3 3.5h5.9v-3.5zm0-10.5h-9l.2 2.5h8.8V8zm0 17.7l-4.7-1.3-.3-3.4H8.5l.5 6.2 7 2v-3.5zm0-3.7v3.5l4.7-1.3.5-5.7H16v3.5zm6.3-7.5H16V8h8.8l-.8 9z" fill="#FFFFFF"/>`
  },

  // ==========================================
  // BACKEND FRAMEWORKS & RUNTIMES
  // ==========================================
  nodejs: {
    id: "nodejs",
    name: "Node.js",
    officialName: "Node.js Runtime",
    category: "backend",
    aliases: ["node", "nodejs", "npm", "npx"],
    fileExtensions: [],
    packageNames: ["node"],
    configFiles: ["package.json"],
    searchableTerms: ["node", "nodejs", "javascript runtime", "v8"],
    primaryColor: "#339933",
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    iconSvg: `<path d="M16 3l11 6.5v13L16 29 5 22.5v-13L16 3z" fill="#339933"/>
      <path d="M16 6.5l8.5 5v10L16 26.5l-8.5-5v-10L16 6.5z" fill="#FFFFFF"/>
      <path d="M16 11l5 3v6l-5 3-5-3v-6l5-3z" fill="#339933"/>`
  },
  express: {
    id: "express",
    name: "Express",
    officialName: "Express.js",
    category: "backend",
    aliases: ["express", "expressjs", "express-server"],
    fileExtensions: [],
    packageNames: ["express", "cors", "body-parser"],
    configFiles: [],
    searchableTerms: ["express", "expressjs", "api server", "middleware"],
    primaryColor: "#1E293B",
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#1E293B"/>
      <text x="16" y="21" font-family="system-ui, sans-serif" font-size="12" font-weight="900" fill="#FFFFFF" text-anchor="middle">ex</text>`
  },
  fastapi: {
    id: "fastapi",
    name: "FastAPI",
    officialName: "FastAPI Python Framework",
    category: "backend",
    aliases: ["fastapi", "uvicorn", "pydantic", "starlette"],
    fileExtensions: [],
    packageNames: ["fastapi", "uvicorn", "pydantic"],
    configFiles: [],
    searchableTerms: ["fastapi", "python api", "async api", "uvicorn", "swagger"],
    primaryColor: "#009688",
    backgroundColor: "#F0FDFA",
    borderColor: "#99F6E4",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#009688"/>
      <path d="M18 5L9 18h6l-2 9 10-13h-6l3-9z" fill="#FFFFFF"/>`
  },
  flask: {
    id: "flask",
    name: "Flask",
    officialName: "Flask Python Microframework",
    category: "backend",
    aliases: ["flask", "werkzeug", "jinja"],
    fileExtensions: [],
    packageNames: ["flask", "werkzeug", "jinja2"],
    configFiles: [],
    searchableTerms: ["flask", "python web", "microframework"],
    primaryColor: "#000000",
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    iconSvg: `<path d="M13 5v6l-6 13c-1 2 0 4 3 4h12c3 0 4-2 3-4l-6-13V5h-6z" fill="none" stroke="#0F172A" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M11 5h10M10 17h12" stroke="#0F172A" stroke-width="2" stroke-linecap="round"/>
      <circle cx="14" cy="21" r="1.5" fill="#0F172A"/>
      <circle cx="18" cy="22" r="1.5" fill="#0F172A"/>`
  },
  django: {
    id: "django",
    name: "Django",
    officialName: "Django Framework",
    category: "backend",
    aliases: ["django", "djangorestframework", "drf"],
    fileExtensions: [],
    packageNames: ["django", "djangorestframework"],
    configFiles: ["manage.py", "wsgi.py", "asgi.py"],
    searchableTerms: ["django", "drf", "python orm", "django admin"],
    primaryColor: "#092E20",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#092E20"/>
      <text x="16" y="21" font-family="Georgia, serif" font-size="14" font-weight="900" fill="#44B78B" text-anchor="middle">dj</text>`
  },
  spring: {
    id: "spring",
    name: "Spring Boot",
    officialName: "Spring Boot / Java",
    category: "backend",
    aliases: ["spring", "springboot", "spring-boot", "spring-mvc"],
    fileExtensions: [],
    packageNames: ["org.springframework.boot"],
    configFiles: ["application.properties", "application.yml"],
    searchableTerms: ["spring", "springboot", "java backend", "enterprise"],
    primaryColor: "#6DB33F",
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    iconSvg: `<path d="M16 2C8.3 2 2 8.3 2 16c0 5.4 3 10.1 7.4 12.4l1.8-3.1C8 23.6 6 20 6 16c0-5.5 4.5-10 10-10s10 4.5 10 10c0 4-2 7.6-5.2 9.3l1.8 3.1C27 26.1 30 21.4 30 16c0-7.7-6.3-14-14-14z" fill="#6DB33F"/>
      <circle cx="16" cy="16" r="4" fill="#6DB33F"/>`
  },
  nestjs: {
    id: "nestjs",
    name: "NestJS",
    officialName: "NestJS Enterprise Node Framework",
    category: "backend",
    aliases: ["nest", "nestjs", "@nestjs/core"],
    fileExtensions: [],
    packageNames: ["@nestjs/core", "@nestjs/common"],
    configFiles: ["nest-cli.json"],
    searchableTerms: ["nestjs", "nest", "typescript backend", "enterprise node"],
    primaryColor: "#E0234E",
    backgroundColor: "#FFF1F2",
    borderColor: "#FECDD3",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#E0234E"/>
      <path d="M16 4l10 7-4 13-12 4-4-11 10-13z" fill="#FFFFFF"/>`
  },

  // ==========================================
  // DATABASES & STORAGE
  // ==========================================
  postgresql: {
    id: "postgresql",
    name: "PostgreSQL",
    officialName: "PostgreSQL Database",
    category: "database",
    aliases: ["postgres", "postgresql", "psql", "pg"],
    fileExtensions: [],
    packageNames: ["pg", "pg-promise", "psycopg2", "asyncpg", "typeorm", "prisma", "drizzle-orm"],
    configFiles: [],
    searchableTerms: ["postgres", "postgresql", "psql", "relational database", "pgvector"],
    primaryColor: "#336791",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M16 3C9 3 4 8 4 14c0 4 2.5 7.5 6 9.5V28l5-3 5 3v-4.5c3.5-2 6-5.5 6-9.5 0-6-5-11-12-11z" fill="#336791"/>
      <circle cx="11" cy="12" r="1.5" fill="#FFFFFF"/>
      <circle cx="21" cy="12" r="1.5" fill="#FFFFFF"/>
      <path d="M16 14v5M12 18h8" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round"/>`
  },
  mysql: {
    id: "mysql",
    name: "MySQL",
    officialName: "MySQL RDBMS",
    category: "database",
    aliases: ["mysql", "mariadb"],
    fileExtensions: [],
    packageNames: ["mysql", "mysql2", "mysqlclient"],
    configFiles: [],
    searchableTerms: ["mysql", "mariadb", "innodb", "sql database"],
    primaryColor: "#4479A1",
    backgroundColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    iconSvg: `<path d="M6 22c3-4 6-6 10-6s7 2 10 6" stroke="#E97B00" stroke-width="3" stroke-linecap="round" fill="none"/>
      <path d="M8 12c4-5 12-5 16 0" stroke="#00758F" stroke-width="3" stroke-linecap="round" fill="none"/>
      <ellipse cx="16" cy="14" rx="10" ry="4" fill="none" stroke="#00758F" stroke-width="2"/>`
  },
  sqlite: {
    id: "sqlite",
    name: "SQLite",
    officialName: "SQLite Embedded Database",
    category: "database",
    aliases: ["sqlite", "sqlite3", "better-sqlite3"],
    fileExtensions: [".db", ".sqlite", ".sqlite3"],
    packageNames: ["sqlite", "sqlite3", "better-sqlite3"],
    configFiles: [],
    searchableTerms: ["sqlite", "sqlite3", "embedded database", "local db"],
    primaryColor: "#003B57",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M6 6h20v20H6z" fill="#003B57" rx="4"/>
      <path d="M11 12h10M11 16h10M11 20h6" stroke="#00A9E0" stroke-width="2.2" stroke-linecap="round"/>`
  },
  mongodb: {
    id: "mongodb",
    name: "MongoDB",
    officialName: "MongoDB Document Database",
    category: "database",
    aliases: ["mongo", "mongodb", "mongoose", "pymongo"],
    fileExtensions: [],
    packageNames: ["mongodb", "mongoose", "pymongo", "motor"],
    configFiles: [],
    searchableTerms: ["mongodb", "mongo", "nosql", "bson", "mongoose"],
    primaryColor: "#47A248",
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    iconSvg: `<path d="M16 2c-3 6-7 10-7 16 0 5 3.5 9 7 11 3.5-2 7-6 7-11 0-6-4-10-7-16z" fill="#47A248"/>
      <path d="M16 2v27c-.3 0-.7 0-1-.2V4.5c.3-.8.7-1.7 1-2.5z" fill="#3FA037"/>`
  },
  redis: {
    id: "redis",
    name: "Redis",
    officialName: "Redis In-Memory Data Store",
    category: "database",
    aliases: ["redis", "ioredis", "redis-cache"],
    fileExtensions: [],
    packageNames: ["redis", "ioredis", "aioredis"],
    configFiles: [],
    searchableTerms: ["redis", "cache", "in-memory", "pubsub", "session store"],
    primaryColor: "#DC382D",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<path d="M16 4l12 6-12 6-12-6 12-6z" fill="#DC382D"/>
      <path d="M4 12l12 6 12-6v5l-12 6-12-6v-5z" fill="#A81E15"/>
      <path d="M4 19l12 6 12-6v5l-12 6-12-6v-5z" fill="#75130D"/>`
  },
  supabase: {
    id: "supabase",
    name: "Supabase",
    officialName: "Supabase BaaS",
    category: "database",
    aliases: ["supabase", "@supabase/supabase-js"],
    fileExtensions: [],
    packageNames: ["@supabase/supabase-js", "@supabase/ssr"],
    configFiles: [],
    searchableTerms: ["supabase", "postgres baas", "realtime db", "auth"],
    primaryColor: "#3ECF8E",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    iconSvg: `<path d="M18 3L4 20h11l-2 9 15-18H17l1-8z" fill="#3ECF8E"/>`
  },
  firebase: {
    id: "firebase",
    name: "Firebase",
    officialName: "Google Firebase / Firestore",
    category: "database",
    aliases: ["firebase", "firestore", "firebase-admin"],
    fileExtensions: [],
    packageNames: ["firebase", "firebase-admin"],
    configFiles: ["firebase.json", "firestore.rules"],
    searchableTerms: ["firebase", "firestore", "gcp baas", "nosql cloud"],
    primaryColor: "#FFCA28",
    backgroundColor: "#FEFCE8",
    borderColor: "#FEF08A",
    iconSvg: `<path d="M5 24L8 6l6 11-9 7z" fill="#FFA000"/>
      <path d="M27 24L20 4l-4 8 11 12z" fill="#F57C00"/>
      <path d="M16 12l-4 5 4 7 11-12-11 0z" fill="#FFCA28"/>`
  },
  dynamodb: {
    id: "dynamodb",
    name: "DynamoDB",
    officialName: "Amazon DynamoDB",
    category: "database",
    aliases: ["dynamodb", "dynamo", "aws-dynamo"],
    fileExtensions: [],
    packageNames: ["@aws-sdk/client-dynamodb", "boto3"],
    configFiles: [],
    searchableTerms: ["dynamodb", "aws nosql", "serverless database"],
    primaryColor: "#4053D6",
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    iconSvg: `<rect x="6" y="6" width="20" height="20" rx="4" fill="#4053D6"/>
      <ellipse cx="16" cy="11" rx="6" ry="2" fill="#FFFFFF"/>
      <path d="M10 11v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5" fill="none" stroke="#FFFFFF" stroke-width="1.8"/>
      <path d="M10 16v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5" fill="none" stroke="#FFFFFF" stroke-width="1.8"/>`
  },

  // ==========================================
  // AI / ML / RAG / EMBEDDINGS
  // ==========================================
  gemini: {
    id: "gemini",
    name: "Gemini",
    officialName: "Google Gemini AI",
    category: "ai_ml",
    aliases: ["gemini", "@google/genai", "@google/generative-ai", "google-genai"],
    fileExtensions: [],
    packageNames: ["@google/genai", "@google/generative-ai", "google-generativeai"],
    configFiles: [],
    searchableTerms: ["gemini", "google genai", "flash", "pro", "multimodal llm"],
    primaryColor: "#1A73E8",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M16 2C16 10 10 16 2 16c8 0 14 6 14 14 0-8 6-14 14-14-8 0-14-6-14-14z" fill="#1A73E8"/>
      <circle cx="16" cy="16" r="3" fill="#FFFFFF"/>`
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    officialName: "OpenAI GPT Models",
    category: "ai_ml",
    aliases: ["openai", "gpt", "gpt-4", "gpt-4o", "chatgpt"],
    fileExtensions: [],
    packageNames: ["openai"],
    configFiles: [],
    searchableTerms: ["openai", "gpt", "gpt-4o", "embeddings", "chatgpt"],
    primaryColor: "#10A37F",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#10A37F"/>
      <path d="M16 8v16M8 16h16M10 10l12 12M10 22L22 10" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round"/>`
  },
  claude: {
    id: "claude",
    name: "Claude",
    officialName: "Anthropic Claude",
    category: "ai_ml",
    aliases: ["claude", "anthropic", "@anthropic-ai/sdk"],
    fileExtensions: [],
    packageNames: ["@anthropic-ai/sdk", "anthropic"],
    configFiles: [],
    searchableTerms: ["claude", "anthropic", "sonnet", "haiku", "opus"],
    primaryColor: "#D97706",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#D97706"/>
      <path d="M16 7l6 18h-4l-1.5-5h-5L10 25H6L16 7zm-1 9h3l-1.5-5-1.5 5z" fill="#FFFFFF"/>`
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    officialName: "Ollama Local Models",
    category: "ai_ml",
    aliases: ["ollama", "local-llm", "llama", "mistral"],
    fileExtensions: [],
    packageNames: ["ollama"],
    configFiles: [],
    searchableTerms: ["ollama", "local llm", "llama", "mistral"],
    primaryColor: "#000000",
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#000000"/>
      <circle cx="12" cy="14" r="2" fill="#FFFFFF"/>
      <circle cx="20" cy="14" r="2" fill="#FFFFFF"/>
      <path d="M11 20c2 2 8 2 10 0" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" fill="none"/>`
  },
  huggingface: {
    id: "huggingface",
    name: "Hugging Face",
    officialName: "Hugging Face Hub & Transformers",
    category: "ai_ml",
    aliases: ["huggingface", "transformers", "hf"],
    fileExtensions: [],
    packageNames: ["transformers", "@huggingface/inference"],
    configFiles: [],
    searchableTerms: ["huggingface", "transformers", "hf", "hub", "models"],
    primaryColor: "#FFD21E",
    backgroundColor: "#FEFCE8",
    borderColor: "#FEF08A",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#FFD21E"/>
      <circle cx="11" cy="13" r="2.5" fill="#24292E"/>
      <circle cx="21" cy="13" r="2.5" fill="#24292E"/>
      <path d="M11 20c2.5 3 7.5 3 10 0" stroke="#24292E" stroke-width="2.2" stroke-linecap="round" fill="none"/>`
  },
  pytorch: {
    id: "pytorch",
    name: "PyTorch",
    officialName: "PyTorch Deep Learning",
    category: "ai_ml",
    aliases: ["pytorch", "torch", "torchvision"],
    fileExtensions: [],
    packageNames: ["torch", "torchvision", "torchaudio"],
    configFiles: [],
    searchableTerms: ["pytorch", "torch", "deep learning", "neural network", "tensors"],
    primaryColor: "#EE4C2C",
    backgroundColor: "#FFF1F2",
    borderColor: "#FECDD3",
    iconSvg: `<path d="M19 4L8 15c-3 3-3 8 0 11s8 3 11 0l5-5-2-2-5 5c-2 2-5 2-7 0s-2-5 0-7l11-11-2-2z" fill="#EE4C2C"/>
      <circle cx="23" cy="8" r="2.5" fill="#EE4C2C"/>`
  },
  tensorflow: {
    id: "tensorflow",
    name: "TensorFlow",
    officialName: "TensorFlow",
    category: "ai_ml",
    aliases: ["tensorflow", "tf", "keras"],
    fileExtensions: [],
    packageNames: ["tensorflow", "keras", "@tensorflow/tfjs"],
    configFiles: [],
    searchableTerms: ["tensorflow", "keras", "tf", "machine learning"],
    primaryColor: "#FF6F00",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    iconSvg: `<path d="M16 2l12 7-5 3-7-4.1L9 12 4 9l12-7z" fill="#FF6F00"/>
      <path d="M4 11l12 7v12L4 23V11zm24 0v12l-12 7V18l12-7z" fill="#E65100"/>`
  },
  vector_store: {
    id: "vector_store",
    name: "Vector Store",
    officialName: "Vector Store / Embeddings Index",
    category: "ai_ml",
    aliases: ["vector_store", "vector-db", "chromadb", "pinecone", "faiss", "qdrant", "weaviate", "embeddings"],
    fileExtensions: [],
    packageNames: ["chromadb", "@pinecone-database/pinecone", "faiss", "weaviate-client", "@qdrant/js-client-rest"],
    configFiles: [],
    searchableTerms: ["vector store", "vector db", "rag", "embeddings", "semantic search"],
    primaryColor: "#0891B2",
    backgroundColor: "#ECFEFF",
    borderColor: "#A5F3FC",
    iconSvg: `<rect x="4" y="4" width="10" height="10" rx="3" fill="#0891B2"/>
      <rect x="18" y="4" width="10" height="10" rx="3" fill="#0891B2" opacity="0.6"/>
      <rect x="4" y="18" width="10" height="10" rx="3" fill="#0891B2" opacity="0.6"/>
      <rect x="18" y="18" width="10" height="10" rx="3" fill="#0891B2"/>
      <circle cx="16" cy="16" r="3" fill="#06B6D4"/>`
  },
  rag_pipeline: {
    id: "rag_pipeline",
    name: "RAG Engine",
    officialName: "Retrieval-Augmented Generation Engine",
    category: "ai_ml",
    aliases: ["rag", "rag_pipeline", "retrieval", "chunker", "indexer"],
    fileExtensions: [],
    packageNames: ["langchain", "@langchain/core", "llamaindex"],
    configFiles: [],
    searchableTerms: ["rag", "retrieval", "knowledge base", "grounding", "chunks"],
    primaryColor: "#4F46E5",
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    iconSvg: `<path d="M6 10h12l8 8v8H6V10z" fill="none" stroke="#4F46E5" stroke-width="2"/>
      <path d="M18 10v8h8" stroke="#4F46E5" stroke-width="1.8"/>
      <path d="M12 24l3 3 6-6" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  },

  // ==========================================
  // CLOUD & DEVOPS
  // ==========================================
  docker: {
    id: "docker",
    name: "Docker",
    officialName: "Docker Container Engine",
    category: "cloud_infra",
    aliases: ["docker", "dockerfile", "container"],
    fileExtensions: [],
    packageNames: [],
    configFiles: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".dockerignore"],
    searchableTerms: ["docker", "container", "dockerfile", "compose"],
    primaryColor: "#2496ED",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M4 18c1-4 5-6 12-6 8 0 12 3 13 6-2 5-7 8-13 8s-10-3-12-8z" fill="#2496ED"/>
      <rect x="7" y="10" width="3" height="3" fill="#2496ED"/>
      <rect x="11" y="10" width="3" height="3" fill="#2496ED"/>
      <rect x="15" y="10" width="3" height="3" fill="#2496ED"/>
      <rect x="11" y="6" width="3" height="3" fill="#2496ED"/>
      <rect x="15" y="6" width="3" height="3" fill="#2496ED"/>
      <rect x="19" y="10" width="3" height="3" fill="#2496ED"/>`
  },
  kubernetes: {
    id: "kubernetes",
    name: "Kubernetes",
    officialName: "Kubernetes (K8s)",
    category: "cloud_infra",
    aliases: ["k8s", "kubernetes", "helm"],
    fileExtensions: [],
    packageNames: [],
    configFiles: ["k8s.yaml", "deployment.yaml"],
    searchableTerms: ["k8s", "kubernetes", "cluster", "pods", "helm"],
    primaryColor: "#326CE5",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#326CE5"/>
      <polygon points="16,6 25,11 25,21 16,26 7,21 7,11" fill="none" stroke="#FFFFFF" stroke-width="1.8"/>
      <circle cx="16" cy="16" r="3" fill="#FFFFFF"/>`
  },
  aws: {
    id: "aws",
    name: "AWS",
    officialName: "Amazon Web Services",
    category: "cloud_infra",
    aliases: ["aws", "amazon-web-services", "s3", "lambda", "ec2"],
    fileExtensions: [],
    packageNames: ["aws-sdk", "@aws-sdk/client-s3", "boto3"],
    configFiles: ["serverless.yml", "sam.yaml", "cdk.json"],
    searchableTerms: ["aws", "amazon cloud", "lambda", "s3", "ec2"],
    primaryColor: "#FF9900",
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
    iconSvg: `<rect width="32" height="32" rx="6" fill="#232F3E"/>
      <text x="16" y="17" font-family="system-ui, sans-serif" font-size="9" font-weight="900" fill="#FFFFFF" text-anchor="middle">aws</text>
      <path d="M8 22c5 3 11 3 16 0" stroke="#FF9900" stroke-width="2" stroke-linecap="round" fill="none"/>`
  },
  gcp: {
    id: "gcp",
    name: "Google Cloud",
    officialName: "Google Cloud Platform",
    category: "cloud_infra",
    aliases: ["gcp", "google-cloud", "cloud-run", "app-engine"],
    fileExtensions: [],
    packageNames: ["@google-cloud/storage", "@google-cloud/firestore"],
    configFiles: ["app.yaml", "cloudbuild.yaml"],
    searchableTerms: ["gcp", "google cloud", "cloud run", "bigquery"],
    primaryColor: "#4285F4",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M16 6l8 5v10l-8 5-8-5V11l8-5z" fill="none" stroke="#4285F4" stroke-width="2.5"/>
      <circle cx="16" cy="16" r="3" fill="#EA4335"/>`
  },
  azure: {
    id: "azure",
    name: "Azure",
    officialName: "Microsoft Azure",
    category: "cloud_infra",
    aliases: ["azure", "ms-azure", "azure-functions"],
    fileExtensions: [],
    packageNames: ["@azure/storage-blob", "@azure/identity"],
    configFiles: ["host.json"],
    searchableTerms: ["azure", "microsoft cloud", "blob storage"],
    primaryColor: "#0078D4",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M6 24l8-18 6 12-8 6H6z" fill="#0078D4"/>
      <path d="M15 17l4-9 7 16H14l1-7z" fill="#50E6FF"/>`
  },
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare",
    officialName: "Cloudflare Workers & CDN",
    category: "cloud_infra",
    aliases: ["cloudflare", "workers", "wrangler"],
    fileExtensions: [],
    packageNames: ["wrangler"],
    configFiles: ["wrangler.toml"],
    searchableTerms: ["cloudflare", "cdn", "workers", "edge"],
    primaryColor: "#F38020",
    backgroundColor: "#FFF7ED",
    borderColor: "#FFEDD5",
    iconSvg: `<path d="M22 17c0-3-2.5-5-5.5-5-.8 0-1.5.2-2.2.5C13.5 10.5 11 9 8.5 9 5 9 2 12 2 16c0 .3 0 .7.1 1h20.8c.6-.6 1.1-1.5 1.1-2.5 0-1.5-1-2.8-2-2.5z" fill="#F38020"/>`
  },
  vercel: {
    id: "vercel",
    name: "Vercel",
    officialName: "Vercel Deployment Platform",
    category: "cloud_infra",
    aliases: ["vercel", "now"],
    fileExtensions: [],
    packageNames: ["@vercel/node", "@vercel/blob"],
    configFiles: ["vercel.json"],
    searchableTerms: ["vercel", "serverless", "edge deployment"],
    primaryColor: "#000000",
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    iconSvg: `<polygon points="16,5 29,27 3,27" fill="#000000"/>`
  },

  // ==========================================
  // DEV TOOLS & REPOSITORIES
  // ==========================================
  git: {
    id: "git",
    name: "Git",
    officialName: "Git Version Control",
    category: "devtools",
    aliases: ["git", "github", "gitlab"],
    fileExtensions: [],
    packageNames: [],
    configFiles: [".gitignore", ".gitmodules"],
    searchableTerms: ["git", "version control", "repo", "commit"],
    primaryColor: "#F05032",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<rect x="4" y="4" width="24" height="24" rx="4" transform="rotate(45 16 16)" fill="#F05032"/>
      <circle cx="16" cy="10" r="2.5" fill="#FFFFFF"/>
      <circle cx="16" cy="22" r="2.5" fill="#FFFFFF"/>
      <circle cx="22" cy="16" r="2.5" fill="#FFFFFF"/>
      <path d="M16 10v12M16 16l6 0" stroke="#FFFFFF" stroke-width="2"/>`
  },
  github: {
    id: "github",
    name: "GitHub",
    officialName: "GitHub Actions & Repo",
    category: "devtools",
    aliases: ["github", "github-actions"],
    fileExtensions: [],
    packageNames: ["@octokit/rest"],
    configFiles: [],
    searchableTerms: ["github", "octocat", "actions", "repo"],
    primaryColor: "#24292E",
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    iconSvg: `<circle cx="16" cy="16" r="14" fill="#24292E"/>
      <path d="M16 8c-4.4 0-8 3.6-8 8 0 3.5 2.3 6.5 5.5 7.6.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1.1-2.7-1.1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.2-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8.6-.2 1.3-.3 2-.3s1.4.1 2 .3c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.6.6.8 1.3.8 2.2 0 3.1-1.9 3.8-3.7 4 .3.3.6.8.6 1.6v2.4c0 .2.2.5.6.4C21.7 22.5 24 19.5 24 16c0-4.4-3.6-8-8-8z" fill="#FFFFFF"/>`
  },
  jupyter: {
    id: "jupyter",
    name: "Jupyter",
    officialName: "Jupyter Notebook",
    category: "devtools",
    aliases: ["jupyter", "ipynb", "notebook"],
    fileExtensions: [".ipynb"],
    packageNames: ["jupyter", "ipykernel", "notebook"],
    configFiles: [],
    searchableTerms: ["jupyter", "notebook", "ipynb", "interactive python"],
    primaryColor: "#F37626",
    backgroundColor: "#FFF7ED",
    borderColor: "#FFEDD5",
    iconSvg: `<circle cx="16" cy="7" r="3" fill="#F37626"/>
      <circle cx="16" cy="25" r="3" fill="#F37626"/>
      <ellipse cx="16" cy="16" rx="13" ry="5.5" fill="none" stroke="#767676" stroke-width="2"/>`
  },

  // ==========================================
  // CORE SYSTEM & ARCHITECTURAL ENTITIES
  // ==========================================
  client: {
    id: "client",
    name: "Client / Browser",
    officialName: "Web Browser / Client",
    category: "entity",
    aliases: ["client", "browser", "web-client", "frontend-app", "ui", "user"],
    searchableTerms: ["client", "browser", "user interface", "spa", "portal", "user"],
    primaryColor: "#2563EB",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<rect x="3" y="5" width="26" height="20" rx="3" fill="none" stroke="#2563EB" stroke-width="2"/>
      <path d="M3 10h26" stroke="#2563EB" stroke-width="1.8"/>
      <circle cx="6.5" cy="7.5" r="1" fill="#2563EB"/>
      <circle cx="9.5" cy="7.5" r="1" fill="#2563EB"/>
      <circle cx="12.5" cy="7.5" r="1" fill="#2563EB"/>
      <path d="M11 25h10M16 25v3" stroke="#2563EB" stroke-width="2" stroke-linecap="round"/>`
  },
  mobile_app: {
    id: "mobile_app",
    name: "Mobile App",
    officialName: "Mobile Application (iOS/Android)",
    category: "entity",
    aliases: ["mobile", "mobile_app", "ios", "android", "flutter", "react-native"],
    searchableTerms: ["mobile", "app", "ios", "android", "device"],
    primaryColor: "#7C3AED",
    backgroundColor: "#F5F3FF",
    borderColor: "#DDD6FE",
    iconSvg: `<rect x="7" y="3" width="18" height="26" rx="4" fill="none" stroke="#7C3AED" stroke-width="2"/>
      <circle cx="16" cy="24" r="1.5" fill="#7C3AED"/>
      <line x1="13" y1="6" x2="19" y2="6" stroke="#7C3AED" stroke-width="1.5" stroke-linecap="round"/>`
  },
  api_gateway: {
    id: "api_gateway",
    name: "API Gateway",
    officialName: "API Gateway / Reverse Proxy",
    category: "entity",
    aliases: ["api_gateway", "gateway", "router", "reverse-proxy", "nginx", "route", "api"],
    searchableTerms: ["api gateway", "proxy", "router", "endpoints", "ingress"],
    primaryColor: "#4F46E5",
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    iconSvg: `<circle cx="7" cy="16" r="3.5" fill="#4F46E5"/>
      <circle cx="25" cy="9" r="3.5" fill="#4F46E5"/>
      <circle cx="25" cy="23" r="3.5" fill="#4F46E5"/>
      <path d="M10.5 16h6l5-6M16.5 16l5 6" stroke="#4F46E5" stroke-width="2" stroke-linecap="round" fill="none"/>`
  },
  server: {
    id: "server",
    name: "Server / Service",
    officialName: "Application Server / Microservice",
    category: "entity",
    aliases: ["server", "backend", "service", "app-server", "microservice"],
    searchableTerms: ["server", "service", "backend", "compute", "node"],
    primaryColor: "#059669",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    iconSvg: `<rect x="4" y="4" width="24" height="7" rx="2" fill="none" stroke="#059669" stroke-width="2"/>
      <rect x="4" y="13" width="24" height="7" rx="2" fill="none" stroke="#059669" stroke-width="2"/>
      <rect x="4" y="22" width="24" height="7" rx="2" fill="none" stroke="#059669" stroke-width="2"/>
      <circle cx="8" cy="7.5" r="1.2" fill="#059669"/>
      <circle cx="8" cy="16.5" r="1.2" fill="#059669"/>
      <circle cx="8" cy="25.5" r="1.2" fill="#059669"/>
      <line x1="20" y1="7.5" x2="24" y2="7.5" stroke="#059669" stroke-width="1.5"/>
      <line x1="20" y1="16.5" x2="24" y2="16.5" stroke="#059669" stroke-width="1.5"/>
      <line x1="20" y1="25.5" x2="24" y2="25.5" stroke="#059669" stroke-width="1.5"/>`
  },
  database_generic: {
    id: "database_generic",
    name: "Database",
    officialName: "Durable Data Store",
    category: "entity",
    aliases: ["database", "db", "storage", "datastore", "rdbms", "sql"],
    searchableTerms: ["database", "storage", "db", "persistence", "tables"],
    primaryColor: "#D97706",
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
    iconSvg: `<ellipse cx="16" cy="7" rx="10" ry="3.5" fill="none" stroke="#D97706" stroke-width="2"/>
      <path d="M6 7v8c0 2 4.5 3.5 10 3.5s10-1.5 10-3.5V7" fill="none" stroke="#D97706" stroke-width="2"/>
      <path d="M6 15v8c0 2 4.5 3.5 10 3.5s10-1.5 10-3.5v-8" fill="none" stroke="#D97706" stroke-width="2"/>`
  },
  auth_security: {
    id: "auth_security",
    name: "Auth & Security",
    officialName: "Authentication / JWT / IAM",
    category: "entity",
    aliases: ["auth", "security", "jwt", "oauth", "iam", "login"],
    searchableTerms: ["auth", "security", "jwt", "oauth", "permissions", "encryption"],
    primaryColor: "#DB2777",
    backgroundColor: "#FDF2F8",
    borderColor: "#FBCFE8",
    iconSvg: `<rect x="6" y="12" width="20" height="15" rx="3" fill="none" stroke="#DB2777" stroke-width="2"/>
      <path d="M10 12V8a6 6 0 0 1 12 0v4" fill="none" stroke="#DB2777" stroke-width="2" stroke-linecap="round"/>
      <circle cx="16" cy="19" r="2" fill="#DB2777"/>
      <path d="M16 21v3" stroke="#DB2777" stroke-width="2" stroke-linecap="round"/>`
  },
  queue_worker: {
    id: "queue_worker",
    name: "Queue / Worker",
    officialName: "Message Queue & Worker Pipeline",
    category: "entity",
    aliases: ["queue", "worker", "job", "kafka", "rabbitmq", "celery", "bullmq"],
    searchableTerms: ["queue", "worker", "pipeline", "async jobs", "messages"],
    primaryColor: "#EA580C",
    backgroundColor: "#FFF7ED",
    borderColor: "#FFEDD5",
    iconSvg: `<rect x="3" y="10" width="7" height="12" rx="2" fill="#EA580C"/>
      <rect x="12.5" y="10" width="7" height="12" rx="2" fill="#EA580C"/>
      <rect x="22" y="10" width="7" height="12" rx="2" fill="#EA580C"/>
      <path d="M6.5 6l6 3-6 3M16 6l6 3-6 3" stroke="#EA580C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  },
  cloud_gateway: {
    id: "cloud_gateway",
    name: "Cloud Gateway",
    officialName: "External Cloud API / Third-Party",
    category: "entity",
    aliases: ["cloud", "external", "third_party", "webhook", "gateway_ext"],
    searchableTerms: ["cloud", "external api", "integration", "webhook", "gateway"],
    primaryColor: "#0284C7",
    backgroundColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    iconSvg: `<path d="M24 16.5a6 6 0 0 0-11-2.5 5 5 0 0 0-7 4.5A4.5 4.5 0 0 0 10.5 23H24a5 5 0 0 0 0-10l0 3.5z" fill="none" stroke="#0284C7" stroke-width="2.2" stroke-linejoin="round"/>`
  },

  // ==========================================
  // DOCUMENT & FILE FORMATS
  // ==========================================
  file_json: {
    id: "file_json",
    name: "JSON",
    officialName: "JSON Data File",
    category: "file_type",
    aliases: ["json", "jsonc"],
    fileExtensions: [".json", ".jsonc"],
    searchableTerms: ["json", "config", "data"],
    primaryColor: "#EAB308",
    backgroundColor: "#FEFCE8",
    borderColor: "#FEF08A",
    iconSvg: `<rect x="5" y="4" width="22" height="24" rx="4" fill="#FEFCE8" stroke="#EAB308" stroke-width="2"/>
      <text x="16" y="19" font-family="monospace" font-size="10" font-weight="900" fill="#CA8A04" text-anchor="middle">{ }</text>`
  },
  file_yaml: {
    id: "file_yaml",
    name: "YAML",
    officialName: "YAML Configuration File",
    category: "file_type",
    aliases: ["yaml", "yml"],
    fileExtensions: [".yaml", ".yml"],
    searchableTerms: ["yaml", "yml", "config"],
    primaryColor: "#DC2626",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<rect x="5" y="4" width="22" height="24" rx="4" fill="#FEF2F2" stroke="#DC2626" stroke-width="2"/>
      <text x="16" y="19" font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#DC2626" text-anchor="middle">YML</text>`
  },
  file_markdown: {
    id: "file_markdown",
    name: "Markdown",
    officialName: "Markdown Document",
    category: "file_type",
    aliases: ["markdown", "md", "mdx"],
    fileExtensions: [".md", ".markdown", ".mdx"],
    searchableTerms: ["markdown", "md", "documentation", "readme"],
    primaryColor: "#0284C7",
    backgroundColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    iconSvg: `<rect x="4" y="6" width="24" height="20" rx="3" fill="none" stroke="#0284C7" stroke-width="2"/>
      <path d="M8 19V13l3 4 3-4v6M20 13v6l3-3" stroke="#0284C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  },
  file_pdf: {
    id: "file_pdf",
    name: "PDF",
    officialName: "Portable Document Format",
    category: "file_type",
    aliases: ["pdf"],
    fileExtensions: [".pdf"],
    searchableTerms: ["pdf", "document", "report"],
    primaryColor: "#EF4444",
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    iconSvg: `<path d="M7 4h12l7 7v17H7V4z" fill="#FEF2F2" stroke="#EF4444" stroke-width="2"/>
      <path d="M19 4v7h7" stroke="#EF4444" stroke-width="1.8"/>
      <text x="16" y="23" font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#EF4444" text-anchor="middle">PDF</text>`
  },
  file_docx: {
    id: "file_docx",
    name: "Word",
    officialName: "Microsoft Word Document",
    category: "file_type",
    aliases: ["docx", "doc"],
    fileExtensions: [".docx", ".doc"],
    searchableTerms: ["word", "doc", "docx", "office"],
    primaryColor: "#2563EB",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    iconSvg: `<path d="M7 4h12l7 7v17H7V4z" fill="#EFF6FF" stroke="#2563EB" stroke-width="2"/>
      <path d="M19 4v7h7" stroke="#2563EB" stroke-width="1.8"/>
      <text x="16" y="23" font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#2563EB" text-anchor="middle">DOC</text>`
  },
  file_xlsx: {
    id: "file_xlsx",
    name: "Excel",
    officialName: "Microsoft Excel Spreadsheet",
    category: "file_type",
    aliases: ["xlsx", "xls", "csv"],
    fileExtensions: [".xlsx", ".xls", ".csv"],
    searchableTerms: ["excel", "sheet", "spreadsheet", "csv", "table"],
    primaryColor: "#10B981",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    iconSvg: `<path d="M7 4h12l7 7v17H7V4z" fill="#ECFDF5" stroke="#10B981" stroke-width="2"/>
      <path d="M19 4v7h7" stroke="#10B981" stroke-width="1.8"/>
      <text x="16" y="23" font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#10B981" text-anchor="middle">XLS</text>`
  },
  file_pptx: {
    id: "file_pptx",
    name: "PowerPoint",
    officialName: "Microsoft PowerPoint Presentation",
    category: "file_type",
    aliases: ["pptx", "ppt"],
    fileExtensions: [".pptx", ".ppt"],
    searchableTerms: ["powerpoint", "presentation", "slides", "deck"],
    primaryColor: "#EA580C",
    backgroundColor: "#FFF7ED",
    borderColor: "#FFEDD5",
    iconSvg: `<path d="M7 4h12l7 7v17H7V4z" fill="#FFF7ED" stroke="#EA580C" stroke-width="2"/>
      <path d="M19 4v7h7" stroke="#EA580C" stroke-width="1.8"/>
      <text x="16" y="23" font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#EA580C" text-anchor="middle">PPT</text>`
  },
  file_doc: {
    id: "file_doc",
    name: "File / Source",
    officialName: "Source File / Asset",
    category: "file_type",
    aliases: ["file", "document", "asset", "src"],
    fileExtensions: [],
    searchableTerms: ["file", "doc", "asset", "source file"],
    primaryColor: "#475569",
    backgroundColor: "#F8FAFC",
    borderColor: "#CBD5E1",
    iconSvg: `<path d="M7 4h12l7 7v17H7V4z" fill="none" stroke="#475569" stroke-width="2"/>
      <path d="M19 4v7h7" stroke="#475569" stroke-width="1.8"/>
      <line x1="11" y1="15" x2="21" y2="15" stroke="#475569" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="11" y1="19" x2="21" y2="19" stroke="#475569" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="11" y1="23" x2="17" y2="23" stroke="#475569" stroke-width="1.8" stroke-linecap="round"/>`
  }
};

/**
 * Deterministically resolves the best-matching architecture icon for any node, entity, file, or tech name.
 * 
 * Follows strict priority order:
 * 1. Exact ID match
 * 2. Exact technology / framework match
 * 3. Package name / library match
 * 4. Programming language match
 * 5. File extension / config file match
 * 6. Known alias / keyword search match
 * 7. Verified generic technical entity icon
 */
export function resolveArchitectureIcon(entity: {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  technology?: string;
  subType?: string;
  path?: string;
  package?: string;
  ext?: string;
}): ResolvedIcon {
  const normTech = (entity.technology || "").trim().toLowerCase();
  const normLabel = (entity.label || entity.name || "").trim().toLowerCase();
  const normType = (entity.type || "").trim().toLowerCase();
  const normSubType = (entity.subType || "").trim().toLowerCase();
  const normPath = (entity.path || "").trim().toLowerCase();
  const normPkg = (entity.package || "").trim().toLowerCase();
  const normExt = (entity.ext || "").trim().toLowerCase();

  const registryEntries = Object.values(ARCHITECTURE_ICON_REGISTRY);

  // 1. Exact ID match
  if (entity.id && ARCHITECTURE_ICON_REGISTRY[entity.id.toLowerCase()]) {
    const icon = ARCHITECTURE_ICON_REGISTRY[entity.id.toLowerCase()];
    return { ...icon, matchedBy: "exact_id" };
  }

  // 2. Exact Technology / Framework matching
  if (normTech.length > 0) {
    for (const item of registryEntries) {
      if (item.id === normTech || item.aliases.some(a => a === normTech) || item.name.toLowerCase() === normTech) {
        return { ...item, matchedBy: "technology" };
      }
    }
  }

  // 3. Package Name matching
  if (normPkg.length > 0) {
    for (const item of registryEntries) {
      if (item.packageNames?.some(p => p.toLowerCase() === normPkg || normPkg.includes(p.toLowerCase()))) {
        return { ...item, matchedBy: "package" };
      }
    }
  }

  // 4. File Extension / Config File matching
  const ext = normExt || (normPath.includes(".") ? "." + normPath.split(".").pop() : "");
  if (ext) {
    const cleanExt = ext.startsWith(".") ? ext : `.${ext}`;
    for (const item of registryEntries) {
      if (item.fileExtensions?.some(e => e.toLowerCase() === cleanExt.toLowerCase())) {
        return { ...item, matchedBy: "file_extension" };
      }
    }
  }

  // Config files matching
  if (normPath || normLabel) {
    const fileName = (normPath ? normPath.split("/").pop() : normLabel) || "";
    for (const item of registryEntries) {
      if (item.configFiles?.some(c => c.toLowerCase() === fileName.toLowerCase())) {
        return { ...item, matchedBy: "config_file" };
      }
    }
  }

  // 5. Keyword & Searchable Terms Search
  const compositeSearch = `${normLabel} ${normTech} ${normSubType} ${normPath}`.toLowerCase();
  for (const item of registryEntries) {
    if (item.searchableTerms.some(t => compositeSearch.includes(t.toLowerCase()))) {
      return { ...item, matchedBy: "alias" };
    }
    if (item.aliases.some(a => compositeSearch.includes(a))) {
      return { ...item, matchedBy: "alias" };
    }
  }

  // 6. Entity Type Mapping
  if (["user", "client", "frontend", "ui", "page", "browser", "component"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.client, matchedBy: "entity_type" };
  }
  if (["api", "route", "gateway", "router", "controller", "endpoint"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.api_gateway, matchedBy: "entity_type" };
  }
  if (["server", "backend", "service", "process", "core"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.server, matchedBy: "entity_type" };
  }
  if (["database", "db", "table", "schema", "storage", "model"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.database_generic, matchedBy: "entity_type" };
  }
  if (["auth", "security", "token", "session", "jwt"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.auth_security, matchedBy: "entity_type" };
  }
  if (["rag", "vector", "embedding", "ai", "llm"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.vector_store, matchedBy: "entity_type" };
  }
  if (["external", "cloud", "gateway_ext", "third_party"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.cloud_gateway, matchedBy: "entity_type" };
  }
  if (["queue", "worker", "job", "pipeline"].includes(normType)) {
    return { ...ARCHITECTURE_ICON_REGISTRY.queue_worker, matchedBy: "entity_type" };
  }

  // 7. Safe default file / asset entity
  return { ...ARCHITECTURE_ICON_REGISTRY.file_doc, matchedBy: "fallback" };
}

/**
 * Generates a standalone, self-contained SVG string for any icon definition.
 */
export function getIconSvg(iconIdOrDef: string | TechnologyIconDefinition | ResolvedIcon, size = 32): string {
  const icon = typeof iconIdOrDef === "string" 
    ? (ARCHITECTURE_ICON_REGISTRY[iconIdOrDef] || resolveArchitectureIcon({ id: iconIdOrDef }))
    : iconIdOrDef;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${icon.iconSvg}</svg>`;
}

/**
 * Generates a Base64 data URI SVG representation for canvas / cytoscape / img tags.
 */
export function getIconDataUri(iconIdOrDef: string | TechnologyIconDefinition | ResolvedIcon, size = 32): string {
  const svgStr = getIconSvg(iconIdOrDef, size);
  return `data:image/svg+xml;base64,${Buffer.from(svgStr, "utf-8").toString("base64")}`;
}

/**
 * Get all available icons in the registry
 */
export function getAllArchitectureIcons(): TechnologyIconDefinition[] {
  return Object.values(ARCHITECTURE_ICON_REGISTRY);
}
