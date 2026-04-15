const crypto = require('crypto');

const KEY_ENV = 'GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64';
const PREFIX = 'enc:v1:';

function decryptToken(storedValue) {
  if (!storedValue) return storedValue;
  if (!storedValue.startsWith(PREFIX)) return storedValue;

  const [, ivB64, tagB64, ciphertextB64] = storedValue.split(':');
  const key = getKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function getKey() {
  const encoded = process.env[KEY_ENV];
  if (!encoded) {
    throw new Error(`${KEY_ENV} env var is required to decrypt stored Google refresh tokens`);
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes`);
  }
  return key;
}

module.exports = { decryptToken };
