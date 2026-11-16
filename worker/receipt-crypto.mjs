import {
  constants,
  createCipheriv,
  createDecipheriv,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const aad = Buffer.from("S02E04-result-v1");

export function encryptPayload(plaintext, publicKey) {
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrappedKey = publicEncrypt(
      { key: publicKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING },
      contentKey,
    );
    return {
      version: 1,
      algorithm: "RSA-OAEP-256+A256GCM",
      wrappedKey: wrappedKey.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    contentKey.fill(0);
  }
}

export function decryptPayload(envelope, privateKey) {
  if (envelope.version !== 1 || envelope.algorithm !== "RSA-OAEP-256+A256GCM") {
    throw new Error("unsupported encrypted result");
  }
  const contentKey = privateDecrypt(
    { key: privateKey, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(envelope.wrappedKey, "base64"),
  );
  try {
    const decipher = createDecipheriv("aes-256-gcm", contentKey, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
  } finally {
    contentKey.fill(0);
  }
}

async function main() {
  const [mode, inputPath, keyPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !keyPath || !outputPath || !["encrypt", "decrypt"].includes(mode)) {
    throw new Error("invalid arguments");
  }

  if (mode === "encrypt") {
    const plaintext = await readFile(inputPath);
    const envelope = encryptPayload(plaintext, await readFile(keyPath));
    await writeFile(outputPath, JSON.stringify(envelope), { mode: 0o600 });
    await rm(inputPath, { force: true });
  } else {
    const envelope = JSON.parse(await readFile(inputPath, "utf8"));
    const plaintext = decryptPayload(envelope, await readFile(keyPath));
    await writeFile(outputPath, plaintext, { flag: "wx", mode: 0o600 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("Encrypted result operation failed.\n");
    process.exitCode = 1;
  });
}
