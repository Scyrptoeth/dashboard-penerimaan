import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  calculateFinancialStatus,
  createEmptyState,
  detectDelimiter,
  mergeImportPreview,
  normalizeProductName,
  normalizeWhatsapp,
  parseCsvText,
  parseDate,
  parseMoney,
  validateImportedState,
} from "./domain";

const HEADER =
  "whatsapp,namaLengkap,productName,totalPayment,tanggal,pilihanPembayaran,pembayaranPertama,pembayaranKedua,vouchers,statusPembayaran,jenisPendaftaran,kolektif";

function csv(rows: string[]) {
  return [HEADER, ...rows].join("\n");
}

describe("CSV parsing", () => {
  it("detects comma and semicolon delimiters", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
  });

  it("drops fully empty rows and accepts trailing empty headers", () => {
    const text = [
      "no;whatsapp;namaLengkap;productName;totalPayment;tanggal;pilihanPembayaran;pembayaranPertama;pembayaranKedua;statusPembayaran;",
      "1;081234567890;Ayu;PKN STAN;100000;21/03/26;cicil;50000;0;selesai;",
      ";;;;;;;;;;",
    ].join("\n");

    const parsed = parseCsvText(text, "semicolon.csv", "import_test", "2026-05-16T00:00:00.000Z");

    expect(parsed.delimiter).toBe(";");
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.parsedDate).toBe("2026-03-21");
  });
});

describe("normalization", () => {
  it("normalizes common WhatsApp formats", () => {
    expect(normalizeWhatsapp("081234567890").normalized).toBe("6281234567890");
    expect(normalizeWhatsapp("81234567890").normalized).toBe("6281234567890");
    expect(normalizeWhatsapp("6281234567890").normalized).toBe("6281234567890");
  });

  it("flags ambiguous or short WhatsApp values", () => {
    expect(normalizeWhatsapp("8.1988E+11").flags).toContain("ambiguous_scientific_whatsapp");
    expect(normalizeWhatsapp("819888741").flags).toContain("short_whatsapp");
  });

  it("normalizes product names for keying", () => {
    expect(normalizeProductName(" PKN  STAN ORBIT FOCUS ").normalized).toBe(
      "pkn stan orbit focus",
    );
  });
});

describe("money and date", () => {
  it("parses IDR-like values and tracks blanks", () => {
    expect(parseMoney("Rp1.149.012").amount).toBe(1149012);
    expect(parseMoney("").wasBlank).toBe(true);
    expect(parseMoney("1E+5").invalid).toBe(true);
  });

  it("parses both date formats", () => {
    expect(parseDate("21/03/2026")).toBe("2026-03-21");
    expect(parseDate("21/03/26")).toBe("2026-03-21");
  });
});

describe("financial status", () => {
  it("derives status without trusting raw payment status", () => {
    expect(
      calculateFinancialStatus({
        totalPayment: 100000,
        paidAmount: 100000,
        pilihanPembayaran: "lunas",
      }),
    ).toBe("paid_off");

    expect(
      calculateFinancialStatus({
        totalPayment: 100000,
        paidAmount: 50000,
        pilihanPembayaran: "cicil",
      }),
    ).toBe("installment_receivable");

    expect(
      calculateFinancialStatus({
        totalPayment: 100000,
        paidAmount: 50000,
        pilihanPembayaran: "lunas",
      }),
    ).toBe("underpaid_lunas_review");

    expect(
      calculateFinancialStatus({
        totalPayment: 100000,
        paidAmount: 0,
        pilihanPembayaran: "cicil",
      }),
    ).toBe("excluded_no_payment");
  });
});

describe("dedupe and merge", () => {
  it("keeps highest paid candidate within one upload", () => {
    const text = csv([
      "081234567890,Ayu,PKN STAN,100000,21/03/2026,cicil,0,0,,proses,sendiri,",
      "081234567890,Ayu,PKN STAN,100000,21/03/2026,cicil,50000,0,,selesai,sendiri,",
    ]);

    const preview = buildImportPreview(text, "first.csv", createEmptyState("2026-05-16T00:00:00.000Z"), "2026-05-16T00:00:00.000Z");

    expect(preview.summary.newRecordCount).toBe(1);
    expect(preview.deltas[0]?.candidate.paidAmount).toBe(50000);
  });

  it("classifies improvements and never replaces with lower paid snapshots", () => {
    const initial = buildImportPreview(
      csv(["081234567890,Ayu,PKN STAN,100000,21/03/2026,cicil,50000,0,,selesai,sendiri,"]),
      "first.csv",
      createEmptyState("2026-05-16T00:00:00.000Z"),
      "2026-05-16T00:00:00.000Z",
    );
    const state = mergeImportPreview(createEmptyState("2026-05-16T00:00:00.000Z"), initial, "2026-05-16T00:00:00.000Z");

    const improved = buildImportPreview(
      csv(["081234567890,Ayu,PKN STAN,100000,22/03/2026,cicil,50000,50000,,selesai,sendiri,"]),
      "second.csv",
      state,
      "2026-05-17T00:00:00.000Z",
    );
    expect(improved.deltas[0]?.kind).toBe("became_paid_off");

    const merged = mergeImportPreview(state, improved, "2026-05-17T00:00:00.000Z");
    const lower = buildImportPreview(
      csv(["081234567890,Ayu,PKN STAN,100000,23/03/2026,cicil,25000,0,,proses,sendiri,"]),
      "third.csv",
      merged,
      "2026-05-18T00:00:00.000Z",
    );

    expect(lower.deltas[0]?.kind).toBe("unchanged");
    expect(lower.deltas[0]?.ignoredReason).toContain("lower");
  });

  it("keeps no-payment prospects only until the same WhatsApp becomes paid", () => {
    const initialPreview = buildImportPreview(
      csv(["081234567890,Ayu,PKN STAN,100000,21/03/2026,cicil,,0,,proses,sendiri,"]),
      "first.csv",
      createEmptyState("2026-05-16T00:00:00.000Z"),
      "2026-05-16T00:00:00.000Z",
    );
    const stateWithProspect = mergeImportPreview(
      createEmptyState("2026-05-16T00:00:00.000Z"),
      initialPreview,
      "2026-05-16T00:00:00.000Z",
    );

    expect(Object.keys(stateWithProspect.noPaymentProspects)).toEqual(["6281234567890"]);

    const paidPreview = buildImportPreview(
      csv(["081234567890,Ayu,PKN STAN VOL. 2,100000,22/03/2026,cicil,50000,0,,selesai,sendiri,"]),
      "second.csv",
      stateWithProspect,
      "2026-05-17T00:00:00.000Z",
    );
    const paidState = mergeImportPreview(stateWithProspect, paidPreview, "2026-05-17T00:00:00.000Z");

    expect(Object.keys(paidState.noPaymentProspects)).toEqual([]);
  });

  it("groups repeated no-payment rows by WhatsApp only", () => {
    const preview = buildImportPreview(
      csv([
        "081234567890,Ayu,PKN STAN,100000,21/03/2026,cicil,0,0,,proses,sendiri,",
        "081234567890,Ayu Pratiwi,BPKP,200000,22/03/2026,cicil,0,0,,proses,sendiri,",
      ]),
      "first.csv",
      createEmptyState("2026-05-16T00:00:00.000Z"),
      "2026-05-16T00:00:00.000Z",
    );
    const state = mergeImportPreview(
      createEmptyState("2026-05-16T00:00:00.000Z"),
      preview,
      "2026-05-16T00:00:00.000Z",
    );

    expect(Object.keys(state.noPaymentProspects)).toHaveLength(1);
    expect(state.noPaymentProspects["6281234567890"]?.productName).toBe("BPKP");
  });
});

describe("state transport", () => {
  it("validates schema-versioned state", () => {
    const state = createEmptyState("2026-05-16T00:00:00.000Z");
    expect(validateImportedState(JSON.parse(JSON.stringify(state))).schemaVersion).toBe(1);
    expect(() => validateImportedState({ ...state, schemaVersion: 999 })).toThrow();
  });

  it("hydrates default WA templates for legacy settings", () => {
    const state = createEmptyState("2026-05-16T00:00:00.000Z");
    const legacyState = {
      ...state,
      settings: {
        productAliases: {},
      },
    };

    const imported = validateImportedState(legacyState);

    expect(imported.settings.waMessageTemplates).toHaveLength(3);
    expect(imported.settings.waMessageTemplates[0]?.name).toBe("Pengingat pelunasan sopan");
    expect(imported.settings.waMessageTemplates[2]?.name).toBe("Follow-up belum bayar");
  });

  it("adds missing built-in WA templates to existing settings", () => {
    const state = createEmptyState("2026-05-16T00:00:00.000Z");
    const existingState = {
      ...state,
      settings: {
        ...state.settings,
        waMessageTemplates: state.settings.waMessageTemplates.slice(0, 2),
      },
    };

    const imported = validateImportedState(existingState);

    expect(imported.settings.waMessageTemplates.map((template) => template.id)).toContain(
      "default-no-payment-follow-up",
    );
  });

  it("hydrates missing no-payment prospects for legacy state", () => {
    const state = createEmptyState("2026-05-16T00:00:00.000Z");
    const legacyState = { ...state };
    delete (legacyState as Partial<typeof state>).noPaymentProspects;

    const imported = validateImportedState(legacyState);

    expect(imported.noPaymentProspects).toEqual({});
  });
});
