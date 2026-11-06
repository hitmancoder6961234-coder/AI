import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Lint policy: rules that catch real bugs (undefined names, duplicate keys, unreachable code, bad typeof, ...) are
 * ERRORS and fail `npm run lint` / CI. Style and hygiene rules (unused variables, empty blocks, ...) are WARNINGS so the
 * existing code base can be cleaned up gradually without blocking work. Tighten a warning to an error once its count is 0.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**", "node_modules/**", "legacy/**", "site/**", "download/**", "icon/**", "data/**", "deploy/**",
      "web/public/**", "web/vendor/**", "server.js", "sw.js", "api/**", "**/*.min.js", "**/*.map",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // hygiene: warn, never fail the build
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-control-regex": "warn",
      "no-prototype-builtins": "warn",
      "no-case-declarations": "warn",
      "no-inner-declarations": "off",
      "no-async-promise-executor": "warn",
      "prefer-const": "warn",
      "no-var": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-this-alias": "warn",
    },
  },
  // Browser code: runs in the page, shares globals through window.Darkness.
  {
    files: ["web/**/*.{js,jsx}"],
    languageOptions: { sourceType: "module", globals: { ...globals.browser, Darkness: "writable", module: "readonly" } },
    rules: { "no-undef": "error" },
  },
  // (the project page used to be downgraded here because it called helpers from the wrong tab; those are fixed, so it is a hard error again)
  // Server, scripts and tests: Node.
  {
    files: ["server/**/*.ts", "tests/**/*.ts", "scripts/**/*.{js,mjs,cjs}", "api/**/*.js", "*.{js,mjs,cjs}", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  // TypeScript is checked by the compiler, so name resolution is its job rather than ESLint's.
  { files: ["**/*.ts"], rules: { "no-undef": "off" } },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs", globals: { ...globals.node } } },
);
