# Data Audit - 2026-05-16

Audit ini memakai folder:

`/Users/persiapantubel/Desktop/codex/persiapantubel/Dashboard Penerimaan/bahan`

## Ringkasan

- File CSV: 61.
- Total baris terbaca: 11.749.
- Total baris non-kosong: sekitar 11.528.
- Encoding: semua terbaca sebagai `utf-8-sig`.
- Delimiter: 59 file comma, 2 file semicolon.
- File semicolon: `penerimaan (23).csv` dan `penerimaan (96).csv`.
- Variasi schema: 60 file dengan 19 kolom standar, 1 file dengan kolom tambahan awal `no` dan trailing header kosong.
- Status raw `statusPembayaran`: `selesai`, `proses`, `dibatalkan`, kosong, `verifikasi`.
- Pilihan pembayaran pada baris non-kosong: `lunas`, `cicil`.
- Baris tanpa `pembayaranPertama` atau bernilai 0: 2.516.
- Baris `pembayaranKedua` kosong: 240.
- Baris `pembayaranKedua` bernilai 0: 10.762.
- Kolom jadwal `waktuKelas`, `waktuSimulasi`, `mulaiKelas`, `zonaWaktu`, dan `jadwalUjian` kosong di semua row audit.

## Variasi Schema

Header mayoritas:

```text
whatsapp,namaLengkap,pendidikan,productName,waktuKelas,waktuSimulasi,mulaiKelas,zonaWaktu,jadwalUjian,totalPayment,tanggal,pilihanPembayaran,pembayaranPertama,pembayaranKedua,vouchers,statusPembayaran,jenisPendaftaran,alamat,kolektif
```

Variasi yang ditemukan:

- Delimiter semicolon.
- Kolom awal tambahan `no`.
- Header trailing kosong.
- Baris kosong penuh di `penerimaan (96).csv`, misalnya pola `;;;;;;;;;;;;;;;;;;;`.

Implikasi desain:

- Parser harus auto-detect delimiter comma vs semicolon.
- Parser harus menerima kolom tambahan.
- Parser harus membuang header kosong dan drop row kosong penuh.
- Parser harus menormalisasi nama kolom dan mengabaikan kolom yang tidak dipakai tanpa gagal.
- Validasi harus melaporkan missing required columns, bukan crash.

## Snapshot Terbaru

File:

`penerimaan - 2026-05-16T211644.591.csv`

Hasil audit:

- Total rows: 280.
- Unique paid keys: 212.
- Row status hasil kalkulasi:
  - `paid_off`: 160 rows.
  - `installment_receivable`: 55 rows.
  - `excluded_no_payment`: 65 rows.
- Unique canonical status:
  - `paid_off`: 157 records.
  - `installment_receivable`: 55 records.
- Estimasi penerimaan unique paid: Rp219.517.834.
- Estimasi piutang unique paid: Rp30.782.830.

Produk di snapshot terbaru berdasarkan paid amount:

- PKN STAN ORBIT FOCUS VOL. 2: Rp207.977.220.
- BPKP STELLAR PREP VOL. 2: Rp11.190.614.
- CHARITY TO SPMB TB 2026: Rp425.000.

## Produk Yang Terdeteksi

Ada 5 nilai `productName` pada baris non-kosong:

- PKN STAN ORBIT FOCUS.
- PKN STAN ORBIT FOCUS VOL. 2.
- CHARITY TO SPMB TB 2026.
- BPKP STELLAR PREP 2026.
- BPKP STELLAR PREP VOL. 2.

Implikasi desain:

- Product normalization harus case-insensitive dan trim whitespace.
- Dashboard harus menyimpan display product original terbaik.
- Baris product kosong masuk exception review.

## Tanggal dan Identitas

Tanggal memakai dua format:

- `dd/mm/yyyy`: mayoritas row.
- `dd/mm/yy`: sebagian row, misalnya `21/03/26`.

Implikasi desain:

- Parser tanggal harus menerima dua format tersebut.
- Simpan tanggal raw dan tanggal parsed jika parsing berhasil.

WhatsApp harus diperlakukan sebagai string:

- Jangan parse sebagai number.
- Nomor pendek/anomali harus masuk review, misalnya `819888741` atau `811632910`.
- Scientific notation seperti `8.8101E+11` harus masuk manual review karena raw data sudah ambigu.

## Pola Duplikasi

CSV adalah snapshot berulang, bukan ledger bersih.

Temuan:

- Unique WhatsApp: 226.
- WhatsApp dengan multiple rows: 221.
- Kombinasi `whatsapp + productName` dengan multiple rows: 371.
- Snapshot terbaru punya 223 unique `whatsapp + productName`, 41 key duplikat, dan 98 row yang masuk key duplikat.

Contoh progres untuk key yang sama:

- `6285743967958 + pkn stan orbit focus vol. 2` berubah dari paid 0 menjadi paid 1.049.012.
- `6283846271096 + pkn stan orbit focus vol. 2` berubah dari paid 0 menjadi paid 574.506.
- Beberapa key muncul puluhan sampai ratusan kali di file berbeda.

Implikasi desain:

- Jangan append semua row upload menjadi tabel utama.
- Simpan canonical record per `normalizedWhatsapp + normalizedProductName`.
- Simpan import batch dan raw row untuk audit terbatas.
- Delta detection harus membedakan unchanged, new, improved payment, changed metadata, and needs review.
- Raw status seperti `dibatalkan` tetap berguna untuk audit trail, tetapi jangan dihitung sebagai status finansial.

## Keputusan Kalkulasi

Sumber kebenaran status finansial:

- `totalPayment`
- `pilihanPembayaran`
- `pembayaranPertama`
- `pembayaranKedua`

`statusPembayaran` disimpan sebagai raw status audit, bukan status finansial dashboard.

Status finansial yang disarankan:

- `paid_off`
- `installment_receivable`
- `underpaid_lunas_review`
- `overpaid_review`
- `needs_review`
- `excluded_no_payment`

Untuk revenue dashboard, pakai `paidAmount` yang sudah dihitung, bukan `totalPayment`, karena banyak row cicilan/partial tetap punya raw status `selesai`.

## Risiko Data

- Nomor WhatsApp mungkin tidak konsisten formatnya: `08`, `8`, `62`, atau karakter lain.
- Beberapa nomor WhatsApp sudah rusak/ambigu dalam CSV, termasuk scientific notation.
- Nama lengkap bisa berubah kapitalisasi atau ejaan.
- Product name versi lama dan versi baru bisa tampak mirip tetapi bisnisnya berbeda.
- `pembayaranPertama` atau `pembayaranKedua` bernilai 0 bisa berarti belum bayar; blank dan 0 harus dibedakan di raw audit tetapi dapat sama-sama menjadi 0 untuk kalkulasi paid amount.
- `statusPembayaran` raw tidak cukup aman untuk menentukan lunas/piutang.
- `tanggal` adalah tanggal transaksi/pendaftaran, bukan tanggal upload.

## Rekomendasi Implementasi

- Pakai library CSV parser yang stabil di browser.
- Gunakan schema validation untuk required columns.
- Simpan versioned state JSON.
- Tampilkan import preview sebelum merge.
- Berikan undo import terakhir.
- Berikan exception review untuk product kosong, payment tidak valid, overpaid, dan mismatch plan.
