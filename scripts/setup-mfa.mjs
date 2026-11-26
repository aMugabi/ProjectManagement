#!/usr/bin/env node
// Sets up the authenticator-app code that sign-in asks for after the password (MFA).
// Usage: npm run setup-mfa
//   1. Shows a QR code to scan with your authenticator app (Microsoft Authenticator, Google
//      Authenticator, 1Password, ...), and the same setup key as text for "Enter a setup key".
//   2. Asks for the code the app now shows, to prove the app and Ledger agree.
//   3. Prints the two environment variables for the Vercel project, and 10 one-time recovery codes.
// Nothing is sent anywhere and nothing is saved: the output exists only in this terminal (the QR
// code is drawn here, by the uqr package, with no network). Run it in your own terminal, not
// through a chat or anything that records its output.
// Must match api/_lib/totp.ts (api/_lib/totp.test.ts checks the two against each other).
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { encode } from 'uqr';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 160 random bits, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateSecret() {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretBase32, nowMs) {
  const clean = secretBase32.toUpperCase().replace(/[\s=-]/g, '');
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30000)));
  const hash = createHmac('sha1', Buffer.from(bytes)).update(message).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(binary % 1e6).padStart(6, '0');
}

/** Ten codes like 'k7pq-x2mf-9a' (about 50 random bits each), without look-alike characters. */
export function generateRecoveryCodes(count = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const raw = Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  });
}

/**
 * The QR code for `text` as terminal lines, two rows of squares per line using half blocks
 * (▀ top dark, ▄ bottom dark, █ both). Dark squares are the drawn characters, so print it dark
 * on light (see qrForTerminal); a 2-square light border is included.
 */
export function qrLines(text) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  const dark = (x, y) => y < size && data[y][x];
  const lines = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const top = dark(x, y);
      const bottom = dark(x, y + 1);
      line += top && bottom ? '\u2588' : top ? '\u2580' : bottom ? '\u2584' : ' ';
    }
    lines.push(line);
  }
  return lines;
}

/** Black on white in a terminal, whatever its theme: phone scanners need dark squares on light. */
export function qrForTerminal(text, colour = process.stdout.isTTY) {
  return qrLines(text)
    .map((line) => (colour ? `  \x1b[30;107m${line}\x1b[0m` : `  ${line}`))
    .join('\n');
}

export function hashRecoveryCode(code) {
  return createHash('sha256').update(code.toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
}

async function main() {
  const secret = generateSecret();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  const link = `otpauth://totp/Ledger?secret=${secret}&issuer=Ledger&algorithm=SHA1&digits=6&period=30`;

  console.log('\nScan this with your authenticator app (it holds the secret: no screenshots or photos):\n');
  console.log(qrForTerminal(link));
  console.log('\nOr add it by hand with this setup key (time-based, 6 digits):\n');
  console.log(`  ${secret.match(/.{1,4}/g).join(' ')}\n`);
  console.log('Apps that take a link instead can use (do not paste it into a website or QR generator):');
  console.log(`  ${link}\n`);

  let confirmed = false;
  for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
    const code = String(await ask('Enter the 6-digit code the app shows now: ')).replace(/\s/g, '');
    const now = Date.now();
    confirmed = [-30000, 0, 30000].some((drift) => totpAt(secret, now + drift) === code);
    if (!confirmed) console.log("That code doesn't match. Check the key was typed exactly, and the phone's clock.");
  }
  rl.close();
  if (!confirmed) throw new Error('Not confirmed; nothing to set. Run `npm run setup-mfa` again.');

  const recovery = generateRecoveryCodes();
  console.log('\nConfirmed. Add these to the Vercel project (Settings → Environment Variables, Production), then redeploy:\n');
  console.log(`AUTH_TOTP_SECRET=${secret}`);
  console.log(`AUTH_RECOVERY_CODES=${recovery.map(hashRecoveryCode).join(',')}\n`);
  console.log('Recovery codes: each signs you in once if you lose the phone. Keep them in your password');
  console.log('manager or on paper, not in this repository. They are not shown again.\n');
  for (const code of recovery) console.log(`  ${code}`);
  console.log('\nUntil you redeploy with AUTH_TOTP_SECRET set, sign-in still asks for the password only.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
