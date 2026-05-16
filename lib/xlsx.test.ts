import { describe, expect, it } from "vitest";
import type { CanonicalRecord } from "./domain";
import { buildRecordsXlsxBlob, getRecordsXlsxRows } from "./xlsx";

const baseRecord: CanonicalRecord = {
  id: "6281234567890::pkn stan",
  normalizedWhatsapp: "6281234567890",
  displayWhatsapp: "+6281234567890",
  rawWhatsapp: "081234567890",
  namaLengkap: "Ayu Lestari",
  normalizedProductName: "pkn stan",
  productName: "PKN STAN",
  totalPayment: 1000000,
  paidAmount: 1000000,
  pembayaranPertama: 1000000,
  pembayaranKedua: 0,
  receivableAmount: 0,
  pilihanPembayaran: "lunas",
  financialStatus: "paid_off",
  rawRowHash: "hash",
  firstSeenAt: "2026-05-17T00:00:00.000Z",
  lastSeenAt: "2026-05-17T00:00:00.000Z",
  lastImportId: "import",
  reviewFlags: [],
};

describe("records XLSX export", () => {
  it("uses the requested visible table columns", () => {
    const rows = getRecordsXlsxRows([baseRecord]);

    expect(rows[0]).toEqual([
      "Nama",
      "WhatsApp",
      "Produk",
      "Mekanisme",
      "Status",
      "Pembayaran 1",
      "Pembayaran 2",
      "Total Pembayaran",
      "Sisa Pembayaran",
    ]);
    expect(rows[1]).toContain("1x Pembayaran");
    expect(rows[1]).toContain("Lunas");
  });

  it("creates a valid ZIP-based workbook blob", async () => {
    const blob = buildRecordsXlsxBlob([baseRecord], new Date("2026-05-17T00:00:00.000Z"));
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(bytes.slice(0, 2)).toEqual(Uint8Array.from([0x50, 0x4b]));
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
