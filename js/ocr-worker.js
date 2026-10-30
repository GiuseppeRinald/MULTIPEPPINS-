// MULTIPEPPINS — worker OCR: usa il motore Tesseract (WebAssembly) senza bloccare la pagina
/* global TesseractCore */
let TessModule = null;
let api = null;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      let lastErr;
      for (const url of msg.coreUrls) {
        try { importScripts(url); break; } catch (err) { lastErr = err; }
      }
      if (typeof TesseractCore === 'undefined') throw lastErr || new Error('Motore OCR non disponibile');
      TessModule = await TesseractCore({});
      for (const [name, data] of Object.entries(msg.langs)) TessModule.FS.writeFile(`/${name}.traineddata`, new Uint8Array(data));
      api = new TessModule.TessBaseAPI();
      const status = api.Init('/', msg.langStr);
      if (status !== 0) throw new Error('Impossibile avviare il riconoscimento per la lingua scelta');
      api.SetVariable('preserve_interword_spaces', '1');
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'recognize') {
      TessModule.FS.writeFile('/input', new Uint8Array(msg.image));
      api.SetPageSegMode(3);
      const r = api.SetImageFile(1, 0);
      if (r === 1) throw new Error('Immagine non leggibile');
      api.Recognize(null);
      const tsv = api.GetTSVText(0);
      const text = api.GetUTF8Text();
      api.Clear();
      self.postMessage({ id: msg.id, ok: true, tsv, text });
    } else if (msg.type === 'end') {
      try { api && api.End(); } catch {}
      self.close();
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};
