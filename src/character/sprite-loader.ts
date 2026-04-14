import type { CharacterManifest } from "../types";
import defaultCatSpritesheetUrl from "../../characters/default-cat/spritesheet.png";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../utils/env";

const DEFAULT_CHARACTER_NAME = "default-cat";
const EMBEDDED_DEFAULT_MANIFEST: CharacterManifest = {
  name: "Pixel Cat",
  author: "Claude Dynamic Island",
  version: "1.0.0",
  description: "A cute pixel cat companion for your Dynamic Island",
  spritesheet: "spritesheet.png",
  frameWidth: 16,
  frameHeight: 16,
  animations: {
    idle: {
      row: 0,
      frameCount: 8,
      frameRate: 4,
      loop: true,
      pingPong: true,
    },
    working: {
      row: 0,
      frameCount: 8,
      frameRate: 6,
      loop: true,
      pingPong: true,
    },
    celebrating: {
      row: 2,
      frameCount: 6,
      frameRate: 10,
      loop: false,
      pingPong: false,
      nextState: "idle",
    },
    sleeping: {
      row: 3,
      frameCount: 4,
      frameRate: 2,
      loop: true,
      pingPong: true,
    },
    confused: {
      row: 4,
      frameCount: 6,
      frameRate: 6,
      loop: false,
      pingPong: false,
      nextState: "idle",
    },
  },
  defaultState: "idle",
  scale: 2,
};

export class SpriteLoader {
  private basePath: string;
  private imageSrcByCharacter = new Map<string, string>();

  constructor() {
    // In dev, characters are served from Vite under /characters.
    this.basePath = "/characters";
  }

  async loadManifest(characterName: string): Promise<CharacterManifest> {
    if (characterName === DEFAULT_CHARACTER_NAME) {
      this.imageSrcByCharacter.set(DEFAULT_CHARACTER_NAME, defaultCatSpritesheetUrl);
      return EMBEDDED_DEFAULT_MANIFEST;
    }

    try {
      const url = `${this.basePath}/${characterName}/manifest.json`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load manifest for ${characterName}: ${response.status}`);
      }
      const manifest: CharacterManifest = await response.json();
      this.validateManifest(manifest);
      this.imageSrcByCharacter.set(characterName, `${this.basePath}/${characterName}/${manifest.spritesheet}`);
      return manifest;
    } catch (webError) {
      if (!isTauri()) {
        throw webError;
      }

      const manifest = await this.loadManifestFromTauriResources(characterName);
      this.validateManifest(manifest);
      return manifest;
    }
  }

  async loadSpritesheet(characterName: string, manifest: CharacterManifest): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load spritesheet: ${manifest.spritesheet}`));
      img.src = this.imageSrcByCharacter.get(characterName)
        ?? `${this.basePath}/${characterName}/${manifest.spritesheet}`;
    });
  }

  private async loadManifestFromTauriResources(characterName: string): Promise<CharacterManifest> {
    const [{ resourceDir, join }, { readTextFile }] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const resourcesRoot = await resourceDir();
    const manifestPath = await join(resourcesRoot, "characters", characterName, "manifest.json");
    const manifestText = await readTextFile(manifestPath);
    const manifest = JSON.parse(manifestText) as CharacterManifest;
    const spritesheetPath = await join(resourcesRoot, "characters", characterName, manifest.spritesheet);
    this.imageSrcByCharacter.set(characterName, convertFileSrc(spritesheetPath));
    return manifest;
  }

  private validateManifest(manifest: CharacterManifest): void {
    if (!manifest.name) throw new Error("Manifest missing 'name'");
    if (!manifest.spritesheet) throw new Error("Manifest missing 'spritesheet'");
    if (!manifest.frameWidth || manifest.frameWidth <= 0) throw new Error("Invalid frameWidth");
    if (!manifest.frameHeight || manifest.frameHeight <= 0) throw new Error("Invalid frameHeight");
    if (!manifest.animations.idle) throw new Error("Manifest missing required 'idle' animation");
    if (!manifest.animations.working) throw new Error("Manifest missing required 'working' animation");
  }
}
