# Development

## Building

Requirements: [Rust](https://rustup.rs) ≥ 1.85, Node.js ≥ 20 and [pnpm](https://pnpm.io).
On Linux additionally `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
libdbus-1-dev pkg-config` (see `.github/workflows/ci.yml`).

```sh
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # build installers for the current platform
```

On macOS, Bluetooth access requires a real app bundle; in `tauri dev` the permission
prompt is attributed to the terminal. Local builds need no update signing key when the
update artifacts are switched off:

```sh
pnpm tauri build --debug --bundles app -c '{"bundle":{"createUpdaterArtifacts":false}}'
```

## Tests

```sh
pnpm test                                        # layout, bitmap, migration, translations
cargo test --manifest-path src-tauri/Cargo.toml  # protocols, status parsing, models, jobs
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

## How it works

```
PDF / image ──► pdf.js renders at the printer's dpi ──► fit, rotate, trim ──► 1-bit threshold
                                (WebView, TypeScript)

1-bit pages ──► protocol (TSPL, …) ──► transport (USB, Bluetooth LE, Bluetooth Classic, system queue)
                           (Rust)
```

- **Frontend** (`src/`): React and Tailwind. `lib/render.ts` rasterises pages,
  `lib/layout.ts` decides scale and rotation, and `lib/bitmap.ts` does the threshold,
  dithering and packing. Translations live in `src/i18n/`; copy `en.ts` to add a language,
  TypeScript and `pnpm test` make sure no key is missing.
- **Backend** (`src-tauri/src/`):
  - `protocol/` turns pages into printer bytes (`tspl.rs`, including LZO bitmap modes 3 and 4).
  - `status/` holds the status query dialects (`phomemo.rs`, `yxwl.rs`).
  - `transport/` moves bytes:
    - `usb.rs`: direct USB via `nusb` (pure Rust); on Linux it detaches `usblp`.
    - `ble.rs`: Bluetooth LE via `btleplug`, including the credit-based flow control of
      Phomemo/QIN firmware and the standard Device Information service.
    - `serial.rs`: Bluetooth Classic SPP and other serial ports.
    - `cups.rs` / `winspool.rs`: raw jobs through CUPS or the Windows spooler.
  - `models.rs` loads the model files.
- **Models** (`src-tauri/models/*.json`) are embedded at build time; see
  [adding a printer](adding-a-printer.md).

### Platform notes

- **Windows** binds USB printers to `usbprint.sys`, so direct USB access fails. Print via
  Bluetooth LE or a spooler queue with the *Generic / Text Only* driver on the printer's
  USB port (or replace the driver with WinUSB, e.g. via Zadig).
- **Linux** needs read/write access to the printer's USB device (a udev rule) and BlueZ
  for Bluetooth.

### Opening files from outside the app

PDFs reach the app through the file association in `tauri.conf.json` (*Open With*, double
click) on every platform, and on macOS also through the Share menu. Either way they land in
`open_files` (`src-tauri/src/lib.rs`), which queues them for the UI.

The Share menu entry is an app extension in `src-tauri/share-extension/` (Swift, no UI) that
hands the shared PDFs to the app via Launch Services. `scripts/build-share-extension.mjs`
builds it before bundling and signs it with `APPLE_SIGNING_IDENTITY` (ad hoc without one),
because Tauri does not sign bundles nested in the app. `tauri dev` has no extension; to try
it, build the app bundle, start it once, then enable it under *Share → Edit Extensions…*.

### Poking at hardware

`cargo run --example probe` lists USB printers and reads their status without printing.
Extra arguments are sent as read-only queries (`-- SSSGETSENSOR`); pass `/dev/cu.<name>`
to query a Bluetooth Classic printer instead. `cargo run --example test_print -- usb 300`
prints one calibration label.

The app writes a log (`Open log folder` on the printer page); Bluetooth LE notifications
and every job are logged there.

## Releases and updates

Releases are built by `.github/workflows/release.yml` and published as GitHub releases;
installed apps check `releases/latest/download/latest.json` and update themselves. The
repository has to be public for that.

1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and
   `package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow builds macOS (Apple Silicon and Intel), Windows and Linux into a draft
   release. Check it and publish it; from then on apps offer the update.

### Secrets

| Secret                               | What                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Update signing key (`tauri signer generate`); the public key is in `tauri.conf.json` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password                                                 |
| `APPLE_CERTIFICATE`                  | Developer ID Application certificate, `.p12` as base64       |
| `APPLE_CERTIFICATE_PASSWORD`         | Its password                                                 |
| `APPLE_SIGNING_IDENTITY`             | e.g. `Developer ID Application: Name (TEAMID)`               |
| `APPLE_API_ISSUER`                   | App Store Connect API issuer ID (notarization)               |
| `APPLE_API_KEY`                      | API key ID                                                   |
| `APPLE_API_KEY_P8`                   | Contents of the `AuthKey_<id>.p8` file                       |

Without the Apple secrets the macOS build is unsigned; without the signing key no update
files are produced. `scripts/set-release-secrets.sh` uploads them with the GitHub CLI.
Tauri signs with the first identity in the certificate file, so the script repacks the
`.p12` to just the Developer ID Application identity; `scripts/set-release-secrets.sh apple`
renews only the certificate.
