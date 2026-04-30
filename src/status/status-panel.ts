import type {
  ActionRecord,
  ApprovalRequest,
  SelectionPrompt,
  SelectionQuestion,
} from "../types";
import { EventBus } from "../events/event-bus";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/env";
import {
  assessApprovalRisk,
  createHistorySummary,
  formatDuration,
  formatPayloadForClipboard,
  formatRelativeTime,
  getPrimaryPath,
} from "./status-format";

const MAX_HISTORY_ITEMS = 7;
const MAX_DETAIL_VALUE_LENGTH = 220;
const MAX_PAYLOAD_LENGTH = 4000;

interface OperationDetail {
  label: string;
  value: string;
}

interface OperationInsight {
  summary: string;
  path: string | null;
  details: OperationDetail[];
}

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
  private currentOpenPath: string | null = null;
  private payloadVisible = false;
  private lastPayloadText = "No payload yet";
  private lastHookLabel = "No hook yet";
  private sessionStartedAt: number | null = null;
  private lastEventAt: number | null = null;

  // Cached DOM element references
  private readonly elToolIcon: HTMLElement | null;
  private readonly elCurrentTool: HTMLElement | null;
  private readonly elCurrentFile: HTMLElement | null;
  private readonly elCurrentNote: HTMLElement | null;
  private readonly elSessionId: HTMLElement | null;
  private readonly elConnectionState: HTMLElement | null;
  private readonly elEventCount: HTMLElement | null;
  private readonly elErrorCount: HTMLElement | null;
  private readonly elActiveDuration: HTMLElement | null;
  private readonly elLastHookEvent: HTMLElement | null;
  private readonly elApprovalTimer: HTMLElement | null;
  private readonly elApprovalButtons: HTMLElement | null;
  private readonly elApprovalRiskCard: HTMLElement | null;
  private readonly elApprovalRiskLabel: HTMLElement | null;
  private readonly elApprovalRiskReason: HTMLElement | null;
  private readonly elApprovalRiskSignal: HTMLElement | null;
  private readonly elBtnApprove: HTMLButtonElement | null;
  private readonly elBtnDeny: HTMLButtonElement | null;
  private readonly elHistoryList: HTMLElement | null;
  private readonly elSelectionPanel: HTMLElement | null;
  private readonly elSelectionPrompt: HTMLElement | null;
  private readonly elSelectionOptions: HTMLElement | null;
  private readonly elSelectionActions: HTMLElement | null;
  private readonly elSelectionSubmit: HTMLButtonElement | null;
  private readonly elOperationInsight: HTMLElement | null;
  private readonly elOperationSummary: HTMLElement | null;
  private readonly elOperationOpen: HTMLButtonElement | null;
  private readonly elOperationDetailList: HTMLElement | null;
  private readonly elPayloadToggle: HTMLButtonElement | null;
  private readonly elPayloadCopy: HTMLButtonElement | null;
  private readonly elPayloadView: HTMLElement | null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;

    // Cache all DOM lookups once
    this.elToolIcon = document.getElementById("tool-icon");
    this.elCurrentTool = document.getElementById("current-tool");
    this.elCurrentFile = document.getElementById("current-file");
    this.elCurrentNote = document.getElementById("current-note");
    this.elSessionId = document.getElementById("session-id");
    this.elConnectionState = document.getElementById("connection-state");
    this.elEventCount = document.getElementById("event-count");
    this.elErrorCount = document.getElementById("error-count");
    this.elActiveDuration = document.getElementById("active-duration");
    this.elLastHookEvent = document.getElementById("last-hook-event");
    this.elApprovalTimer = document.getElementById("approval-timer");
    this.elApprovalButtons = document.getElementById("approval-buttons");
    this.elApprovalRiskCard = document.getElementById("approval-risk-card");
    this.elApprovalRiskLabel = document.getElementById("approval-risk-label");
    this.elApprovalRiskReason = document.getElementById("approval-risk-reason");
    this.elApprovalRiskSignal = document.getElementById("approval-risk-signal");
    this.elBtnApprove = document.getElementById("btn-approve") as HTMLButtonElement | null;
    this.elBtnDeny = document.getElementById("btn-deny") as HTMLButtonElement | null;
    this.elHistoryList = document.getElementById("history-list");
    this.elSelectionPanel = document.getElementById("selection-panel");
    this.elSelectionPrompt = document.getElementById("selection-prompt");
    this.elSelectionOptions = document.getElementById("selection-options");
    this.elSelectionActions = document.getElementById("selection-actions");
    this.elSelectionSubmit = document.getElementById("selection-submit") as HTMLButtonElement | null;
    this.elOperationInsight = document.getElementById("operation-insight");
    this.elOperationSummary = document.getElementById("operation-summary");
    this.elOperationOpen = document.getElementById("operation-open") as HTMLButtonElement | null;
    this.elOperationDetailList = document.getElementById("operation-detail-list");
    this.elPayloadToggle = document.getElementById("payload-toggle") as HTMLButtonElement | null;
    this.elPayloadCopy = document.getElementById("payload-copy") as HTMLButtonElement | null;
    this.elPayloadView = document.getElementById("payload-view");

    this.initEventListeners();
    this.initApprovalButtons();
    this.initSelectionActions();
    this.initOpenAction();
    this.initPayloadToggle();
    this.initPayloadCopy();
    this.updateConnectionState("Armed");
    this.updateCurrentNote("Ready for Claude hook events");
    this.updateLastHookEvent("Waiting for first hook");
    this.renderPayloadView();
    this.renderOverview();
    this.renderHistory();
    setInterval(() => this.renderOverview(), 1000);
  }

  private initEventListeners(): void {
    this.eventBus.subscribe((event) => {
      this.markActivity();
      this.totalEvents += 1;
      this.updateConnectionState("Live");
      this.updateDebugPayload(event);

      switch (event.type) {
        case "pre-tool-use":
          this.updateLastHookEvent(`PreToolUse: ${event.toolName}`);
          this.updateCurrentTool(event.toolName, event.toolInput);
          this.renderOperationInsight(event.toolName, event.toolInput);
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
          this.updateCurrentTool(event.toolName, event.toolInput);
          this.renderOperationInsight(event.toolName, event.toolInput, event.toolOutput);
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
          this.clearOperationInsight();
          this.updateCurrentNote(event.message);
          break;
        case "stop":
          this.updateLastHookEvent(`Stop: ${event.stopReason}`);
          this.hideSelection();
          this.hideApproval();
          this.clearOperationInsight();
          this.updateSessionId(event.sessionId);
          this.updateCurrentNote(`Stopped: ${event.stopReason}`);
          break;
        case "approval-requested":
          this.updateLastHookEvent(`Approval: ${event.toolName}`);
          this.hideSelection();
          this.updateCurrentTool(event.toolName, event.toolInput);
          this.renderOperationInsight(event.toolName, event.toolInput);
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

  private markActivity(): void {
    const now = Date.now();
    this.sessionStartedAt ??= now;
    this.lastEventAt = now;
  }

  private updateCurrentTool(toolName: string, toolInput: Record<string, unknown>): void {
    if (this.elCurrentTool) {
      this.elCurrentTool.textContent = toolName;
    }

    this.updateToolIcon(toolName);

    if (this.elCurrentFile) {
      const filePath = this.getPrimaryPath(toolInput) || "-";
      this.elCurrentFile.textContent = filePath;
    }

    if (toolName === "AskUserQuestion") {
      const selection = this.parseSelection("", toolInput);
      this.updateCurrentNote(selection.questions[0]?.prompt || "Claude is waiting for your input");
    }
  }

  private updateToolIcon(toolName: string): void {
    if (!this.elToolIcon) {
      return;
    }

    const toolIconByName: Record<string, string> = {
      AskUserQuestion: "?",
      Bash: ">_",
      Edit: "E",
      Glob: "*",
      Grep: "G",
      MultiEdit: "M",
      Read: "R",
      Write: "W",
    };

    this.elToolIcon.textContent = toolIconByName[toolName] ?? toolName.slice(0, 1).toUpperCase();
    this.elToolIcon.dataset.tool = toolName.toLowerCase();
  }

  private updateSessionId(sessionId: string): void {
    if (this.elSessionId) {
      this.elSessionId.textContent = `Session: ${sessionId.slice(0, 8)}...`;
    }
  }

  private updateCurrentNote(message: string): void {
    if (this.elCurrentNote) {
      this.elCurrentNote.textContent = message || "-";
    }
  }

  private updateConnectionState(value: string): void {
    if (this.elConnectionState) {
      this.elConnectionState.textContent = value;
    }
  }

  private updateLastHookEvent(value: string): void {
    this.lastHookLabel = value;
    if (this.elLastHookEvent) {
      this.elLastHookEvent.textContent = value;
    }
  }

  private renderOverview(): void {
    if (this.elEventCount) {
      this.elEventCount.textContent = String(this.totalEvents);
    }
    if (this.elErrorCount) {
      this.elErrorCount.textContent = String(this.totalErrors);
    }
    if (this.elActiveDuration) {
      this.elActiveDuration.textContent = formatDuration(this.sessionStartedAt);
      this.elActiveDuration.title = this.lastEventAt
        ? `Last event ${formatRelativeTime(this.lastEventAt)}`
        : "No events yet";
    }
  }

  private updateDebugPayload(event: unknown): void {
    try {
      const text = JSON.stringify(event, null, 2);
      this.lastPayloadText = text.length > MAX_PAYLOAD_LENGTH
        ? `${text.slice(0, MAX_PAYLOAD_LENGTH - 3)}...`
        : text;
    } catch {
      this.lastPayloadText = "Failed to serialize event payload";
    }

    this.renderPayloadView();
  }

  private renderPayloadView(): void {
    if (this.elPayloadView) {
      this.elPayloadView.textContent = this.lastPayloadText;
      this.elPayloadView.hidden = !this.payloadVisible;
    }
    if (this.elPayloadToggle) {
      this.elPayloadToggle.classList.toggle("is-active", this.payloadVisible);
      this.elPayloadToggle.setAttribute(
        "aria-expanded",
        this.payloadVisible ? "true" : "false"
      );
    }
  }

  private addActionToHistory(
    toolName: string,
    toolInput: Record<string, unknown>,
    isError: boolean
  ): void {
    const historySummary = createHistorySummary(toolName, toolInput, isError);

    const record: ActionRecord = {
      toolName,
      summary: historySummary.summary,
      timestamp: Date.now(),
      isError,
      tone: historySummary.tone,
    };
    if (historySummary.path) {
      record.path = historySummary.path;
    }

    this.actionHistory = [record, ...this.actionHistory].slice(0, MAX_HISTORY_ITEMS);
    this.renderHistory();
  }

  private renderOperationInsight(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolOutput?: string
  ): void {
    const insight = this.buildOperationInsight(toolName, toolInput, toolOutput);
    if (!this.elOperationInsight || !this.elOperationSummary || !this.elOperationDetailList) {
      return;
    }

    this.currentOpenPath = insight.path;
    this.elOperationSummary.textContent = insight.summary;
    this.elOperationDetailList.replaceChildren(
      ...insight.details.map((detail) => this.renderOperationDetail(detail))
    );
    this.elOperationInsight.hidden = insight.details.length === 0;

    if (this.elOperationOpen) {
      this.elOperationOpen.hidden = !insight.path;
      this.elOperationOpen.disabled = !insight.path;
      this.elOperationOpen.title = insight.path ? `Open ${insight.path}` : "";
    }
  }

  private clearOperationInsight(): void {
    this.currentOpenPath = null;
    if (this.elOperationInsight) {
      this.elOperationInsight.hidden = true;
    }
    if (this.elOperationDetailList) {
      this.elOperationDetailList.replaceChildren();
    }
    if (this.elOperationOpen) {
      this.elOperationOpen.hidden = true;
      this.elOperationOpen.disabled = true;
      this.elOperationOpen.title = "";
    }
  }

  private renderOperationDetail(detail: OperationDetail): HTMLElement {
    const item = document.createElement("div");
    item.className = "operation-detail-item";

    const label = document.createElement("span");
    label.className = "operation-detail-label";
    label.textContent = detail.label;

    const value = document.createElement("span");
    value.className = "operation-detail-value";
    value.textContent = detail.value;

    item.append(label, value);
    return item;
  }

  private buildOperationInsight(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolOutput?: string
  ): OperationInsight {
    const path = this.getPrimaryPath(toolInput);
    const details: OperationDetail[] = [];

    this.addDetail(details, "Path", path);

    switch (toolName) {
      case "Read":
        this.addDetail(details, "Offset", this.toDisplayValue(toolInput.offset));
        this.addDetail(details, "Limit", this.toDisplayValue(toolInput.limit));
        return { summary: "Read file", path, details };
      case "Write":
        this.addDetail(details, "Content", this.toDisplayValue(toolInput.content));
        return { summary: "Write file", path, details };
      case "Edit":
        this.addDetail(details, "Before", this.toDisplayValue(toolInput.old_string));
        this.addDetail(details, "After", this.toDisplayValue(toolInput.new_string));
        this.addDetail(details, "All", this.toDisplayValue(toolInput.replace_all));
        return { summary: "Edit file", path, details };
      case "MultiEdit":
        this.addMultiEditDetails(details, toolInput.edits);
        return { summary: "Multi-edit file", path, details };
      case "Bash":
        this.addDetail(details, "Command", this.toDisplayValue(toolInput.command));
        this.addDetail(details, "Reason", this.toDisplayValue(toolInput.description));
        return { summary: "Run shell command", path: null, details };
      case "Grep":
        this.addDetail(details, "Pattern", this.toDisplayValue(toolInput.pattern));
        this.addDetail(details, "Glob", this.toDisplayValue(toolInput.glob));
        return { summary: "Search files", path, details };
      case "Glob":
        this.addDetail(details, "Pattern", this.toDisplayValue(toolInput.pattern));
        return { summary: "List matching files", path, details };
      default:
        this.addDetail(details, "Input", this.toDisplayValue(toolInput));
        if (toolOutput) {
          this.addDetail(details, "Output", this.toDisplayValue(toolOutput));
        }
        return { summary: `${toolName} details`, path, details };
    }
  }

  private addMultiEditDetails(details: OperationDetail[], edits: unknown): void {
    if (!Array.isArray(edits)) {
      return;
    }

    this.addDetail(details, "Edits", String(edits.length));
    const preview = edits
      .slice(0, 2)
      .map((edit, index) => {
        if (!edit || typeof edit !== "object") {
          return `${index + 1}. ${this.toDisplayValue(edit)}`;
        }

        const item = edit as Record<string, unknown>;
        return `${index + 1}. ${this.toDisplayValue(item.old_string)} -> ${this.toDisplayValue(item.new_string)}`;
      })
      .join("\n");

    this.addDetail(details, "Preview", preview);
  }

  private addDetail(details: OperationDetail[], label: string, value: string | null): void {
    if (!value) {
      return;
    }

    details.push({ label, value });
  }

  private getPrimaryPath(toolInput: Record<string, unknown>): string | null {
    return getPrimaryPath(toolInput);
  }

  private toDisplayValue(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    let text: string;
    if (typeof value === "string") {
      text = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      text = String(value);
    } else {
      text = JSON.stringify(value);
    }

    text = text.replace(/\r\n/g, "\n").trim();
    if (!text) {
      return null;
    }

    return text.length > MAX_DETAIL_VALUE_LENGTH
      ? `${text.slice(0, MAX_DETAIL_VALUE_LENGTH - 3)}...`
      : text;
  }

  private renderHistory(): void {
    const listEl = this.elHistoryList;
    if (!listEl) return;

    if (this.actionHistory.length === 0) {
      const emptyItem = document.createElement("div");
      emptyItem.className = "history-item history-item-empty";
      emptyItem.textContent = "No recent actions";
      listEl.replaceChildren(emptyItem);
      return;
    }

    const now = Date.now();

    listEl.replaceChildren(
      ...this.actionHistory.map((action) => {
        const item = action.path
          ? document.createElement("button")
          : document.createElement("div");
        const tone = action.tone ?? (action.isError ? "danger" : "neutral");
        item.className = `history-item history-tone-${tone}`;

        if (item instanceof HTMLButtonElement) {
          item.type = "button";
        }

        const dot = document.createElement("span");
        dot.className = "history-item-dot";

        const summary = document.createElement("span");
        summary.className = "history-item-summary";
        summary.textContent = action.summary;

        const time = document.createElement("span");
        time.className = "history-item-time";
        time.textContent = formatRelativeTime(action.timestamp, now);

        item.append(dot, summary, time);

        if (action.path) {
          item.classList.add("history-item-link");
          item.title = `Open ${action.path}`;
          item.addEventListener("click", () => {
            void this.openPath(action.path as string);
          });
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

    if (this.elSelectionPanel) {
      this.elSelectionPanel.classList.add("visible");
      this.elSelectionPanel.classList.toggle(
        "selection-panel-empty",
        this.currentSelection.questions.every((question) => question.options.length === 0)
      );
    }
  }

  private hideSelection(): void {
    this.currentSelection = null;
    this.selectedAnswers.clear();
    this.isResolvingSelection = false;

    if (this.elSelectionPanel) {
      this.elSelectionPanel.classList.remove("visible", "selection-panel-empty");
    }
    if (this.elSelectionOptions) {
      this.elSelectionOptions.replaceChildren();
    }
    if (this.elSelectionActions) {
      this.elSelectionActions.classList.remove("visible");
    }
  }

  private renderSelection(): void {
    if (!this.currentSelection) {
      return;
    }

    const promptEl = this.elSelectionPrompt;
    const optionsEl = this.elSelectionOptions;
    const actionsEl = this.elSelectionActions;
    const submitButton = this.elSelectionSubmit;

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

    if (actionsEl) {
      actionsEl.classList.toggle(
        "visible",
        this.currentSelection.questions.some((question) => question.options.length > 0)
      );
    }
    if (submitButton) {
      submitButton.disabled = !this.canSubmitSelection() || this.isResolvingSelection;
      submitButton.textContent = this.isResolvingSelection ? "Sending..." : "Send Answer";
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
      button.dataset.prompt = question.prompt;
      button.dataset.option = option;
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

    this.updateSelectionState();

    this.renderSelection();
  }

  private updateSelectionState(): void {
    const optionsEl = this.elSelectionOptions;
    if (!optionsEl) return;

    const buttons = optionsEl.querySelectorAll<HTMLButtonElement>(".selection-option");
    for (const btn of buttons) {
      const prompt = btn.dataset.prompt;
      const option = btn.dataset.option;
      if (prompt && option) {
        btn.classList.toggle("is-active", this.isOptionSelected(prompt, option));
      }
    }

    const submitButton = this.elSelectionSubmit;
    if (submitButton) {
      submitButton.disabled = !this.canSubmitSelection() || this.isResolvingSelection;
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

    if (!isTauri()) {
      this.updateCurrentNote("Preview answer sent");
      this.hideSelection();
      return;
    }

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
    this.elSelectionSubmit?.addEventListener("click", () => {
      void this.submitSelection();
    });
  }

  private initOpenAction(): void {
    this.elOperationOpen?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!this.currentOpenPath) {
        return;
      }

      await this.openPath(this.currentOpenPath);
    });
  }

  private initPayloadToggle(): void {
    this.elPayloadToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.payloadVisible = !this.payloadVisible;
      this.renderPayloadView();
    });
  }

  private initPayloadCopy(): void {
    this.elPayloadCopy?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const text = formatPayloadForClipboard(this.lastHookLabel, this.lastPayloadText);
      const copied = await this.copyText(text);
      this.updateCurrentNote(copied ? "Hook payload copied" : "Failed to copy hook payload");
    });
  }

  private async copyText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to the textarea fallback for WebView/browser edge cases.
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }

  private async openPath(path: string): Promise<void> {
    if (!isTauri()) {
      this.updateCurrentNote("Open file is available in the desktop app");
      return;
    }

    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(path);
    } catch (error) {
      console.error("Failed to open operation path:", error);
      this.updateCurrentNote("Failed to open file");
    }
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
    document.body.dataset.approval = toolName || "true";
    this.renderApprovalRisk(toolName, toolInput);
    this.isResolvingApproval = false;
    this.setApprovalButtonsDisabled(false);

    if (this.elApprovalButtons) {
      this.elApprovalButtons.classList.add("visible");
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
    delete document.body.dataset.approval;
    delete document.body.dataset.approvalRisk;
    this.hideApprovalRisk();
    if (this.elApprovalButtons) {
      this.elApprovalButtons.classList.remove("visible");
    }
    if (this.approvalTimer) {
      clearInterval(this.approvalTimer);
      this.approvalTimer = null;
    }
    this.isResolvingApproval = false;
    this.setApprovalButtonsDisabled(false);
  }

  private updateApprovalTimer(): void {
    if (this.elApprovalTimer) {
      this.elApprovalTimer.textContent = `${this.approvalTimeLeft}s`;
    }
  }

  private renderApprovalRisk(toolName: string, toolInput: Record<string, unknown>): void {
    const risk = assessApprovalRisk(toolName, toolInput);
    document.body.dataset.approvalRisk = risk.level;

    if (this.elApprovalRiskCard) {
      this.elApprovalRiskCard.hidden = false;
      this.elApprovalRiskCard.dataset.risk = risk.level;
    }
    if (this.elApprovalRiskLabel) {
      this.elApprovalRiskLabel.textContent = risk.label;
    }
    if (this.elApprovalRiskReason) {
      this.elApprovalRiskReason.textContent = risk.reason;
    }
    if (this.elApprovalRiskSignal) {
      this.elApprovalRiskSignal.textContent = risk.signal;
    }
  }

  private hideApprovalRisk(): void {
    if (this.elApprovalRiskCard) {
      this.elApprovalRiskCard.hidden = true;
      delete this.elApprovalRiskCard.dataset.risk;
    }
  }

  private async resolveApproval(approved: boolean): Promise<void> {
    if (!this.currentApproval || this.isResolvingApproval) return;

    this.isResolvingApproval = true;
    this.setApprovalButtonsDisabled(true);

    if (!isTauri()) {
      this.eventBus.emit({
        type: "approval-resolved",
        approvalId: this.currentApproval.approvalId,
        approved,
      });
      this.updateCurrentNote(approved ? "Preview approval allowed" : "Preview approval denied");
      this.hideApproval();
      return;
    }

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
    this.elBtnApprove?.addEventListener("click", () => {
      void this.resolveApproval(true);
    });
    this.elBtnDeny?.addEventListener("click", () => {
      void this.resolveApproval(false);
    });
  }

  private setApprovalButtonsDisabled(disabled: boolean): void {
    if (this.elBtnApprove) {
      this.elBtnApprove.disabled = disabled;
    }
    if (this.elBtnDeny) {
      this.elBtnDeny.disabled = disabled;
    }
  }

  private showApprovalError(message: string): void {
    if (this.elApprovalTimer) {
      this.elApprovalTimer.textContent = message;
    }
  }
}
