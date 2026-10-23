import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { describeError, translator } from "../i18n";
import { jobSettings } from "./printers";
import type {
  AppConfig,
  Bitmap,
  BleDevice,
  Devices,
  ModelRegistry,
  Printer,
  PrinterProfile,
  PrinterStatus,
} from "./types";

export const listModels = () => invoke<ModelRegistry>("list_models");

export const openModelsDir = () => invoke<void>("open_models_dir");

export const listDevices = () => invoke<Devices>("list_devices");

/** Takes a few seconds; may trigger the macOS Bluetooth permission prompt. */
export const scanBle = () => invoke<BleDevice[]>("scan_ble");

export const printerStatus = (p: PrinterProfile) =>
  invoke<PrinterStatus>("printer_status", { connection: p.connection, modelId: p.modelId });

export const feedLabel = (p: Printer) =>
  invoke<void>("feed_label", { connection: p.connection, settings: jobSettings(p), modelId: p.modelId });

export const calibrate = (p: Printer) =>
  invoke<void>("calibrate", { connection: p.connection, settings: jobSettings(p), modelId: p.modelId });

export const loadConfig = () => invoke<AppConfig | null>("load_config");

export const saveConfig = (config: AppConfig) => invoke<void>("save_config", { config });

export const takePendingFiles = () => invoke<string[]>("take_pending_files");

export async function readDocument(path: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>("read_document", { path });
  return new Uint8Array(buffer);
}

export interface PrintPage {
  bitmap: Bitmap;
  copies: number;
}

/**
 * Sends the job as one binary body: `u32 LE json length`, JSON metadata, then all
 * bitmaps back to back (see `commands::parse_job`).
 */
export function printJob(printer: Printer, pages: PrintPage[], jobId: string): Promise<void> {
  const meta = new TextEncoder().encode(
    JSON.stringify({
      jobId,
      connection: printer.connection,
      modelId: printer.modelId,
      settings: jobSettings(printer),
      pages: pages.map(({ bitmap, copies }) => ({
        widthBytes: bitmap.widthBytes,
        height: bitmap.height,
        copies,
      })),
    }),
  );

  const total = 4 + meta.length + pages.reduce((sum, p) => sum + p.bitmap.data.length, 0);
  const body = new Uint8Array(total);
  new DataView(body.buffer).setUint32(0, meta.length, true);
  body.set(meta, 4);
  let offset = 4 + meta.length;
  for (const { bitmap } of pages) {
    body.set(bitmap.data, offset);
    offset += bitmap.data.length;
  }

  return invoke<void>("print_job", body);
}

export const cancelJob = (jobId: string) => invoke<void>("cancel_job", { jobId });

export interface JobProgress {
  jobId: string;
  sent: number;
  total: number;
}

export function onJobProgress(handler: (progress: JobProgress) => void): Promise<UnlistenFn> {
  return listen<JobProgress>("job-progress", (event) => handler(event.payload));
}

/** Tauri rejects with the serialized Rust error (`{ code, detail, ... }`), translated here. */
export function errorMessage(err: unknown): string {
  return describeError(translator(), err);
}
