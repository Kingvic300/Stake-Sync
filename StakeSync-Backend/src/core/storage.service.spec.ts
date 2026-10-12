import { ConfigService } from '@nestjs/config';
import { parseCloudinaryUrl, StorageService } from './storage.service.js';

describe('StorageService.keyFromUrl', () => {
  const storage = new StorageService(new ConfigService({ apiUrl: 'https://api.stakesync.app', storage: { driver: 'local', localDir: 'uploads' } }));

  it('maps our own public URLs back to their key', () => {
    expect(storage.keyFromUrl('https://api.stakesync.app/api/files/public/avatars/2026-10-11/abc.webp')).toBe('public/avatars/2026-10-11/abc.webp');
  });

  it('never touches files it does not own', () => {
    expect(storage.keyFromUrl('https://lh3.googleusercontent.com/a/photo.jpg')).toBeNull();
    expect(storage.keyFromUrl('https://api.stakesync.app/api/files/proof/2026-10-11/x.jpg')).toBeNull();
    expect(storage.keyFromUrl('https://api.stakesync.app/api/files/public/../proof/x.jpg')).toBeNull();
    expect(storage.keyFromUrl('https://api.stakesync.app.evil.com/api/files/public/a.webp')).toBeNull();
  });
});

describe('StorageService with Cloudinary', () => {
  const storage = new StorageService(new ConfigService({ storage: { driver: 'cloudinary', cloudinaryUrl: 'cloudinary://1234:secretXYZ@stakesync-demo' } }));

  it('reads CLOUDINARY_URL and refuses anything else', () => {
    expect(parseCloudinaryUrl('cloudinary://1234:secretXYZ@stakesync-demo')).toEqual({ api_key: '1234', api_secret: 'secretXYZ', cloud_name: 'stakesync-demo' });
    expect(() => parseCloudinaryUrl('https://cloudinary.com')).toThrow(/CLOUDINARY_URL/);
  });

  it('links public files directly and maps the link back to the key', () => {
    const key = 'public/avatars/2026-10-11/abc123.webp';
    const url = storage.url(key);
    expect(url).toBe('https://res.cloudinary.com/stakesync-demo/image/upload/v1/public/avatars/2026-10-11/abc123.webp');
    expect(storage.keyFromUrl(url)).toBe(key);
    expect(storage.keyFromUrl('https://res.cloudinary.com/stakesync-demo/image/upload/v1712/public/avatars/x.webp')).toBe('public/avatars/x.webp');
  });

  it('never maps private files, other clouds or other hosts', () => {
    expect(storage.keyFromUrl('https://res.cloudinary.com/stakesync-demo/image/authenticated/proofs/x.jpg')).toBeNull();
    expect(storage.keyFromUrl('https://res.cloudinary.com/someone-else/image/upload/public/avatars/x.webp')).toBeNull();
    expect(storage.keyFromUrl('https://lh3.googleusercontent.com/a/photo.jpg')).toBeNull();
  });
});
