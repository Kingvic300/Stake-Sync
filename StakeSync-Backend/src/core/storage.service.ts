import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { randomToken } from '../common/crypto.js';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
]);

/** cloudinary://API_KEY:API_SECRET@CLOUD_NAME, as shown on the Cloudinary dashboard. */
export function parseCloudinaryUrl(url: string) {
  const m = url.trim().match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)$/);
  if (!m) throw new Error('CLOUDINARY_URL must look like cloudinary://API_KEY:API_SECRET@CLOUD_NAME');
  return { api_key: m[1], api_secret: m[2], cloud_name: m[3] };
}

/**
 * Uploaded files (proof photos, dispute evidence, banners, avatars).
 * local: disk, for development. cloudinary: Cloudinary's free plan. s3: any S3-compatible store.
 * Keys starting with "public/" are public; everything else (proofs, evidence) is private and only
 * fetched by the API for people allowed to see it.
 */
@Injectable()
export class StorageService {
  private readonly driver: 'local' | 's3' | 'cloudinary';
  private readonly cloudName?: string;
  private readonly dir: string;
  private readonly s3?: S3Client;
  private readonly bucket?: string;
  private readonly publicUrl?: string;
  private readonly apiUrl: string;

  constructor(config: ConfigService) {
    this.driver = config.get('storage.driver') ?? 'local';
    this.dir = config.get('storage.localDir') ?? 'uploads';
    this.publicUrl = config.get('storage.publicUrl');
    this.apiUrl = config.get('apiUrl') ?? '';
    if (this.driver === 'cloudinary') {
      const creds = parseCloudinaryUrl(config.get<string>('storage.cloudinaryUrl') ?? '');
      cloudinary.config({ ...creds, secure: true, analytics: false }); // no ?_a= tracking on links
      this.cloudName = creds.cloud_name;
    }
    if (this.driver === 's3') {
      const s3 = config.get('storage.s3');
      this.bucket = s3.bucket;
      this.s3 = new S3Client({
        endpoint: s3.endpoint,
        region: s3.region,
        credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
      });
    }
  }

  static isAllowed(mime: string) {
    return ALLOWED.has(mime);
  }

  async put(folder: string, data: Buffer, mime: string) {
    const ext = ALLOWED.get(mime);
    if (!ext) throw new Error(`Unsupported file type ${mime}`);
    const key = `${folder}/${new Date().toISOString().slice(0, 10)}/${randomToken(12)}.${ext}`;
    if (this.cloudName) {
      const { publicId, type } = this.cloudRef(key);
      await new Promise<UploadApiResponse>((resolve, reject) =>
        cloudinary.uploader
          .upload_stream({ public_id: publicId, type, resource_type: 'image', overwrite: false }, (err, res) => (err || !res ? reject(err ?? new Error('Upload failed')) : resolve(res)))
          .end(data),
      );
    } else if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: mime }));
    } else {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (this.cloudName) {
      const res = await fetch(this.cloudUrl(key), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`Cloudinary ${res.status} for ${key}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (this.s3) {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    }
    return readFile(this.localPath(key));
  }

  /** Deletes a file. Already gone counts as done. */
  async remove(key: string) {
    if (this.cloudName) {
      const { publicId, type } = this.cloudRef(key);
      await cloudinary.uploader.destroy(publicId, { type, resource_type: 'image', invalidate: true }); // "not found" is fine
      return;
    }
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      return;
    }
    await unlink(this.localPath(key)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }

  /** The key behind one of our own public URLs; null for anything else, like a Google profile photo. */
  keyFromUrl(url: string) {
    if (this.cloudName) {
      const m = url.match(new RegExp(`^https://res\\.cloudinary\\.com/${this.cloudName}/image/upload/(?:v\\d+/)?(public/[^?#]+)$`));
      return m && !m[1].includes('..') ? m[1] : null;
    }
    const bases = [this.publicUrl?.replace(/\/$/, ''), `${this.apiUrl}/api/files`].filter(Boolean) as string[];
    const base = bases.find((b) => url.startsWith(`${b}/`));
    const key = base ? url.slice(base.length + 1) : null;
    return key?.startsWith('public/') && !key.includes('..') ? key : null;
  }

  /** Public files (banners, avatars). Proof and evidence are served through authorised endpoints instead. */
  url(key: string) {
    if (this.cloudName) return this.cloudUrl(key);
    if (this.publicUrl) return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    return `${this.apiUrl}/api/files/${key}`;
  }

  /** Cloudinary keeps the extension as the format, and private files as "authenticated" (signed links only). */
  private cloudRef(key: string) {
    const dot = key.lastIndexOf('.');
    return { publicId: key.slice(0, dot), format: key.slice(dot + 1), type: key.startsWith('public/') ? 'upload' : 'authenticated' };
  }

  private cloudUrl(key: string) {
    const { publicId, format, type } = this.cloudRef(key);
    return cloudinary.url(publicId, { type, format, resource_type: 'image', secure: true, sign_url: type === 'authenticated' });
  }

  private localPath(key: string) {
    const path = normalize(join(this.dir, key));
    if (!path.startsWith(normalize(this.dir))) throw new Error('Invalid key');
    return path;
  }
}
