//! Bluetooth Classic (SPP) printers. Once paired, macOS exposes them as `/dev/cu.<name>`,
//! Windows as a COM port and Linux as `/dev/rfcomm*`; opening the port establishes the
//! RFCOMM link, so no vendor software is needed.
//!
//! Bluetooth links are slow (a few KB/s) and can stall when the printer stops reading,
//! so jobs are written in small non-blocking chunks: progress can be reported, the job
//! cancelled, and a stalled link detected instead of blocking in `write()` forever.
//!
//! Opening the port is where macOS sets up the RFCOMM link. When that fails the call
//! can hang uninterruptibly in the kernel for minutes, so it runs on its own thread.

use std::collections::BTreeSet;
use std::io::{ErrorKind, Read, Write};
use std::sync::{Mutex, mpsc};
use std::time::{Duration, Instant};

use serde::Serialize;
use serialport::SerialPort;

#[cfg(unix)]
type Port = serialport::TTYPort;
#[cfg(windows)]
type Port = serialport::COMPort;

use super::Progress;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub path: String,
    pub name: String,
}

/// System ports that are never printers.
#[cfg(target_os = "macos")]
const IGNORED: [&str; 2] = ["Bluetooth-Incoming-Port", "debug-console"];

/// Small enough that progress and cancellation stay responsive at Bluetooth speeds.
const CHUNK: usize = 512;

/// No byte accepted for this long means the link is dead or the printer stopped reading.
const STALL_TIMEOUT: Duration = Duration::from_secs(10);

/// Establishing the Bluetooth link normally takes 1-3 s.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Ports whose open() is still stuck in the kernel; opening them again would only pile
/// up more stuck threads.
static CONNECTING: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

#[cfg(not(target_os = "macos"))]
pub fn list() -> Result<Vec<SerialPortInfo>> {
    let ports = serialport::available_ports().map_err(|err| Error::Other(err.to_string()))?;
    Ok(ports
        .into_iter()
        .map(|p| SerialPortInfo {
            name: p.port_name.trim_start_matches("/dev/").to_owned(),
            path: p.port_name,
        })
        .collect())
}

/// macOS lists every port twice (`tty.*` and `cu.*`); only `cu.*` can be opened without
/// waiting for carrier detect.
#[cfg(target_os = "macos")]
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

fn open(path: &str, timeout: Duration) -> Result<Port> {
    let connect_failed = || Error::ConnectFailed { path: path.to_owned() };
    if !CONNECTING.lock().unwrap_or_else(|p| p.into_inner()).insert(path.to_owned()) {
        return Err(connect_failed());
    }

    let (tx, rx) = mpsc::channel();
    let owned = path.to_owned();
    std::thread::spawn(move || {
        // The baud rate is meaningless for RFCOMM but required by the API.
        let result = Port::open(&serialport::new(&owned, 115_200).timeout(timeout));
        CONNECTING.lock().unwrap_or_else(|p| p.into_inner()).remove(&owned);
        // Nobody listens any more after a timeout; the port is then simply closed again.
        let _ = tx.send(result);
    });

    let port = match rx.recv_timeout(CONNECT_TIMEOUT) {
        Ok(result) => result.map_err(|err| match err.kind() {
            serialport::ErrorKind::NoDevice | serialport::ErrorKind::Io(ErrorKind::NotFound) => {
                Error::PortUnavailable { path: path.to_owned() }
            }
            _ => Error::Other(format!("{path}: {err}")),
        })?,
        Err(_) => {
            log::warn!("{path}: no Bluetooth connection after {CONNECT_TIMEOUT:?}");
            return Err(connect_failed());
        }
    };

    // serialport leaves the descriptor blocking, so a full RFCOMM buffer would park us
    // inside write() with no way out. Non-blocking writes return early instead and the
    // crate's own poll() applies the timeout. (Windows COM ports honour the timeout.)
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let fd = port.as_raw_fd();
        // SAFETY: plain fcntl on a descriptor owned by `port`, which outlives these calls.
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            if flags >= 0 {
                libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
            }
        }
    }
    Ok(port)
}

pub fn send(path: &str, data: &[u8], progress: &Progress) -> Result<()> {
    let mut port = open(path, STALL_TIMEOUT)?;
    let started = Instant::now();
    let mut sent = 0;
    // Connected: tell the UI that sending starts now.
    progress.report(0, data.len());

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
                return Err(Error::Stalled { sent, total: data.len() });
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
            return Err(Error::Stalled {
                sent: data.len() - queued,
                total: data.len(),
            });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    progress.report(data.len(), data.len());
    std::thread::sleep(Duration::from_millis(500));
    log::info!(
        "{path}: {} bytes in {:.1}s ({:.1} KB/s)",
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
        Error::Disconnected { sent, total }
    } else {
        Error::Io(err)
    }
}
