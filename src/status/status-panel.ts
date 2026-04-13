import type {
  ActionRecord,
  ApprovalRequest,
  SelectionPrompt,
  SelectionQuestion,
} from "../types";
import { EventBus } from "../events/event-bus";
import { CharacterStateMachine } from "../character/state-machine";
import { invoke } from "@tauri-apps/api/core";

const MAX_HISTORY_ITEMS = 5;

export class StatusPanel {
  private eventBus: EventBus;
  private actionHistory: ActionRecord[] = [];
  private currentApproval: ApprovalRequest | null = null;
  private currentSelection: SelectionPrompt | null = null;
  private selectedAnswers = new Map<string, string[]>();
  private approvalTimer: ReturnType<typeof setInterval> | null = null;
  private approvalTimeLeft = 30;
  private isResolvingApproval = false;
  private isResolvingSelection = false;
  private totalEvents = 0;
  private totalErrors = 0;

  constructor(eventBus: EventBus, _stateMachine: CharacterStateMachine) {
    this.eventBus = eventBus;
    this.initEventListeners();
    this.initApprovalButtons();
    this.initSelectionActions();
    this.updateConnectionState("Armed");
    this.updateCurrentNote("Ready for Claude hook events");
    this.updateLastHookEvent("Waiting for first hook");
    this.renderOverview();
    this.renderHistory();
  }

  private initEventListeners(): void {
    this.eventBus.subscribe((event) => {
      this.totalEvents += 1;
      this.updateConnectionState("Live");

      switch (event.type) {
        case "pre-tool-use":
          this.updateLastHookEvent(`PreToolUse: ${event.toolName}`);
          this.updateCurrentTool(event.toolName, event.toolInput);
          this.updateSessionId(event.sessionId);
          if (event.toolName === "AskUserQuestion") {
            this.hideApproval();
            this.showSelection(event.approvalId, event.toolInput);
          } else if (event.requiresApproval) {
            this.hideSelection();
            this.showApproval(
              event.approvalId,
              event.toolName,
              event.toolInput,
              event.sessionId,
              event.approvalTimeoutSeconds
            );
          } else {
            this.hideSelection();
            this.hideApproval();
          }
          break;
        case "post-tool-use":
          this.updateLastHookEvent(`${event.hookEventName}: ${event.toolName}`);
          this.hideSelection();
          this.hideApproval();
          this.addActionToHistory(event.toolName, event.toolInput, event.isError);
          if (event.isError) {
            this.totalErrors += 1;
          }
          this.updateCurrentNote(
            event.isError ? `Tool failed: ${event.toolName}` : `Tool finished: ${event.toolName}`
          );
          break;
        case "notification":
          this.updateLastHookEvent("Notification");
          this.hideSelection();
          this.hideApproval();
          this.updateCurrentNote(event.message);
          break;
        case "stop":
          this.updateLastHookEvent(`Stop: ${event.stopReason}`);
          this.hideSelection();
          this.hideApproval();
          this.updateSessionId(event.sessionId);
          this.updateCurrentNote(`Stopped: ${event.stopReason}`);
          break;
        case "approval-requested":
          this.updateLastHookEvent(`Approval: ${event.toolName}`);
          this.hideSelection();
          this.showApproval(event.approvalId, event.toolName, event.toolInput, "", 30);
          break;
        case "approval-resolved":
          this.updateLastHookEvent(event.approved ? "Approval: allow" : "Approval: deny");
          this.hideSelection();
          this.hideApproval();
          break;
        case "startup-check":
          this.updateLastHookEvent("Startup self-check");
          this.updateConnectionState(event.ok ? "Hooks Ready" : "Hooks Error");
          this.updateCurrentNote(event.message);
          break;
      }

      this.renderOverview();
    });
  }

  private updateCurrentTool(toolName: string, toolInput: Record<string, unknown>): void {
    const toolEl = document.getElementById("current-tool");
    if (toolEl) {
      toolEl.textContent = toolName;
    }

    const fileEl = document.getElementById("current-file");
    if (fileEl) {
      const filePath = (toolInput.file_path as string) || (toolInput.path as string) || "-";
      fileEl.textContent = filePath;
    }

    if (toolName === "AskUserQuestion") {
      const selection = this.parseSelection("", toolInput);
      this.updateCurrentNote(selection.questions[0]?.prompt || "Claude is waiting for your input");
    }
  }

  private updateSessionId(sessionId: string): void {
    const el = document.getElementById("session-id");
    if (el) {
      el.textContent = `Session: ${sessionId.slice(0, 8)}...`;
    }
  }

  private updateCurrentNote(message: string): void {
    const el = document.getElementById("current-note");
    if (el) {
      el.textContent = message || "-";
    }
  }

  private updateConnectionState(value: string): void {
    const el = document.getElementById("connection-state");
    if (el) {
      el.textContent = value;
    }
  }

  private updateLastHookEvent(value: string): void {
    const el = document.getElementById("last-hook-event");
    if (el) {
      el.textContent = value;
    }
  }

  private renderOverview(): void {
    const eventEl = document.getElementById("event-count");
    const errorEl = document.getElementById("error-count");
    if (eventEl) {
      eventEl.textContent = String(this.totalEvents);
    }
    if (errorEl) {
      errorEl.textContent = String(this.totalErrors);
    }
  }

  private addActionToHistory(
    toolName: string,
    toolInput: Record<string, unknown>,
    isError: boolean
  ): void {
    let summary = toolName;

    if (toolName === "Bash" && typeof toolInput.command === "string") {
      summary = `Bash: ${toolInput.command.slice(0, 30)}`;
    } else if (
      (toolName === "Write" || toolName === "Edit") &&
      typeof toolInput.file_path === "string"
    ) {
      const parts = toolInput.file_path.replace(/\\/g, "/").split("/");
      summary = `${toolName}: ${parts.slice(-2).join("/")}`;
    } else if (toolName === "Read" && typeof toolInput.file_path === "string") {
      const parts = toolInput.file_path.replace(/\\/g, "/").split("/");
      summary = `Read: ${parts.slice(-2).join("/")}`;
    } else if (toolName === "Grep" && typeof toolInput.pattern === "string") {
      summary = `Grep: ${toolInput.pattern.slice(0, 20)}`;
    }

    const record: ActionRecord = {
      toolName,
      summary,
      timestamp: Date.now(),
      isError,
    };

    this.actionHistory = [record, ...this.actionHistory].slice(0, MAX_HISTORY_ITEMS);
    this.renderHistory();
  }

  private renderHistory(): void {
    const listEl = document.getElementById("history-list");
    if (!listEl) return;

    if (this.actionHistory.length === 0) {
      const emptyItem = document.createElement("div");
      emptyItem.className = "history-item history-item-empty";
      emptyItem.textContent = "No recent actions";
      listEl.replaceChildren(emptyItem);
      return;
    }

    listEl.replaceChildren(
      ...this.actionHistory.map((action) => {
        const item = document.createElement("div");
        item.className = "history-item";
        item.textContent = action.summary;
        if (action.isError) {
          item.style.color = "var(--color-error)";
        }
        return item;
      })
    );
  }

  private parseSelection(
    requestId: string,
    toolInput: Record<string, unknown>
  ): SelectionPrompt {
    const rawQuestions = Array.isArray(toolInput.questions)
      ? toolInput.questions
      : [];

    const questions: SelectionQuestion[] =
      rawQuestions.length > 0
        ? rawQuestions
            .map((item, index) => this.parseSelectionQuestion(item, index))
            .filter((question): question is SelectionQuestion => question !== null)
        : [this.createFallbackQuestion(toolInput)];

    return {
      requestId,
      toolInput,
      questions,
    };
  }

  private parseSelectionQuestion(
    item: unknown,
    index: number
  ): SelectionQuestion | null {
    if (!item || typeof item !== "object") {
      return null;
    }

    const question = item as Record<string, unknown>;
    const prompt =
      this.pickFirstString(question, ["question", "prompt", "message", "text"]) ||
      `Question ${index + 1}`;
    const header =
      this.pickFirstString(question, ["header", "title", "label"]) ||
      `Question ${index + 1}`;
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions
      .map((option) => {
        if (typeof option === "string") {
          return option.trim();
        }
        if (option && typeof option === "object") {
          const value = option as Record<string, unknown>;
          return (
            this.pickFirstString(value, ["label", "text", "title", "value", "name"]) || ""
          );
        }
        return "";
      })
      .filter(Boolean);

    return {
      header,
      prompt,
      options,
      multiSelect: question.multiSelect === true,
    };
  }

  private createFallbackQuestion(toolInput: Record<string, unknown>): SelectionQuestion {
    const prompt =
      this.pickFirstString(toolInput, ["question", "prompt", "message", "text", "query"]) ||
      "Claude is waiting for your input";
    const rawOptions = ["options", "choices", "items", "allowed_values"]
      .map((key) => toolInput[key])
      .find((value) => Array.isArray(value)) as unknown[] | undefined;
    const options = (rawOptions || [])
      .map((option) => {
        if (typeof option === "string") {
          return option.trim();
        }
        if (option && typeof option === "object") {
          return (
            this.pickFirstString(option as Record<string, unknown>, [
              "label",
              "text",
              "title",
              "value",
              "name",
            ]) || ""
          );
        }
        return "";
      })
      .filter(Boolean);

    return {
      header: "Question",
      prompt,
      options,
      multiSelect: false,
    };
  }

  private pickFirstString(
    source: Record<string, unknown>,
    keys: string[]
  ): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private showSelection(requestId: string, toolInput: Record<string, unknown>): void {
    this.currentSelection = this.parseSelection(requestId, toolInput);
    this.selectedAnswers.clear();
    this.isResolvingSelection = false;
    this.updateCurrentNote(
      this.currentSelection.questions[0]?.prompt || "Claude is waiting for your input"
    );
    this.renderSelection();

    const panelEl = document.getElementById("selection-panel");
    if (panelEl) {
      panelEl.classList.add("visible");
      panelEl.classList.toggle(
        "selection-panel-empty",
        this.currentSelection.questions.every((question) => question.options.length === 0)
      );
    }
  }

  private hideSelection(): void {
    this.currentSelection = null;
    this.selectedAnswers.clear();
    this.isResolvingSelection = false;

    const panelEl = document.getElementById("selection-panel");
    const optionsEl = document.getElementById("selection-options");
    const actionsEl = document.getElementById("selection-actions");
    if (panelEl) {
      panelEl.classList.remove("visible", "selection-panel-empty");
    }
    if (optionsEl) {
      optionsEl.replaceChildren();
    }
    if (actionsEl) {
      actionsEl.classList.remove("visible");
    }
  }

  private renderSelection(): void {
    if (!this.currentSelection) {
      return;
    }

    const promptEl = document.getElementById("selection-prompt");
    const optionsEl = document.getElementById("selection-options");
    const actionsEl = document.getElementById("selection-actions");
    const submitButton = document.getElementById("selection-submit") as HTMLButtonElement | null;

    if (promptEl) {
      promptEl.textContent =
        this.currentSelection.questions.length === 1
          ? this.currentSelection.questions[0].prompt
          : `${this.currentSelection.questions.length} questions waiting for input`;
    }

    if (optionsEl) {
      optionsEl.replaceChildren(
        ...this.currentSelection.questions.map((question) => this.renderSelectionQuestion(question))
      );
    }

    const autoSubmit =
      this.currentSelection.questions.length === 1 &&
      !this.currentSelection.questions[0].multiSelect;

    if (actionsEl) {
      actionsEl.classList.toggle("visible", !autoSubmit);
    }
    if (submitButton) {
      submitButton.disabled = !this.canSubmitSelection() || this.isResolvingSelection;
    }
  }

  private renderSelectionQuestion(question: SelectionQuestion): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "selection-question";

    const header = document.createElement("div");
    header.className = "selection-question-header";
    header.textContent = question.header;

    const text = document.createElement("div");
    text.className = "selection-question-text";
    text.textContent = question.prompt;

    const choices = document.createElement("div");
    choices.className = "selection-choice-row";

    for (const option of question.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "selection-option";
      if (this.isOptionSelected(question.prompt, option)) {
        button.classList.add("is-active");
      }
      button.textContent = option;
      button.addEventListener("click", () => {
        this.toggleSelectionOption(question, option);
      });
      choices.appendChild(button);
    }

    wrapper.append(header, text, choices);
    return wrapper;
  }

  private isOptionSelected(prompt: string, option: string): boolean {
    return this.selectedAnswers.get(prompt)?.includes(option) ?? false;
  }

  private toggleSelectionOption(question: SelectionQuestion, option: string): void {
    const current = this.selectedAnswers.get(question.prompt) ?? [];

    if (question.multiSelect) {
      if (current.includes(option)) {
        this.selectedAnswers.set(
          question.prompt,
          current.filter((value) => value !== option)
        );
      } else {
        this.selectedAnswers.set(question.prompt, [...current, option]);
      }
    } else {
      this.selectedAnswers.set(question.prompt, [option]);
    }

    this.renderSelection();

    if (
      this.currentSelection &&
      this.currentSelection.questions.length === 1 &&
      !question.multiSelect
    ) {
      void this.submitSelection();
    }
  }

  private canSubmitSelection(): boolean {
    if (!this.currentSelection) {
      return false;
    }

    return this.currentSelection.questions.every((question) => {
      const selected = this.selectedAnswers.get(question.prompt) ?? [];
      return selected.length > 0;
    });
  }

  private buildUpdatedSelectionInput(): Record<string, unknown> | null {
    if (!this.currentSelection || !this.canSubmitSelection()) {
      return null;
    }

    const answers = Object.fromEntries(
      this.currentSelection.questions.map((question) => {
        const selected = this.selectedAnswers.get(question.prompt) ?? [];
        return [question.prompt, question.multiSelect ? selected.join(", ") : selected[0]];
      })
    );

    return {
      ...this.currentSelection.toolInput,
      answers,
    };
  }

  private async submitSelection(): Promise<void> {
    if (!this.currentSelection || this.isResolvingSelection) {
      return;
    }

    const updatedInput = this.buildUpdatedSelectionInput();
    if (!updatedInput) {
      return;
    }

    this.isResolvingSelection = true;
    this.renderSelection();

    try {
      const resolved = await invoke<boolean>("resolve_selection", {
        requestId: this.currentSelection.requestId,
        updatedInput,
      });

      if (!resolved) {
        throw new Error("Selection request is no longer pending");
      }

      this.updateCurrentNote("Answer sent to Claude");
      this.hideSelection();
    } catch (error) {
      console.error("Failed to resolve selection:", error);
      this.isResolvingSelection = false;
      this.updateCurrentNote("Failed to send answer");
      this.renderSelection();
    }
  }

  private initSelectionActions(): void {
    const submitButton = document.getElementById("selection-submit");
    submitButton?.addEventListener("click", () => {
      void this.submitSelection();
    });
  }

  private showApproval(
    approvalId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    sessionId: string,
    approvalTimeoutSeconds: number
  ): void {
    if (this.approvalTimer) {
      clearInterval(this.approvalTimer);
      this.approvalTimer = null;
    }

    this.currentApproval = {
      approvalId,
      toolName,
      toolInput,
      sessionId,
      timestamp: Date.now(),
    };
    this.isResolvingApproval = false;
    this.setApprovalButtonsDisabled(false);

    const buttonsEl = document.getElementById("approval-buttons");
    if (buttonsEl) {
      buttonsEl.classList.add("visible");
    }

    this.approvalTimeLeft = Math.max(1, approvalTimeoutSeconds);
    this.updateApprovalTimer();
    this.approvalTimer = setInterval(() => {
      this.approvalTimeLeft -= 1;
      this.updateApprovalTimer();
      if (this.approvalTimeLeft <= 0) {
        if (this.approvalTimer) {
          clearInterval(this.approvalTimer);
          this.approvalTimer = null;
        }
        void this.resolveApproval(false);
      }
    }, 1000);
  }

  private hideApproval(): void {
    this.currentApproval = null;
    const buttonsEl = document.getElementById("approval-buttons");
    if (buttonsEl) {
      buttonsEl.classList.remove("visible");
    }
    if (this.approvalTimer) {
      clearInterval(this.approvalTimer);
      this.approvalTimer = null;
    }
    this.isResolvingApproval = false;
    this.setApprovalButtonsDisabled(false);
  }

  private updateApprovalTimer(): void {
    const timerEl = document.getElementById("approval-timer");
    if (timerEl) {
      timerEl.textContent = `${this.approvalTimeLeft}s`;
    }
  }

  private async resolveApproval(approved: boolean): Promise<void> {
    if (!this.currentApproval || this.isResolvingApproval) return;

    this.isResolvingApproval = true;
    this.setApprovalButtonsDisabled(true);

    try {
      const resolved = await invoke<boolean>("resolve_approval", {
        approvalId: this.currentApproval.approvalId,
        approved,
      });

      if (!resolved) {
        throw new Error("Approval request is no longer pending");
      }

      this.eventBus.emit({
        type: "approval-resolved",
        approvalId: this.currentApproval.approvalId,
        approved,
      });

      this.hideApproval();
    } catch (error) {
      console.error("Failed to resolve approval:", error);
      this.isResolvingApproval = false;
      this.setApprovalButtonsDisabled(false);
      this.showApprovalError(approved ? "Approve failed" : "Deny failed");
    }
  }

  private initApprovalButtons(): void {
    const approveBtn = document.getElementById("btn-approve");
    const denyBtn = document.getElementById("btn-deny");

    approveBtn?.addEventListener("click", () => {
      void this.resolveApproval(true);
    });
    denyBtn?.addEventListener("click", () => {
      void this.resolveApproval(false);
    });
  }

  private setApprovalButtonsDisabled(disabled: boolean): void {
    const approveBtn = document.getElementById("btn-approve") as HTMLButtonElement | null;
    const denyBtn = document.getElementById("btn-deny") as HTMLButtonElement | null;

    if (approveBtn) {
      approveBtn.disabled = disabled;
    }
    if (denyBtn) {
      denyBtn.disabled = disabled;
    }
  }

  private showApprovalError(message: string): void {
    const timerEl = document.getElementById("approval-timer");
    if (timerEl) {
      timerEl.textContent = message;
    }
  }
}
