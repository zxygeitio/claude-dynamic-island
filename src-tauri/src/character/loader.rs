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

#[allow(dead_code)]
pub fn get_characters_dir() -> PathBuf {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        return PathBuf::from(app_data).join("claude-dynamic-island").join("characters");
    }

    PathBuf::from(".").join("characters")
}

#[cfg(test)]
mod tests {
    use super::scan_characters_dir;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    #[test]
    fn scan_characters_dir_returns_valid_manifest_with_existing_spritesheet() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("claude-dynamic-island-test-{unique}"));
        let character_dir = root.join("test-cat");
        fs::create_dir_all(&character_dir).expect("create character dir");

        fs::write(
            character_dir.join("manifest.json"),
            r#"{
              "name":"Test Cat",
              "spritesheet":"spritesheet.png",
              "frame_width":16,
              "frame_height":16,
              "animations":{
                "idle":{"row":0,"frame_count":1,"frame_rate":1,"loop":true,"ping_pong":false,"next_state":null},
                "working":{"row":0,"frame_count":1,"frame_rate":1,"loop":true,"ping_pong":false,"next_state":null}
              },
              "default_state":"idle",
              "scale":2
            }"#,
        )
        .expect("write manifest");
        fs::write(character_dir.join("spritesheet.png"), [0u8]).expect("write spritesheet");

        let manifests = scan_characters_dir(&root);
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].name, "Test Cat");

        let _ = fs::remove_dir_all(root);
    }
}
