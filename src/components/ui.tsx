import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110 shadow-sm",
  secondary: "bg-panel text-ink border border-line hover:bg-sunken",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
  danger: "bg-panel text-err border border-line hover:bg-err hover:text-white hover:border-err",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  icon,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: ReactNode;
}) {
  const sizes = {
    sm: "h-7 px-2.5 text-xs gap-1.5",
    md: "h-8 px-3 gap-2",
    lg: "h-11 px-5 text-[15px] gap-2.5 font-semibold",
  };
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center rounded-md font-medium transition select-none disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

const INPUT =
  "h-8 w-full rounded-md border border-line bg-panel px-2.5 text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT} ${props.className ?? ""}`} />;
}

function parseNumber(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() === "" || Number.isNaN(n) ? null : n;
}

function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** Accepts German decimal commas; commits on blur or Enter so typing is never interrupted. */
export function NumberInput({
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(formatNumber(value));
  useEffect(() => setText(formatNumber(value)), [value]);

  const commit = (raw: string) => {
    let n = parseNumber(raw);
    if (n === null) return setText(formatNumber(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(formatNumber(n));
    if (n !== value) onChange(n);
  };

  return (
    <div className="relative">
      <input
        className={`${INPUT} tabular ${unit ? "pr-9" : ""}`}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = e.key === "ArrowUp" ? step : -step;
            commit(formatNumber((parseNumber(e.currentTarget.value) ?? value) + delta));
          }
        }}
      />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-faint">
          {unit}
        </span>
      )}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select className={`${INPUT} appearance-auto`} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
}) {
  return (
    <div className="flex rounded-md border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-[5px] px-2 text-xs font-medium transition ${
            o.value === value ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 text-left"
    >
      <span
        className={`mt-0.5 flex h-[18px] w-8 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? "bg-accent" : "bg-line"
        }`}
      >
        <span
          className={`size-3.5 rounded-full bg-white shadow transition ${checked ? "translate-x-3.5" : ""}`}
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] text-ink">{label}</span>
        {hint && <span className="text-[11px] leading-snug text-faint">{hint}</span>}
      </span>
    </button>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wider text-faint uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "err" | "idle" | "busy" }) {
  const colors = {
    ok: "bg-ok",
    warn: "bg-warn",
    err: "bg-err",
    idle: "bg-faint",
    busy: "bg-accent animate-pulse",
  };
  return <span className={`inline-block size-2 shrink-0 rounded-full ${colors[tone]}`} />;
}
