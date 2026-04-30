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

test("classifies approval risk for read, edit, and destructive shell actions", () => {
  assert.deepEqual(helpers.assessApprovalRisk("Read", { file_path: "README.md" }), {
    level: "safe",
    label: "Low Risk",
    signal: "READ",
    reason: "Inspect-only tool",
  });

  assert.deepEqual(helpers.assessApprovalRisk("Edit", { file_path: "src/main.ts" }), {
    level: "review",
    label: "Review",
    signal: "WRITE",
    reason: "Will modify workspace files",
  });

  assert.deepEqual(helpers.assessApprovalRisk("Bash", { command: "git reset --hard HEAD" }), {
    level: "danger",
    label: "High Risk",
    signal: "SHELL",
    reason: "Destructive shell command",
  });
});

test("describes tool intent for product-level decisions", () => {
  assert.deepEqual(helpers.describeToolIntent("Read", { file_path: "D:/repo/src/main.ts" }), {
    label: "Inspecting context",
    description: "Claude is reading a file before deciding the next move.",
    nextAction: "No approval needed unless your hook policy blocks read-only tools.",
    scope: "src/main.ts",
  });

  assert.deepEqual(helpers.describeToolIntent("AskUserQuestion", {}), {
    label: "Input required",
    description: "Claude is blocked until you choose an answer.",
    nextAction: "Answer directly inside the island to continue the session.",
    scope: "Decision",
  });

  assert.deepEqual(
    helpers.describeToolIntent("Bash", { command: "git reset --hard HEAD" }),
    {
      label: "Dangerous command",
      description: "git reset --hard HEAD",
      nextAction: "Deny unless you explicitly requested this destructive operation.",
      scope: "Workspace",
    }
  );
});

test("formats hook payload for clipboard diagnostics", () => {
  assert.equal(
    helpers.formatPayloadForClipboard("PreToolUse: Bash", '{\n  "tool": "Bash"\n}'),
    'Hook: PreToolUse: Bash\nPayload:\n{\n  "tool": "Bash"\n}'
  );

  assert.equal(
    helpers.formatPayloadForClipboard("", ""),
    "Hook: Unknown\nPayload:\nNo payload yet"
  );
});

test("blocks unsafe open targets from hook-controlled paths", () => {
  assert.equal(helpers.isSafeLocalOpenPath("D:/repo/src/main.ts"), true);
  assert.equal(helpers.isSafeLocalOpenPath("README.md"), true);
  assert.equal(helpers.isSafeLocalOpenPath("https://example.com"), false);
  assert.equal(helpers.isSafeLocalOpenPath("file:///C:/Windows/System32/calc.exe"), false);
  assert.equal(helpers.isSafeLocalOpenPath("\\\\server\\share\\payload.lnk"), false);
  assert.equal(helpers.isSafeLocalOpenPath("../outside.txt"), false);
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
