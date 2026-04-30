import { EventBus } from "../events/event-bus";

const DEMO_SESSION_ID = "preview-session";

export function initPreviewControls(eventBus: EventBus): void {
  bindDemoButton("preview-demo-read", () => {
    const toolInput = { file_path: "D:/workspace/claude-dynamic-island/src/main.ts" };

    eventBus.emit({
      type: "pre-tool-use",
      toolName: "Read",
      toolInput,
      approvalId: createPreviewId("read"),
      sessionId: DEMO_SESSION_ID,
      requiresApproval: false,
      approvalTimeoutSeconds: 30,
    });

    window.setTimeout(() => {
      eventBus.emit({
        type: "post-tool-use",
        toolName: "Read",
        toolInput,
        toolOutput: "Loaded 128 lines from src/main.ts",
        isError: false,
        hookEventName: "PostToolUse",
      });
    }, 650);
  });

  bindDemoButton("preview-demo-approval", () => {
    eventBus.emit({
      type: "pre-tool-use",
      toolName: "Bash",
      toolInput: {
        command: "git reset --hard HEAD",
        cwd: "D:/workspace/claude-dynamic-island",
      },
      approvalId: createPreviewId("approval"),
      sessionId: DEMO_SESSION_ID,
      requiresApproval: true,
      approvalTimeoutSeconds: 45,
    });
  });

  bindDemoButton("preview-demo-question", () => {
    eventBus.emit({
      type: "pre-tool-use",
      toolName: "AskUserQuestion",
      toolInput: {
        questions: [
          {
            header: "Scope",
            question: "Which polish pass should run next?",
            options: ["Visual polish", "Hook smoke test", "Release notes"],
          },
        ],
      },
      approvalId: createPreviewId("question"),
      sessionId: DEMO_SESSION_ID,
      requiresApproval: false,
      approvalTimeoutSeconds: 300,
    });
  });

  bindDemoButton("preview-demo-error", () => {
    eventBus.emit({
      type: "post-tool-use",
      toolName: "Edit",
      toolInput: { file_path: "D:/workspace/claude-dynamic-island/src/status/status-panel.ts" },
      toolOutput: "Patch failed: target text was not found",
      isError: true,
      hookEventName: "PostToolUseFailure",
    });
  });

  bindDemoButton("preview-demo-done", () => {
    eventBus.emit({
      type: "stop",
      stopReason: "end_turn",
      sessionId: DEMO_SESSION_ID,
    });
  });
}

function bindDemoButton(id: string, onClick: () => void): void {
  document.getElementById(id)?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
}

function createPreviewId(kind: string): string {
  return `preview-${kind}-${Date.now()}`;
}
