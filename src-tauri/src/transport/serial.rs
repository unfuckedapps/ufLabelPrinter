//! Bluetooth Classic (SPP) printers. Once paired, macOS exposes them as `/dev/cu.<name>`;
//! opening the port establishes the RFCOMM link, so no vendor software is needed.
//!
//! Bluetooth links are slow (a few KB/s) and can stall when the printer stops reading,
//! so jobs are written in small non-blocking chunks: progress can be reported, the job
//! cancelled, and a stalled link detected instead of blocking in `write()` forever.

use std::io::{ErrorKind, Read, Write};
use std::os::fd::AsRawFd;
use std::time::{Duration, Instant};

use serde::Serialize;
use serialport::{SerialPort, TTYPort};

use super::Progress;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub path: String,
    pub name: String,
}

/// System ports that are never printers.
const IGNORED: [&str; 2] = ["Bluetooth-Incoming-Port", "debug-console"];

/// Small enough that progress and cancellation stay responsive at Bluetooth speeds.
const CHUNK: usize = 512;

/// No byte accepted for this long means the link is dead or the printer stopped reading.
const STALL_TIMEOUT: Duration = Duration::from_secs(10);

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

fn open(path: &str, timeout: Duration) -> Result<TTYPort> {
    // The baud rate is meaningless for RFCOMM but required by the API.
    let port = TTYPort::open(&serialport::new(path, 115_200).timeout(timeout)).map_err(|err| {
        match err.kind() {
            serialport::ErrorKind::NoDevice => Error::NotFound(format!(
                "{path} – ist der Drucker eingeschaltet und gekoppelt? ({err})"
            )),
            serialport::ErrorKind::Io(ErrorKind::NotFound) => Error::NotFound(format!(
                "{path} ist verschwunden – macOS hat die Bluetooth-Verbindung getrennt"
            )),
            _ => Error::Other(format!("{path}: {err}")),
        }
    })?;

    // serialport leaves the descriptor blocking, so a full RFCOMM buffer would park us
    // inside write() with no way out. Non-blocking writes return early instead and the
    // crate's own poll() applies the timeout.
    let fd = port.as_raw_fd();
    // SAFETY: plain fcntl on a descriptor owned by `port`, which outlives these calls.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        if flags >= 0 {
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }
    Ok(port)
}

pub fn send(path: &str, data: &[u8], progress: &Progress) -> Result<()> {
    let mut port = open(path, STALL_TIMEOUT)?;
    let started = Instant::now();
    let mut sent = 0;

    while sent < data.len() {
        if progress.is_cancelled() {
            let _ = port.clear(serialport::ClearBuffer::Output);
            return Err(Error::Cancelled);
        }
        let end = (sent + CHUNK).min(data.len());
        match port.write(&data[sent..end]) {
            Ok(n) => sent += n,
            Err(err) if err.kind() == ErrorKind::WouldBlock || err.kind() == ErrorKind::Interrupted => {}
            Err(err) if err.kind() == ErrorKind::TimedOut => {
                return Err(Error::Timeout(format!(
                    "Bluetooth-Übertragung hängt seit {}s bei {} von {} KB – Drucker außer Reichweite oder Verbindung getrennt",
                    STALL_TIMEOUT.as_secs(),
                    sent / 1024,
                    data.len() / 1024
                )));
            }
            Err(err) => return Err(map_io(err, sent, data.len())),
        }
        // Report what actually left the machine, not what sits in the tty buffer.
        let queued = port.bytes_to_write().unwrap_or(0) as usize;
        progress.report(sent.saturating_sub(queued), data.len());
    }

    // Wait until the Bluetooth stack sent everything; closing earlier can drop the tail
    // of the job together with the RFCOMM link. tcdrain() could block forever on a dead
    // link, so poll the output queue instead.
    let mut last_change = Instant::now();
    let mut last_queued = usize::MAX;
    loop {
        let queued = port.bytes_to_write().unwrap_or(0) as usize;
        if queued == 0 {
            break;
        }
        if progress.is_cancelled() {
            let _ = port.clear(serialport::ClearBuffer::Output);
            return Err(Error::Cancelled);
        }
        if queued != last_queued {
            last_queued = queued;
            last_change = Instant::now();
            progress.report(data.len() - queued, data.len());
        } else if last_change.elapsed() > STALL_TIMEOUT {
            return Err(Error::Timeout(format!(
                "Bluetooth-Übertragung hängt, {} KB nicht gesendet – Verbindung getrennt?",
                queued.div_ceil(1024)
            )));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    progress.report(data.len(), data.len());
    std::thread::sleep(Duration::from_millis(500));
    eprintln!(
        "[serial] {path}: {} bytes in {:.1}s ({:.1} KB/s)",
        data.len(),
        started.elapsed().as_secs_f32(),
        data.len() as f32 / 1024.0 / started.elapsed().as_secs_f32()
    );
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
    let mut written = 0;
    while written < cmd.len() {
        match port.write(&cmd[written..]) {
            Ok(n) => written += n,
            Err(err) if err.kind() == ErrorKind::WouldBlock || err.kind() == ErrorKind::Interrupted => {}
            Err(err) if err.kind() == ErrorKind::TimedOut => {}
            Err(err) => return Err(err.into()),
        }
    }

    let deadline = Instant::now() + timeout;
    let mut reply = Vec::new();
    let mut buf = [0u8; 256];
    while !done(&reply) && Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(n) => reply.extend_from_slice(&buf[..n]),
            Err(err) if matches!(err.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(reply)
}

fn map_io(err: std::io::Error, sent: usize, total: usize) -> Error {
    if err.kind() == ErrorKind::BrokenPipe {
        Error::Other(format!(
            "Bluetooth-Verbindung nach {} von {} KB abgerissen",
            sent / 1024,
            total / 1024
        ))
    } else {
        Error::Io(err)
    }
}
