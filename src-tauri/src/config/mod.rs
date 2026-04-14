pub mod settings;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{env, fs, path::PathBuf};

#[derive(Debug, Clone)]
pub struct HookVerificationResult {
    pub checked_paths: Vec<PathBuf>,
    pub missing_entries: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HookConfig {
    pub hooks: HooksConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HooksConfig {
    #[serde(rename = "PreToolUse")]
    pub pre_tool_use: Vec<HookMatcher>,
    #[serde(rename = "PostToolUse")]
    pub post_tool_use: Vec<HookMatcher>,
    #[serde(rename = "PostToolUseFailure")]
    pub post_tool_use_failure: Vec<HookMatcher>,
    #[serde(rename = "Notification")]
    pub notification: Vec<HookMatcher>,
    #[serde(rename = "Stop")]
    pub stop: Vec<HookMatcher>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HookMatcher {
    pub matcher: String,
    pub hooks: Vec<HookEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HookEntry {
    #[serde(rename = "type")]
    pub hook_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_env_vars: Option<Vec<String>>,
}

#[allow(dead_code)]
pub fn generate_hook_config(port: u16) -> HookConfig {
    let base_url = format!("http://127.0.0.1:{}", port);

    HookConfig {
        hooks: HooksConfig {
            pre_tool_use: vec![HookMatcher {
                matcher: String::new(),
                hooks: vec![HookEntry {
                    hook_type: "http".to_string(),
                    command: None,
                    url: Some(format!("{}/hooks/pre-tool-use", base_url)),
                    timeout: Some(120),
                    headers: None,
                    allowed_env_vars: None,
                }],
            }],
            post_tool_use: vec![HookMatcher {
                matcher: String::new(),
                hooks: vec![HookEntry {
                    hook_type: "http".to_string(),
                    command: None,
                    url: Some(format!("{}/hooks/post-tool-use", base_url)),
                    timeout: None,
                    headers: None,
                    allowed_env_vars: None,
                }],
            }],
            post_tool_use_failure: vec![HookMatcher {
                matcher: String::new(),
                hooks: vec![HookEntry {
                    hook_type: "http".to_string(),
                    command: None,
                    url: Some(format!("{}/hooks/post-tool-use-failure", base_url)),
                    timeout: None,
                    headers: None,
                    allowed_env_vars: None,
                }],
            }],
            notification: vec![HookMatcher {
                matcher: String::new(),
                hooks: vec![HookEntry {
                    hook_type: "http".to_string(),
                    command: None,
                    url: Some(format!("{}/hooks/notification", base_url)),
                    timeout: None,
                    headers: None,
                    allowed_env_vars: None,
                }],
            }],
            stop: vec![HookMatcher {
                matcher: String::new(),
                hooks: vec![HookEntry {
                    hook_type: "http".to_string(),
                    command: None,
                    url: Some(format!("{}/hooks/stop", base_url)),
                    timeout: None,
                    headers: None,
                    allowed_env_vars: None,
                }],
            }],
        },
    }
}

pub fn ensure_claude_hook_config(
    port: u16,
) -> Result<Vec<PathBuf>, Box<dyn std::error::Error + Send + Sync>> {
    let mut updated_paths = vec![resolve_user_claude_settings_path()?];

    if let Some(project_path) = resolve_project_claude_settings_path()? {
        updated_paths.push(project_path);
    }

    for settings_path in &updated_paths {
        write_hook_config(&settings_path, port)?;
    }

    Ok(updated_paths)
}

pub fn verify_claude_hook_config(
    port: u16,
    settings_paths: &[PathBuf],
) -> Result<HookVerificationResult, Box<dyn std::error::Error + Send + Sync>> {
    let base = hook_base_url(port);
    let expected = [
        ("PreToolUse", format!("{}/hooks/pre-tool-use", base)),
        ("PostToolUse", format!("{}/hooks/post-tool-use", base)),
        (
            "PostToolUseFailure",
            format!("{}/hooks/post-tool-use-failure", base),
        ),
        ("Notification", format!("{}/hooks/notification", base)),
        ("Stop", format!("{}/hooks/stop", base)),
    ];
    let mut missing_entries = Vec::new();

    for settings_path in settings_paths {
        let content = fs::read_to_string(settings_path)?;
        let root = serde_json::from_str::<Value>(&content)?;
        let hooks_object = root
            .get("hooks")
            .and_then(Value::as_object)
            .ok_or("Claude settings hooks must be a JSON object")?;

        for (key, url) in &expected {
            let matchers = hooks_object
                .get(*key)
                .cloned()
                .map(serde_json::from_value::<Vec<HookMatcher>>)
                .transpose()?
                .unwrap_or_default();

            let found = matchers
                .iter()
                .flat_map(|matcher| matcher.hooks.iter())
                .any(|entry| is_dynamic_island_hook(entry, url));

            if !found {
                missing_entries.push(format!("{} missing in {}", key, settings_path.display()));
            }
        }
    }

    Ok(HookVerificationResult {
        checked_paths: settings_paths.to_vec(),
        missing_entries,
    })
}

fn write_hook_config(
    settings_path: &PathBuf,
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let parent = settings_path
        .parent()
        .ok_or("Claude settings path has no parent directory")?;
    fs::create_dir_all(parent)?;

    let mut root = if settings_path.exists() {
        let content = fs::read_to_string(settings_path)?;
        if content.trim().is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::from_str::<Value>(&content)?
        }
    } else {
        Value::Object(Map::new())
    };

    let root_object = root
        .as_object_mut()
        .ok_or("Claude settings.json must be a JSON object")?;
    let hooks_value = root_object
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let hooks_object = hooks_value
        .as_object_mut()
        .ok_or("Claude settings hooks must be a JSON object")?;

    let generated = generate_hook_config(port);
    merge_hook_entries(
        hooks_object,
        "PreToolUse",
        generated.hooks.pre_tool_use,
        &format!("{}/hooks/pre-tool-use", hook_base_url(port)),
    )?;
    merge_hook_entries(
        hooks_object,
        "PostToolUse",
        generated.hooks.post_tool_use,
        &format!("{}/hooks/post-tool-use", hook_base_url(port)),
    )?;
    merge_hook_entries(
        hooks_object,
        "PostToolUseFailure",
        generated.hooks.post_tool_use_failure,
        &format!("{}/hooks/post-tool-use-failure", hook_base_url(port)),
    )?;
    merge_hook_entries(
        hooks_object,
        "Notification",
        generated.hooks.notification,
        &format!("{}/hooks/notification", hook_base_url(port)),
    )?;
    merge_hook_entries(
        hooks_object,
        "Stop",
        generated.hooks.stop,
        &format!("{}/hooks/stop", hook_base_url(port)),
    )?;

    let pretty = serde_json::to_string_pretty(&root)?;
    fs::write(settings_path, pretty)?;

    Ok(())
}

fn hook_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{}", port)
}

fn merge_hook_entries(
    hooks_object: &mut Map<String, Value>,
    key: &str,
    generated: Vec<HookMatcher>,
    target_url: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut existing = hooks_object
        .get(key)
        .cloned()
        .map(serde_json::from_value::<Vec<HookMatcher>>)
        .transpose()?
        .unwrap_or_default();

    for matcher in &mut existing {
        matcher.hooks.retain(|entry| !is_dynamic_island_hook(entry, target_url));
    }
    existing.retain(|matcher| !matcher.hooks.is_empty());

    for generated_matcher in generated {
        if let Some(existing_matcher) = existing
            .iter_mut()
            .find(|matcher| matcher.matcher == generated_matcher.matcher)
        {
            existing_matcher.hooks.extend(generated_matcher.hooks);
        } else {
            existing.push(generated_matcher);
        }
    }

    hooks_object.insert(key.to_string(), serde_json::to_value(existing)?);
    Ok(())
}

fn is_dynamic_island_hook(entry: &HookEntry, target_url: &str) -> bool {
    entry.hook_type == "http" && entry.url.as_deref() == Some(target_url)
}

fn resolve_user_claude_settings_path() -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
    if let Some(user_profile) = env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(user_profile).join(".claude").join("settings.json"));
    }

    if let Some(home) = env::var_os("HOME") {
        return Ok(PathBuf::from(home).join(".claude").join("settings.json"));
    }

    Err("Unable to resolve home directory for Claude settings.json".into())
}

fn resolve_project_claude_settings_path(
) -> Result<Option<PathBuf>, Box<dyn std::error::Error + Send + Sync>> {
    let cwd = env::current_dir()?;
    let looks_like_workspace =
        cwd.join("package.json").exists() && cwd.join("src-tauri").exists();

    if looks_like_workspace {
        Ok(Some(cwd.join(".claude").join("settings.local.json")))
    } else {
        Ok(None)
    }
}
