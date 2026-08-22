/**
 * Stockage S3 (production). Chiffrement au repos via SSE-S3
 * (ServerSideEncryption: 'AES256') sur chaque écriture. Non exercé dans
 * cet environnement (pas de compte AWS de développement) — cf. TODO
 * T2.5, la variante `local.ts` est le driver réellement testé ici.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver } from '../storage';

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({ region: process.env.S3_REGION });
  }
  return client;
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET manquant (STORAGE_DRIVER=s3)');
  return bucket;
}

export const s3StorageDriver: StorageDriver = {
  async put(key, data, contentType) {
    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: data,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      })
    );
  },

  async get(key) {
    const result = await getClient().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: key })
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Objet introuvable : ${key}`);
    return Buffer.from(bytes);
  },

  async delete(key) {
    await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
  },

  async sign(key, expirySeconds) {
    return getSignedUrl(
      getClient(),
      new GetObjectCommand({ Bucket: getBucket(), Key: key }),
      { expiresIn: expirySeconds }
    );
  },
};
