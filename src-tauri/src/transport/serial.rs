//! Bluetooth Classic (SPP) printers. Once paired, macOS exposes them as `/dev/cu.<name>`;
//! opening the port establishes the RFCOMM link, so no vendor software is needed.

use std::io::{Read, Write};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub path: String,
    pub name: String,
}

/// System ports that are never printers.
const IGNORED: [&str; 2] = ["Bluetooth-Incoming-Port", "debug-console"];

pub fn list() -> Result<Vec<SerialPortInfo>> {
    let mut ports: Vec<_> = std::fs::read_dir("/dev")?
        .filter_map(|entry| {
            let file_name = entry.ok()?.file_name().into_string().ok()?;
            let name = file_name.strip_prefix("cu.")?;
            (!IGNORED.contains(&name)).then(|| SerialPortInfo {
                path: format!("/dev/{file_name}"),
                name: name.to_owned(),
            })
        })
        .collect();
    ports.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ports)
}

fn open(path: &str, timeout: Duration) -> Result<Box<dyn serialport::SerialPort>> {
    // The baud rate is meaningless for RFCOMM but required by the API.
    serialport::new(path, 115_200)
        .timeout(timeout)
        .open()
        .map_err(|err| match err.kind() {
            serialport::ErrorKind::NoDevice => Error::NotFound(format!(
                "{path} – ist der Drucker eingeschaltet und gekoppelt? ({err})"
            )),
            _ => Error::Other(format!("{path}: {err}")),
        })
}

pub fn send(path: &str, data: &[u8], timeout: Duration) -> Result<()> {
    let mut port = open(path, timeout)?;
    port.write_all(data).map_err(map_io)?;
    port.flush().map_err(map_io)?;
    // Closing the port immediately can drop the RFCOMM link before the tail of the job
    // left the Bluetooth stack.
    std::thread::sleep(Duration::from_millis(500));
    Ok(())
}

/// See [`super::usb::UsbPrinter::exchange`].
pub fn exchange(
    path: &str,
    cmd: &[u8],
    timeout: Duration,
    done: impl Fn(&[u8]) -> bool,
) -> Result<Vec<u8>> {
    let mut port = open(path, Duration::from_millis(100))?;
    let _ = port.clear(serialport::ClearBuffer::Input);
    port.write_all(cmd).map_err(map_io)?;
    port.flush().map_err(map_io)?;

    let deadline = Instant::now() + timeout;
    let mut reply = Vec::new();
    let mut buf = [0u8; 256];
    while !done(&reply) && Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(n) => reply.extend_from_slice(&buf[..n]),
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(reply)
}

fn map_io(err: std::io::Error) -> Error {
    if err.kind() == std::io::ErrorKind::TimedOut {
        Error::Timeout("Bluetooth-Übertragung hängt – Drucker außer Reichweite?".into())
    } else {
        Error::Io(err)
    }
}
