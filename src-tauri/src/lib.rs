pub mod commands;
pub mod error;
pub mod models;
pub mod protocol;
pub mod status;
pub mod transport;

use std::sync::RwLock;

use tauri::{Emitter, Manager};

use commands::{DeviceState, Models, PendingFiles};
use models::ModelRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DeviceState::default())
        .manage(PendingFiles::default())
        .setup(|app| {
            let registry = ModelRegistry::load(commands::user_models_dir(app.handle()).as_deref());
            app.manage(Models(RwLock::new(registry)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_models,
            commands::open_models_dir,
            commands::list_devices,
            commands::printer_status,
            commands::feed_label,
            commands::calibrate,
            commands::print_job,
            commands::read_document,
            commands::take_pending_files,
            commands::load_config,
            commands::save_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Finder "Öffnen mit" / dropping files on the Dock icon.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<_> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                app.state::<PendingFiles>()
                    .0
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .extend(paths);
                // The UI drains the queue on this signal and once on startup.
                let _ = app.emit("files-opened", ());
            }
        });
}
