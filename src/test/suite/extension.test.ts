/**
 * Extension-host tests — run inside the VS Code process via `npm run test:suite`.
 *
 * Two suites:
 *   1. parseDaggerFunctions — pure parser logic; no VS Code API called, but the
 *      function lives in extension.ts which imports vscode, so an extension-host
 *      context is required to load the module without mocking.
 *   2. ServicesProvider — verifies tree-item construction and env-binding using
 *      the real vscode.TreeItem / vscode.ThemeIcon APIs.
 */

import * as assert from "assert";
import { parseDaggerFunctions } from "../../extension";
import { ServicesProvider } from "../../servicesProvider";
import { SERVICES } from "../../services";

// ── parseDaggerFunctions ──────────────────────────────────────────────────────

suite("parseDaggerFunctions", () => {
  test("empty input returns empty array", () => {
    assert.deepStrictEqual(parseDaggerFunctions(""), []);
  });

  test("blank-only input returns empty array", () => {
    assert.deepStrictEqual(parseDaggerFunctions("   \n  \n"), []);
  });

  test("header and separator lines are skipped", () => {
    const input = [
      "Name    Description",
      "─────   ──────────────────",
      "build   Build a repository",
    ].join("\n");
    assert.deepStrictEqual(parseDaggerFunctions(input), [
      { name: "build", description: "Build a repository" },
    ]);
  });

  test("parses name-only entry (no description column)", () => {
    const input = "Name\n─────\nbuild";
    assert.deepStrictEqual(parseDaggerFunctions(input), [
      { name: "build", description: "" },
    ]);
  });

  test("parses multiple functions", () => {
    const input = [
      "Name    Description",
      "─────   ──────────────────",
      "build   Build a repository",
      "test    Run tests",
      "shell   Open a shell",
    ].join("\n");
    const result = parseDaggerFunctions(input);
    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result[1], {
      name: "test",
      description: "Run tests",
    });
  });

  test("strips ANSI escape codes before parsing", () => {
    // Dagger sometimes emits bold function names
    const input =
      "\x1b[1mName\x1b[0m    Description\n\x1b[1mbuild\x1b[0m   Build";
    const result = parseDaggerFunctions(input);
    // Header line should be skipped; build should be parsed cleanly
    assert.ok(
      result.some((f) => f.name === "build" && f.description === "Build"),
      `expected {name:'build', description:'Build'}, got: ${JSON.stringify(result)}`,
    );
  });

  test("ASCII separator line (dashes) is skipped", () => {
    const input = "Name    Description\n-----   ------\nbuild   Build";
    const result = parseDaggerFunctions(input);
    assert.deepStrictEqual(result, [{ name: "build", description: "Build" }]);
  });

  test("kebab-case names like test-otel and test-ocr are parsed", () => {
    const input = [
      "Name    Description",
      "─────   ──────────────────",
      "test-otel   Verify OTel service binding",
      "test-ocr    Verify OCR service binding",
    ].join("\n");
    assert.deepStrictEqual(parseDaggerFunctions(input), [
      { name: "test-otel", description: "Verify OTel service binding" },
      { name: "test-ocr", description: "Verify OCR service binding" },
    ]);
  });
});

// ── ServicesProvider ──────────────────────────────────────────────────────────

suite("ServicesProvider — initial state", () => {
  let provider: ServicesProvider;

  const setRunning = (serviceId: string, port: number) => {
    const states = (
      provider as unknown as {
        states: Map<string, { status: string; port?: number }>;
      }
    ).states;
    states.set(serviceId, { status: "running", port });
  };

  setup(() => {
    provider = new ServicesProvider(() => undefined);
  });

  test("getChildren returns one item per SERVICES entry", () => {
    const items = provider.getChildren();
    assert.strictEqual(items.length, SERVICES.length);
  });

  test("every item starts in stopped state (contextValue == service-stopped)", () => {
    const items = provider.getChildren();
    for (const item of items) {
      assert.strictEqual(
        item.contextValue,
        "service-stopped",
        `expected service-stopped for "${String(item.label)}"`,
      );
    }
  });

  test('every item description is "Stopped"', () => {
    const items = provider.getChildren();
    for (const item of items) {
      assert.strictEqual(
        item.description,
        "Stopped",
        `expected description "Stopped" for "${String(item.label)}"`,
      );
    }
  });

  test("tree item labels match service definitions in order", () => {
    const items = provider.getChildren();
    const labels = items.map((i) => String(i.label));
    const expected = SERVICES.map((s) => s.label);
    assert.deepStrictEqual(labels, expected);
  });

  test("bindEnv returns empty object when all services are stopped", () => {
    assert.deepStrictEqual(provider.bindEnv(), {});
  });

  test("bindServiceArgs returns empty array when all services are stopped", () => {
    assert.deepStrictEqual(provider.bindServiceArgs(), []);
  });

  test("bindServiceArgs includes --otel when OTel service is running", () => {
    setRunning("otel-webui", 4318);
    const args = provider.bindServiceArgs();
    assert.strictEqual(args[0], "--otel");
    assert.ok(args[1].startsWith("tcp://"));
    assert.ok(args[1].endsWith(":4318"));
  });

  test("bindServiceArgs includes --ocr when OCR service is running", () => {
    setRunning("ocr", 8080);
    const args = provider.bindServiceArgs();
    assert.strictEqual(args[0], "--ocr");
    assert.ok(args[1].startsWith("tcp://"));
    assert.ok(args[1].endsWith(":8080"));
  });

  test("bindServiceArgs includes both flags in SERVICES order when both are running", () => {
    setRunning("otel-webui", 4318);
    setRunning("ocr", 8080);
    const args = provider.bindServiceArgs();
    assert.deepStrictEqual(
      args.filter((_, idx) => idx % 2 === 0),
      ["--otel", "--ocr"],
    );
    assert.ok(args[1].startsWith("tcp://") && args[1].endsWith(":4318"));
    assert.ok(args[3].startsWith("tcp://") && args[3].endsWith(":8080"));
  });

  test("bindServiceArgsForFunction filters to function-accepted flags", () => {
    setRunning("otel-webui", 4318);
    setRunning("ocr", 8080);

    const anyProvider = provider as unknown as {
      getAcceptedFlags: (fnName: string) => Set<string>;
    };
    anyProvider.getAcceptedFlags = (fnName: string) =>
      fnName === "test-otel" ? new Set(["otel"]) : new Set(["ocr"]);

    const otelArgs = provider.bindServiceArgsForFunction("test-otel");
    assert.deepStrictEqual(otelArgs[0], "--otel");
    assert.strictEqual(otelArgs.length, 2);

    const ocrArgs = provider.bindServiceArgsForFunction("test-ocr");
    assert.deepStrictEqual(ocrArgs[0], "--ocr");
    assert.strictEqual(ocrArgs.length, 2);
  });
});
