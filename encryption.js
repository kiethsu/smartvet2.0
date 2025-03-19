// encryption.js
const crypto = require('crypto');

// NOTE: In production, manage your encryption key securely.
const algorithm = 'aes-256-cbc';

function encryptData(text, key) {
  const cipher = crypto.createCipher(algorithm, key);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decryptData(encryptedText, key) {
  const decipher = crypto.createDecipher(algorithm, key);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encryptData, decryptData };
