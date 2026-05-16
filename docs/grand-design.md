# Grand Design - Dashboard Penerimaan

Tanggal: 2026-05-16  
Status: Ready for development planning, belum scaffold aplikasi.

## 1. Ringkasan Produk

Dashboard Penerimaan adalah website dashboard lokal untuk mengubah file CSV penerimaan Bimbel Persiapantubel menjadi data penerimaan yang mudah dipahami, bisa diupdate berulang, dan bisa diekspor sebagai state JSON.

Produk ini bukan sekadar CSV viewer. Produk ini harus menjadi sistem rekonsiliasi ringan:

- Membaca snapshot CSV berulang.
- Menormalisasi identitas siswa dan produk.
- Menghitung status finansial secara mandiri.
- Menyimpan canonical record yang tidak redundant.
- Menampilkan hanya perubahan bermakna ketika CSV baru diupload.
- Memberikan insight penerimaan, piutang, dan pengecualian data.

## 2. Kriteria Sukses

MVP dianggap berhasil jika pengguna dapat:

- Upload CSV penerimaan langsung di browser.
- Melihat ringkasan penerimaan, lunas, piutang, dan jumlah siswa berbayar.
- Melihat daftar siswa berbayar tanpa baris pendaftaran yang belum membayar.
- Upload CSV berikutnya dan melihat hanya data baru atau perubahan pembayaran.
- Menyimpan state di browser.
- Export JSON dan import JSON untuk dipakai di browser/perangkat lain.
- Menemukan data bermasalah melalui exception review.

## 3. Scope MVP

In scope:

- CSV upload.
- Auto-detect delimiter comma dan semicolon.
- Mapping kolom wajib.
- Normalisasi WhatsApp dan product name.
- Perhitungan status finansial dashboard.
- Dedupe `normalizedWhatsapp + normalizedProductName`.
- Import preview dan import summary.
- Local browser persistence.
- Export/import JSON versioned state.
- Dashboard KPI, table detail, filters, product breakdown, receivable view, exception view.

Out of scope untuk MVP:

- Login multi-user.
- Database cloud dan realtime sync.
- Integrasi payment gateway.
- Edit data yang menulis balik ke CSV sumber.
- Role-based access control.
- Deploy production cloud.

## 4. Persona dan Workflow

Persona utama: admin/owner Bimbel Persiapantubel yang perlu mengecek update penerimaan dan piutang cepat dari CSV.

Workflow utama:

1. Pengguna membuka Dashboard Penerimaan.
2. Website memuat state lokal dari browser jika ada.
3. Pengguna upload CSV penerimaan.
4. Website parse dan validasi CSV.
5. Website menampilkan import preview:
   - total rows.
   - paid rows.
   - excluded no payment.
   - new records.
   - improved payment.
   - unchanged.
   - exceptions.
6. Pengguna merge import.
7. Dashboard memperbarui KPI dan tabel.
8. Pengguna export JSON bila ingin membagikan state.
9. Pengguna lain import JSON untuk melihat state yang sama.

## 5. Data Source

Folder bahan:

`/Users/persiapantubel/Desktop/codex/persiapantubel/Dashboard Penerimaan/bahan`

Kolom fokus:

- `whatsapp`
- `namaLengkap`
- `productName`
- `totalPayment`
- `tanggal`
- `pilihanPembayaran`
- `pembayaranPertama`
- `pembayaranKedua`
- `vouchers`
- `statusPembayaran`
- `jenisPendaftaran`
- `kolektif`

Kolom lain boleh disimpan sebagai raw metadata tetapi tidak menjadi inti MVP.

Parser harus membuang row kosong penuh, header kosong, dan kolom tambahan seperti `no` tanpa gagal.

## 6. Normalisasi

`normalizedWhatsapp`:

- Ambil digit saja.
- Jika diawali `0`, ubah menjadi `62` + nomor tanpa nol awal.
- Jika diawali `8`, ubah menjadi `62` + nomor.
- Jika diawali `62`, pertahankan.
- Jika kosong atau terlalu pendek, masukkan exception review.
- Jika raw WhatsApp mengandung scientific notation atau karakter yang membuat nomor ambigu, masukkan manual review.

`normalizedProductName`:

- Trim whitespace.
- Collapse multiple spaces.
- Casefold/lowercase untuk key.
- Simpan display name dari record terbaik.

Money:

- Parse sebagai integer rupiah.
- Treat blank sebagai 0 untuk kalkulasi paid amount, tetapi simpan flag raw blank untuk audit.
- Jika tidak bisa diparse, tandai `needs_review`.

Tanggal:

- Parse `dd/mm/yyyy` dan `dd/mm/yy`.
- Simpan raw date string dan parsed date bila valid.

Key canonical:

```text
normalizedWhatsapp + "::" + normalizedProductName
```

## 7. Status Finansial

Jangan memakai `statusPembayaran` sebagai sumber kebenaran lunas/piutang. Simpan sebagai `rawPaymentStatus` untuk audit.

Hitung:

```text
paidAmount = pembayaranPertama + pembayaranKedua
receivableAmount = max(totalPayment - paidAmount, 0)
```

Status:

- `excluded_no_payment`: `paidAmount <= 0`.
- `paid_off`: `paidAmount == totalPayment` dan `totalPayment > 0`.
- `overpaid_review`: `paidAmount > totalPayment`.
- `installment_receivable`: `pilihanPembayaran = cicil`, `paidAmount > 0`, dan `paidAmount < totalPayment`.
- `underpaid_lunas_review`: `pilihanPembayaran = lunas`, `paidAmount > 0`, dan `paidAmount < totalPayment`.
- `needs_review`: required field kosong, product kosong, money invalid, atau plan tidak dikenali.

Record `excluded_no_payment` tidak tampil di dashboard siswa berbayar, tetapi tetap dihitung di import summary.

Revenue dashboard memakai `paidAmount`, bukan `totalPayment`, agar cicilan dan pembayaran parsial tidak dibaca sebagai penerimaan penuh.

## 8. Dedupe dan Merge

CSV diperlakukan sebagai snapshot, bukan ledger transaksi bersih.

Saat import:

1. Parse semua row.
2. Normalisasi row menjadi candidate.
3. Buang candidate `excluded_no_payment` dari canonical table, tetapi catat di import summary.
4. Group candidate berdasarkan canonical key.
5. Pilih candidate terbaik per key:
   - paid amount terbesar.
   - jika paid amount sama, pilih raw status audit yang lebih informatif dengan urutan `selesai`, `verifikasi`, `proses`, `dibatalkan`.
   - jika paid amount sama, pilih data dengan identitas dan metadata lebih lengkap.
   - jika masih sama, pilih row terakhir dalam upload.
6. Bandingkan candidate terbaik dengan canonical state existing.
7. Klasifikasikan delta:
   - `new_record`
   - `payment_improved`
   - `became_paid_off`
   - `metadata_changed`
   - `unchanged`
   - `needs_review`
8. Merge hanya record baru atau yang lebih baik.

Aturan jangan dilakukan:

- Jangan append semua raw rows ke tabel utama.
- Jangan mengganti record berbayar dengan row baru yang paid amount lebih rendah.
- Jangan menghapus record lama hanya karena tidak muncul di upload terbaru.
- Jangan menghitung row `dibatalkan` sebagai peserta aktif ketika ada record berbayar yang lebih baik untuk key sama.

## 9. State JSON

Gunakan versioned state.

```ts
type DashboardState = {
  schemaVersion: 1;
  exportedAt?: string;
  appName: "Dashboard Penerimaan";
  records: Record<string, CanonicalRecord>;
  imports: ImportBatch[];
  settings: DashboardSettings;
};
```

Canonical record minimal:

```ts
type CanonicalRecord = {
  id: string;
  normalizedWhatsapp: string;
  displayWhatsapp: string;
  namaLengkap: string;
  normalizedProductName: string;
  productName: string;
  totalPayment: number;
  paidAmount: number;
  pembayaranPertama: number;
  pembayaranKedua: number;
  receivableAmount: number;
  pilihanPembayaran: "lunas" | "cicil" | "unknown";
  financialStatus: string;
  tanggal?: string;
  parsedDate?: string;
  vouchers?: string;
  jenisPendaftaran?: string;
  rawPaymentStatus?: string;
  rawRowHash?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastImportId: string;
  sourceFileName?: string;
  reviewFlags: string[];
};
```

Import batch minimal:

```ts
type ImportBatch = {
  id: string;
  importedAt: string;
  fileName: string;
  fileHash: string;
  rowCount: number;
  paidRowCount: number;
  excludedNoPaymentCount: number;
  newRecordCount: number;
  updatedRecordCount: number;
  unchangedCount: number;
  exceptionCount: number;
};
```

## 10. UI/UX Direction

Product type: operational finance/admin dashboard untuk pendidikan.

Target feel:

- Tenang, presisi, cepat discan.
- Padat tetapi tidak sesak.
- Tidak seperti landing page, tidak pakai hero marketing.
- Tidak memakai blue-purple gradient, generic Inter-only look, atau card grid dekoratif.

Layout utama:

- Top utility bar: app title, last import, import CSV, import JSON, export JSON.
- KPI strip: total penerimaan, total piutang, siswa lunas, siswa cicilan, exception.
- Main workspace:
  - left or top filters.
  - table canonical records.
  - right/secondary panel untuk import summary atau selected record.
- Tabs:
  - Overview.
  - Records.
  - Piutang.
  - Produk.
  - Exceptions.
  - Import History.

Accessibility:

- Semua control file upload harus punya label.
- Button icon harus punya accessible name.
- Focus ring terlihat.
- Minimum target 44px.
- Table harus mendukung keyboard navigation dan visible sort state.
- Warna status jangan hanya red/green; gunakan label dan icon.

Data visualization:

- Bar chart produk berdasarkan paid amount.
- Stacked status per product.
- Receivable list lebih penting daripada chart dekoratif.
- Empty state harus jelas untuk no data dan no changes.

Visual recommendation:

- Font: `DM Sans` untuk UI dan `DM Mono` untuk angka/ID, atau pasangan lokal setara via `next/font`.
- Background: off-white hangat netral.
- Text: near-black.
- Accent: amber/gold terbatas untuk financial focus.
- Semantic colors hanya untuk status: red error, green success, amber warning, neutral info.
- Radius konsisten 6-8px untuk controls, bukan rounded besar di semua tempat.

## 11. Arsitektur Teknis Masa Depan

Framework target: Next.js/React, tetapi belum dibuat pada sesi ini.

Guardrails:

- Sebelum coding Next.js, baca guide relevan di `node_modules/next/dist/docs/` sesuai AGENTS.md proyek.
- Default ke Server Components.
- Gunakan `'use client'` hanya untuk komponen yang butuh state browser, file input, localStorage/IndexedDB, drag-drop, charts, dan interaksi table.
- Parsing CSV dan state merge berjalan di client karena data bersumber dari file lokal user.
- Pertimbangkan Web Worker jika CSV menjadi besar.

Library yang layak dipertimbangkan saat implementasi:

- CSV parsing: Papa Parse atau parser browser-safe sejenis.
- Schema validation: Zod.
- Table: TanStack Table jika kebutuhan sorting/filtering kompleks.
- Chart: Recharts atau visx jika benar-benar dibutuhkan.
- Persistence: localStorage untuk MVP kecil, IndexedDB jika state mulai besar.

Catatan: jangan install dependency sampai sesi implementasi disetujui.

## 12. Test Plan

Unit tests:

- delimiter detection.
- column mapping.
- WhatsApp normalization.
- money parsing.
- status financial calculation.
- candidate best-record selection.
- import delta classification.
- JSON import/export schema version.

Fixture tests:

- comma CSV.
- semicolon CSV.
- CSV dengan kolom `no`.
- CSV tanpa `kolektif`.
- row no payment.
- cicil belum lunas.
- cicil lunas.
- lunas kurang bayar.
- overpaid.
- duplicate key dalam satu upload.
- upload kedua dengan payment improved.

UI verification:

- Empty state.
- Upload preview.
- Merge result.
- Filters.
- Responsive desktop and mobile.
- Keyboard navigation.
- JSON export/import.

## 13. Risiko dan Mitigasi

Risiko: CSV adalah snapshot berulang sehingga raw append menyebabkan duplikasi besar.  
Mitigasi: canonical record per `normalizedWhatsapp + normalizedProductName`.

Risiko: `statusPembayaran` raw tidak cocok dengan status finansial.  
Mitigasi: hitung status sendiri dan simpan raw status sebagai audit.

Risiko: localStorage terbatas.  
Mitigasi: MVP bisa mulai localStorage, tetapi state schema harus bisa dipindah ke IndexedDB.

Risiko: product name berubah antar periode.  
Mitigasi: product normalization dan review mapping di fase berikutnya.

Risiko: data sensitif siswa berada di browser.  
Mitigasi: beri affordance clear local data, export/import eksplisit, dan hindari upload cloud.

## 14. Recommended Next Actions

1. Konfirmasi MVP final: localStorage atau langsung IndexedDB.
2. Definisikan product mapping jika nama produk lama dan baru perlu digabung atau tetap terpisah.
3. Tentukan apakah import preview perlu approval manual sebelum merge.
4. Buat fixture CSV kecil dari pola data nyata.
5. Scaffold Next.js hanya setelah user menyetujui fase implementasi.
6. Implement parser, normalizer, and financial engine lebih dulu sebelum UI penuh.
7. Bangun dashboard UI setelah engine punya test coverage.
