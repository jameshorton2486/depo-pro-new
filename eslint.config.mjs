import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    ".verify-*/**",
    "next-env.d.ts",
    // A local measurement harness, not shipping code. It is excluded from the repository via
    // .git/info/exclude, so CI clones a tree that has never contained it and lints clean --
    // which is why this failed only in the one working tree that holds the directory, and only
    // once that tree was reattached to main.
    //
    // The rule and the file are both correct and cannot be reconciled: render_workspace_proof.cjs
    // is CommonJS, so require() is the only import form available to it. Ignoring is the fix;
    // rewriting a .cjs to use ESM imports is not.
    "geometry-proof/**",
    // Nested Claude worktrees contain their own generated .next/dist artifacts and are separate
    // repositories. The root release check must lint this checkout, not recursively lint those.
    ".claude/worktrees/**",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]);

export default eslintConfig;
