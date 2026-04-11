import { IslandController } from "./island/island";
import { CharacterRenderer } from "./character/renderer";
import { CharacterStateMachine } from "./character/state-machine";
import { SpriteLoader } from "./character/sprite-loader";
import { EventBus } from "./events/event-bus";
import { StatusPanel } from "./status/status-panel";
import { SettingsStore } from "./settings/settings-store";
import type { TransitionType } from "./character/renderer";
import { invoke } from "@tauri-apps/api/core";

async function init() {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      document.body.dataset.tauri = "true";
      try {
        const [{ getCurrentWindow }, { getCurrentWebview }] = await Promise.all([
          import("@tauri-apps/api/window"),
          import("@tauri-apps/api/webview"),
        ]);
        await getCurrentWindow().setBackgroundColor({ red: 5, green: 5, blue: 6, alpha: 255 });
        await getCurrentWebview().setBackgroundColor({ red: 5, green: 5, blue: 6, alpha: 255 });
      } catch (error) {
        console.error("Failed to apply transparent Tauri background:", error);
      }
    }

    const eventBus = new EventBus();
    const settingsStore = new SettingsStore();
    await settingsStore.load();
    const settings = settingsStore.get();
    const spriteLoader = new SpriteLoader();
    const stateMachine = new CharacterStateMachine();
    const renderer = new CharacterRenderer(
      document.getElementById("character-canvas") as HTMLCanvasElement
    );
    const island = new IslandController();
    new StatusPanel(eventBus, stateMachine);

    // Start listening for Tauri events from the backend
    await eventBus.listenTauriEvents();

    try {
      const manifest = await spriteLoader.loadManifest(settings.selectedCharacter);
      const spritesheet = await spriteLoader.loadSpritesheet(settings.selectedCharacter, manifest);
      renderer.setSpritesheet(spritesheet, manifest);
      stateMachine.setManifest(manifest);
    } catch (err) {
      console.error("Failed to load configured character, falling back to default-cat:", err);
      try {
        const manifest = await spriteLoader.loadManifest("default-cat");
        const spritesheet = await spriteLoader.loadSpritesheet("default-cat", manifest);
        renderer.setSpritesheet(spritesheet, manifest);
        stateMachine.setManifest(manifest);
      } catch (fallbackError) {
        console.error("Failed to load default character:", fallbackError);
        const noteEl = document.getElementById("current-note");
        if (noteEl) {
          noteEl.textContent = "Character assets failed to load";
        }
      }
    }

    if ("__TAURI_INTERNALS__" in window) {
      try {
        const startupCheck = await invoke<{ ok: boolean; shouldDisplay: boolean; message: string }>(
          "run_startup_self_check"
        );
        if (startupCheck.shouldDisplay) {
          eventBus.emit({
            type: "startup-check",
            ok: startupCheck.ok,
            message: startupCheck.message,
          });
        }
      } catch (error) {
        console.error("Failed to run startup hook self-check:", error);
      }
    }

    // Connect state machine to renderer
    stateMachine.onStateChange((state, transition) => {
      renderer.playAnimation(state, transition as TransitionType);
    });

    // Connect event bus to state machine + island
    let collapseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearCollapseTimer = () => {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    };
    const scheduleCollapse = (delayMs: number, callback: () => void) => {
      clearCollapseTimer();
      collapseTimer = setTimeout(() => {
        collapseTimer = null;
        callback();
      }, delayMs);
    };

    eventBus.subscribe((event) => {
      switch (event.type) {
        case "pre-tool-use":
          clearCollapseTimer();
          stateMachine.transition("working", "squish");
          island.setWaiting();
          island.expand();
          break;
        case "post-tool-use":
          clearCollapseTimer();
          if (event.isError) {
            stateMachine.transition("confused", "shake");
            island.setError();
            island.expand();
          } else {
            island.setWorking();
          }
          break;
        case "notification":
          clearCollapseTimer();
          if (stateMachine.getCurrentState() === "sleeping") {
            stateMachine.transition("working", "squish");
          }
          island.setWorking();
          island.expand();
          break;
        case "stop":
          clearCollapseTimer();
          if (event.stopReason === "end_turn") {
            stateMachine.transition("celebrating", "jump");
            island.setDone();
            scheduleCollapse(3000, () => {
              island.collapse();
              island.setIdle();
              stateMachine.transition("idle", undefined);
            });
          } else {
            stateMachine.transition("idle", undefined);
            island.setIdle();
            scheduleCollapse(2000, () => island.collapse());
          }
          break;
        case "approval-requested":
          clearCollapseTimer();
          island.setWaiting();
          island.expand();
          break;
        case "approval-resolved":
          clearCollapseTimer();
          if (event.approved) {
            island.setWorking();
          } else {
            island.setIdle();
            stateMachine.transition("idle", undefined);
            scheduleCollapse(1500, () => island.collapse());
          }
          break;
        case "startup-check":
          clearCollapseTimer();
          island.expand();
          if (event.ok) {
            stateMachine.transition("celebrating", "jump");
            island.setDone();
            scheduleCollapse(2400, () => {
              island.collapse();
              island.setIdle();
              stateMachine.transition("idle", undefined);
            });
          } else {
            stateMachine.transition("confused", "shake");
            island.setError();
          }
          break;
      }
    });

    // Click to toggle expand/collapse
    const expandHint = document.getElementById("expand-hint");
    expandHint?.addEventListener("click", () => {
      island.toggle();
    });

    const quitButton = document.getElementById("quit-button");
    quitButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!("__TAURI_INTERNALS__" in window)) {
        return;
      }

      try {
        await invoke("quit_app");
      } catch (error) {
        console.error("Failed to close Claude Dynamic Island:", error);
      }
    });

    // Also click on pill body to toggle
    const islandEl = document.getElementById("island");
    islandEl?.addEventListener("dblclick", () => {
      island.toggle();
    });

    // Start render loop
    renderer.startRenderLoop();

    // Start idle timer for sleep state
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (stateMachine.getCurrentState() === "idle") {
          stateMachine.transition("sleeping", "sleep");
        }
      }, 5 * 60 * 1000);
    };

    eventBus.subscribe(() => resetIdleTimer());
    resetIdleTimer();
  } finally {
    document.body.dataset.ready = "true";
  }
}

init().catch(console.error);
