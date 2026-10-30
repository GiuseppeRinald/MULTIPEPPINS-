# MULTIPEPPINS

Tutti gli strumenti PDF in un posto solo, in stile iLovePDF, con il tema "Tramonto".
Tutto funziona **nel browser**: i file non vengono mai caricati su un server.

## Strumenti (40)

| Categoria | Strumenti |
|---|---|
| Organizza | Unisci PDF · Dividi PDF · Rimuovi pagine · Estrai pagine · Organizza PDF · Ruota PDF |
| Ottimizza | Comprimi PDF · OCR PDF · Ripara PDF · PDF in bianco e nero |
| Converti in PDF | Immagini in PDF · Scansiona in PDF · Word in PDF · Excel in PDF · PowerPoint in PDF · Testo in PDF · HTML in PDF |
| Converti da PDF | PDF in JPG/PNG · PDF in Word (con OCR) · PDF in PowerPoint · PDF in Excel (con OCR) · PDF in testo · PDF in Markdown · PDF in PDF/A (1b, 2b, 3b) |
| Modifica | Modifica PDF · Firma PDF · Filigrana · Numeri di pagina · Ritaglia PDF · Ridimensiona pagine · Più pagine per foglio · Compila moduli · Proprietà del PDF |
| Sicurezza | Proteggi PDF · Sblocca PDF · Censura PDF · Appiattisci PDF |
| Altro | Confronta PDF · Workflow (più strumenti in sequenza, salvabili) |

## Come avviarla

È un sito statico: basta servire la cartella con un qualsiasi web server, per esempio

```
python3 -m http.server 8000
```

e aprire `http://localhost:8000`. Funziona anche su GitHub Pages, Netlify, Cloudflare Pages ecc.
(Non si apre facendo doppio clic su `index.html`: i moduli JavaScript richiedono un server.)

## Struttura

- `index.html`, `css/style.css` — interfaccia
- `js/app.js` — home, pagina strumento, risultati
- `js/tools.js`, `js/tools2.js`, `js/tools3.js` — gli strumenti
- `js/pdfa.js` — conversione in PDF/A (metadati XMP, profilo sRGB, testo invisibile con carattere incorporato)
- `js/fonts.js` — caratteri: i 3 standard del PDF più Arial, Times New Roman, Courier New, Calibri, Cambria (equivalenti liberi), DejaVu e Poppins, incorporati nei PDF con accenti ed €
- `js/pptx.js` — lettore PowerPoint (forme, testi, immagini, tabelle) → PDF
- `js/editor.js` — editor visuale (modifica, firma, censura)
- `js/pages.js` — miniature e riordino pagine
- `js/layout.js` — impaginatore HTML → PDF
- `js/crypto.js` — protezione/sblocco con password (AES/RC4)
- `js/ocr.js`, `js/ocr-worker.js` — OCR con Tesseract (italiano, inglese, francese, tedesco, spagnolo)
- `vendor/` — librerie: pdf-lib, pdf.js, docx, PptxGenJS, Tesseract e dati delle lingue, profilo colore `srgb.icc` (pubblico dominio, Graeme W. Gill)

Word in PDF ed Excel in PDF scaricano al primo uso le librerie mammoth e SheetJS da CDN (serve internet).

## Non inclusi

Web in PDF da indirizzo, riassunto e traduzione con AI: richiedono un server o un servizio esterno.
