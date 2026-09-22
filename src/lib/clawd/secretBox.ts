/**
 * Encrypts small secrets (the shared app key) before they touch localStorage.
 *
 * The AES-GCM key is generated non-extractable and kept in IndexedDB: this
 * origin's own code can use it to encrypt and decrypt, but nothing —
 * including this code — can ever read its raw bytes back out. That defeats
 * the common case of a secret being lifted straight off disk (a stolen
 * device, or malware that scrapes browser storage files without running any
 * page's JS); it does not defend against a script already executing in this
 * origin, which could call the same decrypt this module does.
 */

const DB_NAME = "clawdmeter-keystore";
const STORE_NAME = "keys";
const KEY_ID = "appkey-wrap-v1";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function getStoredKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
}

function putStoredKey(db: IDBDatabase, cryptoKey: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(cryptoKey, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

let keyPromise: Promise<CryptoKey> | null = null;

function getOrCreateKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const db = await openDb();
      const existing = await getStoredKey(db);
      if (existing) return existing;
      const generated = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false, // non-extractable
        ["encrypt", "decrypt"],
      );
      await putStoredKey(db, generated);
      return generated;
    })().catch((error: unknown) => {
      keyPromise = null; // let the next call retry instead of caching a failure
      throw error;
    });
  }
  return keyPromise;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export type SealedValue = { iv: string; ciphertext: string };

export async function seal(plaintext: string): Promise<SealedValue> {
  const cryptoKey = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(buffer)) };
}

export async function unseal(sealed: SealedValue): Promise<string> {
  const cryptoKey = await getOrCreateKey();
  const iv = fromBase64(sealed.iv);
  const ciphertext = fromBase64(sealed.ciphertext);
  const buffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(buffer);
}
