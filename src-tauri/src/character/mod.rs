pub mod loader;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimationDef {
    pub row: usize,
    pub frame_count: usize,
    pub frame_rate: u32,
    pub r#loop: bool,
    pub ping_pong: bool,
    pub next_state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CharacterManifest {
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub spritesheet: String,
    pub frame_width: usize,
    pub frame_height: usize,
    pub animations: std::collections::HashMap<String, AnimationDef>,
    pub default_state: String,
    pub scale: u32,
}
