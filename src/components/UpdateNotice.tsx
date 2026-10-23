import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowDownToLine, X } from "lucide-react";

import { useT } from "../i18n";
import { errorMessage } from "../lib/api";
import { Button } from "./ui";

const FIRST_CHECK_MS = 5_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

/** Looks for a new GitHub release in the background and offers a one-click update. */
export function UpdateNotice() {
  const t = useT();
  const [update, setUpdate] = useState<Update | null>(null);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const look = () =>
      check()
        .then((found) => found && setUpdate(found))
        // Offline, no release yet or running outside a bundle: try again later.
        .catch(() => {});
    const first = window.setTimeout(look, FIRST_CHECK_MS);
    const again = window.setInterval(look, RECHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, []);

  if (!update) return null;

  const install = async () => {
    setError(null);
    setProgress(0);
    let total = 0;
    let done = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          setProgress(total ? Math.round((done / total) * 100) : 0);
        }
      });
      await relaunch();
    } catch (err) {
      setProgress(null);
      setError(errorMessage(err));
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-xs font-medium text-accent hover:brightness-105"
      >
        <ArrowDownToLine className="size-3.5" />
        {t("update.available", { version: update.version })}
      </button>
      {open && (
        <div className="absolute top-9 right-0 z-50 flex w-80 flex-col gap-3 rounded-lg border border-line bg-panel p-4 shadow-xl">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{t("update.title", { version: update.version })}</span>
            <button className="text-faint hover:text-ink" onClick={() => setOpen(false)} aria-label={t("toast.close")}>
              <X className="size-3.5" />
            </button>
          </div>
          {update.body && (
            <p className="max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-line text-muted select-text">
              {update.body}
            </p>
          )}
          {error && <p className="text-xs text-err select-text">{t("update.failed", { error })}</p>}
          <Button variant="primary" busy={progress !== null} onClick={() => void install()}>
            {progress === null ? t("update.install") : t("update.downloading", { percent: progress })}
          </Button>
        </div>
      )}
    </div>
  );
}
