import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decryptPayload, encryptPayload } from "./receipt-crypto.mjs";

test("encrypted result round-trips with the private key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "s02e04-crypto-test-"));
  try {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const input = Buffer.from('{"result":"dummy result","receipt":"dummy receipt"}');
    const envelope = encryptPayload(input, publicKey);
    assert.deepEqual(decryptPayload(envelope, privateKey), input);
    await writeFile(join(directory, "roundtrip.enc"), JSON.stringify(envelope));
    assert.equal(JSON.parse(await readFile(join(directory, "roundtrip.enc"), "utf8")).version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
