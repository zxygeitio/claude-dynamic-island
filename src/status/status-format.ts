export type ActivityTone = "neutral" | "info" | "success" | "danger" | "waiting";
export type ApprovalRiskLevel = "safe" | "review" | "danger";

export interface HistorySummary {
  summary: string;
  path: string | null;
  tone: ActivityTone;
}

export interface ApprovalRisk {
  level: ApprovalRiskLevel;
  label: string;
  signal: string;
  reason: string;
}

const PATH_KEYS = ["file_path", "path", "notebook_path", "cwd"];
const READ_ONLY_TOOLS = new Set(["Read", "Grep", "Glob"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const DESTRUCTIVE_COMMAND_PATTERN =
  /\b(rm\s+-rf|remove-item|del\s+\/[fsq]|rmdir\s+\/s|git\s+reset\s+--hard|git\s+clean\s+-fd|format|mkfs|shutdown|npm\s+publish|cargo\s+publish)\b/i;

export function getPrimaryPath(toolInput: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function createHistorySummary(
  toolName: string,
  toolInput: Record<string, unknown>,
  isError: boolean
): HistorySummary {
  const path = getPrimaryPath(toolInput);
  const tone = getActivityTone(toolName, isError);
  let summary = toolName;

  if (toolName === "Bash" && typeof toolInput.command === "string") {
    summary = `Bash: ${truncateSingleLine(toolInput.command, 48)}`;
  } else if (
    (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") &&
    path
  ) {
    summary = `${toolName}: ${compactPath(path)}`;
  } else if (toolName === "Read" && path) {
    summary = `Read: ${compactPath(path)}`;
  } else if (toolName === "Grep" && typeof toolInput.pattern === "string") {
    summary = `Grep: ${truncateSingleLine(toolInput.pattern, 32)}`;
  } else if (toolName === "Glob" && typeof toolInput.pattern === "string") {
    summary = `Glob: ${truncateSingleLine(toolInput.pattern, 32)}`;
  }

  return { summary, path, tone };
}

export function formatRelativeTime(timestamp: number | null, now = Date.now()): string {
  if (!timestamp) {
    return "-";
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return "now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export function formatDuration(startedAt: number | null, now = Date.now()): string {
  if (!startedAt) {
    return "0s";
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

export function getActivityTone(toolName: string, isError: boolean): ActivityTone {
  if (isError) {
    return "danger";
  }

  if (toolName === "Bash" || toolName === "AskUserQuestion") {
    return "waiting";
  }

  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    return "info";
  }

  if (toolName === "Stop") {
    return "success";
  }

  return "neutral";
}

export function assessApprovalRisk(
  toolName: string,
  toolInput: Record<string, unknown>
): ApprovalRisk {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return {
      level: "safe",
      label: "Low Risk",
      signal: "READ",
      reason: "Inspect-only tool",
    };
  }

  if (toolName === "Bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    if (DESTRUCTIVE_COMMAND_PATTERN.test(command)) {
      return {
        level: "danger",
        label: "High Risk",
        signal: "SHELL",
        reason: "Destructive shell command",
      };
    }

    return {
      level: "review",
      label: "Review",
      signal: "SHELL",
      reason: "Shell command requires attention",
    };
  }

  if (WRITE_TOOLS.has(toolName)) {
    return {
      level: "review",
      label: "Review",
      signal: "WRITE",
      reason: "Will modify workspace files",
    };
  }

  if (toolName === "AskUserQuestion") {
    return {
      level: "safe",
      label: "Low Risk",
      signal: "INPUT",
      reason: "Human input request",
    };
  }

  return {
    level: "review",
    label: "Review",
    signal: "TOOL",
    reason: "Check tool input before approving",
  };
}

export function formatPayloadForClipboard(hookLabel: string, payloadText: string): string {
  const hook = hookLabel.trim() || "Unknown";
  const payload = payloadText.trim() || "No payload yet";
  return `Hook: ${hook}\nPayload:\n${payload}`;
}

function compactPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

function truncateSingleLine(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}
