//! Status queries of the YXWL firmware in Vevor printers (Y468BT and relatives), taken
//! from Vevor's FlashLabel Pro app: TSPL's `~!T` plus vendor `READC …` reads. The reply
//! format is not documented, so parsing is deliberately lenient and the raw reply is
//! logged for refinement.

use super::{PrinterStatus, StatusDialect};

/// Spellings as in FlashLabel ("MDDLE", "PRDOCUTID").
const QUERIES: [&str; 4] = ["~!T", "READC VERSION", "READC MDDLE", "READC PRDOCUTID"];

pub struct Yxwl;

fn lines(reply: &[u8]) -> impl Iterator<Item = String> + '_ {
    reply
        .split(|b| matches!(b, b'\r' | b'\n' | 0))
        .map(|l| String::from_utf8_lossy(l).trim().to_owned())
        .filter(|l| !l.is_empty())
}

fn looks_like_version(line: &str) -> bool {
    let digits = line.trim_start_matches(|c: char| c.is_ascii_alphabetic() || c == ' ' || c == ':');
    let mut parts = digits.split('.');
    parts.next().is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        && parts.next().is_some_and(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit()))
}

impl StatusDialect for Yxwl {
    fn request(&self) -> Vec<u8> {
        QUERIES.iter().map(|q| format!("{q}\r\n")).collect::<String>().into_bytes()
    }

    /// The reply has no known terminator; collect until the transport times out.
    fn is_complete(&self, _reply: &[u8]) -> bool {
        false
    }

    fn parse(&self, reply: &[u8]) -> PrinterStatus {
        log::info!("yxwl status reply {:?}", String::from_utf8_lossy(reply));
        let mut status = PrinterStatus::connected();
        status.responsive = !reply.is_empty();
        for line in lines(reply) {
            // "KEY:VALUE" or "KEY=VALUE" replies: look at the value.
            let value = line
                .split_once([':', '='])
                .map_or(line.as_str(), |(_, v)| v)
                .trim()
                .to_owned();
            if status.firmware.is_none() && looks_like_version(&value) {
                status.firmware = Some(value);
            } else if status.model.is_none()
                && value.len() >= 3
                && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' '))
                && value.chars().any(|c| c.is_ascii_digit())
            {
                status.model = Some(value);
            }
        }
        status
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_model_and_version_from_loose_replies() {
        let status = Yxwl.parse(b"Y468BT\r\nV1.2.07\r\nPID:0468\r\n");
        assert!(status.responsive);
        assert_eq!(status.model.as_deref(), Some("Y468BT"));
        assert_eq!(status.firmware.as_deref(), Some("V1.2.07"));

        assert!(!Yxwl.parse(b"").responsive);
    }
}
