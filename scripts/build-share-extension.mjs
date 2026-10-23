// Builds the macOS Share extension ("Share → ufLabelPrinter") that tauri.conf.json bundles
// as Contents/PlugIns/ShareExtension.appex. Runs before bundling; does nothing elsewhere.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const src = path("../src-tauri/share-extension/");
const out = path("../src-tauri/target/share-extension/");
const appex = `${out}ShareExtension.appex`;
const conf = JSON.parse(readFileSync(path("../src-tauri/tauri.conf.json"), "utf8"));

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

rmSync(appex, { recursive: true, force: true });
mkdirSync(`${appex}/Contents/MacOS`, { recursive: true });

// Universal, so the same extension fits the Apple Silicon and the Intel app.
const slices = ["arm64", "x86_64"].map((arch) => {
  const binary = `${out}ShareExtension-${arch}`;
  run("xcrun", [
    "--sdk", "macosx", "swiftc",
    "-target", `${arch}-apple-macos11.0`,
    "-swift-version", "5",
    "-O",
    "-module-name", "ShareExtension",
    "-parse-as-library",
    "-application-extension",
    "-Xlinker", "-application_extension",
    "-Xlinker", "-e", "-Xlinker", "_NSExtensionMain",
    "-o", binary,
    `${src}ShareViewController.swift`,
  ]);
  return binary;
});
run("lipo", ["-create", "-output", `${appex}/Contents/MacOS/ShareExtension`, ...slices]);

const plist = `${appex}/Contents/Info.plist`;
copyFileSync(`${src}Info.plist`, plist);
for (const [key, value] of [
  // Extension identifiers have to start with the app's.
  ["CFBundleIdentifier", `${conf.identifier}.share`],
  ["CFBundleDisplayName", conf.productName],
  ["CFBundleShortVersionString", conf.version],
  ["CFBundleVersion", conf.version],
]) {
  run("plutil", ["-replace", key, "-string", value, plist]);
}

// Tauri signs the app around it but not bundles nested in it, so sign it here with the
// same identity: Developer ID with hardened runtime for notarized releases, else ad hoc.
const identity = process.env.APPLE_SIGNING_IDENTITY;
run("codesign", [
  "--force",
  "--sign", identity || "-",
  ...(identity ? ["--options", "runtime", "--timestamp"] : []),
  "--entitlements", `${src}ShareExtension.entitlements`,
  appex,
]);
