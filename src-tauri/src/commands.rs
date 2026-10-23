use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{Error, Result};
use crate::models::{ModelRegistry, PrinterModel};
use crate::protocol::{self, JobSettings, Page};
use crate::status::{self, PrinterStatus};
use crate::transport::{Connection, Progress, ble, cups, serial, usb};

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Serialises access per device (two jobs must never interleave on the wire, but a
/// stalled Bluetooth job must not block the USB printer) and tracks running jobs.
#[derive(Default)]
pub struct DeviceState {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// Printers still working on a job they already received.
    busy_until: Mutex<HashMap<String, Instant>>,
    /// Cancel flags of jobs that are being sent, by job id.
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DeviceState {
    fn lock_for(&self, connection: &Connection) -> Arc<Mutex<()>> {
        locked(&self.locks).entry(connection.key()).or_default().clone()
    }

    fn is_busy(&self, connection: &Connection) -> bool {
        locked(&self.busy_until)
            .get(&connection.key())
            .is_some_and(|until| Instant::now() < *until)
    }

    fn mark_busy(&self, connection: &Connection, duration: Duration) {
        locked(&self.busy_until).insert(connection.key(), Instant::now() + duration);
    }
}

/// Model files, reloaded whenever the UI lists them so user edits apply without restart.
pub struct Models(pub RwLock<ModelRegistry>);

/// Files handed to the app by Finder ("Öffnen mit") before the UI was ready.
#[derive(Default)]
pub struct PendingFiles(pub Mutex<Vec<PathBuf>>);

pub fn user_models_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("models"))
}

fn model(app: &AppHandle, id: &str) -> Result<PrinterModel> {
    let models = app.state::<Models>();
    let registry = models.0.read().unwrap_or_else(|p| p.into_inner());
    registry.get(id).cloned()
}

async fn with_device<T: Send + 'static>(
    app: &AppHandle,
    connection: &Connection,
    work: impl FnOnce(&DeviceState) -> Result<T> + Send + 'static,
) -> Result<T> {
    let app = app.clone();
    let lock = app.state::<DeviceState>().lock_for(connection);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = locked(&lock);
        work(&app.state::<DeviceState>())
    })
    .await
    .map_err(|err| Error::Other(err.to_string()))?
}

#[tauri::command]
pub fn list_models(app: AppHandle) -> ModelRegistry {
    let fresh = ModelRegistry::load(user_models_dir(&app).as_deref());
    let models = app.state::<Models>();
    *models.0.write().unwrap_or_else(|p| p.into_inner()) = fresh.clone();
    fresh
}

/// Opens the folder for custom model files in Finder, creating it on first use.
#[tauri::command]
pub fn open_models_dir(app: AppHandle) -> Result<()> {
    let dir = user_models_dir(&app).ok_or_else(|| Error::Other("no app config directory".into()))?;
    std::fs::create_dir_all(&dir)?;
    std::process::Command::new("open").arg(&dir).spawn()?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbDevice {
    #[serde(flatten)]
    pub info: usb::UsbPrinterInfo,
    /// CUPS queue driving the same device, used to suggest a name.
    pub cups_queue: Option<String>,
    pub model_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialDevice {
    #[serde(flatten)]
    pub info: serial::SerialPortInfo,
    pub model_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Devices {
    pub usb: Vec<UsbDevice>,
    pub serial: Vec<SerialDevice>,
    pub cups: Vec<cups::CupsQueue>,
}

#[tauri::command]
pub async fn list_devices(app: AppHandle) -> Result<Devices> {
    let registry = list_models(app);
    tauri::async_runtime::spawn_blocking(move || {
        let queues = cups::list().unwrap_or_default();
        let usb = usb::list()?
            .into_iter()
            .map(|info| {
                let queue = info.serial.as_ref().and_then(|serial| {
                    let needle = format!("serial={serial}");
                    queues.iter().find(|q| q.device_uri.contains(&needle))
                });
                UsbDevice {
                    cups_queue: queue.map(|q| q.name.clone()),
                    model_id: registry
                        .match_usb(info.vendor_id, info.product_id)
                        .map(|m| m.id.clone()),
                    info,
                }
            })
            .collect();
        let serial = serial::list()?
            .into_iter()
            .map(|info| SerialDevice {
                model_id: registry.match_bluetooth(&info.name).map(|m| m.id.clone()),
                info,
            })
            .collect();
        Ok(Devices {
            usb,
            serial,
            cups: queues,
        })
    })
    .await
    .map_err(|err| Error::Other(err.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleDevice {
    #[serde(flatten)]
    pub info: ble::BleDeviceInfo,
    pub model_id: Option<String>,
}

/// Scans a few seconds for Bluetooth LE devices. Separate from `list_devices` because it
/// takes a while and may trigger the macOS Bluetooth permission prompt.
#[tauri::command]
pub async fn scan_ble(app: AppHandle) -> Result<Vec<BleDevice>> {
    let registry = list_models(app);
    tauri::async_runtime::spawn_blocking(move || {
        Ok(ble::scan()?
            .into_iter()
            .map(|info| BleDevice {
                model_id: registry.match_bluetooth(&info.name).map(|m| m.id.clone()),
                info,
            })
            .collect())
    })
    .await
    .map_err(|err| Error::Other(err.to_string()))?
}

#[tauri::command]
pub async fn printer_status(
    app: AppHandle,
    connection: Connection,
    model_id: String,
) -> Result<PrinterStatus> {
    let dialect = model(&app, &model_id)?.status.as_deref().and_then(status::get);
    let printing = PrinterStatus {
        printing: true,
        ..PrinterStatus::connected()
    };
    let state = app.state::<DeviceState>();
    // A job is being sent right now; don't queue up behind it.
    if state.lock_for(&connection).try_lock().is_err() {
        return Ok(printing);
    }
    with_device(&app, &connection.clone(), move |state| {
        // Queries in the middle of a print can make the firmware abort it.
        if state.is_busy(&connection) {
            return Ok(printing);
        }
        connection.status(dialect)
    })
    .await
}

#[tauri::command]
pub async fn feed_label(
    app: AppHandle,
    connection: Connection,
    settings: JobSettings,
    model_id: String,
) -> Result<()> {
    let job = protocol::get(&model(&app, &model_id)?.protocol)?.feed(&settings)?;
    with_device(&app, &connection.clone(), move |state| {
        connection.send(&job, &Progress::silent())?;
        state.mark_busy(&connection, Duration::from_secs(3));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn calibrate(
    app: AppHandle,
    connection: Connection,
    settings: JobSettings,
    model_id: String,
) -> Result<()> {
    let job = protocol::get(&model(&app, &model_id)?.protocol)?.calibrate(&settings)?;
    with_device(&app, &connection.clone(), move |state| {
        connection.send(&job, &Progress::silent())?;
        state.mark_busy(&connection, Duration::from_secs(10));
        Ok(())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageMeta {
    width_bytes: usize,
    height: usize,
    copies: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobMeta {
    /// Chosen by the UI so it can match progress events and cancel the job.
    job_id: String,
    connection: Connection,
    model_id: String,
    settings: JobSettings,
    pages: Vec<PageMeta>,
}

/// Body layout: `u32 LE json length`, JSON [`JobMeta`], then the packed bitmaps of all
/// pages back to back. Sent raw so a batch of labels does not go through JSON arrays.
fn parse_job(body: &[u8]) -> Result<(JobMeta, Vec<Page>)> {
    let invalid = |msg: &str| Error::InvalidJob(msg.to_owned());

    let len_bytes: [u8; 4] = body
        .get(..4)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| invalid("missing header"))?;
    let meta_end = 4 + u32::from_le_bytes(len_bytes) as usize;
    let meta: JobMeta =
        serde_json::from_slice(body.get(4..meta_end).ok_or_else(|| invalid("truncated metadata"))?)?;

    let mut offset = meta_end;
    let mut pages = Vec::with_capacity(meta.pages.len());
    for p in &meta.pages {
        let end = offset + p.width_bytes * p.height;
        let data = body.get(offset..end).ok_or_else(|| invalid("truncated bitmap"))?;
        pages.push(Page {
            width_bytes: p.width_bytes,
            height: p.height,
            copies: p.copies,
            data: data.to_vec(),
        });
        offset = end;
    }
    if offset != body.len() {
        return Err(invalid("trailing data"));
    }
    Ok((meta, pages))
}

/// Rough time the printer needs for a job it has fully received. Errs on the slow side:
/// it only delays the next status query.
fn print_duration(settings: &JobSettings, pages: &[Page]) -> Duration {
    let labels: u32 = pages.iter().map(|p| p.copies.max(1)).sum();
    let inches = (settings.height_mm + 5.0) / 25.4;
    let speed = f32::from(settings.speed.unwrap_or(2).max(1));
    Duration::from_secs_f32(2.0 + labels as f32 * (inches / speed + 1.0))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobProgress<'a> {
    job_id: &'a str,
    sent: usize,
    total: usize,
}

/// Emits `job-progress` events, at most every 100 ms plus the final one.
fn progress_reporter(app: AppHandle, job_id: String) -> impl Fn(usize, usize) + Sync {
    let last = Mutex::new(Instant::now() - Duration::from_secs(1));
    move |sent, total| {
        let mut last = locked(&last);
        if sent < total && last.elapsed() < Duration::from_millis(100) {
            return;
        }
        *last = Instant::now();
        let _ = app.emit("job-progress", JobProgress { job_id: &job_id, sent, total });
    }
}

#[tauri::command]
pub async fn print_job(app: AppHandle, request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err(Error::InvalidJob("expected a binary request body".into()));
    };
    let (mut meta, pages) = parse_job(body)?;
    let model = model(&app, &meta.model_id)?;
    // Compression is only worth the risk where bandwidth hurts; USB is fast enough raw.
    if matches!(meta.connection, Connection::Serial { .. } | Connection::Ble { .. }) {
        meta.settings.compression = model.compression;
    }
    let protocol = protocol::get(&model.protocol)?;
    let job = protocol.print(&meta.settings, &pages)?;
    let busy_for = print_duration(&meta.settings, &pages);

    let cancel = Arc::new(AtomicBool::new(false));
    let state = app.state::<DeviceState>();
    locked(&state.jobs).insert(meta.job_id.clone(), cancel.clone());

    let report = progress_reporter(app.clone(), meta.job_id.clone());
    let connection = meta.connection.clone();
    let result = with_device(&app, &connection, move |state| {
        // Cancelled while waiting for the device: nothing was sent yet.
        if cancel.load(Ordering::Relaxed) {
            return Err(Error::Cancelled);
        }
        meta.connection.send(&job, &Progress::new(&report, &cancel))?;
        state.mark_busy(&meta.connection, busy_for);
        Ok(())
    })
    .await;

    locked(&state.jobs).remove(&meta.job_id);
    result
}

#[tauri::command]
pub fn cancel_job(state: State<'_, DeviceState>, job_id: String) {
    if let Some(flag) = locked(&state.jobs).get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

const OPENABLE: [&str; 5] = ["pdf", "png", "jpg", "jpeg", "webp"];

/// Reads a dropped or opened document; restricted to the formats the UI can render.
#[tauri::command]
pub async fn read_document(path: PathBuf) -> Result<Response> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !OPENABLE.contains(&ext.as_str()) {
        return Err(Error::UnsupportedFile(ext));
    }
    Ok(Response::new(read_file(path).await?))
}

async fn read_file(path: PathBuf) -> Result<Vec<u8>> {
    tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|err| Error::Other(err.to_string()))?
        .map_err(Error::from)
}

#[tauri::command]
pub fn take_pending_files(pending: State<'_, PendingFiles>) -> Vec<PathBuf> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|p| p.into_inner()))
}

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| Error::Other(err.to_string()))?;
    Ok(dir.join("config.json"))
}

/// The config is owned by the frontend; Rust only stores it.
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Option<serde_json::Value>> {
    let path = config_path(&app)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: serde_json::Value) -> Result<()> {
    let path = config_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&config)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(meta: serde_json::Value, pages: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(&meta).unwrap();
        let mut out = (json.len() as u32).to_le_bytes().to_vec();
        out.extend(json);
        out.extend_from_slice(pages);
        out
    }

    fn meta(pages: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "jobId": "job-1",
            "connection": { "type": "usb", "vendorId": 11836, "productId": 22361, "serial": "Q7" },
            "modelId": "phomemo-d530-pro",
            "settings": {
                "widthMm": 101.6, "heightMm": 152.4,
                "media": { "type": "gap", "gapMm": 3, "offsetMm": 0 },
                "density": null, "speed": 4, "rotate180": false, "tear": true
            },
            "pages": pages
        })
    }

    #[test]
    fn parses_raw_job_body() {
        let raw = body(
            meta(serde_json::json!([
                { "widthBytes": 2, "height": 1, "copies": 1 },
                { "widthBytes": 1, "height": 2, "copies": 2 }
            ])),
            &[1, 2, 3, 4],
        );
        let (meta, pages) = parse_job(&raw).unwrap();
        assert!(matches!(meta.connection, Connection::Usb(ref s) if s.serial.as_deref() == Some("Q7")));
        assert_eq!(pages[0].data, [1, 2]);
        assert_eq!(pages[1].data, [3, 4]);
        assert_eq!(pages[1].copies, 2);
    }

    #[test]
    fn rejects_truncated_body() {
        let raw = body(meta(serde_json::json!([{ "widthBytes": 2, "height": 2, "copies": 1 }])), &[0; 3]);
        assert!(parse_job(&raw).is_err());
    }
}
