/**
 * CloudBase 本地账号认证（E-01 共享环境，用户名+密码）。
 *
 * 口径与 043/068 一致：
 *  · 登录：POST /auth/v1/signin，头 Authorization: Bearer <Publishable Key>，body {username,password}；
 *  · 刷新：POST /auth/v1/token，body {grant_type:'refresh_token', refresh_token}；
 *  · 无服务端登出：signOut 只清本机会话；
 *  · access_token 提前 5 分钟刷新，刷新失败即清会话并要求重新登录。
 */
import { AppError } from '../domain/types';

const SESSION_KEY = 'whenlast.cloud.session';
const REFRESH_AHEAD_MS = 300_000;
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_EXPIRES_IN_SECONDS = 7200;

export interface CloudSession {
  userId: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  /** 绝对过期时间（epoch ms）。 */
  expiresAt: number;
}

export function cloudBaseUrl(): string {
  const envId = (import.meta.env.VITE_CLOUDBASE_ENV_ID ?? '').trim();
  return envId ? `https://${envId}.api.tcloudbasegateway.com` : '';
}

export function cloudPublishableKey(): string {
  return (import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY ?? '').trim();
}

export function isCloudConfigured(): boolean {
  return Boolean(cloudBaseUrl() && cloudPublishableKey());
}

let cached: CloudSession | null | undefined;
let refreshInFlight: Promise<CloudSession | null> | null = null;

function isSessionShape(value: unknown): value is CloudSession {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === 'string' &&
    record.userId.length > 0 &&
    typeof record.username === 'string' &&
    typeof record.accessToken === 'string' &&
    record.accessToken.length > 0 &&
    typeof record.refreshToken === 'string' &&
    record.refreshToken.length > 0 &&
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt)
  );
}

/** 会话存本机 localStorage：与业务数据同一 origin，不随包分发，也不写入仓库。 */
function load(): CloudSession | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isSessionShape(parsed)) cached = parsed;
      else localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    cached = null;
  }
  return cached;
}

function persist(next: CloudSession | null): void {
  cached = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // 隐私模式等场景写入失败不影响本次会话
  }
}

function expiresInSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_EXPIRES_IN_SECONDS;
}

async function postJson(
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${cloudBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } catch {
    throw new AppError('CLOUD_NETWORK', controller.signal.aborted ? '请求超时' : '网络不可用');
  } finally {
    clearTimeout(timer);
  }
}

function toSession(
  payload: Record<string, unknown>,
  username: string,
  fallbackRefresh = '',
): CloudSession | null {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  const refreshToken =
    (typeof payload.refresh_token === 'string' ? payload.refresh_token : '') || fallbackRefresh;
  const userId = typeof payload.sub === 'string' ? payload.sub : '';
  if (!accessToken || !refreshToken || !userId) return null;
  return {
    userId,
    username,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresInSeconds(payload.expires_in) * 1000,
  };
}

async function refreshSession(session: CloudSession): Promise<CloudSession | null> {
  try {
    const result = await postJson(
      '/auth/v1/token',
      { Authorization: `Bearer ${cloudPublishableKey()}` },
      { grant_type: 'refresh_token', refresh_token: session.refreshToken },
    );
    if (result.status < 200 || result.status >= 300) return null;
    const next = toSession(
      JSON.parse(result.text) as Record<string, unknown>,
      session.username,
      session.refreshToken,
    );
    if (!next) return null;
    persist(next);
    return next;
  } catch {
    return null;
  }
}

export async function signIn(username: string, password: string): Promise<CloudSession> {
  if (!isCloudConfigured()) throw new AppError('CLOUD_NOT_CONFIGURED', '未配置云端环境');
  const name = username.trim();
  if (!name || !password) throw new AppError('CLOUD_AUTH', '请填写账号和密码');

  const result = await postJson(
    '/auth/v1/signin',
    { Authorization: `Bearer ${cloudPublishableKey()}` },
    { username: name, password },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new AppError('CLOUD_AUTH', `登录失败：HTTP ${result.status}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    throw new AppError('CLOUD_FAILED', '登录响应无法解析');
  }

  const session = toSession(payload, name);
  if (!session) throw new AppError('CLOUD_FAILED', '登录响应缺少令牌');
  persist(session);
  return session;
}

/** 取当前会话；临近过期自动刷新，刷新失败即清会话并返回 null。 */
export async function getCloudSession(): Promise<CloudSession | null> {
  const session = load();
  if (!session) return null;
  if (session.expiresAt - Date.now() > REFRESH_AHEAD_MS) return session;

  if (!refreshInFlight) {
    refreshInFlight = refreshSession(session)
      .then((next) => {
        if (!next) persist(null);
        return next;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function getAccessToken(): Promise<string | null> {
  return (await getCloudSession())?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  persist(null);
}
