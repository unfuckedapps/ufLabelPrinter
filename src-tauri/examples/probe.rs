//! Hardware smoke test that never prints: lists USB printers, reads their status with the
//! Phomemo dialect and optionally sends read-only queries. Run with `cargo run --example probe [-- QUERY...]`;
//! each extra argument is sent CRLF-terminated (e.g. `SSSGETSENSOR`).
//! `cargo run --example probe -- /dev/cu.D530Pro` reads the status over Bluetooth instead.

use std::time::{Duration, Instant};

use uflabelprinter_lib::status;
use uflabelprinter_lib::transport::Connection;
use uflabelprinter_lib::transport::usb::{self, UsbPrinter, UsbSelector};

fn main() {
    let extra: Vec<String> = std::env::args().skip(1).collect();

    if let Some(path) = extra.first().filter(|a| a.starts_with("/dev/")) {
        let started = Instant::now();
        let status = Connection::Serial { path: path.clone() }.status(status::get("phomemo"));
        println!("{path}: status in {:?}: {status:?}", started.elapsed());
        return;
    }

    let printers = usb::list().expect("USB enumeration failed");
    if printers.is_empty() {
        println!("no USB printer-class devices found");
    }

    for p in printers {
        println!("{p:?}");
        let sel = UsbSelector {
            vendor_id: p.vendor_id,
            product_id: p.product_id,
            serial: p.serial.clone(),
        };

        let started = Instant::now();
        let status = Connection::Usb(sel.clone()).status(status::get("phomemo"));
        println!("  status in {:?}: {status:?}", started.elapsed());

        if extra.is_empty() {
            continue;
        }
        let printer = UsbPrinter::open(&sel).expect("open");
        for query in &extra {
            let prefix = format!("{query}:");
            let reply = printer.exchange(
                format!("{query}\r\n").as_bytes(),
                Duration::from_secs(4),
                |r| String::from_utf8_lossy(r).contains(&prefix) && r.ends_with(b"\n"),
            );
            match reply {
                Ok(reply) => println!("  {query} -> {:?}", String::from_utf8_lossy(&reply)),
                Err(err) => println!("  {query} failed: {err}"),
            }
        }
    }
}
