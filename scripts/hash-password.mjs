#!/usr/bin/env node
// Prints the AUTH_PASSWORD_HASH value for a password: `scrypt$<salt hex>$<key hex>`.
// Must match api/_lib/password.ts (N=16384, r=8, p=1, 64-byte key).
// Usage: npm run hash-password   (prompts without echoing the password)
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export function hashPassword(password, salt = randomBytes(16)) {
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  let prompt = '';
  // Echo only the prompt, never the typed characters.
  rl._writeToOutput = (s) => {
    if (s.includes(prompt)) process.stdout.write(prompt);
  };
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question) => {
    prompt = question;
    process.stdout.write(question);
    const { value } = await lines.next();
    process.stdout.write('\n');
    return value ?? '';
  };

  const password = await ask('Password: ');
  const repeat = await ask('Repeat:   ');
  rl.close();
  if (!password) throw new Error('No password given.');
  if (repeat !== password) throw new Error("Passwords don't match.");
  console.log(`\nAUTH_PASSWORD_HASH=${hashPassword(password)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
