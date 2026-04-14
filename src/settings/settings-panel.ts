import { EventBus } from "../events/event-bus";
import { SettingsStore } from "./settings-store";
import { invoke } from "@tauri-apps/api/core";
import type { CharacterOption, RuntimeSettings } from "../types";
import { isTauri } from "../utils/env";

/**
 * Manages the in-island settings panel UI: character selection,
 * auto-approve configuration, hooks re-check, and save actions.
 */
export class SettingsPanelController {
  // Cached DOM elements
  private panel: HTMLElement | null;
  private button: HTMLElement | null;
  private characterSelect: HTMLSelectElement | null;
  private timeoutInput: HTMLInputElement | null;
  private autoApproveInput: HTMLInputElement | null;
  private recheckButton: HTMLElement | null;
  private saveButton: HTMLElement | null;

  private visible = false;

  constructor(
    private eventBus: EventBus,
    private settingsStore: SettingsStore,
    private activeCharacterRef: { value: string },
    private applyCharacter: (characterId: string) => Promise<boolean>,
    private updateHooksStatus: (ok: boolean, message: string) => void,
  ) {
    this.panel = document.getElementById("settings-panel");
    this.button = document.getElementById("settings-button");
    this.characterSelect = document.getElementById("settings-character") as HTMLSelectElement | null;
    this.timeoutInput = document.getElementById("settings-timeout") as HTMLInputElement | null;
    this.autoApproveInput = document.getElementById("settings-auto-approve") as HTMLInputElement | null;
    this.recheckButton = document.getElementById("settings-recheck");
    this.saveButton = document.getElementById("settings-save");

    this.initEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Hooks self-check
  // ---------------------------------------------------------------------------

  async runHooksSelfCheck(showSuccess = true): Promise<void> {
    if (!isTauri()) {
      this.updateHooksStatus(true, "Browser preview mode");
      return;
    }

    this.recheckButton?.setAttribute("disabled", "true");

    try {
      const startupCheck = await invoke<{ ok: boolean; shouldDisplay: boolean; message: string }>(
        "run_startup_self_check"
      );
      this.updateHooksStatus(startupCheck.ok, startupCheck.message);
      if (showSuccess || !startupCheck.ok || startupCheck.shouldDisplay) {
        this.eventBus.emit({
          type: "startup-check",
          ok: startupCheck.ok,
          message: startupCheck.message,
        });
      }
    } catch (error) {
      console.error("Failed to run startup hook self-check:", error);
      const message = "Failed to run Claude hook self-check";
      this.updateHooksStatus(false, message);
      this.eventBus.emit({
        type: "startup-check",
        ok: false,
        message,
      });
    } finally {
      this.recheckButton?.removeAttribute("disabled");
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private applyPanelState(): void {
    this.panel?.classList.toggle("visible", this.visible);
  }

  private async fillPanel(): Promise<void> {
    let characterOptions: CharacterOption[] = [
      { id: "default-cat", name: "Pixel Cat" },
    ];
    let runtimeSettings: RuntimeSettings = {
      autoApproveTools: this.settingsStore.get().autoApproveTools,
      approvalTimeoutSeconds: this.settingsStore.get().approvalTimeoutSeconds,
    };

    if (isTauri()) {
      try {
        runtimeSettings = await invoke<RuntimeSettings>("get_runtime_settings");
        characterOptions = await invoke<CharacterOption[]>("list_available_characters");
      } catch (error) {
        console.error("Failed to load runtime settings:", error);
      }
    }

    if (this.characterSelect) {
      this.characterSelect.replaceChildren(
        ...characterOptions.map((option) => {
          const el = document.createElement("option");
          el.value = option.id;
          el.textContent = option.name;
          return el;
        })
      );
      this.characterSelect.value = this.activeCharacterRef.value;
    }
    if (this.timeoutInput) {
      this.timeoutInput.value = String(runtimeSettings.approvalTimeoutSeconds);
    }
    if (this.autoApproveInput) {
      this.autoApproveInput.value = runtimeSettings.autoApproveTools.join(", ");
    }
  }

  private initEventListeners(): void {
    this.button?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.visible = !this.visible;
      if (this.visible) {
        await this.fillPanel();
      }
      this.applyPanelState();
    });

    this.saveButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const timeout = Math.max(1, Number(this.timeoutInput?.value || "30"));
      const autoApproveTools = (this.autoApproveInput?.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const selectedCharacter = this.characterSelect?.value || this.activeCharacterRef.value;

      const characterChanged = selectedCharacter !== this.activeCharacterRef.value;
      if (characterChanged) {
        const applied = await this.applyCharacter(selectedCharacter);
        if (!applied) {
          this.eventBus.emit({
            type: "startup-check",
            ok: false,
            message: `Failed to load character: ${selectedCharacter}`,
          });
          return;
        }
      }

      await this.settingsStore.update({
        approvalTimeoutSeconds: timeout,
        autoApproveTools,
        selectedCharacter,
      });

      if (isTauri()) {
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

      this.visible = false;
      this.applyPanelState();
      this.eventBus.emit({
        type: "startup-check",
        ok: true,
        message: "Runtime settings updated",
      });
    });

    this.recheckButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.runHooksSelfCheck(true);
    });
  }
}
