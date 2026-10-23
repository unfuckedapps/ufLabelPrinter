# Adding a printer

Support for a printer comes in up to three layers. Most printers only need the first one.

| Layer                 | What it is                                     | Where                          |
| --------------------- | ---------------------------------------------- | ------------------------------ |
| **Model file**        | Name, resolution, how to recognise it, defaults | `src-tauri/models/<id>.json`   |
| **Protocol**          | The printer language (TSPL, ESC/POS, ZPL, …)    | `src-tauri/src/protocol/`      |
| **Status dialect**    | How to ask for paper/cover/model                | `src-tauri/src/status/`        |

## 1. Model file

Copy one of the files in [`src-tauri/models/`](../src-tauri/models) and adjust it:

```json
{
  "id": "phomemo-d530-pro",
  "vendor": "Phomemo",
  "name": "D530 Pro",
  "protocol": "tspl",
  "status": "phomemo",
  "dpi": 300,
  "maxWidthMm": 108,
  "match": {
    "usb": [{ "vendorId": 11836, "productId": 22361 }],
    "bluetooth": ["D530Pro", "D530 Pro"]
  },
  "defaults": { "widthMm": 101.6, "heightMm": 152.4, "mediaType": "gap", "gapMm": 3 },
  "speeds": [2, 3, 4, 5, 6],
  "density": { "min": 0, "max": 15 },
  "notes": "Shown under the model picker."
}
```

| Field              | Required | Meaning                                                                                   |
| ------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `id`               | yes      | Unique, kebab-case. A user file with the same id replaces the built-in one.               |
| `vendor`, `name`   | yes      | Shown in the UI.                                                                          |
| `protocol`         | yes      | A registered protocol id, currently `tspl`.                                               |
| `status`           | no       | A registered status dialect, currently `phomemo`. Leave it out if unknown.                |
| `dpi`              | yes      | Native print resolution, usually 203 or 300.                                              |
| `maxWidthMm`       | yes      | Print head width.                                                                         |
| `match.usb`        | no       | USB vendor/product ids (decimal) used to recognise the printer automatically.             |
| `match.bluetooth`  | no       | Prefixes of the Bluetooth name. On macOS this is the part after `/dev/cu.`.               |
| `defaults`         | no       | Starting values for new profiles: `widthMm`, `heightMm`, `mediaType` (`gap`, `blackMark`, `continuous`), `gapMm`, `speed`, `density`. |
| `speeds`           | no       | Speeds (in/s) offered in the UI.                                                          |
| `density`          | no       | Range of the density slider.                                                              |
| `notes`            | no       | Free text for quirks.                                                                     |
| `compression`      | no       | `"lzo"` if the printer accepts LZO1X bitmaps (TSPL `BITMAP` mode 3). Used over Bluetooth only. |

**Testing without rebuilding:** put the file into
`~/Library/Application Support/com.unfuckedapps.thermalprinter/models/` (*Printers →
Open models folder*) and press *Reload*. If the file is broken, the error is shown
right there.

**Contributing:** put the file into `src-tauri/models/`. It is embedded at build time
and checked by `cargo test` (`builtin_models_are_valid`).

### Finding the facts

- **USB ids:** `ioreg -p IOUSB -l -w0 | grep -E 'USB Product Name|idVendor|idProduct'`
  on macOS, or `lsusb` on Linux. `cargo run --example probe` lists every USB device
  with a printer-class interface.
- **Language:** check the vendor's CUPS driver. Its PPD names the filter
  (`grep cupsFilter /etc/cups/ppd/*.ppd`), and `strings` on that filter usually reveals
  the commands (`SIZE`, `GAP` and `BITMAP` mean TSPL). Even better, render a job with
  `cupsfilter -p <ppd> -m printer/foo label.pdf > job.prn` and look at the bytes.
- **Status queries:** `strings` on the vendor app tends to list them. Try only
  *read-only* ones with `cargo run --example probe -- <QUERY>`. Never send anything named
  RESTORE, UPDATE or similar.

## 2. Protocol

A protocol turns a protocol-neutral job into bytes:

```rust
pub trait Protocol: Send + Sync {
    fn print(&self, settings: &JobSettings, pages: &[Page]) -> Result<Vec<u8>>;
    fn feed(&self, settings: &JobSettings) -> Result<Vec<u8>>;
    fn calibrate(&self, settings: &JobSettings) -> Result<Vec<u8>>;
}
```

`Page` is a packed 1-bit bitmap (a set bit means black, MSB first, rows padded to whole
bytes) at the printer's resolution. Scaling, rotation and dithering have already
happened. `JobSettings` carries the label size, media type, density, speed and
orientation.

1. Add `src-tauri/src/protocol/<name>.rs` with a unit struct implementing `Protocol`.
2. Register it in `protocol::get` in `src-tauri/src/protocol/mod.rs`.
3. Add unit tests that compare against bytes captured from the vendor driver.
   `tspl.rs` has examples.

## 3. Status dialect

```rust
pub trait StatusDialect: Send + Sync {
    fn request(&self) -> Vec<u8>;
    fn is_complete(&self, reply: &[u8]) -> bool;
    fn parse(&self, reply: &[u8]) -> PrinterStatus;
}
```

`request` is sent as is. Replies are collected until `is_complete` returns true or a
4-second timeout passes. Register the dialect in `status::get`. The app never queries a
printer while it is still working on a job, because some firmwares abort the print when
that happens.
