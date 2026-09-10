import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Full jsx-a11y strict ruleset (eslint-config-next only ships a subset).
  // Rules only — eslint-config-next already registers the plugin, and flat
  // config forbids redefining it.
  { rules: { ...jsxA11y.flatConfigs.strict.rules } },
  {
    rules: {
      // The canvas nodes are draggable/selectable divs with role="button",
      // tabIndex, and key handlers managed via a roving-tabindex controller;
      // the static-element rules can't see that pattern.
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      // The canvas viewport and the dashboard globe (both role="group") are
      // intentionally focusable so keyboard users can pan/zoom them, and the
      // sidebar resize handle is an ARIA window splitter (focusable
      // separator with aria-valuenow).
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { roles: ["tabpanel", "group", "separator"] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
