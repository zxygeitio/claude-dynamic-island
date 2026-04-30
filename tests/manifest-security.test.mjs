import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helpers = await importManifestSecurityHelpers();

test("accepts local character image filenames", () => {
  assert.doesNotThrow(() => helpers.validateCharacterAssetPath("spritesheet.png"));
  assert.doesNotThrow(() => helpers.validateCharacterAssetPath("idle.webp"));
});

test("rejects character asset paths that escape the character directory", () => {
  assert.throws(() => helpers.validateCharacterAssetPath("../secret.png"));
  assert.throws(() => helpers.validateCharacterAssetPath("subdir/spritesheet.png"));
  assert.throws(() => helpers.validateCharacterAssetPath("https://example.com/sprite.png"));
  assert.throws(() => helpers.validateCharacterAssetPath("payload.svg"));
});

async function importManifestSecurityHelpers() {
  const source = await readFile(
    new URL("../src/character/manifest-security.ts", import.meta.url),
    "utf8"
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}
