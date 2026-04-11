use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tauri::State;
use tokio::sync::{Mutex, watch};

struct PendingSelection {
    sender: watch::Sender<Option<Value>>,
}

pub struct SelectionGate {
    pending: HashMap<String, PendingSelection>,
}

impl SelectionGate {
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    pub fn add_pending(&mut self, request_id: String) -> watch::Receiver<Option<Value>> {
        let (tx, rx) = watch::channel(None);
        self.pending.insert(request_id, PendingSelection { sender: tx });
        rx
    }

    pub fn resolve(&mut self, request_id: &str, updated_input: Value) -> bool {
        if let Some(pending) = self.pending.remove(request_id) {
            pending.sender.send(Some(updated_input)).is_ok()
        } else {
            false
        }
    }

    pub fn remove_pending(&mut self, request_id: &str) -> bool {
        self.pending.remove(request_id).is_some()
    }

    pub async fn wait_for_resolution(
        mut rx: watch::Receiver<Option<Value>>,
        timeout_secs: u64,
    ) -> Option<Value> {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            async {
                loop {
                    if rx.changed().await.is_err() {
                        return None;
                    }
                    if let Some(result) = rx.borrow().clone() {
                        return Some(result);
                    }
                }
            },
        )
        .await;

        match result {
            Ok(inner) => inner,
            Err(_) => None,
        }
    }
}

pub struct SelectionGateState(pub Arc<Mutex<SelectionGate>>);

#[tauri::command]
pub async fn resolve_selection(
    state: State<'_, SelectionGateState>,
    request_id: String,
    updated_input: Value,
) -> Result<bool, String> {
    let mut gate = state.0.lock().await;
    Ok(gate.resolve(&request_id, updated_input))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::SelectionGate;

    #[tokio::test]
    async fn wait_for_resolution_returns_updated_input() {
        let mut gate = SelectionGate::new();
        let request_id = "selection-1".to_string();
        let rx = gate.add_pending(request_id.clone());
        let updated_input = json!({
            "questions": [
                { "question": "Which framework?" }
            ],
            "answers": {
                "Which framework?": "React"
            }
        });

        assert!(gate.resolve(&request_id, updated_input.clone()));
        let result = SelectionGate::wait_for_resolution(rx, 1).await;

        assert_eq!(result, Some(updated_input));
        assert!(gate.pending.is_empty());
    }

    #[tokio::test]
    async fn remove_pending_cleans_up_timed_out_requests() {
        let mut gate = SelectionGate::new();
        let request_id = "selection-timeout".to_string();
        let rx = gate.add_pending(request_id.clone());

        let result = SelectionGate::wait_for_resolution(rx, 0).await;
        assert_eq!(result, None);
        assert!(gate.remove_pending(&request_id));
        assert!(gate.pending.is_empty());
    }
}
