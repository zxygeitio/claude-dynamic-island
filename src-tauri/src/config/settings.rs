use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct AppSettings {
    pub island_position: Option<(i32, i32)>,
    pub selected_character: String,
    pub auto_approve_tools: Vec<String>,
    pub approval_timeout_seconds: u64,
    pub server_port: u16,
    pub auto_start: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            island_position: None,
            selected_character: "default-cat".to_string(),
            auto_approve_tools: vec!["Read".to_string(), "Grep".to_string(), "Glob".to_string()],
            approval_timeout_seconds: 30,
            server_port: 17321,
            auto_start: false,
        }
    }
}
