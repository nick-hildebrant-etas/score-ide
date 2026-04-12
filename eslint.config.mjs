import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import jsonc from "eslint-plugin-jsonc";

export default [
  // Ignore generated/vendor directories globally
  {
    ignores: ["out/**", "pipelines/node_modules/**", "pipelines/sdk/**", "pipelines/out/**", ".vscode-test/**"],
  },

  // TypeScript sources — extension + pipelines module
  {
    files: ["src/**/*.ts", "pipelines/src/**/*.ts"],
    plugins: { "@typescript-eslint": typescriptEslint },
    languageOptions: { parser: tsParser },
    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
      "@typescript-eslint/no-unused-vars": "warn",
      curly: "warn",
      eqeqeq: "warn",
      "no-throw-literal": "warn",
      semi: "off",
    },
  },

  // pipelines/ uses experimental decorators — override parser options for that subtree
  {
    files: ["pipelines/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { experimentalDecorators: true },
    },
  },

  // JSON and JSONC files
  ...jsonc.configs["flat/recommended-with-jsonc"],

  // .code-workspace files are JSONC (allow comments)
  {
    files: ["**/*.code-workspace"],
    plugins: { jsonc },
    language: "jsonc/jsonc",
    rules: {
      ...jsonc.configs["flat/recommended-with-jsonc"]
        .find((c) => c.rules)?.rules,
      "jsonc/no-comments": "off",
    },
  },
];
