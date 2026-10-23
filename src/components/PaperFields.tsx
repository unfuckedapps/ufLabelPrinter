import { useT } from "../i18n";
import { MEDIA_TYPES, PAPER_PRESETS } from "../lib/printers";
import type { PaperProfile } from "../lib/types";
import { Field, NumberInput, Segmented, Select, TextInput } from "./ui";

/** Editor for the physical properties of a label roll. */
export function PaperFields({
  paper,
  onChange,
}: {
  paper: PaperProfile;
  onChange: (patch: Partial<PaperProfile>) => void;
}) {
  const t = useT();
  const preset = PAPER_PRESETS.find((p) => p.widthMm === paper.widthMm && p.heightMm === paper.heightMm);

  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={t("paper.fields.name")} className="col-span-2">
        <TextInput value={paper.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label={t("paper.fields.format")} className="col-span-2">
        <Select
          value={preset?.id ?? "custom"}
          onChange={(id) => {
            const p = PAPER_PRESETS.find((x) => x.id === id);
            if (p) onChange({ widthMm: p.widthMm, heightMm: p.heightMm });
          }}
          options={[
            ...PAPER_PRESETS.map((p) => ({ value: p.id, label: p.label })),
            ...(preset ? [] : [{ value: "custom", label: t("paper.fields.custom") }]),
          ]}
        />
      </Field>
      <Field label={t("paper.fields.width")}>
        <NumberInput value={paper.widthMm} onChange={(widthMm) => onChange({ widthMm })} unit="mm" min={10} max={120} step={0.5} />
      </Field>
      <Field label={t(paper.mediaType === "continuous" ? "paper.fields.lengthPerLabel" : "paper.fields.height")}>
        <NumberInput value={paper.heightMm} onChange={(heightMm) => onChange({ heightMm })} unit="mm" min={10} max={500} step={0.5} />
      </Field>
      <Field label={t("paper.fields.mediaType")} hint={t(`media.${paper.mediaType}.hint`)} className="col-span-2">
        <Segmented
          value={paper.mediaType}
          onChange={(mediaType) => onChange({ mediaType })}
          options={MEDIA_TYPES.map((m) => ({ value: m, label: t(`media.${m}.label`) }))}
        />
      </Field>
      {paper.mediaType !== "continuous" && (
        <>
          <Field label={t(paper.mediaType === "gap" ? "paper.fields.gapHeight" : "paper.fields.markHeight")}>
            <NumberInput value={paper.gapMm} onChange={(gapMm) => onChange({ gapMm })} unit="mm" min={0} max={20} step={0.5} />
          </Field>
          <Field label={t("paper.fields.gapOffset")} hint={t("paper.fields.gapOffsetHint")}>
            <NumberInput
              value={paper.gapOffsetMm}
              onChange={(gapOffsetMm) => onChange({ gapOffsetMm })}
              unit="mm"
              min={-10}
              max={10}
              step={0.5}
            />
          </Field>
        </>
      )}
    </div>
  );
}
