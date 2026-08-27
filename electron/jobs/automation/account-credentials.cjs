'use strict';

// Autonomous employer-account registration credentials. A generated password
// is scoped to exactly one host/username pair and stored encrypted through the
// existing saveExternalAccountCredentials channel; this module only creates and
// validates the secret material so it stays unit-testable without Electron.

const crypto = require('crypto');

const PASSWORD_LENGTH = 20;
const USERNAME_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generatePassword({ length = PASSWORD_LENGTH, randomBytes = (bytes) => crypto.randomBytes(bytes) } = {}) {
  const size = Math.max(16, Math.min(64, Number(length) || PASSWORD_LENGTH));
  const lowercase = 'abcdefghijkmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  // Ambiguous characters (l, I, 1, O, 0) are excluded above; these remain for
  // entropy and are guaranteed present at least once.
  const symbols = '!@#$%^&*';
  const all = lowercase + uppercase + digits + symbols;
  const pick = (alphabet) => alphabet[randomBytes(4).readUInt32BE(0) % alphabet.length];
  const password = [pick(lowercase), pick(uppercase), pick(digits), pick(symbols)];
  while (password.length < size) password.push(pick(all));
  // Fisher-Yates with the same bounded random source.
  for (let index = password.length - 1; index > 0; index -= 1) {
    const swap = randomBytes(4).readUInt32BE(0) % (index + 1);
    [password[index], password[swap]] = [password[swap], password[index]];
  }
  return password.join('');
}

function validateGeneratedCredential({ username = '', password = '' } = {}) {
  if (!USERNAME_PATTERN.test(String(username || '').trim())) throw new Error('A generated employer account requires a valid email username.');
  const value = String(password || '');
  if (value.length < 16 || value.length > 64) throw new Error('A generated employer password must be between 16 and 64 characters.');
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) throw new Error('A generated employer password must mix upper case, lower case, and digits.');
  return { username: String(username).trim().toLowerCase(), password: value };
}

module.exports = { PASSWORD_LENGTH, generatePassword, validateGeneratedCredential };
