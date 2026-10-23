//! Bluetooth Low Energy printers via CoreBluetooth (`btleplug`). This is how the vendor
//! phone apps talk to them: no pairing in System Settings and no `/dev/cu.*` serial
//! driver, which on macOS is flaky with dual-mode printers like the Phomemo D530 Pro.
//!
//! Printers expose a UART-like service: one characteristic to write print data to and
//! one that notifies replies. Everything is sent as write-without-response (ATT Write
//! Command): the Phomemo D530 Pro silently drops acknowledged writes, and Labelife
//! never uses them either. CoreBluetooth paces these writes itself (btleplug waits for
//! "ready to send").

use std::future::Future;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use btleplug::api::{
    Central, CentralState, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter,
    WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use uuid::Uuid;

use super::Progress;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleDeviceInfo {
    /// CoreBluetooth's per-Mac identifier; stable across restarts.
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
    /// Advertises one of the known printer services.
    pub printer_service: bool,
}

/// Lower 96 bits of the Bluetooth base UUID `0000xxxx-0000-1000-8000-00805f9b34fb`.
const BASE_UUID_LOW: u128 = 0x0000_1000_8000_0080_5f9b_34fb;

const fn uuid16(short: u16) -> Uuid {
    Uuid::from_u128(((short as u128) << 96) | BASE_UUID_LOW)
}

/// Bluetooth SIG services (0x18xx: GAP, battery, device information, …) never carry
/// print data.
fn is_standard_service(uuid: Uuid) -> bool {
    let value = uuid.as_u128();
    value & ((1 << 96) - 1) == BASE_UUID_LOW && (value >> 104) & 0xff == 0x18
}

/// Printer UART services as advertised: Phomemo/QIN (FF00), Microchip ISSC transparent
/// UART, Nordic UART, the AE30 and 18F0 services of many cheap printers.
const PRINTER_SERVICES: [Uuid; 5] = [
    uuid16(0xff00),
    Uuid::from_u128(0x49535343_fe7d_4ae5_8fa9_9fafd205e455),
    Uuid::from_u128(0x6e400001_b5a3_f393_e0a9_e50e24dcca9e),
    uuid16(0xae30),
    uuid16(0x18f0),
];

/// Their write characteristics, most specific first (FF02 is what Labelife uses).
const WRITE_CHARS: [Uuid; 5] = [
    uuid16(0xff02),
    Uuid::from_u128(0x49535343_8841_43f4_a8d4_ecbe34729bb3),
    Uuid::from_u128(0x6e400002_b5a3_f393_e0a9_e50e24dcca9e),
    uuid16(0xae01),
    uuid16(0x2af1),
];

/// The matching reply (notify) characteristics.
const NOTIFY_CHARS: [Uuid; 5] = [
    uuid16(0xff03),
    Uuid::from_u128(0x49535343_1e4d_4bd9_ba61_23c647249616),
    Uuid::from_u128(0x6e400003_b5a3_f393_e0a9_e50e24dcca9e),
    uuid16(0xae02),
    uuid16(0x2af0),
];

const SCAN_TIME: Duration = Duration::from_secs(4);
const FIND_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DISCOVER_TIMEOUT: Duration = Duration::from_secs(10);
/// One chunk not accepted for this long means the printer stopped reading.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// macOS negotiates up to 512 bytes, but the UART bridges in cheap printers have small
/// buffers; 180 bytes (the common iOS MTU) is what such modules reliably handle.
const MAX_CHUNK: usize = 180;
/// Unacknowledged writes may still be in flight when the last one is queued.
const DRAIN_DELAY: Duration = Duration::from_secs(1);

fn ble_err(err: btleplug::Error) -> Error {
    match err {
        btleplug::Error::PermissionDenied => Error::BlePermission,
        btleplug::Error::DeviceNotFound => Error::NotFound(err.to_string()),
        other => Error::Ble(other.to_string()),
    }
}

/// Runs async btleplug code from the blocking device threads (and from examples).
fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

static ADAPTER: OnceLock<Adapter> = OnceLock::new();

async fn adapter() -> Result<&'static Adapter> {
    if let Some(adapter) = ADAPTER.get() {
        return Ok(adapter);
    }
    let manager = Manager::new().await.map_err(ble_err)?;
    let adapter = manager
        .adapters()
        .await
        .map_err(ble_err)?
        .into_iter()
        .next()
        .ok_or_else(|| Error::Ble("no Bluetooth adapter".into()))?;
    // CoreBluetooth reports "unknown" until it has settled; give it a moment.
    for _ in 0..20 {
        if adapter.adapter_state().await.map_err(ble_err)? != CentralState::Unknown {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if adapter.adapter_state().await.map_err(ble_err)? == CentralState::PoweredOff {
        return Err(Error::Ble("Bluetooth is switched off".into()));
    }
    Ok(ADAPTER.get_or_init(|| adapter))
}

async fn name_of(p: &Peripheral) -> Option<String> {
    let props = p.properties().await.ok()??;
    props.local_name.or(props.advertisement_name)
}

/// Scans for a few seconds and lists every named BLE device in range.
pub fn scan() -> Result<Vec<BleDeviceInfo>> {
    block_on(async {
        let adapter = adapter().await?;
        adapter.start_scan(ScanFilter::default()).await.map_err(ble_err)?;
        tokio::time::sleep(SCAN_TIME).await;
        let _ = adapter.stop_scan().await;

        let mut found: Vec<BleDeviceInfo> = Vec::new();
        for p in adapter.peripherals().await.map_err(ble_err)? {
            let Some(props) = p.properties().await.map_err(ble_err)? else {
                continue;
            };
            let Some(name) = props.local_name.clone().or(props.advertisement_name.clone()) else {
                continue;
            };
            log::debug!(
                "scan: {name:?} id={} rssi={:?} services={:?} manufacturer={:?}",
                p.id(),
                props.rssi,
                props.services,
                props.manufacturer_data.keys().collect::<Vec<_>>()
            );
            found.push(BleDeviceInfo {
                id: p.id().to_string(),
                name,
                rssi: props.rssi,
                printer_service: props.services.iter().any(|s| PRINTER_SERVICES.contains(s)),
            });
        }
        Ok(dedupe(found))
    })
}

#[cfg(target_os = "macos")]
async fn retrieve(adapter: &Adapter, id: &str) -> Option<Peripheral> {
    use btleplug::api::RetrievePeripheralsOptions;
    use btleplug::platform::PeripheralId;

    let id = PeripheralId::from(Uuid::parse_str(id).ok()?);
    let options = RetrievePeripheralsOptions {
        identifiers: Some(vec![id]),
        services: None,
    };
    adapter.retrieve_peripherals(options).await.ok()?.into_iter().next()
}

#[cfg(not(target_os = "macos"))]
async fn retrieve(_adapter: &Adapter, _id: &str) -> Option<Peripheral> {
    None
}

/// Dual-mode printers can show up more than once under the same name; keep the entry
/// that advertises a printer service, then the strongest signal.
fn dedupe(mut found: Vec<BleDeviceInfo>) -> Vec<BleDeviceInfo> {
    found.sort_by(|a, b| {
        (b.printer_service, b.rssi.unwrap_or(i16::MIN)).cmp(&(a.printer_service, a.rssi.unwrap_or(i16::MIN)))
    });
    let mut seen = std::collections::HashSet::new();
    found.retain(|d| seen.insert(d.name.clone()));
    found
}

/// Finds a printer by id; falls back to its name in case the id changed (it is per Mac).
async fn find(id: &str, name: &str) -> Result<Peripheral> {
    let adapter = adapter().await?;
    if let Some(p) = retrieve(adapter, id).await {
        log::debug!("{name}: retrieved known peripheral {id}");
        return Ok(p);
    }
    log::debug!("{name}: not known to CoreBluetooth, scanning for {id}");

    adapter.start_scan(ScanFilter::default()).await.map_err(ble_err)?;
    let deadline = Instant::now() + FIND_TIMEOUT;
    let mut by_name = None;
    let found = loop {
        let peripherals = adapter.peripherals().await.map_err(ble_err)?;
        if let Some(p) = peripherals.iter().find(|p| p.id().to_string() == id) {
            break Some(p.clone());
        }
        for p in &peripherals {
            if by_name.is_none() && name_of(p).await.as_deref() == Some(name) {
                by_name = Some(p.clone());
            }
        }
        if Instant::now() > deadline {
            break by_name;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    };
    let _ = adapter.stop_scan().await;
    found.ok_or_else(|| Error::NotFound(format!("{name} is not in Bluetooth range")))
}

struct Link {
    peripheral: Peripheral,
    write: Characteristic,
    notify: Option<Characteristic>,
}

fn pick(chars: &[Characteristic], known: &[Uuid], flags: CharPropFlags) -> Option<Characteristic> {
    known
        .iter()
        .find_map(|uuid| chars.iter().find(|c| c.uuid == *uuid && c.properties.intersects(flags)))
        .cloned()
}

async fn connect(id: &str, name: &str) -> Result<Link> {
    let peripheral = find(id, name).await?;
    let started = Instant::now();
    if !peripheral.is_connected().await.map_err(ble_err)? {
        log::debug!("{name}: connecting");
        tokio::time::timeout(CONNECT_TIMEOUT, peripheral.connect())
            .await
            .map_err(|_| {
                log::warn!("{name}: no connection after {CONNECT_TIMEOUT:?}");
                Error::ConnectFailed { path: name.to_owned() }
            })?
            .map_err(ble_err)?;
    }
    log::debug!("{name}: connected after {:?}, discovering services", started.elapsed());
    tokio::time::timeout(DISCOVER_TIMEOUT, peripheral.discover_services())
        .await
        .map_err(|_| Error::Ble(format!("{name}: service discovery timed out")))?
        .map_err(ble_err)?;

    let chars: Vec<_> = peripheral.characteristics().into_iter().collect();
    for c in &chars {
        log::debug!("{name}: service {} char {} {:?}", c.service_uuid, c.uuid, c.properties);
    }
    let writable = CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE;
    let write = pick(&chars, &WRITE_CHARS, writable)
        // Unknown printer: any writable characteristic outside the standard 0x18xx services.
        .or_else(|| {
            chars
                .iter()
                .find(|c| c.properties.intersects(writable) && !is_standard_service(c.service_uuid))
                .cloned()
        });
    let Some(write) = write else {
        let _ = peripheral.disconnect().await;
        return Err(Error::Ble(format!("{name} has no writable characteristic")));
    };
    let notify = pick(&chars, &NOTIFY_CHARS, CharPropFlags::NOTIFY).or_else(|| {
        chars
            .iter()
            .find(|c| c.service_uuid == write.service_uuid && c.properties.contains(CharPropFlags::NOTIFY))
            .cloned()
    });
    log::info!(
        "{name}: writing to {} {:?}, replies on {:?}, mtu {}",
        write.uuid,
        write.properties,
        notify.as_ref().map(|c| c.uuid),
        peripheral.mtu()
    );
    Ok(Link {
        peripheral,
        write,
        notify,
    })
}

impl Link {
    fn chunk_size(&self) -> usize {
        // MTU minus the 3-byte ATT header; CoreBluetooth reports at least 23.
        usize::from(self.peripheral.mtu()).saturating_sub(3).clamp(20, MAX_CHUNK)
    }

    /// Write commands where possible; acknowledged writes only for printers without them.
    fn write_type(&self) -> WriteType {
        if self.write.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
            WriteType::WithoutResponse
        } else {
            WriteType::WithResponse
        }
    }

    async fn write_command(&self, data: &[u8]) -> Result<()> {
        let kind = self.write_type();
        for part in data.chunks(self.chunk_size()) {
            tokio::time::timeout(WRITE_TIMEOUT, self.peripheral.write(&self.write, part, kind))
                .await
                .map_err(|_| Error::Ble("write timed out".into()))?
                .map_err(ble_err)?;
        }
        Ok(())
    }

    async fn close(self) {
        let _ = self.peripheral.disconnect().await;
    }
}

pub fn send(id: &str, name: &str, data: &[u8], progress: &Progress) -> Result<()> {
    block_on(async {
        let link = connect(id, name).await?;
        let result = send_on(&link, data, progress).await;
        link.close().await;
        result
    })
}

async fn send_on(link: &Link, data: &[u8], progress: &Progress<'_>) -> Result<()> {
    let started = Instant::now();
    let chunk = link.chunk_size();
    let kind = link.write_type();
    let chunks: Vec<_> = data.chunks(chunk).collect();
    // Connected: tell the UI that sending starts now.
    progress.report(0, data.len());

    for (i, part) in chunks.iter().enumerate() {
        if progress.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let sent = i * chunk;
        match tokio::time::timeout(WRITE_TIMEOUT, link.peripheral.write(&link.write, part, kind)).await {
            Ok(Ok(())) => {}
            Ok(Err(btleplug::Error::NotConnected)) => {
                return Err(Error::Disconnected { sent, total: data.len() });
            }
            Ok(Err(err)) => return Err(ble_err(err)),
            Err(_) => return Err(Error::Stalled { sent, total: data.len() }),
        }
        progress.report((i * chunk + part.len()).min(data.len()), data.len());
    }
    if kind == WriteType::WithoutResponse {
        // Disconnecting right away could drop packets still queued in CoreBluetooth.
        tokio::time::sleep(DRAIN_DELAY).await;
    }
    log::info!(
        "{}: {} bytes in {:.1}s, {chunk} byte chunks",
        link.write.uuid,
        data.len(),
        started.elapsed().as_secs_f32()
    );
    Ok(())
}

/// See [`super::usb::UsbPrinter::exchange`]; replies arrive as notifications.
pub fn exchange(
    id: &str,
    name: &str,
    cmd: &[u8],
    timeout: Duration,
    done: impl Fn(&[u8]) -> bool,
) -> Result<Vec<u8>> {
    block_on(async {
        let link = connect(id, name).await?;
        let result = exchange_on(&link, cmd, timeout, done).await;
        link.close().await;
        result
    })
}

async fn exchange_on(
    link: &Link,
    cmd: &[u8],
    timeout: Duration,
    done: impl Fn(&[u8]) -> bool,
) -> Result<Vec<u8>> {
    let Some(notify) = &link.notify else {
        return Ok(Vec::new());
    };
    link.peripheral.subscribe(notify).await.map_err(ble_err)?;
    let mut notifications = link.peripheral.notifications().await.map_err(ble_err)?;

    link.write_command(cmd).await?;

    let deadline = tokio::time::Instant::now() + timeout;
    let mut reply = Vec::new();
    while !done(&reply) {
        match tokio::time::timeout_at(deadline, notifications.next()).await {
            Ok(Some(n)) if n.uuid == notify.uuid => reply.extend(n.value),
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => break,
        }
    }
    let _ = link.peripheral.unsubscribe(notify).await;
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_one_entry_per_name() {
        let device = |id: &str, rssi, printer_service| BleDeviceInfo {
            id: id.into(),
            name: "D530 Pro".into(),
            rssi: Some(rssi),
            printer_service,
        };
        let kept = dedupe(vec![device("a", -40, false), device("b", -70, true), device("c", -50, false)]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "b", "the one advertising a printer service wins");
    }

    #[test]
    fn builds_16_bit_uuids_and_spots_standard_services() {
        assert_eq!(uuid16(0xff02).to_string(), "0000ff02-0000-1000-8000-00805f9b34fb");
        assert!(is_standard_service(uuid16(0x180a)));
        assert!(!is_standard_service(uuid16(0xff00)));
        assert!(!is_standard_service(WRITE_CHARS[1]));
    }
}
