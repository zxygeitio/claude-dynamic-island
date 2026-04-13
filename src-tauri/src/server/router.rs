use axum::{
    Router,
    routing::post,
    extract::State,
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Emitter, Manager};
use uuid::Uuid;

use crate::approval::gate::ApprovalGate;
use crate::config::settings::AppSettings;
use crate::selection::gate::SelectionGate;
use crate::server::models::*;

const SELECTION_TIMEOUT_SECS: u64 = 300;

pub fn create_router(
    app_handle: tauri::AppHandle,
    gate: Arc<Mutex<ApprovalGate>>,
    selection_gate: Arc<Mutex<SelectionGate>>,
    runtime_settings: Arc<Mutex<AppSettings>>,
) -> Router {
    Router::new()
        .route("/hooks/pre-tool-use", post(pre_tool_use_handler))
        .route("/hooks/post-tool-use", post(post_tool_use_handler))
        .route("/hooks/post-tool-use-failure", post(post_tool_use_failure_handler))
        .route("/hooks/notification", post(notification_handler))
        .route("/hooks/stop", post(stop_handler))
        .with_state(AppState {
            app_handle,
            gate,
            selection_gate,
            runtime_settings,
        })
}

#[derive(Clone)]
pub struct AppState {
    pub app_handle: tauri::AppHandle,
    pub gate: Arc<Mutex<ApprovalGate>>,
    pub selection_gate: Arc<Mutex<SelectionGate>>,
    pub runtime_settings: Arc<Mutex<AppSettings>>,
}

async fn pre_tool_use_handler(
    State(state): State<AppState>,
    Json(event): Json<HookEvent>,
) -> Result<(StatusCode, Json<HookHttpResponse>), StatusCode> {
    let runtime_settings = {
        let settings = state.runtime_settings.lock().await;
        settings.clone()
    };
    let approval_id = Uuid::new_v4().to_string();

    let tool_name = event.tool_name.clone().unwrap_or_default();
    let tool_input = event.tool_input.clone().unwrap_or(serde_json::Value::Null);

    let session_id = event.session_id.clone();
    let payload = PreToolUsePayload {
        approval_id: approval_id.clone(),
        tool_name: tool_name.clone(),
        tool_input: tool_input.clone(),
        session_id: session_id.clone(),
        requires_approval: false,
        approval_timeout_seconds: runtime_settings.approval_timeout_seconds,
    };

    if tool_name.eq_ignore_ascii_case("AskUserQuestion") {
        return handle_ask_user_question(state, approval_id, payload).await;
    }

    if runtime_settings
        .auto_approve_tools
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&tool_name))
    {
        if let Err(e) = emit_to_island(&state.app_handle, "pre-tool-use", &payload) {
            eprintln!("Failed to emit auto-approved pre-tool-use event: {}", e);
        }

        let payload = NotificationPayload {
            message: format!("Auto-approved {}", tool_name),
        };
        if let Err(e) = emit_to_island(&state.app_handle, "notification", &payload) {
            eprintln!("Failed to emit auto-approve notification: {}", e);
        }

        return Ok((
            StatusCode::OK,
            Json(HookHttpResponse {
                decision: None,
                reason: None,
                hook_specific_output: Some(HookSpecificOutput {
                    hook_event_name: "PreToolUse".to_string(),
                    permission_decision: Some("allow".to_string()),
                    permission_decision_reason: Some(format!(
                        "Auto-approved by Claude Dynamic Island for {}",
                        tool_name
                    )),
                    updated_input: None,
                    additional_context: None,
                }),
            }),
        ));
    }

    let payload = PreToolUsePayload {
        requires_approval: true,
        ..payload
    };

    // Add pending approval and get receiver
    let rx = {
        let mut g = state.gate.lock().await;
        g.add_pending(approval_id.clone())
    };

    // Emit to frontend for approval
    if let Err(e) = emit_to_island(&state.app_handle, "pre-tool-use", &payload) {
        eprintln!("Failed to emit pre-tool-use event: {}", e);
        let mut gate = state.gate.lock().await;
        gate.remove_pending(&approval_id);

        return Ok((
            StatusCode::OK,
            Json(HookHttpResponse {
                decision: None,
                reason: None,
                hook_specific_output: Some(HookSpecificOutput {
                    hook_event_name: "PreToolUse".to_string(),
                    permission_decision: Some("deny".to_string()),
                    permission_decision_reason: Some("Failed to emit approval request".to_string()),
                    updated_input: None,
                    additional_context: None,
                }),
            }),
        ));
    }

    // Wait for user resolution without holding the approval gate lock.
    let result =
        ApprovalGate::wait_for_resolution(rx, runtime_settings.approval_timeout_seconds).await;

    if result.is_none() {
        let mut gate = state.gate.lock().await;
        gate.remove_pending(&approval_id);
    }

    let approved = matches!(result, Some(true));
    let permission_decision = if approved { "allow" } else { "deny" };
    let permission_reason = if approved {
        "Approved in Claude Dynamic Island"
    } else {
        "Denied or timed out in Claude Dynamic Island"
    };

    Ok((
        StatusCode::OK,
        Json(HookHttpResponse {
            decision: None,
            reason: None,
            hook_specific_output: Some(HookSpecificOutput {
                hook_event_name: "PreToolUse".to_string(),
                permission_decision: Some(permission_decision.to_string()),
                permission_decision_reason: Some(permission_reason.to_string()),
                updated_input: None,
                additional_context: None,
            }),
        }),
    ))
}

async fn handle_ask_user_question(
    state: AppState,
    request_id: String,
    payload: PreToolUsePayload,
) -> Result<(StatusCode, Json<HookHttpResponse>), StatusCode> {
    let rx = {
        let mut gate = state.selection_gate.lock().await;
        gate.add_pending(request_id.clone())
    };

    if let Err(error) = emit_to_island(&state.app_handle, "pre-tool-use", &payload) {
        eprintln!("Failed to emit AskUserQuestion event: {}", error);
        let mut gate = state.selection_gate.lock().await;
        gate.remove_pending(&request_id);

        return Ok((
            StatusCode::OK,
            Json(HookHttpResponse {
                decision: None,
                reason: None,
                hook_specific_output: Some(HookSpecificOutput {
                    hook_event_name: "PreToolUse".to_string(),
                    permission_decision: Some("deny".to_string()),
                    permission_decision_reason: Some(
                        "Failed to open Claude Dynamic Island selection UI".to_string(),
                    ),
                    updated_input: None,
                    additional_context: None,
                }),
            }),
        ));
    }

    let runtime_settings = {
        let settings = state.runtime_settings.lock().await;
        settings.clone()
    };
    let selection_timeout_secs = runtime_settings
        .approval_timeout_seconds
        .max(SELECTION_TIMEOUT_SECS);
    let result = SelectionGate::wait_for_resolution(rx, selection_timeout_secs).await;

    if result.is_none() {
        let mut gate = state.selection_gate.lock().await;
        gate.remove_pending(&request_id);
    }

    let Some(updated_input) = result else {
        return Ok((
            StatusCode::OK,
            Json(HookHttpResponse {
                decision: None,
                reason: None,
                hook_specific_output: Some(HookSpecificOutput {
                    hook_event_name: "PreToolUse".to_string(),
                    permission_decision: Some("deny".to_string()),
                    permission_decision_reason: Some(
                        "AskUserQuestion timed out in Claude Dynamic Island".to_string(),
                    ),
                    updated_input: None,
                    additional_context: None,
                }),
            }),
        ));
    };

    Ok((
        StatusCode::OK,
        Json(HookHttpResponse {
            decision: None,
            reason: None,
            hook_specific_output: Some(HookSpecificOutput {
                hook_event_name: "PreToolUse".to_string(),
                permission_decision: Some("allow".to_string()),
                permission_decision_reason: Some(
                    "Answered in Claude Dynamic Island".to_string(),
                ),
                updated_input: Some(updated_input),
                additional_context: None,
            }),
        }),
    ))
}

async fn post_tool_use_handler(
    State(state): State<AppState>,
    Json(event): Json<HookEvent>,
) -> StatusCode {
    let tool_name = event.tool_name.clone().unwrap_or_default();
    let tool_input = event.tool_input.clone().unwrap_or(serde_json::Value::Null);
    let tool_output = event
        .tool_response
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok())
        .unwrap_or_default();

    let payload = PostToolUsePayload {
        tool_name,
        tool_input,
        tool_output,
        is_error: false,
        hook_event_name: "PostToolUse".to_string(),
    };

    if let Err(e) = emit_to_island(&state.app_handle, "post-tool-use", &payload) {
        eprintln!("Failed to emit post-tool-use event: {}", e);
    }

    StatusCode::OK
}

async fn post_tool_use_failure_handler(
    State(state): State<AppState>,
    Json(event): Json<HookEvent>,
) -> StatusCode {
    let tool_name = event.tool_name.clone().unwrap_or_default();
    let tool_input = event.tool_input.clone().unwrap_or(serde_json::Value::Null);
    let tool_output = event
        .tool_response
        .as_ref()
        .and_then(|value| serde_json::to_string(value).ok())
        .or_else(|| event.message.clone())
        .unwrap_or_else(|| "Tool execution failed".to_string());

    let payload = PostToolUsePayload {
        tool_name,
        tool_input,
        tool_output,
        is_error: true,
        hook_event_name: "PostToolUseFailure".to_string(),
    };

    if let Err(e) = emit_to_island(&state.app_handle, "post-tool-use", &payload) {
        eprintln!("Failed to emit post-tool-use-failure event: {}", e);
    }

    StatusCode::OK
}

async fn notification_handler(
    State(state): State<AppState>,
    Json(event): Json<HookEvent>,
) -> StatusCode {
    let message = event
        .message
        .clone()
        .or_else(|| event.title.clone())
        .unwrap_or_else(|| event.hook_event_name.clone());

    let payload = NotificationPayload { message };

    if let Err(e) = emit_to_island(&state.app_handle, "notification", &payload) {
        eprintln!("Failed to emit notification event: {}", e);
    }

    StatusCode::OK
}

async fn stop_handler(
    State(state): State<AppState>,
    Json(event): Json<HookEvent>,
) -> StatusCode {
    let stop_reason = if event.stop_hook_active.unwrap_or(false) {
        "hook_active".to_string()
    } else {
        "end_turn".to_string()
    };

    let payload = StopPayload {
        stop_reason,
        session_id: event.session_id,
    };

    if let Err(e) = emit_to_island(&state.app_handle, "stop", &payload) {
        eprintln!("Failed to emit stop event: {}", e);
    }

    StatusCode::OK
}

fn emit_to_island<S: serde::Serialize>(
    app_handle: &tauri::AppHandle,
    event_name: &str,
    payload: &S,
) -> tauri::Result<()> {
    if let Some(window) = app_handle.get_webview_window("island") {
        window.emit(event_name, payload)
    } else {
        app_handle.emit(event_name, payload)
    }
}
