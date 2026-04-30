import { IslandController } from "./island/island";
import { CharacterRenderer } from "./character/renderer";
import { CharacterStateMachine } from "./character/state-machine";
import { SpriteLoader } from "./character/sprite-loader";
import { EventBus } from "./events/event-bus";
import { EventOrchestrator } from "./events/event-orchestrator";
import { StatusPanel } from "./status/status-panel";
import { SettingsStore } from "./settings/settings-store";
import { SettingsPanelController } from "./settings/settings-panel";
import { initPreviewControls } from "./preview/demo-controls";
import type { TransitionType } from "./character/renderer";
import type { RuntimeSettings } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./utils/env";

async function init() {
  try {
    // Keep native and WebView backgrounds aligned to avoid a white first frame.
    if (isTauri()) {
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
    // Core services.
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
    new StatusPanel(eventBus);
    if (!isTauri()) {
      document.body.dataset.preview = "true";
      initPreviewControls(eventBus);
    }

    // Shared mutable reference for the active character id.
    const activeCharacterRef = { value: settings.selectedCharacter };

    const applyCharacter = async (characterId: string): Promise<boolean> => {
      try {
        const manifest = await spriteLoader.loadManifest(characterId);
        const spritesheet = await spriteLoader.loadSpritesheet(characterId, manifest);
        renderer.setSpritesheet(spritesheet, manifest);
        stateMachine.setManifest(manifest);
        activeCharacterRef.value = characterId;
        return true;
      } catch (error) {
        console.error(`Failed to apply character ${characterId}:`, error);
        return false;
      }
    };
    // Hooks status helper shared between orchestrator and settings.
    const hooksStatusEl = document.getElementById("settings-hooks-status");
    const updateHooksStatus = (ok: boolean, message: string): void => {
      if (!hooksStatusEl) return;
      hooksStatusEl.textContent = message;
      hooksStatusEl.dataset.state = ok ? "ok" : "error";
    };
    // Event wiring.
    if (isTauri()) {
      await eventBus.listenTauriEvents();
    }
    // Event orchestrator handles event-to-island/state-machine mapping.
    new EventOrchestrator(eventBus, island, stateMachine, updateHooksStatus);

    // Settings panel controller
    const settingsPanel = new SettingsPanelController(
      eventBus,
      settingsStore,
      activeCharacterRef,
      applyCharacter,
      updateHooksStatus,
    );
    // Load initial character.
    try {
      const ok = await applyCharacter(settings.selectedCharacter);
      if (!ok) {
        throw new Error("Configured character failed to load");
      }
    } catch (err) {
      console.error("Failed to load configured character, falling back to default-cat:", err);
      try {
        const ok = await applyCharacter("default-cat");
        if (!ok) {
          throw new Error("Default character failed to load");
        }
      } catch (fallbackError) {
        console.error("Failed to load default character:", fallbackError);
        const noteEl = document.getElementById("current-note");
        if (noteEl) {
          noteEl.textContent = "Character assets failed to load";
        }
      }
    }
    // Connect state machine to renderer.
    stateMachine.onStateChange((state, transition) => {
      renderer.playAnimation(state, transition as TransitionType);
    });
    // Startup self-check and runtime settings sync.
    if (isTauri()) {
      try {
        await invoke<RuntimeSettings>("update_runtime_settings", {
          payload: {
            autoApproveTools: settings.autoApproveTools,
            approvalTimeoutSeconds: settings.approvalTimeoutSeconds,
          },
        });
        await settingsPanel.runHooksSelfCheck(false);
      } catch (error) {
        console.error("Failed to run startup hook self-check:", error);
      }
    } else {
      updateHooksStatus(true, "Browser preview mode");
    }
    // UI interactions.
    document.getElementById("expand-hint")?.addEventListener("click", () => {
      island.toggle();
    });

    document.getElementById("quit-button")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isTauri()) return;
      try {
        await invoke("quit_app");
      } catch (error) {
        console.error("Failed to close Claude Dynamic Island:", error);
      }
    });

    document.getElementById("island")?.addEventListener("dblclick", () => {
      island.toggle();
    });
    // Render loop.
    renderer.startRenderLoop();
    // Idle-to-sleep timer.
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
