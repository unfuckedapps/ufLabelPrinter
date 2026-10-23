use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Errors surfaced to the UI. They serialize as `{ code, detail, ...params }`; the UI
/// translates `code` (see `src/i18n/`) and shows `detail` as technical context.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Busy(String),

    #[error("{0}")]
    Usb(String),

    #[error("printer did not accept data in time")]
    SendTimeout,

    #[error("{path} is not available")]
    PortUnavailable { path: String },

    #[error("could not establish a Bluetooth connection via {path}")]
    ConnectFailed { path: String },

    #[error("Bluetooth LE: {0}")]
    Ble(String),

    #[error("no permission to use Bluetooth")]
    BlePermission,

    #[error("Bluetooth transfer stalled at {sent} of {total} bytes")]
    Stalled { sent: usize, total: usize },

    #[error("Bluetooth connection dropped at {sent} of {total} bytes")]
    Disconnected { sent: usize, total: usize },

    #[error("cancelled")]
    Cancelled,

    #[error("unsupported file type .{0}")]
    UnsupportedFile(String),

    #[error("unknown printer model \"{0}\"")]
    UnknownModel(String),

    #[error("{0}")]
    InvalidJob(String),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

impl Error {
    fn code(&self) -> &'static str {
        match self {
            Error::NotFound(_) => "notFound",
            Error::Busy(_) => "busy",
            Error::Usb(_) => "usb",
            Error::SendTimeout => "sendTimeout",
            Error::PortUnavailable { .. } => "portUnavailable",
            Error::ConnectFailed { .. } => "connectFailed",
            Error::Ble(_) => "ble",
            Error::BlePermission => "blePermission",
            Error::Stalled { .. } => "stalled",
            Error::Disconnected { .. } => "disconnected",
            Error::Cancelled => "cancelled",
            Error::UnsupportedFile(_) => "unsupportedFile",
            Error::UnknownModel(_) => "unknownModel",
            Error::InvalidJob(_) => "invalidJob",
            Error::Io(_) => "io",
            Error::Other(_) => "other",
        }
    }
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

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("code", self.code())?;
        map.serialize_entry("detail", &self.to_string())?;
        match self {
            Error::PortUnavailable { path } | Error::ConnectFailed { path } => {
                map.serialize_entry("path", path)?
            }
            Error::Stalled { sent, total } | Error::Disconnected { sent, total } => {
                map.serialize_entry("sentKb", &sent.div_ceil(1024))?;
                map.serialize_entry("totalKb", &total.div_ceil(1024))?;
            }
            Error::UnsupportedFile(ext) => map.serialize_entry("ext", ext)?,
            Error::UnknownModel(id) => map.serialize_entry("id", id)?,
            _ => {}
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_detail_and_params() {
        let json = serde_json::to_value(Error::Stalled { sent: 2048, total: 15_000 }).unwrap();
        assert_eq!(json["code"], "stalled");
        assert_eq!(json["sentKb"], 2);
        assert_eq!(json["totalKb"], 15);
        assert!(json["detail"].as_str().unwrap().contains("2048"));
        assert_eq!(serde_json::to_value(Error::Cancelled).unwrap()["code"], "cancelled");
    }
}
