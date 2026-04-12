import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  test("Commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("score-ide.runPipeline"),
      "score-ide.runPipeline should be registered"
    );
    assert.ok(
      commands.includes("score-ide.refreshPipelines"),
      "score-ide.refreshPipelines should be registered"
    );
  });
});
