//! Direct USB access to label printers via `nusb` (no CUPS driver involved).
//!
//! Most Chinese label printers expose a standard USB printer-class interface (class 7)
//! with one bulk OUT endpoint for commands and, if bidirectional, one bulk IN endpoint
//! for status replies.

use std::io::Write;
use std::time::{Duration, Instant};

use nusb::descriptors::TransferType;
use nusb::transfer::{Buffer, Bulk, Direction, In, Out, TransferError};
use nusb::{DeviceInfo, Interface, MaybeFuture};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

const PRINTER_CLASS: u8 = 7;

/// Identifies a USB printer across reconnects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbSelector {
    pub vendor_id: u16,
    pub product_id: u16,
    /// Distinguishes two identical printers; optional because some devices report none.
    pub serial: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbPrinterInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial: Option<String>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
}

fn printer_interface(info: &DeviceInfo) -> Option<u8> {
    info.interfaces()
        .find(|i| i.class() == PRINTER_CLASS)
        .map(|i| i.interface_number())
}

pub fn list() -> Result<Vec<UsbPrinterInfo>> {
    let devices = nusb::list_devices().wait()?;
    Ok(devices
        .filter(|d| printer_interface(d).is_some())
        .map(|d| UsbPrinterInfo {
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            serial: d.serial_number().map(str::to_owned),
            manufacturer: d.manufacturer_string().map(str::to_owned),
            product: d.product_string().map(str::to_owned),
        })
        .collect())
}

fn find(sel: &UsbSelector) -> Result<DeviceInfo> {
    let mut candidates = nusb::list_devices()
        .wait()?
        .filter(|d| d.vendor_id() == sel.vendor_id && d.product_id() == sel.product_id);

    let found = match &sel.serial {
        Some(serial) => candidates.find(|d| d.serial_number() == Some(serial.as_str())),
        None => candidates.next(),
    };

    found.ok_or_else(|| {
        Error::NotFound(format!(
            "USB-Gerät {:04x}:{:04x}{} ist nicht angeschlossen",
            sel.vendor_id,
            sel.product_id,
            sel.serial
                .as_deref()
                .map(|s| format!(" (Seriennr. {s})"))
                .unwrap_or_default()
        ))
    })
}

pub struct UsbPrinter {
    interface: Interface,
    out_ep: u8,
    in_ep: Option<u8>,
}

impl UsbPrinter {
    pub fn open(sel: &UsbSelector) -> Result<Self> {
        let info = find(sel)?;
        let iface_num = printer_interface(&info)
            .ok_or_else(|| Error::Usb("Gerät hat keine Drucker-Schnittstelle".into()))?;

        let device = info.open().wait()?;
        let interface = device.claim_interface(iface_num).wait()?;

        let desc = interface
            .descriptor()
            .ok_or_else(|| Error::Usb("Schnittstellenbeschreibung fehlt".into()))?;
        let bulk = |dir: Direction| {
            desc.endpoints()
                .find(|e| e.transfer_type() == TransferType::Bulk && e.direction() == dir)
                .map(|e| e.address())
        };
        let out_ep = bulk(Direction::Out)
            .ok_or_else(|| Error::Usb("Kein Bulk-OUT-Endpunkt gefunden".into()))?;
        let in_ep = bulk(Direction::In);

        Ok(Self { interface, out_ep, in_ep })
    }

    /// Sends a complete job. Blocks until the printer accepted all bytes; a busy printer
    /// throttles us via NAKs, hence the generous timeout per transfer.
    pub fn send(&self, data: &[u8], timeout: Duration) -> Result<()> {
        let mut writer = self
            .interface
            .endpoint::<Bulk, Out>(self.out_ep)?
            .writer(16 * 1024)
            .with_num_transfers(4)
            .with_write_timeout(timeout);

        writer.write_all(data).map_err(map_io)?;
        writer.flush().map_err(map_io)?;
        Ok(())
    }

    /// Sends `cmd` and collects the printer's answer until `done` accepts it or `timeout`
    /// elapses. Replies of the Phomemo/QIN firmware take 1-3 s and can still be queued
    /// from an earlier session (e.g. Labelife), so stale input is drained first.
    /// Returns an empty vec for printers that never answer.
    pub fn exchange(
        &self,
        cmd: &[u8],
        timeout: Duration,
        done: impl Fn(&[u8]) -> bool,
    ) -> Result<Vec<u8>> {
        let Some(in_ep) = self.in_ep else {
            return Ok(Vec::new());
        };

        let mut reader = self.interface.endpoint::<Bulk, In>(in_ep)?;
        let len = reader.max_packet_size() * 8;
        let mut read = |wait: Duration| -> Result<Vec<u8>> {
            let completion = reader.transfer_blocking(Buffer::new(len), wait);
            match completion.status {
                Ok(()) => {
                    let mut data = completion.buffer.into_vec();
                    data.truncate(completion.actual_len);
                    Ok(data)
                }
                Err(TransferError::Cancelled) => Ok(Vec::new()),
                Err(err) => Err(Error::Usb(err.to_string())),
            }
        };

        while !read(Duration::from_millis(30))?.is_empty() {}

        self.send(cmd, Duration::from_secs(2))?;

        let deadline = Instant::now() + timeout;
        let mut reply = Vec::new();
        while !done(&reply) {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            reply.extend(read(remaining)?);
        }
        Ok(reply)
    }
}

fn map_io(err: std::io::Error) -> Error {
    if err.kind() == std::io::ErrorKind::TimedOut {
        Error::Timeout("Der Drucker hat die Daten nicht angenommen".into())
    } else {
        Error::Io(err)
    }
}
