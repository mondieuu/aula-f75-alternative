# AULA F75 protokol notları (Türkçe)

Tersine mühendislikle çıkarılan USB HID protokolü, ayar bloğu, tuş kodları ve firmware yaması. Hepsi gerçek bir F75 (firmware V11.0.0) üzerinde ölçüldü.

## Protokol (tersine mühendislikle çıkarıldı)

Kablolu, `258a:010c`, usage page `ff00`, feature report 6 (519 bayt):
`[işlem, tür, 0, 1, 0, uzunluk_lo, uzunluk_hi, veri…]`. Okuma = işlem `| 0x80`.

| İşlem | Veri | Boyut |
|---|---|---|
| `03` (tür = katman 0–3) | Tuş haritası, tuş başına 4 bayt | 512 |
| `04` | Ayar bloğu, sonu `5a a5` | 128 |
| `06` | Tuş renkleri: R, G, B düzlemleri, her biri 126 bayt | 384 |
| `0a` | Efekt renk paleti, efekt × 21 bayt (7 renk) | 512 |
| `08` / `88` | **Firmware belleği. Kullanmayın, klavyeyi bozabilir.** | |

Kablosuz, `3554:fa09`, usage page `ff02`, rapor `0x13` (19 bayt):
`[komut, toplam, sıra, (katman<<4)|uzunluk, 14 bayt, sağlama]`. Sağlama = rapor kimliği dahil ilk 19 baytın toplamı.
Komutlar: `01` tuş haritası, `02` renkler, `04` ayar, `09` palet, `44` ayarı oku, `07` bağlantı durumu. Klavye her paketi geri yollayarak onaylar.

Fabrika sıfırlaması ayrı bir komut değil: AULA programı varsayılan tuş haritalarını, ayar bloğunu ve paleti normal yazma komutlarıyla gönderiyor.

Ayar bloğu: `[3]` debounce 0–4, `[9]` özel renk modu, `[10]` efekt, `[22]` Tap (0 = kapalı, açıkken hassasiyet 10–127), `[24]` uyku (×30 sn, 0 = kapalı),
`0x3a + 2×(efekt−1)`: parlaklık 0–9, sonraki bayt `hız<<4 | renk yuvası` (7 = renkli).

Ses tekerleği matris sırası 84. Normal katmanda `0700001D` iken firmware çevirmeyi ses aç/kıs, basmayı sessiz yapar.
Başka kod atanırsa basma o kodu gönderir ama çevirme hiç çalışmaz (dönüş ayrı bir matris tuşu değil).
FN katmanında (katman 1) sıra 84 serbestçe atanır: FN + basma. Test edildi.
Tarama (sıra 84'e farklı kodlar yazıp tekerlek çevrilerek): `07 00 00 00`–`1E` → ses ±; `07 00 00 1F`–`FF`, `07 01..03 ..`,
`07 00 01..03 1D`, medya (`02`), fare (`01`), ışık (`08`) ve `03`–`06`, `09` türleri → çevirme hiçbir şey göndermez.
Sonuç: dönüş yönleri tuş haritasıyla yeniden atanamıyor; firmware yamasıyla atanıyor (aşağıda).

## Firmware (Firmware sekmesi, `firmware.js`)

Sinowealth ISP yükleyicisi (SH68F90A), protokol [sinowealth-kb-tool](https://github.com/carlossless/sinowealth-kb-tool) (MIT, Karolis Stasaitis).
Yükleyiciye geçiş: kablolu klavyeye feature report 5 `[75 00 00 00 00]`. Klavye `0603:1020` olarak geri gelir.
Komutlar (report 5): `55` firmware etkin, `52 lo hi` okuma adresi, `57` yazma, `45` silme (yükleyici korunur), `5a` yeniden başlat.
Sayfalar report 6 ile 2048 bayt: okuma `72`, yazma `77`. Firmware 61440 bayt, son 4 KB yükleyici (hiç yazılmaz).
Klavye ayarları flash'ta `0xC600` adresinde durur; firmware yazılınca o andaki ayarlar da yazılır.

Tekerlek yaması (V11). Dönüş kodu `0x38BA`'da 23 baytlık blok, üç mod:

| Mod | Blok | Etki |
|---|---|---|
| Ses (fabrika) | `9009bd 302f04 74e9 8002 74ea f0 e4 a3 f0 d250 d22d 786f f6` | Tüketici kodu `E9`/`EA` |
| Parça | aynı blok, `E9`→`B5`, `EA`→`B6` | Sonraki / önceki parça |
| Işık | `900d15 e4 f0 a3 7402 302f01 14 f0 a3 a3 7408 f0 c242 128c0f` | `0D15..0D18` = `00 yön ?? 08`, `bit42` temizlenir, parlaklık rutini `0x8C0F` çağrılır (FN + ↑/↓ ile aynı rutin) |

Basma: `0x4445` (`74 xx f0`): `E2` sessiz, `CD` oynat/duraklat.
Klavyenin tuş kodu dağıtıcısı: haritadaki 4 bayt `0D18..0D15`'e yüklenir (`0D18` tür). Tür 08 → `0xA674`, `0D17` alt işlem (03 parlaklık, 04 hız), `0D16` yön.

Yazılan veri geri okunup doğrulanmadan firmware etkinleştirilmez. Doğrulama başarısız olursa klavye yükleyici modunda kalır.

Tuş kodları: `00 00 00 HID` tuş, `00 MOD HID 00` kombinasyon, `02 00 HI LO` medya, `01 BTN 01 00` fare,
`00000000` kapalı, `07000001` Win kilidi, `07000002` klavye kilidi.
