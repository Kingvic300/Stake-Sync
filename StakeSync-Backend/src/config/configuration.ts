const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

// An empty value in .env (e.g. `JWT_SECRET=`) counts as unset, so these defaults apply in development.
export default () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  adminUrl: process.env.ADMIN_URL || 'http://localhost:5174',
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  corsOrigins: list(process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174'),
  database: {
    url: process.env.DATABASE_URL,
    sync: process.env.DB_SYNC === 'true',
  },
  security: {
    /** Hops of trusted proxies in front of the API (1 behind one load balancer). 0 when exposed directly. */
    trustProxy: num(process.env.TRUST_PROXY, 0),
    /** Admins must use an authenticator app. Defaults to on in production. */
    adminRequire2fa: process.env.ADMIN_REQUIRE_2FA ? process.env.ADMIN_REQUIRE_2FA === 'true' : process.env.NODE_ENV === 'production',
    /** Optional: only these IPs (or prefixes ending in '.') can use admin endpoints. */
    adminIpAllowlist: list(process.env.ADMIN_IP_ALLOWLIST),
    maxLoginAttempts: num(process.env.MAX_LOGIN_ATTEMPTS, 8),
    lockMinutes: num(process.env.LOGIN_LOCK_MINUTES, 15),
  },
  logs: {
    /** Days to keep each level in the server log. */
    keepInfoDays: num(process.env.LOG_KEEP_INFO_DAYS, 14),
    keepWarnDays: num(process.env.LOG_KEEP_WARN_DAYS, 30),
    keepErrorDays: num(process.env.LOG_KEEP_ERROR_DAYS, 90),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
    accessTtlSecs: num(process.env.ACCESS_TTL_SECS, 15 * 60),
    refreshTtlDays: num(process.env.REFRESH_TTL_DAYS, 30),
  },
  /** EC P-256 private key (PEM) for embedded-wallet sign-in tokens; see docs/embedded-wallets.md. */
  walletAuth: { privateKey: process.env.WALLET_AUTH_PRIVATE_KEY },
  /** 32-byte key, base64. Encrypts OAuth tokens and admin TOTP secrets at rest. */
  encryptionKey: process.env.ENCRYPTION_KEY,
  oauth: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET },
    wakatime: { clientId: process.env.WAKATIME_CLIENT_ID, clientSecret: process.env.WAKATIME_CLIENT_SECRET },
  },
  solana: {
    cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
    rpcUrl: process.env.SOLANA_RPC_URL || (process.env.SOLANA_CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com'),
    wsUrl: process.env.SOLANA_WS_URL,
    /** Read-only RPC used by the Solana verification adapter (devnet challenges check devnet). */
    devnetRpcUrl: process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    programId: process.env.STAKE_SYNC_PROGRAM_ID || 'ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV',
    // Circle's USDC for the cluster: real USDC on mainnet, free test USDC (faucet.circle.com) on devnet.
    usdcMint:
      process.env.USDC_MINT ||
      (process.env.SOLANA_CLUSTER === 'devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    treasury: process.env.TREASURY_WALLET,
    verifierKey: process.env.VERIFIER_SECRET_KEY,
    /** Creates challenges on-chain and pays network fees for users. */
    platformKey: process.env.PLATFORM_SECRET_KEY,
    /** SOL sent to a wallet that can't cover account rent when joining or sponsoring. */
    rentDripLamports: num(process.env.RENT_DRIP_LAMPORTS, 3_000_000),
    rentDripsPerDay: num(process.env.RENT_DRIPS_PER_DAY, 3),
    workersEnabled: process.env.CHAIN_WORKERS !== 'false',
  },
  /**
   * Which on/off-ramp the apps open: LocalRamp (Nigeria-focused, no partner fee) when its public key
   * is set, otherwise Onramper. ONRAMP_PROVIDER forces one.
   */
  onrampProvider: (process.env.ONRAMP_PROVIDER || (process.env.LOCALRAMP_PUBLIC_KEY ? 'localramp' : 'onramper')) as 'localramp' | 'onramper',
  localramp: {
    publicKey: process.env.LOCALRAMP_PUBLIC_KEY,
    /** Server-side only: transaction status checks. */
    secretKey: process.env.LOCALRAMP_SECRET_KEY,
    /** Set in the LocalRamp dashboard; LocalRamp sends it in the localramp-webhook-token header. */
    webhookToken: process.env.LOCALRAMP_WEBHOOK_TOKEN,
    apiUrl: process.env.LOCALRAMP_API_URL || 'https://api.localramp.co',
    /** LocalRamp's code for USDC on Solana when buying, and the coin/chain when selling. */
    buyCurrency: process.env.LOCALRAMP_BUY_CURRENCY || 'USDC_SOL',
    sellCurrency: process.env.LOCALRAMP_SELL_CURRENCY || 'USDC',
    sellChain: process.env.LOCALRAMP_SELL_CHAIN || 'SOL',
  },
  /** Local currency in and out through Onramper (routes to licensed on-ramps; no monthly fee). */
  onramp: {
    apiKey: process.env.ONRAMPER_API_KEY,
    /** Ed25519 private key (PEM) for V2 URL signing. Its public key is registered with Onramper. */
    signingKey: process.env.ONRAMPER_SIGNING_KEY,
    baseUrl: process.env.ONRAMPER_BASE_URL || 'https://buy.onramper.com',
    /** Onramper's id for USDC on Solana. */
    usdcId: process.env.ONRAMPER_USDC_ID || 'usdc_sol',
    defaultFiat: process.env.ONRAMPER_DEFAULT_FIAT || 'NGN',
    /** Webhooks record top-ups (and later cash-outs) in money history. Off until registered with Onramper. */
    webhooksEnabled: process.env.ONRAMPER_WEBHOOKS_ENABLED === 'true',
    /** Issued by Onramper when the webhook is registered; each payload is signed with it (HMAC-SHA256). */
    webhookSecret: process.env.ONRAMPER_WEBHOOK_SECRET,
    /** Cash-out webhooks stay parked until the sell payload is confirmed with Onramper. */
    sellWebhooksEnabled: process.env.ONRAMPER_SELL_WEBHOOKS_ENABLED === 'true',
    /** Re-checks unfinished transactions through Onramper's API. Off until tested against it. */
    reconcileEnabled: process.env.ONRAMPER_RECONCILE_ENABLED === 'true',
    /** Staging: https://api-stg.onramper.com */
    apiUrl: process.env.ONRAMPER_API_URL || 'https://api.onramper.com',
  },
  mail: {
    /** Brevo v3 API key (not an SMTP key). */
    brevoKey: process.env.BREVO_API_KEY,
    from: process.env.MAIL_FROM || 'Stake-Sync <stakesync2@gmail.com>',
  },
  push: {
    vapidPublic: process.env.VAPID_PUBLIC_KEY,
    vapidPrivate: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'mailto:stakesync2@gmail.com',
  },
  storage: {
    // Cloudinary as soon as CLOUDINARY_URL is set, unless STORAGE_DRIVER says otherwise.
    driver: (process.env.STORAGE_DRIVER || (process.env.CLOUDINARY_URL ? 'cloudinary' : 'local')) as 'local' | 's3' | 'cloudinary',
    /** cloudinary://API_KEY:API_SECRET@CLOUD_NAME (Cloudinary dashboard > API Keys). */
    cloudinaryUrl: process.env.CLOUDINARY_URL,
    localDir: process.env.STORAGE_LOCAL_DIR || 'uploads',
    publicUrl: process.env.STORAGE_PUBLIC_URL,
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  },
  github: {
    /** Optional app token for public lookups when a user token isn't needed. */
    token: process.env.GITHUB_TOKEN,
  },
  verification: {
    /** How long a check may stay "unavailable" before the period is excused for good. */
    unavailableGraceHours: num(process.env.VERIFY_UNAVAILABLE_GRACE_HOURS, 24),
    intervalMinutes: num(process.env.VERIFY_INTERVAL_MINUTES, 10),
  },
});
