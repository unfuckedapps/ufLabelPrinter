//! Fallback transport: hand raw TSPL to an existing CUPS queue (`lp -o raw`).
//! Useful for printers that are only reachable through CUPS (e.g. network queues).

use std::io::Write;
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CupsQueue {
    pub name: String,
    pub device_uri: String,
    /// From the queue's PPD, e.g. 203 or 300.
    pub dpi: Option<u32>,
}

pub fn list() -> Result<Vec<CupsQueue>> {
    let output = Command::new("lpstat").arg("-v").output()?;
    let text = String::from_utf8_lossy(&output.stdout);

    Ok(text
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("device for ")?;
            let (name, uri) = rest.split_once(": ")?;
            Some(CupsQueue {
                name: name.to_owned(),
                device_uri: uri.trim().to_owned(),
                dpi: ppd_resolution(name),
            })
        })
        .collect())
}

fn ppd_resolution(queue: &str) -> Option<u32> {
    let ppd = std::fs::read_to_string(format!("/etc/cups/ppd/{queue}.ppd")).ok()?;
    let line = ppd.lines().find(|l| l.starts_with("*DefaultResolution:"))?;
    let value = line.split(':').nth(1)?.trim();
    value
        .trim_end_matches("dpi")
        .split('x')
        .next()?
        .parse()
        .ok()
}

pub fn send(queue: &str, data: &[u8]) -> Result<()> {
    let mut child = Command::new("lp")
        .args(["-d", queue, "-o", "raw", "-t", "Thermalprinter", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;

    child
        .stdin
        .take()
        .ok_or_else(|| Error::Other("lp stdin nicht verfügbar".into()))?
        .write_all(data)?;

    let output = child.wait_with_output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(Error::Other(format!(
            "lp ist fehlgeschlagen: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )))
    }
}
