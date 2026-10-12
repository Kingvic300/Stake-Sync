import type { ProviderKey } from '../modules/challenges/entities/challenge.entities.js';

export const PROVIDER_LABELS: Record<ProviderKey | 'google', string> = {
  github: 'GitHub',
  solana: 'Solana',
  leetcode: 'LeetCode',
  codeforces: 'Codeforces',
  wakatime: 'WakaTime',
  camera: 'Camera',
  health: 'Health',
  photo: 'Photo',
  google: 'Google',
};

export const providerFromLabel = (label: string) =>
  (Object.entries(PROVIDER_LABELS).find(([, v]) => v.toLowerCase() === label.toLowerCase())?.[0] ?? label.toLowerCase()) as ProviderKey;
