export function validateCharacterAssetPath(path: string): void {
  const normalized = path.replace(/\\/g, "/").trim();

  if (!normalized) {
    throw new Error("Character asset path is empty");
  }

  if (
    normalized.includes("/") ||
    normalized.includes("..") ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  ) {
    throw new Error("Character asset path must stay inside its character directory");
  }

  if (!/\.(png|webp)$/i.test(normalized)) {
    throw new Error("Character spritesheet must be a PNG or WebP image");
  }
}
