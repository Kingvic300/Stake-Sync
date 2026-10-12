// USDC has 6 decimals. Money is stored and computed as bigint base units; the API speaks dollars.
export const USDC = 1_000_000n;

export function toUnits(usd: number | string): bigint {
  const [whole, frac = ''] = String(usd).split('.');
  return BigInt(whole || '0') * USDC + BigInt((frac + '000000').slice(0, 6));
}

export const toUsd = (units: bigint | string | number) => Number(BigInt(units)) / 1_000_000;

/** TypeORM transformer for numeric(20,0) columns holding base units. */
export const bigintColumn = {
  to: (v?: bigint | null) => (v === undefined || v === null ? v : v.toString()),
  from: (v?: string | null) => (v === undefined || v === null ? v : BigInt(v)),
};
