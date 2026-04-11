import type { AppSettings } from "../types";

const SETTINGS_KEY = "app-settings";

const DEFAULT_SETTINGS: AppSettings = {
  islandPosition: null,
  selectedCharacter: "default-cat",
  autoApproveTools: ["Read", "Grep", "Glob"],
  approvalTimeoutSeconds: 30,
  serverPort: 17321,
  autoStart: false,
};

export class SettingsStore {
  private settings: AppSettings;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load(): Promise<void> {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      const saved = await store.get<AppSettings>(SETTINGS_KEY);
      if (saved) {
        this.settings = { ...DEFAULT_SETTINGS, ...saved };
      }
    } catch {
      // Store not available yet (dev mode), use defaults
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  async save(): Promise<void> {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      await store.set(SETTINGS_KEY, this.settings);
      await store.save();
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  async update(partial: Partial<AppSettings>): Promise<void> {
    this.settings = { ...this.settings, ...partial };
    await this.save();
  }
}
