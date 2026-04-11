import { listen } from "@tauri-apps/api/event";

export type IslandEvent =
  | { type: "pre-tool-use"; toolName: string; toolInput: Record<string, unknown>; approvalId: string; sessionId: string; requiresApproval: boolean }
  | { type: "post-tool-use"; toolName: string; toolInput: Record<string, unknown>; toolOutput: string; isError: boolean }
  | { type: "notification"; message: string }
  | { type: "stop"; stopReason: string; sessionId: string }
  | { type: "approval-requested"; approvalId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: "approval-resolved"; approvalId: string; approved: boolean }
  | { type: "startup-check"; ok: boolean; message: string };

type EventCallback = (event: IslandEvent) => void;

export class EventBus {
  private listeners: EventCallback[] = [];

  subscribe(callback: EventCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  emit(event: IslandEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  async listenTauriEvents(): Promise<void> {
    await listen("pre-tool-use", (event) => {
      const payload = event.payload as {
        approval_id: string;
        tool_name: string;
        tool_input: Record<string, unknown>;
        session_id: string;
        requires_approval: boolean;
      };
      this.emit({
        type: "pre-tool-use",
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        approvalId: payload.approval_id,
        sessionId: payload.session_id,
        requiresApproval: payload.requires_approval,
      });
    });

    await listen("post-tool-use", (event) => {
      const payload = event.payload as {
        tool_name: string;
        tool_input: Record<string, unknown>;
        tool_output: string;
        is_error: boolean;
      };
      this.emit({
        type: "post-tool-use",
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        toolOutput: payload.tool_output,
        isError: payload.is_error,
      });
    });

    await listen("notification", (event) => {
      const payload = event.payload as { message: string };
      this.emit({ type: "notification", message: payload.message });
    });

    await listen("stop", (event) => {
      const payload = event.payload as {
        stop_reason: string;
        session_id: string;
      };
      this.emit({
        type: "stop",
        stopReason: payload.stop_reason,
        sessionId: payload.session_id,
      });
    });
  }
}
