use serde::{Serialize, Serializer};

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Errors surfaced to the UI. Messages are German because they are shown to the user verbatim.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Drucker nicht gefunden: {0}")]
    NotFound(String),

    #[error("Der Drucker ist belegt (läuft Labelife oder ein CUPS-Druckauftrag?): {0}")]
    Busy(String),

    #[error("USB-Fehler: {0}")]
    Usb(String),

    #[error("Zeitüberschreitung: {0}")]
    Timeout(String),

    #[error("Druck abgebrochen")]
    Cancelled,

    #[error("Ungültiger Druckauftrag: {0}")]
    InvalidJob(String),

    #[error("Ein-/Ausgabefehler: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

impl From<nusb::Error> for Error {
    fn from(err: nusb::Error) -> Self {
        match err.kind() {
            nusb::ErrorKind::Busy => Error::Busy(err.to_string()),
            nusb::ErrorKind::Disconnected | nusb::ErrorKind::NotFound => {
                Error::NotFound(err.to_string())
            }
            _ => Error::Usb(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::InvalidJob(err.to_string())
    }
}

// Tauri commands need serializable errors; the frontend only needs the message.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
