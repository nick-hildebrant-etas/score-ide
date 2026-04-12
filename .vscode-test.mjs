import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/suite/**/*.test.js",
  launchArgs: ["--headless", "--no-sandbox", "--disable-gpu"],
});
