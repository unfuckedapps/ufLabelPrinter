//! Transports move opaque bytes to a printer; they know nothing about printer languages.

pub mod cups;
pub mod serial;
pub mod usb;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::status::{PrinterStatus, StatusDialect};

/// How a printer profile reaches its device.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Connection {
    Usb(usb::UsbSelector),
    /// Bluetooth SPP (or any other serial) port, e.g. `/dev/cu.D530Pro`.
    Serial { path: String },
    Cups { queue: String },
}

/// Per USB transfer; a printer that is busy printing a long label holds off new data.
const SEND_TIMEOUT: Duration = Duration::from_secs(60);

/// Feedback for long transfers: Bluetooth needs minutes for an uncompressed label.
pub struct Progress<'a> {
    report: &'a (dyn Fn(usize, usize) + Sync),
    cancel: &'a AtomicBool,
}

static NEVER_CANCELLED: AtomicBool = AtomicBool::new(false);

impl<'a> Progress<'a> {
    pub fn new(report: &'a (dyn Fn(usize, usize) + Sync), cancel: &'a AtomicBool) -> Self {
        Self { report, cancel }
    }

    /// For short commands where progress does not matter.
    pub fn silent() -> Progress<'static> {
        Progress {
            report: &|_, _| {},
            cancel: &NEVER_CANCELLED,
        }
    }

    pub fn report(&self, sent: usize, total: usize) {
        (self.report)(sent, total);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// The Phomemo/QIN firmware needs up to ~3 s to answer a batch of queries.
const STATUS_TIMEOUT: Duration = Duration::from_secs(4);

impl Connection {
    pub fn send(&self, data: &[u8], progress: &Progress) -> Result<()> {
        match self {
            Connection::Usb(sel) => usb::UsbPrinter::open(sel)?.send(data, SEND_TIMEOUT, progress),
            Connection::Serial { path } => serial::send(path, data, progress),
            Connection::Cups { queue } => {
                cups::send(queue, data)?;
                progress.report(data.len(), data.len());
                Ok(())
            }
        }
    }

    /// Stable identity, used to serialise access per device.
    pub fn key(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Without a dialect only USB can tell whether the device is there; opening a
    /// Bluetooth port would connect it, and CUPS queues are fire-and-forget.
    pub fn status(&self, dialect: Option<&dyn StatusDialect>) -> Result<PrinterStatus> {
        let reply = match (self, dialect) {
            (Connection::Usb(sel), Some(d)) => {
                usb::UsbPrinter::open(sel)?.exchange(&d.request(), STATUS_TIMEOUT, |r| d.is_complete(r))?
            }
            (Connection::Usb(sel), None) => {
                usb::UsbPrinter::open(sel)?;
                return Ok(PrinterStatus::connected());
            }
            (Connection::Serial { path }, Some(d)) => {
                serial::exchange(path, &d.request(), STATUS_TIMEOUT, |r| d.is_complete(r))?
            }
            (Connection::Serial { .. } | Connection::Cups { .. }, _) => {
                return Ok(PrinterStatus::default());
            }
        };
        Ok(dialect.map(|d| d.parse(&reply)).unwrap_or_default())
    }
}
