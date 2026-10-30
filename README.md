# MULTIPEPPINS

Tutti gli strumenti PDF in un posto solo, in stile iLovePDF, con il tema "Tramonto".
Tutto funziona **nel browser**: i file non vengono mai caricati su un server.

## Strumenti (34)

| Categoria | Strumenti |
|---|---|
| Organizza | Unisci PDF · Dividi PDF · Rimuovi pagine · Estrai pagine · Organizza PDF · Ruota PDF |
| Ottimizza | Comprimi PDF · Ripara PDF · PDF in bianco e nero |
| Converti in PDF | Immagini in PDF · Scansiona in PDF · Word in PDF · Excel in PDF · Testo in PDF · HTML in PDF |
| Converti da PDF | PDF in JPG/PNG · PDF in Word · PDF in PowerPoint · PDF in Excel · PDF in testo |
| Modifica | Modifica PDF · Firma PDF · Filigrana · Numeri di pagina · Ritaglia PDF · Ridimensiona pagine · Più pagine per foglio · Compila moduli · Proprietà del PDF |
| Sicurezza | Proteggi PDF · Sblocca PDF · Censura PDF · Appiattisci PDF |
| Altro | Confronta PDF |

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
- `js/tools.js`, `js/tools2.js` — gli strumenti
- `js/editor.js` — editor visuale (modifica, firma, censura)
- `js/pages.js` — miniature e riordino pagine
- `js/layout.js` — impaginatore HTML → PDF
- `js/crypto.js` — protezione/sblocco con password (AES/RC4)
- `vendor/` — librerie: pdf-lib, pdf.js, docx, PptxGenJS

Word in PDF ed Excel in PDF scaricano al primo uso le librerie mammoth e SheetJS da CDN (serve internet).

## Prossima fase

OCR (testo da scansioni), PowerPoint in PDF, PDF/A.
