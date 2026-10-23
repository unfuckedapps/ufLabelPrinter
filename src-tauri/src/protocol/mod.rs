//! Printer languages. A protocol turns a protocol-neutral job (label settings plus 1-bit
//! pages) into the bytes that go over the wire. Transports and the UI never see these
//! bytes, so adding a language (ESC/POS, ZPL, a vendor dialect) means implementing
//! [`Protocol`] in a new module and registering it in [`get`].

pub mod tspl;

use serde::Deserialize;

use crate::error::{Error, Result};

pub trait Protocol: Send + Sync {
    /// A complete print job for all pages.
    fn print(&self, settings: &JobSettings, pages: &[Page]) -> Result<Vec<u8>>;
    /// Feeds exactly one label.
    fn feed(&self, settings: &JobSettings) -> Result<Vec<u8>>;
    /// Lets the printer measure label and gap length with its sensor.
    fn calibrate(&self, settings: &JobSettings) -> Result<Vec<u8>>;
}

/// Looks up a protocol by the id used in model files (`"protocol": "tspl"`).
pub fn get(id: &str) -> Result<&'static dyn Protocol> {
    match id {
        "tspl" => Ok(&tspl::Tspl),
        other => Err(Error::Other(format!("unbekannte Druckersprache \"{other}\""))),
    }
}

/// How the printer finds the start of the next label.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Media {
    /// Die-cut labels with a gap between them (Lückenpapier).
    Gap { gap_mm: f32, offset_mm: f32 },
    /// Labels separated by a black mark on the back side.
    BlackMark { mark_mm: f32, offset_mm: f32 },
    /// Continuous roll without any markers.
    Continuous,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSettings {
    pub width_mm: f32,
    pub height_mm: f32,
    pub media: Media,
    /// Printer-specific darkness, `None` keeps the printer's own setting.
    pub density: Option<u8>,
    /// Inches per second, `None` keeps the printer's own setting.
    pub speed: Option<u8>,
    /// Prints the label upside down.
    pub rotate180: bool,
    /// Feed the finished label to the tear bar.
    pub tear: bool,
    /// Set by the backend from the model, never by the UI.
    #[serde(skip)]
    pub compression: Compression,
}

/// How bitmap data is encoded on the wire.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Compression {
    #[default]
    None,
    /// LZO1X, as Phomemo's Labelife sends it (TSPL `BITMAP` mode 3 with a length field).
    /// Shrinks a typical shipping label from ~270 KB to a few KB, which matters over
    /// Bluetooth.
    Lzo,
}

/// A 1-bit raster where a set bit means black. Rows are padded to whole bytes.
#[derive(Debug, Clone)]
pub struct Page {
    pub width_bytes: usize,
    pub height: usize,
    pub copies: u32,
    pub data: Vec<u8>,
}

impl Page {
    pub fn validate(&self) -> Result<()> {
        if self.width_bytes == 0 || self.height == 0 {
            return Err(Error::InvalidJob("leere Seite".into()));
        }
        if self.data.len() != self.width_bytes * self.height {
            return Err(Error::InvalidJob(format!(
                "Bitmap hat {} Bytes, erwartet {}",
                self.data.len(),
                self.width_bytes * self.height
            )));
        }
        Ok(())
    }
}
