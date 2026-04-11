export type CharacterState = "idle" | "working" | "celebrating" | "sleeping" | "confused";

export type IslandStatus = "idle" | "working" | "waiting" | "done" | "error";

export interface AnimationDef {
  row: number;
  frameCount: number;
  frameRate: number;
  loop: boolean;
  pingPong: boolean;
  nextState?: CharacterState;
}

export interface CharacterManifest {
  name: string;
  author?: string;
  version?: string;
  description?: string;
  spritesheet: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<CharacterState, AnimationDef>;
  defaultState: CharacterState;
  scale: number;
}

export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  transcript_path?: string;
  input?: {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_output?: string;
    message?: string;
    stop_reason?: string;
  };
}

export interface ApprovalRequest {
  approvalId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

export interface SelectionQuestion {
  header: string;
  prompt: string;
  options: string[];
  multiSelect: boolean;
}

export interface SelectionPrompt {
  requestId: string;
  toolInput: Record<string, unknown>;
  questions: SelectionQuestion[];
}

export interface ActionRecord {
  toolName: string;
  summary: string;
  timestamp: number;
  isError: boolean;
}

export interface AppSettings {
  islandPosition: { x: number; y: number } | null;
  selectedCharacter: string;
  autoApproveTools: string[];
  approvalTimeoutSeconds: number;
  serverPort: number;
  autoStart: boolean;
}
