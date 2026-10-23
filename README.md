# ufLabelPrinter

**Unfuck your thermal label printer.**

Cheap thermal label printers (Phomemo, Vevor, Munbyn, iDPRT, Jadens and the hundred
white-label clones of them) are perfectly good hardware. The software they ship with is
not. You get bloated vendor apps that want an account, a cloud and a firmware update
before printing one label. You get macOS drivers that crop your 105 × 203 mm DHL label
onto 4 × 6" paper instead of scaling it, so the address ends up missing. And you need one
app per printer brand.

ufLabelPrinter is a small native app that skips all of that. It renders your label
itself and talks to the printer directly over **USB**, **Bluetooth** or, if you must,
**CUPS**. You need no driver, no account and no vendor app.

## What it does

- **Drop in a PDF or image and print it.** Shipping labels from DHL, Deutsche Post,
  Warenpost and the like, or any PNG/JPG. You can queue several files and print them in
  one go, set copies per file and see at a glance which ones are already printed.
- **It scales to the paper you actually loaded.** A label that is bigger than the
  paper is shrunk to fit, never cropped. Landscape labels are rotated automatically,
  and white borders can be trimmed so the content uses the whole label.
- **The preview is exactly what gets printed.** It shows the final 1-bit bitmap at
  the printer's resolution, so there are no surprises.
- **Barcodes stay scannable.** Rendering uses a hard threshold at the printer's native
  dpi instead of fuzzy scaling. In testing, DHL Leitcode/Identcode and Warenpost UPU S10
  barcodes shrunk to 80 % still decoded at both 300 and 203 dpi.
- **Paper profiles:** describe each label roll once (size, gap/black-mark/continuous) and
  switch the loaded paper from the toolbar when you change the roll.
- **There are printer tools built in:** a calibration test label (edge frame, rulers,
  line patterns), label feed, sensor calibration, density, speed, 180° flip and
  fine offsets.
- **It reports live printer status** (paper, cover, model and firmware) for printers
  that support it. Status is never queried while the printer is still printing.
- **It integrates with the system.** You can drag & drop files, use ⌘O / ⌘P, use
  "Open With" from Finder, or drop files on the Dock icon.
- **Bluetooth LE without pairing.** Vendor flow control (Phomemo/QIN credits) and
  compressed bitmaps are handled, so a shipping label goes out in a few seconds.
- **It is modular.** Printer models are JSON files, and printer languages and status
  dialects are small Rust modules. See [Adding a printer](docs/adding-a-printer.md).

## Supported printers

| Printer                 | Connection      | Language | Status            | Notes                                                    |
| ----------------------- | --------------- | -------- | ----------------- | -------------------------------------------------------- |
| Phomemo D530 Pro        | USB, BLE        | TSPL     | yes (`phomemo`)   | 300 dpi. BLE uses credit flow control + LZO mode 4       |
| Vevor Y468BT            | USB, BLE        | TSPL     | –                 | 203 or 300 dpi variants                                  |
| Generic TSPL, 203 dpi   | USB, BT, CUPS   | TSPL     | –                 | Most 4" shipping label printers speak TSPL               |
| Generic TSPL, 300 dpi   | USB, BT, CUPS   | TSPL     | –                 |                                                          |

Your printer is not listed? If its macOS/Windows driver mentions TSPL, or it is sold as
"TSC compatible", the generic models will most likely work as they are. Once you have
confirmed it, please [add a model file](docs/adding-a-printer.md) so it is recognised
automatically.

## Getting started

Requirements: macOS (the primary target for now), [Rust](https://rustup.rs) ≥ 1.85,
Node.js ≥ 20 and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # build ufLabelPrinter.app and a .dmg
```

On first start, every USB label printer that is connected is set up automatically.
Bluetooth printers are added under **Printers → Scan Bluetooth LE**; no pairing in
System Settings is needed, macOS only asks once for Bluetooth permission. Paired
Bluetooth Classic printers (`/dev/cu.<name>`) work too, but on macOS LE is far more
reliable.

The UI is available in English, German, French and Spanish (switch it in the toolbar).
To add a language, copy `src/i18n/en.ts`, translate it and register it in
`src/i18n/index.tsx`. TypeScript and `pnpm test` make sure no key is missing.

## How it works

```
PDF / image ──► pdf.js renders at the printer's dpi ──► fit, rotate, trim ──► 1-bit threshold
                                (WebView, TypeScript)

1-bit pages ──► protocol (TSPL, …) ──► transport (USB via nusb, Bluetooth SPP, CUPS raw)
                           (Rust)
```

- **Frontend** (`src/`): React and Tailwind. `lib/render.ts` rasterises pages,
  `lib/layout.ts` decides scale and rotation, and `lib/bitmap.ts` does the threshold,
  dithering and packing.
- **Backend** (`src-tauri/src/`):
  - `protocol/` turns pages into printer bytes (`tspl.rs`).
  - `status/` holds the status query dialects (`phomemo.rs`).
  - `transport/` moves bytes over USB (`nusb`, pure Rust, no libusb), serial ports or `lp`.
  - `models.rs` loads the model files.
- **Models** (`src-tauri/models/*.json`) are embedded at build time. You can add more at
  runtime in `~/Library/Application Support/com.unfuckedapps.uflabelprinter/models/`.

### Poking at hardware

`cargo run --example probe` lists USB printers and reads their status without printing
anything. Extra arguments are sent as read-only queries, for example
`cargo run --example probe -- SSSGETSENSOR`. Pass `/dev/cu.<name>` to query a Bluetooth
printer instead.

## Troubleshooting

- **The printer stops halfway through a label and beeps.** The vendor apps run into this
  too. The most likely cause is the power drawn by dense black areas, such as big
  barcodes printed large. Try a lower **speed** (2–3 in/s) or a lower density in the
  printer settings, or keep *Trim white borders* off so the label prints a little
  smaller.
- **"The printer is busy".** Another program is holding the USB device, usually
  Labelife or a running CUPS job. Quit it and try again.
- **Content is offset or cut at the edge.** Print the test label and adjust
  *Fine tuning*. After changing the roll, run *Calibrate sensor* once.
- **The label comes out upside down.** Turn on *Rotate print by 180°*.
- **Bluetooth is slow or drops.** Models with `"compression": "lzo"` send labels
  compressed (about 15 KB instead of 270 KB). A transfer that makes no progress for 10 s
  is aborted, and you can cancel any job from the progress bar.

## Development

```sh
pnpm test                           # frontend unit tests (layout, bitmap)
cd src-tauri && cargo test          # protocol, status parsing, model files, job decoding
cd src-tauri && cargo clippy --all-targets
```

Contributions of model files, protocols (ESC/POS, ZPL, EPL, …) and status dialects are
very welcome.

## License

[MIT](LICENSE). Printer and vendor names belong to their respective owners; this project
is not affiliated with Phomemo, Vevor or any other manufacturer.
