import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helpers = await importStatusHelpers();

test("extracts the first useful path from Claude tool input", () => {
  assert.equal(
    helpers.getPrimaryPath({ cwd: "D:/workspace", file_path: "D:/workspace/src/main.ts" }),
    "D:/workspace/src/main.ts"
  );
  assert.equal(helpers.getPrimaryPath({ path: "README.md" }), "README.md");
  assert.equal(helpers.getPrimaryPath({ command: "npm run build" }), null);
});

test("summarizes common tool events with tone and path", () => {
  assert.deepEqual(
    helpers.createHistorySummary("Edit", { file_path: "D:/repo/src/main.ts" }, false),
    {
      summary: "Edit: src/main.ts",
      path: "D:/repo/src/main.ts",
      tone: "info",
    }
  );

  assert.deepEqual(
    helpers.createHistorySummary("Bash", { command: "npm run build && npm test" }, true),
    {
      summary: "Bash: npm run build && npm test",
      path: null,
      tone: "danger",
    }
  );
});

test("formats compact relative and elapsed times", () => {
  const now = new Date("2026-04-29T08:30:00.000Z").getTime();

  assert.equal(helpers.formatRelativeTime(now - 4_000, now), "now");
  assert.equal(helpers.formatRelativeTime(now - 70_000, now), "1m ago");
  assert.equal(helpers.formatRelativeTime(now - 3_600_000, now), "1h ago");
  assert.equal(helpers.formatDuration(now - 65_000, now), "1m 05s");
  assert.equal(helpers.formatDuration(null, now), "0s");
});

async function importStatusHelpers() {
  const source = await readFile(new URL("../src/status/status-format.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}
