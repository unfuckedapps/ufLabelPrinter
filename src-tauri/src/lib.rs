pub mod commands;
pub mod error;
pub mod models;
pub mod protocol;
pub mod status;
pub mod transport;

use std::path::PathBuf;
use std::sync::RwLock;

use tauri::{AppHandle, Emitter, Manager};

use commands::{DeviceState, Models, PendingFiles};
use models::ModelRegistry;

/// Hands files from "Open With" / file associations to the UI, which drains the queue on
/// this signal and once on startup.
fn open_files(app: &AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let paths: Vec<_> = paths.into_iter().filter(|p| p.is_file()).collect();
    if paths.is_empty() {
        return;
    }
    app.state::<PendingFiles>()
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .extend(paths);
    let _ = app.emit("files-opened", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Windows and Linux start a new process per opened file; forward it to the running one.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        open_files(app, argv.into_iter().skip(1).map(PathBuf::from));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder
        // Hardware problems are only debuggable with a log the user can send:
        // ~/Library/Logs/com.unfuckedapps.uflabelprinter/ufLabelPrinter.log on macOS.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .level(log::LevelFilter::Info)
                .level_for("uflabelprinter_lib", log::LevelFilter::Debug)
                .level_for("btleplug", log::LevelFilter::Debug)
                .level_for("nusb", log::LevelFilter::Warn)
                .max_file_size(2_000_000)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(DeviceState::default())
        .manage(PendingFiles::default())
        .setup(|app| {
            let registry = ModelRegistry::load(commands::user_models_dir(app.handle()).as_deref());
            app.manage(Models(RwLock::new(registry)));
            // Files passed on the command line, e.g. by a file association on Windows/Linux.
            #[cfg(not(target_os = "macos"))]
            open_files(app.handle(), std::env::args().skip(1).map(PathBuf::from));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_models,
            commands::open_models_dir,
            commands::open_log_dir,
            commands::list_devices,
            commands::scan_ble,
            commands::printer_status,
            commands::feed_label,
            commands::calibrate,
            commands::print_job,
            commands::cancel_job,
            commands::read_document,
            commands::take_pending_files,
            commands::load_config,
            commands::save_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Finder "Open With" / dropping files on the Dock icon.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                open_files(_app, urls.iter().filter_map(|u| u.to_file_path().ok()));
            }
        });
}
