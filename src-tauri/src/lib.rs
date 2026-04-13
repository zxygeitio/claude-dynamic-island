mod server;
mod approval;
mod config;
mod selection;

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Arc};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Runtime, Size,
    WebviewWindow,
};
use tokio::sync::Mutex;

const COLLAPSED_WIDTH: f64 = 364.0;
const COLLAPSED_HEIGHT: f64 = 52.0;
const EXPANDED_WIDTH: f64 = 520.0;
const EXPANDED_HEIGHT: f64 = 380.0;
const COLLAPSED_RADIUS: i32 = 26;
const EXPANDED_RADIUS: i32 = 28;
const TOP_MARGIN: f64 = 0.0;
const PORT_SEARCH_SPAN: u16 = 24;
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_EXIT_ID: &str = "tray-exit";

#[derive(Clone)]
struct RuntimeContext {
    server_port: u16,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettingsPayload {
    auto_approve_tools: Vec<String>,
    approval_timeout_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupCheckResult {
    ok: bool,
    should_display: bool,
    message: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RuntimeStateFile {
    startup_hook_check_version: Option<String>,
}

#[tauri::command]
fn sync_island_window(window: WebviewWindow, expanded: bool) -> Result<(), String> {
    sync_island_window_impl(&window, expanded)
}

#[tauri::command]
fn snap_island_window(window: WebviewWindow) -> Result<(), String> {
    snap_island_window_impl(&window)
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn get_runtime_settings(
    runtime_settings: tauri::State<'_, Arc<Mutex<config::settings::AppSettings>>>,
) -> Result<RuntimeSettingsPayload, String> {
    let settings = runtime_settings.lock().await;
    Ok(RuntimeSettingsPayload {
        auto_approve_tools: settings.auto_approve_tools.clone(),
        approval_timeout_seconds: settings.approval_timeout_seconds,
    })
}

#[tauri::command]
async fn update_runtime_settings(
    runtime_settings: tauri::State<'_, Arc<Mutex<config::settings::AppSettings>>>,
    payload: RuntimeSettingsPayload,
) -> Result<RuntimeSettingsPayload, String> {
    let mut settings = runtime_settings.lock().await;
    settings.auto_approve_tools = payload.auto_approve_tools;
    settings.approval_timeout_seconds = payload.approval_timeout_seconds.max(1);

    Ok(RuntimeSettingsPayload {
        auto_approve_tools: settings.auto_approve_tools.clone(),
        approval_timeout_seconds: settings.approval_timeout_seconds,
    })
}

#[tauri::command]
fn run_startup_self_check(
    app: tauri::AppHandle,
    runtime_context: tauri::State<'_, RuntimeContext>,
) -> Result<StartupCheckResult, String> {
    let version = app.package_info().version.to_string();
    let mut runtime_state = load_runtime_state(&app).unwrap_or_default();
    let should_display = runtime_state.startup_hook_check_version.as_deref() != Some(version.as_str());

    let settings_paths = config::ensure_claude_hook_config(runtime_context.server_port)
        .map_err(|error| format!("Failed to install Claude hooks: {error}"))?;
    let verification = config::verify_claude_hook_config(runtime_context.server_port, &settings_paths)
        .map_err(|error| format!("Failed to verify Claude hooks: {error}"))?;

    let ok = verification.missing_entries.is_empty();
    let checked_paths = verification
        .checked_paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();

    if ok {
        runtime_state.startup_hook_check_version = Some(version);
        save_runtime_state(&app, &runtime_state)
            .map_err(|error| format!("Failed to save startup state: {error}"))?;
    }

    let message = if ok {
        format!("Hooks verified in {}", checked_paths.join(" and "))
    } else {
        format!("Hook self-check failed: {}", verification.missing_entries.join("; "))
    };

    Ok(StartupCheckResult {
        ok,
        should_display: should_display || !ok,
        message,
    })
}

fn sync_island_window_impl(window: &WebviewWindow, expanded: bool) -> Result<(), String> {
    let (width, height, radius) = if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT, EXPANDED_RADIUS)
    } else {
        (COLLAPSED_WIDTH, COLLAPSED_HEIGHT, COLLAPSED_RADIUS)
    };

    if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
        let work_area = monitor.work_area();
        let scale_factor = monitor.scale_factor();
        let left = f64::from(work_area.position.x) / scale_factor
            + (f64::from(work_area.size.width) / scale_factor - width) / 2.0;
        let top = f64::from(work_area.position.y) / scale_factor + TOP_MARGIN;

        window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|error| error.to_string())?;
        window
            .set_position(Position::Logical(LogicalPosition::new(left, top)))
            .map_err(|error| error.to_string())?;
    }

    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;

    #[cfg(windows)]
    apply_window_region(window, width as i32, height as i32, radius)?;

    Ok(())
}

fn snap_island_window_impl(window: &WebviewWindow) -> Result<(), String> {
    if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
        let work_area = monitor.work_area();
        let scale_factor = monitor.scale_factor();
        let outer_size = window.outer_size().map_err(|error| error.to_string())?;
        let width = f64::from(outer_size.width) / scale_factor;
        let left = f64::from(work_area.position.x) / scale_factor
            + (f64::from(work_area.size.width) / scale_factor - width) / 2.0;
        let top = f64::from(work_area.position.y) / scale_factor + TOP_MARGIN;

        window
            .set_position(Position::Logical(LogicalPosition::new(left, top)))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(windows)]
fn apply_window_region(
    window: &WebviewWindow,
    width: i32,
    height: i32,
    radius: i32,
) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ};

    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let physical_width = (f64::from(width) * scale_factor).round() as i32;
    let physical_height = (f64::from(height) * scale_factor).round() as i32;
    let physical_radius = (f64::from(radius) * scale_factor).round() as i32;

    unsafe {
        let region = CreateRoundRectRgn(
            0,
            0,
            physical_width + 1,
            physical_height + 1,
            physical_radius * 2,
            physical_radius * 2,
        );
        if region.0.is_null() {
            return Err("failed to create native rounded region".into());
        }

        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            let _ = DeleteObject(HGDIOBJ(region.0));
            return Err("failed to apply native rounded region".into());
        }
    }

    Ok(())
}

fn runtime_state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    Ok(config_dir.join("runtime-state.json"))
}

fn load_runtime_state<R: Runtime>(app: &AppHandle<R>) -> Result<RuntimeStateFile, String> {
    let path = runtime_state_path(app)?;
    if !path.exists() {
        return Ok(RuntimeStateFile::default());
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn save_runtime_state<R: Runtime>(
    app: &AppHandle<R>,
    state: &RuntimeStateFile,
) -> Result<(), String> {
    let path = runtime_state_path(app)?;
    let content = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn show_island_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, TRAY_SHOW_ID, "显示 Claude Dynamic Island", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let exit_item = MenuItem::with_id(app, TRAY_EXIT_ID, "退出", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show_item, &exit_item]).map_err(|error| error.to_string())?;

    let mut builder = TrayIconBuilder::with_id("claude-dynamic-island-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Claude Dynamic Island")
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                TRAY_SHOW_ID => show_island_window(app),
                TRAY_EXIT_ID => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    show_island_window(tray.app_handle());
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn run() {
    let settings = config::settings::AppSettings::default();
    let server_port = resolve_available_server_port(settings.server_port);
    let runtime_settings = Arc::new(Mutex::new(settings.clone()));
    let approval_gate = Arc::new(Mutex::new(approval::gate::ApprovalGate::new()));
    let selection_gate = Arc::new(Mutex::new(selection::gate::SelectionGate::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("island") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(approval::gate::ApprovalGateState(approval_gate.clone()))
        .manage(selection::gate::SelectionGateState(selection_gate.clone()))
        .manage(runtime_settings.clone())
        .manage(RuntimeContext { server_port })
        .setup(move |app| {
            let window = app.get_webview_window("island").expect("Failed to get island window");
            let _ = window.set_background_color(Some(Color(5, 5, 6, 255)));
            if let Err(error) = config::ensure_claude_hook_config(server_port) {
                eprintln!("Failed to install Claude hook config: {error}");
            }
            if let Err(error) = build_tray(&app.handle()) {
                eprintln!("Failed to create tray icon: {error}");
            }
            if let Err(error) = sync_island_window_impl(&window, false) {
                eprintln!("Failed to initialize island window frame: {error}");
            }
            let _ = window.show();

            // Start the HTTP server for hook ingestion
            let app_handle = app.handle().clone();
            let approval_gate = approval_gate.clone();
            let selection_gate = selection_gate.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start_server(
                    app_handle,
                    approval_gate,
                    selection_gate,
                    server_port,
                    runtime_settings,
                )
                .await
                {
                    eprintln!("Failed to start HTTP server: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            approval::gate::resolve_approval,
            selection::gate::resolve_selection,
            snap_island_window,
            sync_island_window,
            quit_app,
            get_runtime_settings,
            update_runtime_settings,
            run_startup_self_check,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn resolve_available_server_port(preferred_port: u16) -> u16 {
    for offset in 0..=PORT_SEARCH_SPAN {
        let port = preferred_port.saturating_add(offset);
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }

    preferred_port
}
