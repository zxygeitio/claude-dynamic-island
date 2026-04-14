import type { IslandEvent } from "./event-bus";
import { EventBus } from "./event-bus";
import { IslandController } from "../island/island";
import { CharacterStateMachine } from "../character/state-machine";

/**
 * Orchestrates the mapping from incoming hook events to UI state changes.
 *
 * Centralises the collapse-timer management, character state transitions,
 * and island status updates that were previously inlined in main.ts.
 */
export class EventOrchestrator {
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private eventBus: EventBus,
    private island: IslandController,
    private stateMachine: CharacterStateMachine,
    private onHooksStatus: (ok: boolean, message: string) => void,
  ) {
    this.eventBus.subscribe((event) => this.handle(event));
  }

  // ---------------------------------------------------------------------------
  // Collapse timer helpers
  // ---------------------------------------------------------------------------

  private clearCollapseTimer(): void {
    if (this.collapseTimer) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
  }

  private scheduleCollapse(delayMs: number, callback: () => void): void {
    this.clearCollapseTimer();
    this.collapseTimer = setTimeout(() => {
      this.collapseTimer = null;
      callback();
    }, delayMs);
  }

  // ---------------------------------------------------------------------------
  // Event handler
  // ---------------------------------------------------------------------------

  private handle(event: IslandEvent): void {
    switch (event.type) {
      case "pre-tool-use":
        this.clearCollapseTimer();
        this.stateMachine.transition("working", "squish");
        this.island.setWaiting();
        this.island.expand();
        break;

      case "post-tool-use":
        this.clearCollapseTimer();
        if (event.isError) {
          this.stateMachine.transition("confused", "shake");
          this.island.setError();
          this.island.expand();
        } else {
          this.island.setWorking();
        }
        break;

      case "notification":
        this.clearCollapseTimer();
        if (this.stateMachine.getCurrentState() === "sleeping") {
          this.stateMachine.transition("working", "squish");
        }
        this.island.setWorking();
        this.island.expand();
        break;

      case "stop":
        this.clearCollapseTimer();
        if (event.stopReason === "end_turn") {
          this.stateMachine.transition("celebrating", "jump");
          this.island.setDone();
          this.scheduleCollapse(3000, () => {
            this.island.collapse();
            this.island.setIdle();
            this.stateMachine.transition("idle", undefined);
          });
        } else {
          this.stateMachine.transition("idle", undefined);
          this.island.setIdle();
          this.scheduleCollapse(2000, () => this.island.collapse());
        }
        break;

      case "approval-requested":
        this.clearCollapseTimer();
        this.island.setWaiting();
        this.island.expand();
        break;

      case "approval-resolved":
        this.clearCollapseTimer();
        if (event.approved) {
          this.island.setWorking();
        } else {
          this.island.setIdle();
          this.stateMachine.transition("idle", undefined);
          this.scheduleCollapse(1500, () => this.island.collapse());
        }
        break;

      case "startup-check":
        this.clearCollapseTimer();
        this.onHooksStatus(event.ok, event.message);
        this.island.expand();
        if (event.ok) {
          this.stateMachine.transition("celebrating", "jump");
          this.island.setDone();
          this.scheduleCollapse(2400, () => {
            this.island.collapse();
            this.island.setIdle();
            this.stateMachine.transition("idle", undefined);
          });
        } else {
          this.stateMachine.transition("confused", "shake");
          this.island.setError();
        }
        break;
    }
  }
}
