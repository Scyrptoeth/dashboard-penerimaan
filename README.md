# Dashboard Penerimaan

Dashboard lokal untuk membaca CSV penerimaan Bimbel Persiapantubel, menghitung status finansial, dedupe snapshot berdasarkan `normalizedWhatsapp + normalizedProductName`, dan menyimpan state di browser.

## Fitur MVP

- Import CSV dengan auto-detect delimiter comma/semicolon.
- Normalisasi WhatsApp, product name, tanggal, dan nominal rupiah.
- Status finansial dihitung dari nilai pembayaran, bukan dari `statusPembayaran`.
- Preview import sebelum merge.
- Canonical records tanpa duplikasi snapshot.
- KPI penerimaan, piutang, lunas, dan exception.
- Tabel records, piutang, produk, exceptions, dan import history.
- Local browser persistence dengan export/import JSON.
- Undo import terakhir dan clear local data.

## Development

```bash
npm install
npm run dev
```

Verifikasi utama:

```bash
npm test
npm run typecheck
npm run build
```

CSV sumber di folder `bahan/` diabaikan oleh Git karena dapat berisi data siswa dan pembayaran.
