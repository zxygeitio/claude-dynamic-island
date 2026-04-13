import { IslandController } from "./island/island";
import { CharacterRenderer } from "./character/renderer";
import { CharacterStateMachine } from "./character/state-machine";
import { SpriteLoader } from "./character/sprite-loader";
import { EventBus } from "./events/event-bus";
import { StatusPanel } from "./status/status-panel";
import { SettingsStore } from "./settings/settings-store";
import type { TransitionType } from "./character/renderer";
import { invoke } from "@tauri-apps/api/core";
import type { CharacterOption, RuntimeSettings } from "./types";

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
    let settingsPanelVisible = false;
    const spriteLoader = new SpriteLoader();
    const stateMachine = new CharacterStateMachine();
    const renderer = new CharacterRenderer(
      document.getElementById("character-canvas") as HTMLCanvasElement
    );
    const island = new IslandController();
    new StatusPanel(eventBus, stateMachine);
    let activeCharacter = settings.selectedCharacter;

    const applyCharacter = async (characterId: string) => {
      try {
        const manifest = await spriteLoader.loadManifest(characterId);
        const spritesheet = await spriteLoader.loadSpritesheet(characterId, manifest);
        renderer.setSpritesheet(spritesheet, manifest);
        stateMachine.setManifest(manifest);
        activeCharacter = characterId;
        return true;
      } catch (error) {
        console.error(`Failed to apply character ${characterId}:`, error);
        return false;
      }
    };

    // Start listening for Tauri events from the backend
    await eventBus.listenTauriEvents();

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
          updateHooksStatus(event.ok, event.message);
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

    const settingsPanel = document.getElementById("settings-panel");
    const settingsButton = document.getElementById("settings-button");
    const settingsCharacterSelect = document.getElementById("settings-character") as HTMLSelectElement | null;
    const settingsTimeoutInput = document.getElementById("settings-timeout") as HTMLInputElement | null;
    const settingsAutoApproveInput = document.getElementById("settings-auto-approve") as HTMLInputElement | null;
    const settingsHooksStatus = document.getElementById("settings-hooks-status");
    const settingsRecheckButton = document.getElementById("settings-recheck");
    const settingsSaveButton = document.getElementById("settings-save");

    const applySettingsPanelState = () => {
      settingsPanel?.classList.toggle("visible", settingsPanelVisible);
    };

    const updateHooksStatus = (ok: boolean, message: string) => {
      if (!settingsHooksStatus) {
        return;
      }

      settingsHooksStatus.textContent = message;
      settingsHooksStatus.dataset.state = ok ? "ok" : "error";
    };

    const runHooksSelfCheck = async (showSuccess = true) => {
      if (!("__TAURI_INTERNALS__" in window)) {
        updateHooksStatus(true, "Browser preview mode");
        return;
      }

      settingsRecheckButton?.setAttribute("disabled", "true");

      try {
        const startupCheck = await invoke<{ ok: boolean; shouldDisplay: boolean; message: string }>(
          "run_startup_self_check"
        );
        updateHooksStatus(startupCheck.ok, startupCheck.message);
        if (showSuccess || !startupCheck.ok || startupCheck.shouldDisplay) {
          eventBus.emit({
            type: "startup-check",
            ok: startupCheck.ok,
            message: startupCheck.message,
          });
        }
      } catch (error) {
        console.error("Failed to run startup hook self-check:", error);
        const message = "Failed to run Claude hook self-check";
        updateHooksStatus(false, message);
        eventBus.emit({
          type: "startup-check",
          ok: false,
          message,
        });
      } finally {
        settingsRecheckButton?.removeAttribute("disabled");
      }
    };

    if ("__TAURI_INTERNALS__" in window) {
      try {
        await invoke<RuntimeSettings>("update_runtime_settings", {
          payload: {
            autoApproveTools: settings.autoApproveTools,
            approvalTimeoutSeconds: settings.approvalTimeoutSeconds,
          },
        });
        await runHooksSelfCheck(false);
      } catch (error) {
        console.error("Failed to run startup hook self-check:", error);
      }
    } else {
      updateHooksStatus(true, "Browser preview mode");
    }

    const fillSettingsPanel = async () => {
      let characterOptions: CharacterOption[] = [
        { id: "default-cat", name: "Pixel Cat" },
      ];
      let runtimeSettings: RuntimeSettings = {
        autoApproveTools: settingsStore.get().autoApproveTools,
        approvalTimeoutSeconds: settingsStore.get().approvalTimeoutSeconds,
      };

      if ("__TAURI_INTERNALS__" in window) {
        try {
          runtimeSettings = await invoke<RuntimeSettings>("get_runtime_settings");
          characterOptions = await invoke<CharacterOption[]>("list_available_characters");
        } catch (error) {
          console.error("Failed to load runtime settings:", error);
        }
      }

      if (settingsCharacterSelect) {
        settingsCharacterSelect.replaceChildren(
          ...characterOptions.map((option) => {
            const el = document.createElement("option");
            el.value = option.id;
            el.textContent = option.name;
            return el;
          })
        );
        settingsCharacterSelect.value = activeCharacter;
      }
      if (settingsTimeoutInput) {
        settingsTimeoutInput.value = String(runtimeSettings.approvalTimeoutSeconds);
      }
      if (settingsAutoApproveInput) {
        settingsAutoApproveInput.value = runtimeSettings.autoApproveTools.join(", ");
      }
    };

    settingsButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      settingsPanelVisible = !settingsPanelVisible;
      if (settingsPanelVisible) {
        await fillSettingsPanel();
      }
      applySettingsPanelState();
    });

    settingsSaveButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const timeout = Math.max(1, Number(settingsTimeoutInput?.value || "30"));
      const autoApproveTools = (settingsAutoApproveInput?.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const selectedCharacter = settingsCharacterSelect?.value || activeCharacter;

      const characterChanged = selectedCharacter !== activeCharacter;
      if (characterChanged) {
        const applied = await applyCharacter(selectedCharacter);
        if (!applied) {
          eventBus.emit({
            type: "startup-check",
            ok: false,
            message: `Failed to load character: ${selectedCharacter}`,
          });
          return;
        }
      }

      await settingsStore.update({
        approvalTimeoutSeconds: timeout,
        autoApproveTools,
        selectedCharacter,
      });

      if ("__TAURI_INTERNALS__" in window) {
        try {
          await invoke<RuntimeSettings>("update_runtime_settings", {
            payload: {
              approvalTimeoutSeconds: timeout,
              autoApproveTools,
            },
          });
        } catch (error) {
          console.error("Failed to update runtime settings:", error);
        }
      }

      settingsPanelVisible = false;
      applySettingsPanelState();
      eventBus.emit({
        type: "startup-check",
        ok: true,
        message: "Runtime settings updated",
      });
    });

    settingsRecheckButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await runHooksSelfCheck(true);
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
