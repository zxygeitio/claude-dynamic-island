pub mod models;
pub mod router;

use std::sync::Arc;
use tokio::sync::Mutex;
use crate::approval::gate::ApprovalGate;
use crate::selection::gate::SelectionGate;

pub async fn start_server(
    app_handle: tauri::AppHandle,
    gate: Arc<Mutex<ApprovalGate>>,
    selection_gate: Arc<Mutex<SelectionGate>>,
    port: u16,
    approval_timeout_secs: u64,
    auto_approve_tools: Vec<String>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let router = router::create_router(
        app_handle,
        gate,
        selection_gate,
        approval_timeout_secs,
        auto_approve_tools,
    );

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    println!("Claude Dynamic Island server listening on {}", addr);

    axum::serve(listener, router).await?;

    Ok(())
}
