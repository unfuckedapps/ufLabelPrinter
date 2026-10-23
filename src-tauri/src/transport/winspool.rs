//! Windows: raw jobs through the print spooler, the counterpart of `lp -o raw` on CUPS.
//! Windows binds USB printers to usbprint.sys, so direct USB access is not possible
//! without swapping drivers; a queue with the "Generic / Text Only" driver on the
//! printer's USB port passes TSPL through unchanged.

use windows::Win32::Graphics::Printing::{
    ClosePrinter, DOC_INFO_1W, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinterW,
    PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W, StartDocPrinterW,
    StartPagePrinter, WritePrinter,
};
use windows::core::{HSTRING, PCWSTR, PWSTR};

use super::SystemQueue;
use crate::error::{Error, Result};

fn win_err(err: windows::core::Error) -> Error {
    Error::Other(format!("Windows spooler: {err}"))
}

pub fn list() -> Result<Vec<SystemQueue>> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut needed, mut count) = (0u32, 0u32);
    // First call only reports the buffer size.
    let _ = unsafe { EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut needed, &mut count) };
    if needed == 0 {
        return Ok(Vec::new());
    }
    let mut buffer = vec![0u8; needed as usize];
    unsafe { EnumPrintersW(flags, PCWSTR::null(), 4, Some(&mut buffer), &mut needed, &mut count) }
        .map_err(win_err)?;

    // SAFETY: on success the buffer starts with `count` PRINTER_INFO_4W records whose
    // strings point into the same buffer, which outlives this slice.
    let infos =
        unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), count as usize) };
    Ok(infos
        .iter()
        .filter_map(|info| unsafe { info.pPrinterName.to_string() }.ok())
        .map(|name| SystemQueue {
            name,
            device_uri: String::new(),
            dpi: None,
        })
        .collect())
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn send(queue: &str, data: &[u8]) -> Result<()> {
    let mut handle = PRINTER_HANDLE::default();
    unsafe { OpenPrinterW(&HSTRING::from(queue), &mut handle, None) }.map_err(win_err)?;

    let mut doc_name = wide("ufLabelPrinter");
    let mut datatype = wide("RAW");
    let doc = DOC_INFO_1W {
        pDocName: PWSTR(doc_name.as_mut_ptr()),
        pOutputFile: PWSTR::null(),
        pDatatype: PWSTR(datatype.as_mut_ptr()),
    };

    let result = (|| -> Result<()> {
        if unsafe { StartDocPrinterW(handle, 1, &doc) } == 0 {
            return Err(win_err(windows::core::Error::from_win32()));
        }
        unsafe { StartPagePrinter(handle) }.ok().map_err(win_err)?;
        let mut offset = 0;
        while offset < data.len() {
            let mut written = 0u32;
            let chunk = &data[offset..];
            unsafe { WritePrinter(handle, chunk.as_ptr().cast(), chunk.len() as u32, &mut written) }
                .ok()
                .map_err(win_err)?;
            if written == 0 {
                return Err(Error::SendTimeout);
            }
            offset += written as usize;
        }
        unsafe { EndPagePrinter(handle) }.ok().map_err(win_err)?;
        unsafe { EndDocPrinter(handle) }.ok().map_err(win_err)?;
        Ok(())
    })();

    let _ = unsafe { ClosePrinter(handle) };
    result
}
