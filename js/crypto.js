// MULTIPEPPINS — protezione e sblocco PDF (Standard Security Handler)
// Cifra con AES-128 (V4/R4). Decifra RC4 40/128, AES-128 e AES-256 (R2–R6).
import { PDFLib } from './core.js';

const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFNumber, PDFRef, PDFBool } = PDFLib;

/* ---------- MD5 ---------- */
function md5(input) {
  const msg = input instanceof Uint8Array ? input : new Uint8Array(input);
  const len = msg.length;
  const nBlocks = ((len + 8) >>> 6) + 1;
  const words = new Uint32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= msg[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[nBlocks * 16 - 2] = (len * 8) >>> 0;
  words[nBlocks * 16 - 1] = Math.floor((len * 8) / 0x100000000);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let blk = 0; blk < nBlocks; blk++) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + words[blk * 16 + g]) >>> 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { for (let j = 0; j < 4; j++) out[i * 4 + j] = (v >>> (8 * j)) & 0xff; });
  return out;
}

/* ---------- RC4 ---------- */
function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/* ---------- AES (WebCrypto) ---------- */
const subtle = () => {
  if (!crypto || !crypto.subtle) throw new Error('Il browser non supporta la crittografia necessaria (serve una pagina https).');
  return crypto.subtle;
};
async function aesKey(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}
async function aesEncrypt(rawKey, data, iv) {
  const k = await aesKey(rawKey);
  iv = iv || crypto.getRandomValues(new Uint8Array(16));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
  const out = new Uint8Array(16 + ct.length);
  out.set(iv, 0);
  out.set(ct, 16);
  return out;
}
// AES-CBC senza padding (lunghezza multipla di 16)
async function aesEncryptNoPad(rawKey, iv, data) {
  const k = await aesKey(rawKey);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
  return ct.slice(0, data.length);
}
async function aesDecryptNoPad(rawKey, iv, data) {
  // Aggiunge un blocco di padding valido così WebCrypto accetta la decifratura
  const k = await aesKey(rawKey);
  const lastBlock = data.length ? data.slice(data.length - 16) : iv;
  const padBlock = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: lastBlock }, k, new Uint8Array(0))).slice(0, 16);
  const full = new Uint8Array(data.length + 16);
  full.set(data, 0);
  full.set(padBlock, data.length);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, full));
}
async function aesDecrypt(rawKey, data) {
  if (data.length < 16) return new Uint8Array(0);
  const iv = data.slice(0, 16);
  let ct = data.slice(16);
  if (!ct.length) return new Uint8Array(0);
  if (ct.length % 16) ct = ct.slice(0, ct.length - (ct.length % 16));
  try {
    const k = await aesKey(rawKey);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv }, k, ct));
  } catch {
    const plain = await aesDecryptNoPad(rawKey, iv, ct);
    const p = plain[plain.length - 1];
    return p > 0 && p <= 16 ? plain.slice(0, plain.length - p) : plain;
  }
}
async function sha(alg, data) {
  return new Uint8Array(await subtle().digest(alg, data));
}

/* ---------- Utilità ---------- */
const PAD = new Uint8Array([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
function concat(...arrs) {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function latin1(str) {
  const out = [];
  for (const c of String(str || '')) { const code = c.charCodeAt(0); out.push(code < 256 ? code : 63); }
  return new Uint8Array(out);
}
function padPw(pw) {
  const p = latin1(pw).slice(0, 32);
  return concat(p, PAD.slice(0, 32 - p.length));
}
function int32le(v) {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
}
function toHex(b) {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function strBytes(obj) {
  if (!obj) return new Uint8Array(0);
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.asBytes();
  return new Uint8Array(0);
}
function eq(a, b, n) {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---------- Calcolo chiavi R2–R4 ---------- */
function computeO(ownerPw, userPw, R, n) {
  let h = md5(padPw(ownerPw || userPw));
  if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
  const key = h.slice(0, n);
  let x = rc4(key, padPw(userPw));
  if (R >= 3) for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return x;
}
function fileKeyR4(userPwPadded, O, P, id0, R, n, encryptMetadata) {
  let h = md5(concat(userPwPadded, O, int32le(P), id0, R >= 4 && !encryptMetadata ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)));
  if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
  return h.slice(0, n);
}
function computeU(key, id0, R) {
  if (R === 2) return rc4(key, PAD);
  let x = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return concat(x, new Uint8Array(16));
}

/* ---------- Calcolo chiavi R5/R6 (AES-256) ---------- */
async function hash2B(pw, salt, udata, R) {
  let K = await sha('SHA-256', concat(pw, salt, udata));
  if (R === 5) return K;
  for (let round = 0; ; round++) {
    const unit = concat(pw, K, udata);
    const K1 = new Uint8Array(unit.length * 64);
    for (let i = 0; i < 64; i++) K1.set(unit, i * unit.length);
    const E = await aesEncryptNoPad(K.slice(0, 16), K.slice(16, 32), K1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    const alg = ['SHA-256', 'SHA-384', 'SHA-512'][sum % 3];
    K = await sha(alg, E);
    if (round >= 63 && E[E.length - 1] <= round - 31) break;
  }
  return K.slice(0, 32);
}
function utf8pw(pw) {
  return new TextEncoder().encode(String(pw || '').normalize('NFKC')).slice(0, 127);
}

/* ---------- Lettura dizionario /Encrypt ---------- */
async function getEncryptionKey(encDict, id0, password) {
  const num = (k, d) => { const v = encDict.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
  const filter = encDict.lookup(PDFName.of('Filter'));
  if (filter && filter.asString && filter.asString() !== '/Standard') throw new Error('Questo PDF usa una protezione con certificato, non con password: non può essere sbloccato qui.');
  const V = num('V', 0), R = num('R', 2);
  const P = num('P', -1) | 0;
  const O = strBytes(encDict.lookup(PDFName.of('O')));
  const U = strBytes(encDict.lookup(PDFName.of('U')));
  const encMetaObj = encDict.lookup(PDFName.of('EncryptMetadata'));
  const encryptMetadata = !(encMetaObj instanceof PDFBool) || encMetaObj.asBoolean() !== false;

  // Metodo di cifratura per stream e stringhe
  let stmMethod = V >= 4 ? 'Identity' : 'RC4';
  let strMethod = stmMethod;
  if (V >= 4) {
    const cf = encDict.lookup(PDFName.of('CF'));
    const methodOf = (nameObj) => {
      if (!nameObj) return 'Identity';
      const name = nameObj.asString().slice(1);
      if (name === 'Identity') return 'Identity';
      const sub = cf instanceof PDFDict ? cf.lookup(PDFName.of(name)) : null;
      const cfm = sub instanceof PDFDict ? sub.lookup(PDFName.of('CFM')) : null;
      const m = cfm ? cfm.asString().slice(1) : 'None';
      return m === 'AESV2' ? 'AES128' : m === 'AESV3' ? 'AES256' : m === 'V2' ? 'RC4' : 'Identity';
    };
    stmMethod = methodOf(encDict.lookup(PDFName.of('StmF')));
    strMethod = methodOf(encDict.lookup(PDFName.of('StrF')));
  }

  if (R <= 4) {
    const n = V === 1 ? 5 : Math.max(5, Math.min(16, num('Length', 40) / 8));
    // 1) prova come password utente
    const tryUser = (pwPadded) => {
      const key = fileKeyR4(pwPadded, O, P, id0, R, n, encryptMetadata);
      const u = computeU(key, id0, R);
      return eq(u, U, R === 2 ? 32 : 16) ? key : null;
    };
    let key = tryUser(padPw(password));
    // 2) prova come password proprietario
    if (!key) {
      let h = md5(padPw(password));
      if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
      const okey = h.slice(0, n);
      let userPadded;
      if (R === 2) userPadded = rc4(okey, O);
      else {
        let x = O;
        for (let i = 19; i >= 0; i--) x = rc4(okey.map((b) => b ^ i), x);
        userPadded = x;
      }
      key = tryUser(userPadded);
    }
    if (!key) return { needPassword: true };
    return { key, V, R, stmMethod, strMethod, encryptMetadata, perObject: true };
  }

  // R5 / R6
  const pw = utf8pw(password);
  const OE = strBytes(encDict.lookup(PDFName.of('OE')));
  const UE = strBytes(encDict.lookup(PDFName.of('UE')));
  let key = null;
  const uHash = await hash2B(pw, U.slice(32, 40), new Uint8Array(0), R);
  if (eq(uHash, U, 32)) {
    const ik = await hash2B(pw, U.slice(40, 48), new Uint8Array(0), R);
    key = await aesDecryptNoPad(ik, new Uint8Array(16), UE.slice(0, 32));
  } else {
    const oHash = await hash2B(pw, O.slice(32, 40), U.slice(0, 48), R);
    if (eq(oHash, O, 32)) {
      const ik = await hash2B(pw, O.slice(40, 48), U.slice(0, 48), R);
      key = await aesDecryptNoPad(ik, new Uint8Array(16), OE.slice(0, 32));
    }
  }
  if (!key) return { needPassword: true };
  return { key: key.slice(0, 32), V, R, stmMethod: stmMethod === 'Identity' && V >= 5 ? 'Identity' : stmMethod, strMethod, encryptMetadata, perObject: false };
}

function objectKey(info, ref, aes) {
  if (!info.perObject) return info.key;
  const n = info.key.length;
  const extra = [ref.objectNumber & 0xff, (ref.objectNumber >> 8) & 0xff, (ref.objectNumber >> 16) & 0xff, ref.generationNumber & 0xff, (ref.generationNumber >> 8) & 0xff];
  const h = md5(concat(info.key, new Uint8Array(extra), aes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0)));
  return h.slice(0, Math.min(n + 5, 16));
}

async function cryptBytes(info, method, ref, data, decrypt) {
  if (method === 'Identity') return data;
  if (method === 'RC4') return rc4(objectKey(info, ref, false), data);
  const k = objectKey(info, ref, true);
  return decrypt ? aesDecrypt(k, data) : aesEncrypt(k, data);
}

// Applica la (de)cifratura a tutte le stringhe e agli stream di un oggetto
async function cryptObject(obj, ref, info, decrypt) {
  const fixStrings = async (o) => {
    if (o instanceof PDFString || o instanceof PDFHexString) {
      const b = await cryptBytes(info, info.strMethod, ref, o.asBytes(), decrypt);
      return PDFHexString.of(toHex(b));
    }
    if (o instanceof PDFDict) {
      // Le firme digitali non vanno toccate
      for (const [k, v] of o.entries()) {
        if (k.asString() === '/Contents' && o.lookup(PDFName.of('Type')) === PDFName.of('Sig')) continue;
        const nv = await fixStrings(v);
        if (nv !== v) o.set(k, nv);
      }
      return o;
    }
    if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) {
        const v = o.get(i);
        const nv = await fixStrings(v);
        if (nv !== v) o.set(i, nv);
      }
      return o;
    }
    return o;
  };
  if (obj instanceof PDFRawStream) {
    await fixStrings(obj.dict);
    const type = obj.dict.lookup(PDFName.of('Type'));
    if (type === PDFName.of('XRef')) return obj;
    if (!info.encryptMetadata && type === PDFName.of('Metadata')) return obj;
    obj.contents = await cryptBytes(info, info.stmMethod, ref, obj.contents, decrypt);
    return obj;
  }
  return fixStrings(obj);
}

/* ---------- Patch del parser di pdf-lib per decifrare durante il caricamento ---------- */
const ENDOBJ = [101, 110, 100, 111, 98, 106];
let parseHook = null; // { mode: 'scan' | 'decrypt', info, encRef }
const proto = PDFLib.PDFParser.prototype;
const originalParseIndirectObject = proto.parseIndirectObject;
proto.parseIndirectObject = async function () {
  if (!parseHook) return originalParseIndirectObject.call(this);
  const ref = this.parseIndirectObjectHeader();
  this.skipWhitespaceAndComments();
  let object = this.parseObject();
  this.skipWhitespaceAndComments();
  this.matchKeyword(ENDOBJ);
  const isStream = object instanceof PDFRawStream;
  const type = isStream ? object.dict.lookup(PDFName.of('Type')) : null;
  if (isStream && type === PDFName.of('XRef')) {
    PDFLib.PDFXRefStreamParser.forStream(object).parseIntoContext();
    return ref;
  }
  if (parseHook.mode === 'decrypt' && !(parseHook.encRef && ref === parseHook.encRef)) {
    object = await cryptObject(object, ref, parseHook.info, true);
  }
  if (parseHook.mode === 'decrypt' && isStream && type === PDFName.of('ObjStm')) {
    await PDFLib.PDFObjectStreamParser.forStream(object, this.shouldWaitForTick).parseIntoContext();
    return ref;
  }
  this.context.assign(ref, object);
  return ref;
};

async function loadWithHook(bytes, hook) {
  parseHook = hook;
  try {
    return await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  } finally {
    parseHook = null;
  }
}

/* ---------- API pubblica ---------- */
export async function isEncrypted(bytes) {
  const doc = await loadWithHook(bytes, { mode: 'scan' });
  return !!doc.context.trailerInfo.Encrypt;
}

// Restituisce i byte decifrati; lancia {code:'password'} se serve una password valida
export async function decryptPdf(bytes, password) {
  const scan = await loadWithHook(bytes, { mode: 'scan' });
  const encEntry = scan.context.trailerInfo.Encrypt;
  if (!encEntry) return { bytes, wasEncrypted: false };
  const encDict = encEntry instanceof PDFRef ? scan.context.lookup(encEntry) : encEntry;
  const idArr = scan.context.trailerInfo.ID ? scan.context.lookup(scan.context.trailerInfo.ID) : null;
  const id0 = idArr instanceof PDFArray ? strBytes(idArr.lookup(0)) : new Uint8Array(0);
  const info = await getEncryptionKey(encDict, id0, password || '');
  if (info.needPassword) {
    const e = new Error(password ? 'Password errata. Riprova.' : 'Questo PDF richiede una password per essere aperto.');
    e.code = 'password';
    throw e;
  }
  const doc = await loadWithHook(bytes, { mode: 'decrypt', info, encRef: encEntry instanceof PDFRef ? encEntry : null });
  if (encEntry instanceof PDFRef) doc.context.delete(encEntry);
  doc.context.trailerInfo.Encrypt = undefined;
  const out = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes: out, wasEncrypted: true };
}

// perms: {print, copy, modify, annotate, fill, assemble}
export async function encryptPdf(bytes, userPw, ownerPw, perms = {}) {
  if (!userPw) throw new Error('Inserisci una password.');
  // Normalizza: tutti gli oggetti come oggetti indiretti semplici, niente object stream
  let doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const flat = await doc.save({ useObjectStreams: false, addDefaultPage: false });
  doc = await PDFLib.PDFDocument.load(flat, { updateMetadata: false, throwOnInvalidObject: false });
  const ctx = doc.context;

  const R = 4, n = 16;
  let P = 0xfffff0c0 | 0;
  if (perms.print !== false) P |= 4 | 2048;
  if (perms.modify !== false) P |= 8;
  if (perms.copy !== false) P |= 16 | 512;
  if (perms.annotate !== false) P |= 32;
  if (perms.fill !== false) P |= 256;
  if (perms.assemble !== false) P |= 1024;
  P |= 0;

  const id0 = crypto.getRandomValues(new Uint8Array(16));
  const owner = ownerPw || userPw + '#' + toHex(crypto.getRandomValues(new Uint8Array(6)));
  const O = computeO(owner, userPw, R, n);
  const key = fileKeyR4(padPw(userPw), O, P, id0, R, n, true);
  const U = computeU(key, id0, R);
  const info = { key, V: 4, R, stmMethod: 'AES128', strMethod: 'AES128', encryptMetadata: true, perObject: true };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    await cryptObject(obj, ref, info, false);
  }

  const encDict = ctx.obj({
    Filter: 'Standard',
    V: 4,
    R: 4,
    Length: 128,
    P,
    O: PDFHexString.of(toHex(O)),
    U: PDFHexString.of(toHex(U)),
    StmF: 'StdCF',
    StrF: 'StdCF',
    CF: { StdCF: { Type: 'CryptFilter', CFM: 'AESV2', AuthEvent: 'DocOpen', Length: 16 } },
  });
  ctx.trailerInfo.Encrypt = ctx.register(encDict);
  const idHex = PDFHexString.of(toHex(id0));
  ctx.trailerInfo.ID = ctx.obj([idHex, idHex]);
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
