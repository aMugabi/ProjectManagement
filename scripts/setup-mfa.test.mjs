import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { generateSecret, qrForTerminal, qrLines } from './setup-mfa.mjs';

const link = `otpauth://totp/Ledger?secret=${generateSecret()}&issuer=Ledger&algorithm=SHA1&digits=6&period=30`;

/** Reads the half-block glyphs back into rows of dark (true) / light (false) squares. */
function squares(lines) {
  return lines.flatMap((line) => {
    const chars = [...line];
    return [chars.map((c) => c === '█' || c === '▀'), chars.map((c) => c === '█' || c === '▄')];
  });
}

describe('setup QR code', () => {
  it('draws exactly the encoded squares, two rows per line, with a light border', () => {
    const { data, size } = encode(link, { ecc: 'M', border: 2 });
    const lines = qrLines(link);
    expect(lines).toHaveLength(Math.ceil(size / 2));
    const drawn = squares(lines).slice(0, size);
    expect(drawn).toEqual(data);
    // Border rows and columns are light; the finder pattern's corner (after the border) is dark.
    expect(drawn[0].every((d) => !d)).toBe(true);
    expect(drawn.every((row) => !row[0] && !row[size - 1])).toBe(true);
    expect(drawn[2][2]).toBe(true);
  });

  it('is black on white in a terminal and plain when piped', () => {
    const coloured = qrForTerminal(link, true).split('\n');
    expect(coloured.every((l) => l.startsWith('  \x1b[30;107m') && l.endsWith('\x1b[0m'))).toBe(true);
    const plain = qrForTerminal(link, false).split('\n');
    expect(plain.join('')).not.toContain('\x1b');
    expect(plain.map((l) => l.slice(2))).toEqual(qrLines(link));
  });
});
