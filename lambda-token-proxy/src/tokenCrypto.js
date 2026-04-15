const crypto = require('crypto');

const KEY_ENV = 'GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64';
const PREFIX = 'enc:v1:';

function encryptToken(plaintext) {
  if (!plaintext) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + [
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function getKey() {
  const encoded = process.env[KEY_ENV];
  if (!encoded) {
    throw new Error(`${KEY_ENV} env var is required`);
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes`);
  }
  return key;
}

module.exports = { encryptToken };
