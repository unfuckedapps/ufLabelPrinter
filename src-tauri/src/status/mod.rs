//! Status query dialects. Unlike print languages these are wildly vendor specific, so a
//! model file names its dialect (`"status": "phomemo"`) or leaves it out entirely.
//! To support another family, implement [`StatusDialect`] and register it in [`get`].

pub mod phomemo;
pub mod yxwl;

use serde::Serialize;

pub trait StatusDialect: Send + Sync {
    /// Bytes that ask the printer for its state.
    fn request(&self) -> Vec<u8>;
    /// Whether `reply` already holds every expected answer, so reading can stop early.
    fn is_complete(&self, reply: &[u8]) -> bool;
    fn parse(&self, reply: &[u8]) -> PrinterStatus;
}

pub fn get(id: &str) -> Option<&'static dyn StatusDialect> {
    match id {
        "phomemo" => Some(&phomemo::Phomemo),
        "yxwl" => Some(&yxwl::Yxwl),
        _ => None,
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatus {
    /// The device is connected and could be opened.
    pub connected: bool,
    /// The firmware answered our queries (not every printer does).
    pub responsive: bool,
    /// A job was sent moments ago; the printer is left alone until it is done.
    pub printing: bool,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub paper: Option<bool>,
    pub cover_open: Option<bool>,
    /// The Bluetooth module (from the BLE Device Information service), e.g.
    /// "FSC-BT986 9.7.7"; often all a printer reveals about itself over BLE.
    pub module: Option<String>,
}

impl PrinterStatus {
    pub fn connected() -> Self {
        Self {
            connected: true,
            ..Default::default()
        }
    }
}
