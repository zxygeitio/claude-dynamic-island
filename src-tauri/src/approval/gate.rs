use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, watch};
use tauri::State;

struct PendingApproval {
    sender: watch::Sender<Option<bool>>,
}

pub struct ApprovalGate {
    pending: HashMap<String, PendingApproval>,
}

impl ApprovalGate {
    pub fn new() -> Self {
        Self {
            pending: HashMap::new(),
        }
    }

    pub fn add_pending(&mut self, approval_id: String) -> watch::Receiver<Option<bool>> {
        let (tx, rx) = watch::channel(None);
        self.pending.insert(approval_id, PendingApproval { sender: tx });
        rx
    }

    pub fn resolve(&mut self, approval_id: &str, approved: bool) -> bool {
        if let Some(pending) = self.pending.remove(approval_id) {
            pending.sender.send(Some(approved)).is_ok()
        } else {
            false
        }
    }

    pub fn remove_pending(&mut self, approval_id: &str) -> bool {
        self.pending.remove(approval_id).is_some()
    }

    pub async fn wait_for_resolution(
        mut rx: watch::Receiver<Option<bool>>,
        timeout_secs: u64,
    ) -> Option<bool> {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            async {
                loop {
                    if rx.changed().await.is_err() {
                        return None;
                    }
                    if let Some(result) = *rx.borrow() {
                        return Some(result);
                    }
                }
            },
        )
        .await;

        match result {
            Ok(inner) => inner,
            Err(_) => None, // Timeout
        }
    }
}

pub struct ApprovalGateState(pub Arc<Mutex<ApprovalGate>>);

#[tauri::command]
pub async fn resolve_approval(
    state: State<'_, ApprovalGateState>,
    approval_id: String,
    approved: bool,
) -> Result<bool, String> {
    let mut gate = state.0.lock().await;
    Ok(gate.resolve(&approval_id, approved))
}

#[cfg(test)]
mod tests {
    use super::ApprovalGate;

    #[tokio::test]
    async fn wait_for_resolution_returns_approved_value() {
        let mut gate = ApprovalGate::new();
        let approval_id = "approval-1".to_string();
        let rx = gate.add_pending(approval_id.clone());

        assert!(gate.resolve(&approval_id, true));
        let result = ApprovalGate::wait_for_resolution(rx, 1).await;

        assert_eq!(result, Some(true));
        assert!(gate.pending.is_empty());
    }

    #[tokio::test]
    async fn remove_pending_cleans_up_timed_out_requests() {
        let mut gate = ApprovalGate::new();
        let approval_id = "approval-timeout".to_string();
        let rx = gate.add_pending(approval_id.clone());

        let result = ApprovalGate::wait_for_resolution(rx, 0).await;
        assert_eq!(result, None);
        assert!(gate.remove_pending(&approval_id));
        assert!(gate.pending.is_empty());
    }
}
