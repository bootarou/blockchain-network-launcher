/**
 * Decryption for symbol-bootstrap's addresses.yml.
 *
 * Extracted from server.ts so the Beacon producer can reuse the exact same
 * routine: the transport private key must be decrypted the same way the
 * Address Viewer already does it, not by a second implementation that could
 * drift from symbol-bootstrap's CryptoUtils.
 */
import crypto from 'crypto';

export const ENCRYPT_PREFIX = 'ENCRYPTED:';

/**
 * Decrypt a single ENCRYPTED: value using symbol-bootstrap's CryptoUtils scheme.
 * Algorithm: PBKDF2(SHA-256, 1024 iterations, 32-byte key) + AES-256-CBC (PKCS7).
 * Data format: salt(32 hex) + iv(32 hex) + ciphertext(base64)
 */
export function decryptPrivateKey(encryptedValue: string, password: string): string {
  const data = encryptedValue.startsWith(ENCRYPT_PREFIX)
    ? encryptedValue.slice(ENCRYPT_PREFIX.length)
    : encryptedValue;

  const saltHex = data.substr(0, 32);
  const ivHex = data.substr(32, 32);
  const cipherB64 = data.substring(64);

  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.pbkdf2Sync(password, salt, 1024, 32, 'sha256');

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(Buffer.from(cipherB64, 'base64'));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Recursively walk an addresses object and decrypt all ENCRYPTED: privateKey fields.
 */
export function decryptAddressesObj(obj: any, password: string): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => decryptAddressesObj(item, password));
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'privateKey' && typeof value === 'string' && value.startsWith(ENCRYPT_PREFIX)) {
        result[key] = decryptPrivateKey(value, password);
      } else {
        result[key] = decryptAddressesObj(value, password);
      }
    }
    return result;
  }
  return obj;
}
