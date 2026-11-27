import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./health-check.sh', import.meta.url));
const servers = [];

/** A stand-in for Ledger: answers each request with the next of `replies` (the last one repeats). */
async function fakeLedger(replies) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    const [status, body] = replies[Math.min(seen.length - 1, replies.length - 1)];
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

/** An address where nothing listens. */
async function nothingAt() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolve) => server.close(resolve));
  return url;
}

function run(env) {
  return new Promise((resolve) => {
    execFile('bash', [SCRIPT], { env: { ...process.env, RETRY_SECONDS: '0', ...env } }, (error, stdout) => {
      resolve({ code: error ? error.code : 0, out: stdout });
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

const healthy = { ok: true, store: 'postgres', database: 'ok', push: 'ok', email: 'off', mfa: 'off' };

describe('the health alert script', () => {
  it('passes on 200, asking once', async () => {
    const ledger = await fakeLedger([[200, healthy]]);
    const { code, out } = await run({ LEDGER_URL: ledger.url });
    expect(code).toBe(0);
    expect(out).toContain("Ledger's health check answered HTTP 200");
    expect(ledger.seen).toEqual(['/api/health']);
  });

  it('passes when the retry is healthy (a waking database, or a blip)', async () => {
    const ledger = await fakeLedger([[503, { ...healthy, ok: false, database: 'failing' }], [200, healthy]]);
    const { code } = await run({ LEDGER_URL: ledger.url });
    expect(code).toBe(0);
    expect(ledger.seen).toHaveLength(2);
  });

  it('fails with the reason when the database fails twice, and names only what failed', async () => {
    const ledger = await fakeLedger([[503, { ...healthy, ok: false, database: 'failing' }]]);
    const { code, out } = await run({ LEDGER_URL: ledger.url });
    expect(code).toBe(1);
    expect(out).toMatch(/::error::Ledger is not healthy \(HTTP 503\)\. The database isn't answering/);
    expect(out).not.toMatch(/mfa|email|postgres/); // the public log shows no other field
  });

  it('fails with the reason when the push keys are unusable', async () => {
    const ledger = await fakeLedger([[503, { ...healthy, ok: false, push: 'invalid' }]]);
    const { code, out } = await run({ LEDGER_URL: ledger.url });
    expect(code).toBe(1);
    expect(out).toContain('The push keys in Vercel are unusable');
    expect(out).not.toContain("The database isn't answering");
  });

  it("fails when Ledger doesn't answer while the check's own network works", async () => {
    const reference = await fakeLedger([[200, 'ok']]);
    const { code, out } = await run({ LEDGER_URL: await nothingAt(), REFERENCE_URL: reference.url });
    expect(code).toBe(1);
    expect(out).toContain("Ledger didn't answer at all");
  });

  it("doesn't blame Ledger when the check's own network is down too", async () => {
    const { code, out } = await run({ LEDGER_URL: await nothingAt(), REFERENCE_URL: await nothingAt() });
    expect(code).toBe(0);
    expect(out).toContain("::warning::This check's own network failed");
  });

  it('fails on a server error or a missing route, with a reason for each', async () => {
    const broken = await fakeLedger([[500, { error: 'boom' }]]);
    expect((await run({ LEDGER_URL: broken.url })).out).toContain("Ledger's server failed (HTTP 500)");
    const missing = await fakeLedger([[404, {}]]);
    const gone = await run({ LEDGER_URL: missing.url });
    expect(gone.code).toBe(1);
    expect(gone.out).toContain('The health route is missing');
  });
});
