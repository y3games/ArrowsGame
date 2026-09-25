/** Comma-separated origin list -> array; blanks are dropped and an empty result falls back to `fallback`. */
export function parseCorsOrigins(raw: string | undefined, fallback = 'http://localhost:5173'): string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  return origins.length > 0 ? origins : [fallback];
}

export const SERVER_CONFIG = {
  PORT: Number(process.env.PORT ?? 4000),
  CORS_ORIGINS: parseCorsOrigins(process.env.CORS_ORIGIN),
} as const;
