use std::fs;
use std::path::PathBuf;
use crate::character::CharacterManifest;

pub fn scan_characters_dir(dir: &PathBuf) -> Vec<CharacterManifest> {
    let mut manifests = Vec::new();

    if !dir.exists() {
        return manifests;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let manifest_path = path.join("manifest.json");
                if manifest_path.exists() {
                    if let Ok(content) = fs::read_to_string(&manifest_path) {
                        if let Ok(manifest) = serde_json::from_str::<CharacterManifest>(&content) {
                            // Validate that the spritesheet file exists
                            let spritesheet_path = path.join(&manifest.spritesheet);
                            if spritesheet_path.exists() {
                                manifests.push(manifest);
                            } else {
                                eprintln!(
                                    "Warning: Spritesheet not found for character '{}': {}",
                                    manifest.name,
                                    spritesheet_path.display()
                                );
                            }
                        } else {
                            eprintln!(
                                "Warning: Invalid manifest.json in {}",
                                path.display()
                            );
                        }
                    }
                }
            }
        }
    }

    manifests
}

pub fn get_characters_dir() -> PathBuf {
    let app_data = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    app_data.join("claude-dynamic-island").join("characters")
}
