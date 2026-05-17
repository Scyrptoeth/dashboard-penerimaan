import { describe, expect, it } from "vitest";
import type { CanonicalRecord } from "./domain";
import {
  buildWaMeDraft,
  buildWaMeLink,
  formatWaMeBatchLine,
  renderWaTemplate,
} from "./wa-me";

const baseRecord: CanonicalRecord = {
  id: "6281234567890::pkn-stan",
  normalizedWhatsapp: "6281234567890",
  displayWhatsapp: "+6281234567890",
  rawWhatsapp: "081234567890",
  namaLengkap: "Ayu Pratiwi",
  normalizedProductName: "pkn stan",
  productName: "PKN STAN",
  totalPayment: 1000000,
  paidAmount: 400000,
  pembayaranPertama: 400000,
  pembayaranKedua: 0,
  receivableAmount: 600000,
  pilihanPembayaran: "cicil",
  financialStatus: "installment_receivable",
  rawRowHash: "hash",
  firstSeenAt: "2026-05-17T00:00:00.000Z",
  lastSeenAt: "2026-05-17T00:00:00.000Z",
  lastImportId: "import",
  reviewFlags: [],
};

describe("wa.me helpers", () => {
  it("renders supported placeholders and keeps unknown placeholders literal", () => {
    const rendered = renderWaTemplate(
      "Halo {nama}, produk {produk}, sisa {sisaPembayaran}, unknown {kode}.",
      baseRecord,
    );

    expect(rendered.message).toContain("Halo Ayu Pratiwi");
    expect(rendered.message).toContain("PKN STAN");
    expect(rendered.message).toContain("Rp");
    expect(rendered.message).toContain("{kode}");
    expect(rendered.unknownPlaceholders).toEqual(["kode"]);
  });

  it("builds encoded wa.me links", () => {
    const link = buildWaMeLink("6281234567890", "Halo Ayu & tim\nKonfirmasi #1");

    expect(link).toBe(
      "https://wa.me/6281234567890?text=Halo%20Ayu%20%26%20tim%0AKonfirmasi%20%231",
    );
  });

  it("blocks drafts with invalid WhatsApp numbers", () => {
    const draft = buildWaMeDraft(
      {
        ...baseRecord,
        normalizedWhatsapp: "819888741",
        reviewFlags: ["short_whatsapp"],
      },
      "Halo {nama}",
    );

    expect(draft.ok).toBe(false);
    expect(draft.link).toBe("");
    expect(draft.reasons.join(" ")).toContain("WhatsApp");
  });

  it("formats batch copy lines with recipient context", () => {
    const draft = buildWaMeDraft(baseRecord, "Halo {nama}");

    expect(formatWaMeBatchLine(draft)).toBe(
      "Ayu Pratiwi | +6281234567890 | https://wa.me/6281234567890?text=Halo%20Ayu%20Pratiwi",
    );
  });
});
