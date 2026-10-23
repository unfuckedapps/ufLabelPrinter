// pdf.js needs its standard fonts for PDFs that reference Helvetica & co. without
// embedding them (DHL labels do), and CMaps for CJK text. Served from /pdfjs/.
import { cpSync } from "node:fs";

const from = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const to = new URL("../public/pdfjs/", import.meta.url);

for (const dir of ["standard_fonts", "cmaps"]) {
  cpSync(new URL(`${dir}/`, from), new URL(`${dir}/`, to), { recursive: true });
}
