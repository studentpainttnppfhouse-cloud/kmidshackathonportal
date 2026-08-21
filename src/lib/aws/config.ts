/**
 * Where the Aurora connection details come from, and what to say when one is
 * missing.
 *
 * Kept separate from `pool.ts` so the setup screen and the migration script can
 * both read it without pulling in `pg` or the AWS SDK, and so it can be tested
 * without a database.
 *
 * Nothing here is required for the app to boot. The portal still runs on
 * Supabase; Aurora is wired up alongside it and is reached only through the
 * health check and `scripts/aurora-setup.mjs` until the data layer moves over.
 */

/** How we prove who we are to the database. */
export type AuroraAuth =
  /** Vercel OIDC -> AWS IAM role -> a signed 15-minute RDS token. No password anywhere. */
  | { kind: 'iam'; roleArn: string }
  /** A plain password, for non-Vercel hosts. */
  | { kind: 'password'; password: string }
  /**
   * No credentials at all. Only ever accepted for a database on this machine,
   * which is how a default Postgres install is set up — `npm run dev:local`
   * would otherwise demand a password that does not exist.
   */
  | { kind: 'trust' };

export interface AuroraConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  region: string;
  auth: AuroraAuth;
}

/**
 * Names each value may arrive under, most-preferred first.
 *
 * `vercel env pull` produces whatever the AWS integration chose to inject, and
 * that vocabulary is not stable — the Aurora marketplace integration, a
 * hand-made Postgres integration and the Vercel Postgres defaults all use
 * different names for the same host. Reading whichever one is present means
 * nobody has to hand-copy values into a second set of variables.
 */
const ALIASES = {
  host: ['RDS_HOSTNAME', 'RDS_HOST', 'AURORA_HOST', 'PGHOST', 'POSTGRES_HOST'],
  port: ['RDS_PORT', 'PGPORT', 'POSTGRES_PORT'],
  database: ['RDS_DATABASE', 'RDS_DB_NAME', 'PGDATABASE', 'POSTGRES_DATABASE'],
  user: ['RDS_USERNAME', 'RDS_USER', 'PGUSER', 'POSTGRES_USER'],
  region: ['AWS_REGION', 'AWS_DEFAULT_REGION', 'RDS_REGION'],
  roleArn: ['AWS_ROLE_ARN', 'RDS_ROLE_ARN'],
  password: ['RDS_PASSWORD', 'PGPASSWORD', 'POSTGRES_PASSWORD'],
  url: ['AURORA_DATABASE_URL', 'RDS_DATABASE_URL'],
} as const;

/** Human-readable location of each value, shown when one is missing. */
const SOURCES: Record<string, string> = {
  host: 'RDS console > your cluster > Endpoint (the writer endpoint)',
  database: 'RDS console > your cluster > Configuration > DB name',
  user: 'The database user you created and granted rds_iam to',
  region: 'The AWS region your cluster is in, e.g. ap-southeast-1',
  auth: 'AWS_ROLE_ARN (from the Vercel AWS integration) or RDS_PASSWORD',
};

export interface AuroraProblem {
  key: string;
  source: string;
  reason: string;
  /** Other names this value is accepted under, so a setup screen can say so. */
  alsoAccepts: string[];
}

type Vars = Record<string, string | undefined>;

/**
 * A database on this machine, where trust or peer authentication is the norm.
 * `pool.ts` makes the same call about whether to require TLS.
 */
export function isLocalHost(host: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('/');
}

/** First non-empty value among a key's accepted names. */
function pick(vars: Vars, key: keyof typeof ALIASES): string | undefined {
  for (const name of ALIASES[key]) {
    const value = vars[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/**
 * A single connection URI, if one was given.
 *
 * Both the Vercel Postgres integration and a hand-written `.env.local` tend to
 * carry the whole thing as one string, so accept that shape and unpack it into
 * the same fields as the individual variables.
 */
function fromUrl(raw: string): Partial<AuroraConfig> & { password?: string } {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: url.pathname.replace(/^\//, '') || undefined,
    user: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
  };
}

/**
 * Resolve the configuration, reporting what is missing rather than throwing.
 *
 * §3 of the brief says a misconfigured deploy must never show a generic error,
 * and the first-time deployer is exactly who will hit this.
 */
export function resolveAurora(
  vars: Vars = process.env,
): { config: AuroraConfig; problems: [] } | { config: null; problems: AuroraProblem[] } {
  const rawUrl = pick(vars, 'url');
  let fromUri: Partial<AuroraConfig> & { password?: string } = {};
  const problems: AuroraProblem[] = [];

  if (rawUrl) {
    try {
      fromUri = fromUrl(rawUrl);
    } catch {
      problems.push({
        key: 'AURORA_DATABASE_URL',
        source: 'A full Postgres URI, postgresql://user@host:5432/dbname',
        reason: 'is not a valid URL',
        alsoAccepts: [...ALIASES.url].slice(1),
      });
    }
  }

  const host = pick(vars, 'host') ?? fromUri.host;
  const database = pick(vars, 'database') ?? fromUri.database;
  const user = pick(vars, 'user') ?? fromUri.user;
  const region = pick(vars, 'region');
  const roleArn = pick(vars, 'roleArn');
  const password = pick(vars, 'password') ?? fromUri.password;

  const rawPort = pick(vars, 'port');
  const port = rawPort ? Number(rawPort) : (fromUri.port ?? 5432);

  const require_ = (key: keyof typeof ALIASES, value: string | undefined) => {
    if (value) return;
    problems.push({
      key: ALIASES[key][0],
      source: SOURCES[key] ?? '',
      reason: 'not set',
      alsoAccepts: [...ALIASES[key]].slice(1),
    });
  };

  require_('host', host);
  require_('database', database);
  require_('user', user);

  if (rawPort !== undefined && !Number.isFinite(port)) {
    problems.push({
      key: 'RDS_PORT',
      source: 'The port your cluster listens on — 5432 unless you changed it',
      reason: `"${rawPort}" is not a number`,
      alsoAccepts: [...ALIASES.port].slice(1),
    });
  }

  /**
   * IAM is preferred whenever a role is available: the token it produces lives
   * for 15 minutes, so there is no long-lived secret to leak or rotate. A
   * password is the fallback for a laptop, where there is no Vercel OIDC token
   * to exchange.
   */
  let auth: AuroraAuth | null = null;
  if (roleArn) {
    auth = { kind: 'iam', roleArn };
    // The signature is region-scoped, so IAM cannot fall back to a default.
    require_('region', region);
  } else if (password) {
    auth = { kind: 'password', password };
  } else if (host && isLocalHost(host)) {
    // A local Postgres almost always trusts the local user. Demanding a
    // password here would break `npm run dev:local`, which is the one setup
    // path that is supposed to need nothing at all.
    auth = { kind: 'trust' };
  } else {
    problems.push({
      key: 'AWS_ROLE_ARN',
      source: SOURCES.auth ?? '',
      reason:
        'not set, and no RDS_PASSWORD either — one of the two is needed to authenticate',
      alsoAccepts: [...ALIASES.roleArn].slice(1),
    });
  }

  if (problems.length > 0 || !host || !database || !user || !auth) {
    return { config: null, problems };
  }

  return {
    config: { host, port, database, user, region: region ?? '', auth },
    problems: [],
  };
}

/** True when enough is configured to attempt a connection. */
export function auroraConfigured(vars: Vars = process.env): boolean {
  return resolveAurora(vars).config !== null;
}
