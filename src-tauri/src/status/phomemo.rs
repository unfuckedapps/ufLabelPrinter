//! Status queries of the Phomemo/QIN firmware (the `SSS…` commands Labelife uses).
//! These printers answer the standard TSPL `<ESC>!?` with "Cmd error", so we use the
//! vendor queries. Each answers with a line `SSSGETxxx:VALUE`.

use super::{PrinterStatus, StatusDialect};

// `SSSGETPRINTING` exists too, but gets dropped when batched with the others.
const QUERIES: [&str; 4] = ["SSSGETPAPER", "SSSGETCAP", "SSSGETTYPE", "SSSGETVERSION"];

pub struct Phomemo;

fn answers(reply: &[u8]) -> impl Iterator<Item = (&str, &str)> {
    std::str::from_utf8(reply)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.trim().split_once(':'))
        .filter(|(key, _)| QUERIES.contains(key))
}

impl StatusDialect for Phomemo {
    fn request(&self) -> Vec<u8> {
        QUERIES.iter().map(|q| format!("{q}\r\n")).collect::<String>().into_bytes()
    }

    fn is_complete(&self, reply: &[u8]) -> bool {
        answers(reply).count() >= QUERIES.len()
    }

    fn parse(&self, reply: &[u8]) -> PrinterStatus {
        let mut status = PrinterStatus::connected();
        for (key, value) in answers(reply) {
            status.responsive = true;
            let value = value.trim();
            match key {
                "SSSGETPAPER" => status.paper = Some(value == "YES"),
                "SSSGETCAP" => status.cover_open = Some(value != "CLOSE"),
                "SSSGETTYPE" => status.model = Some(value.to_owned()),
                "SSSGETVERSION" => status.firmware = Some(value.to_owned()),
                _ => {}
            }
        }
        status
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_d530_pro_replies() {
        let reply = b"SSSGETPAPER:YES\r\nSSSGETCAP:CLOSE\r\nSSSGETTYPE:D530 Pro\r\n\
                      SSSGETVERSION:V2.8.0\r\n";
        assert!(Phomemo.is_complete(reply));

        let status = Phomemo.parse(reply);
        assert!(status.responsive);
        assert_eq!(status.paper, Some(true));
        assert_eq!(status.cover_open, Some(false));
        assert_eq!(status.model.as_deref(), Some("D530 Pro"));
        assert_eq!(status.firmware.as_deref(), Some("V2.8.0"));
    }

    #[test]
    fn ignores_errors_and_partial_replies() {
        let reply = b"Cmd error:\x1b!?~!T\r\nSSSGETPAPER:NO\r\n";
        assert!(!Phomemo.is_complete(reply));
        let status = Phomemo.parse(reply);
        assert_eq!(status.paper, Some(false));
        assert_eq!(status.model, None);
    }
}
