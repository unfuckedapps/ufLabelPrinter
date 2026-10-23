//! Prints one calibration label (edge frame, diagonals, black block, 1/2/3-dot lines)
//! and reports how long the transfer took. Useful when bringing up a new printer or
//! transport without the UI:
//!
//! ```sh
//! cargo run --example test_print -- usb 300                 # first USB printer
//! cargo run --example test_print -- /dev/cu.D530Pro 300     # Bluetooth
//! cargo run --example test_print -- /dev/cu.Y468BT-4958 203 50 30
//! cargo run --example test_print -- /dev/cu.D530Pro 300 101.6 152.4 lzo
//! ```
//!
//! Arguments: target, dpi, optional label width and height in mm (default 4x6"),
//! optional `lzo` to send the bitmap LZO-compressed (TSPL `BITMAP` mode 3).

use std::time::Instant;

use uflabelprinter_lib::protocol::{self, Compression, JobSettings, Media, Page};
use uflabelprinter_lib::transport::{Connection, Progress};
use uflabelprinter_lib::transport::usb::{self, UsbSelector};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let target = args.first().expect("target: usb or /dev/cu.<name>");
    let dpi: f32 = args.get(1).and_then(|a| a.parse().ok()).unwrap_or(203.0);
    let width_mm: f32 = args.get(2).and_then(|a| a.parse().ok()).unwrap_or(101.6);
    let height_mm: f32 = args.get(3).and_then(|a| a.parse().ok()).unwrap_or(152.4);

    let connection = if target == "usb" {
        let p = usb::list().expect("USB enumeration").into_iter().next().expect("no USB printer");
        Connection::Usb(UsbSelector {
            vendor_id: p.vendor_id,
            product_id: p.product_id,
            serial: p.serial,
        })
    } else {
        Connection::Serial { path: target.clone() }
    };

    let width = (width_mm / 25.4 * dpi).round() as usize;
    let height = (height_mm / 25.4 * dpi).round() as usize;
    let page = pattern(width, height, dpi / 25.4);
    let settings = JobSettings {
        width_mm,
        height_mm,
        media: Media::Gap {
            gap_mm: 3.0,
            offset_mm: 0.0,
        },
        density: None,
        speed: None,
        rotate180: false,
        tear: true,
        compression: if args.get(4).is_some_and(|a| a == "lzo") {
            Compression::Lzo
        } else {
            Compression::None
        },
    };

    let job = protocol::get("tspl").unwrap().print(&settings, &[page]).expect("job");
    println!("{connection:?}: sending {} bytes ({width}x{height} dots)", job.len());
    let started = Instant::now();
    let report = |sent: usize, total: usize| eprint!("\r{:>3} %  {sent}/{total} bytes", sent * 100 / total);
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let result = connection.send(&job, &Progress::new(&report, &cancel));
    eprintln!();
    match result {
        Ok(()) => println!("sent in {:?}", started.elapsed()),
        Err(err) => println!("failed after {:?}: {err}", started.elapsed()),
    }
}

fn pattern(width: usize, height: usize, dpmm: f32) -> Page {
    let width_bytes = width.div_ceil(8);
    let mut data = vec![0u8; width_bytes * height];
    let mut set = |x: usize, y: usize| {
        if x < width && y < height {
            data[y * width_bytes + x / 8] |= 0x80 >> (x % 8);
        }
    };

    let line = (0.4 * dpmm).round().max(2.0) as usize;
    for y in 0..height {
        for x in 0..width {
            let edge = x < line || y < line || x >= width - line || y >= height - line;
            // Diagonals show skew and stretch at a glance.
            let diag_a = (x * height / width).abs_diff(y) < line / 2 + 1;
            let diag_b = ((width - 1 - x) * height / width).abs_diff(y) < line / 2 + 1;
            if edge || diag_a || diag_b {
                set(x, y);
            }
        }
    }

    let mm = |v: f32| (v * dpmm).round() as usize;
    let (top, block_h) = (mm(10.0), mm(8.0));
    for y in top..top + block_h {
        for x in mm(10.0)..mm(25.0) {
            set(x, y);
        }
        let mut x = mm(30.0);
        for dots in [1, 2, 3] {
            for _ in 0..10 {
                for d in 0..dots {
                    set(x + d, y);
                }
                x += 2 * dots;
            }
            x += mm(4.0);
        }
    }

    Page {
        width_bytes,
        height,
        copies: 1,
        data,
    }
}
