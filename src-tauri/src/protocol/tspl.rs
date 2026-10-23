//! TSPL command generation (TSC printer language, spoken by most Chinese label printers).
//!
//! Reverse-checked against the output of the vendor's `rastertolabeltspl` CUPS filter:
//! `SIZE` / `GAP` / `DIRECTION` header, then `CLS`, `BITMAP x,y,wbytes,h,mode,<raw>` and
//! `PRINT`, all CRLF terminated. In TSPL bitmaps a 0 bit prints a dot, 1 leaves it white.

use std::fmt::Write as _;

use super::{JobSettings, Media, Page, Protocol};
use crate::error::{Error, Result};

pub struct Tspl;

/// Formats millimetres without a trailing ".0" (`101.6`, `3`).
fn mm(value: f32) -> String {
    let rounded = (value * 10.0).round() / 10.0;
    if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.1}")
    }
}

fn header(s: &JobSettings) -> String {
    let mut out = String::new();
    let _ = write!(out, "SIZE {} mm,{} mm\r\n", mm(s.width_mm), mm(s.height_mm));
    let _ = match s.media {
        Media::Gap { gap_mm, offset_mm } => {
            write!(out, "GAP {} mm,{} mm\r\n", mm(gap_mm), mm(offset_mm))
        }
        Media::BlackMark { mark_mm, offset_mm } => {
            write!(out, "BLINE {} mm,{} mm\r\n", mm(mark_mm), mm(offset_mm))
        }
        Media::Continuous => write!(out, "GAP 0,0\r\n"),
    };
    let _ = write!(out, "DIRECTION {},0\r\n", u8::from(s.rotate180));
    out.push_str("REFERENCE 0,0\r\n");
    out.push_str("OFFSET 0 mm\r\n");
    let _ = write!(out, "SET TEAR {}\r\n", if s.tear { "ON" } else { "OFF" });
    if let Some(density) = s.density {
        let _ = write!(out, "DENSITY {}\r\n", density.min(15));
    }
    if let Some(speed) = s.speed {
        let _ = write!(out, "SPEED {speed}\r\n");
    }
    out
}

fn build_job(settings: &JobSettings, pages: &[Page]) -> Result<Vec<u8>> {
    if pages.is_empty() {
        return Err(Error::InvalidJob("keine Seiten".into()));
    }

    let payload: usize = pages.iter().map(|p| p.data.len() + 64).sum();
    let mut out = Vec::with_capacity(payload + 256);
    out.extend_from_slice(header(settings).as_bytes());

    for page in pages {
        page.validate()?;
        out.extend_from_slice(b"CLS\r\n");
        out.extend_from_slice(
            format!("BITMAP 0,0,{},{},0,", page.width_bytes, page.height).as_bytes(),
        );
        out.extend(page.data.iter().map(|b| !b));
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(format!("PRINT 1,{}\r\n", page.copies.max(1)).as_bytes());
    }

    Ok(out)
}

impl Protocol for Tspl {
    fn print(&self, settings: &JobSettings, pages: &[Page]) -> Result<Vec<u8>> {
        build_job(settings, pages)
    }

    fn feed(&self, settings: &JobSettings) -> Result<Vec<u8>> {
        Ok(format!("{}FORMFEED\r\n", header(settings)).into_bytes())
    }

    /// Feeds a few labels while the sensor measures them.
    fn calibrate(&self, settings: &JobSettings) -> Result<Vec<u8>> {
        let command = match settings.media {
            Media::Gap { .. } => "GAPDETECT",
            Media::BlackMark { .. } => "BLINEDETECT",
            Media::Continuous => {
                return Err(Error::Other("Endlospapier muss nicht kalibriert werden".into()));
            }
        };
        Ok(format!("{}{command}\r\n", header(settings)).into_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(media: Media) -> JobSettings {
        JobSettings {
            width_mm: 101.6,
            height_mm: 152.4,
            media,
            density: None,
            speed: Some(4),
            rotate180: false,
            tear: true,
        }
    }

    #[test]
    fn formats_millimetres() {
        assert_eq!(mm(101.6), "101.6");
        assert_eq!(mm(3.0), "3");
        assert_eq!(mm(0.04), "0");
    }

    #[test]
    fn builds_gap_job_like_vendor_driver() {
        let page = Page {
            width_bytes: 2,
            height: 1,
            copies: 1,
            data: vec![0b1000_0000, 0x00],
        };
        let job = build_job(
            &settings(Media::Gap {
                gap_mm: 3.0,
                offset_mm: 0.0,
            }),
            &[page],
        )
        .unwrap();

        let expected_head = "SIZE 101.6 mm,152.4 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0,0\r\n";
        assert!(job.starts_with(expected_head.as_bytes()));

        let bitmap = b"CLS\r\nBITMAP 0,0,2,1,0,";
        let at = job
            .windows(bitmap.len())
            .position(|w| w == bitmap)
            .expect("bitmap command");
        let data = &job[at + bitmap.len()..at + bitmap.len() + 2];
        assert_eq!(data, &[0b0111_1111, 0xff], "black must become 0 bits");
        assert!(job.ends_with(b"\r\nPRINT 1,1\r\n"));
    }

    #[test]
    fn continuous_and_black_mark_headers() {
        let job = build_job(
            &settings(Media::Continuous),
            &[Page {
                width_bytes: 1,
                height: 1,
                copies: 3,
                data: vec![0],
            }],
        )
        .unwrap();
        let text = String::from_utf8_lossy(&job);
        assert!(text.contains("GAP 0,0\r\n"));
        assert!(text.contains("PRINT 1,3\r\n"));

        let bline = String::from_utf8(
            Tspl.calibrate(&settings(Media::BlackMark {
                mark_mm: 2.5,
                offset_mm: 0.0,
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(bline.contains("BLINE 2.5 mm,0 mm\r\n"));
        assert!(bline.ends_with("BLINEDETECT\r\n"));
    }

    #[test]
    fn rejects_mismatched_bitmap() {
        let page = Page {
            width_bytes: 4,
            height: 2,
            copies: 1,
            data: vec![0; 3],
        };
        assert!(build_job(&settings(Media::Continuous), &[page]).is_err());
    }
}
