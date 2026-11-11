/**
 * 067 云端备份通道：单表 p067_snapshots（E-01 共享环境，PostgREST）。
 *
 * 只做「手动备份 / 手动恢复」，不做实时多设备同步；本地 IndexedDB 始终是主库。
 * 表结构见 docs/sql/p067_cloud_schema.sql。
 */
import { AppError, type Snapshot } from '../domain/types';
import { buildBackup } from '../storage/importExport';
import { cloudBaseUrl, getAccessToken } from './cloudbaseAuth';

const TABLE = 'p067_snapshots';
const REQUEST_TIMEOUT_MS = 20_000;
const LIST_LIMIT = 20;

export interface CloudSnapshotMeta {
  id: string;
  created_at: string;
  item_count: number;
  event_count: number;
  checksum: string;
  schema_version: number;
  device_label: string | null;
}

const LIST_COLUMNS = 'id,created_at,item_count,event_count,checksum,schema_version,device_label';

function deviceLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  return 'Web';
}

function newSnapshotId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle as
    | SubtleCrypto
    | undefined;
  if (!subtle) throw new AppError('CLOUD_FAILED', '当前环境不支持 sha256');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function request(
  method: 'GET' | 'POST' | 'DELETE',
  query: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const token = await getAccessToken();
  if (!token) throw new AppError('CLOUD_AUTH', '登录已失效，请重新登录');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${cloudBaseUrl()}/v1/rdb/rest/${TABLE}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Prefer:
          method === 'POST'
            ? 'return=representation'
            : method === 'DELETE'
              ? 'return=minimal'
              : 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new AppError('CLOUD_AUTH', `云端拒绝访问：HTTP ${response.status}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AppError('CLOUD_FAILED', `云端返回 HTTP ${response.status}`);
    }
    return { status: response.status, text };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('CLOUD_NETWORK', controller.signal.aborted ? '请求超时' : '网络不可用');
  } finally {
    clearTimeout(timer);
  }
}

function parseRows(text: string): Record<string, unknown>[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    throw new AppError('CLOUD_FAILED', '云端响应无法解析');
  }
}

function toMeta(row: Record<string, unknown>): CloudSnapshotMeta {
  return {
    id: String(row.id ?? ''),
    created_at: String(row.created_at ?? ''),
    item_count: Number(row.item_count ?? 0),
    event_count: Number(row.event_count ?? 0),
    checksum: String(row.checksum ?? ''),
    schema_version: Number(row.schema_version ?? 1),
    device_label: typeof row.device_label === 'string' ? row.device_label : null,
  };
}

/** 把当前本地快照整包上传为一条云端备份记录。 */
export async function uploadSnapshot(snapshot: Snapshot): Promise<CloudSnapshotMeta> {
  const text = buildBackup(snapshot);
  const payload = JSON.parse(text) as Record<string, unknown>;
  const body = {
    id: newSnapshotId(),
    schema_version: Number(payload.schemaVersion ?? 1),
    item_count: snapshot.items.length,
    event_count: snapshot.events.length,
    checksum: await sha256Hex(text),
    payload,
    device_label: deviceLabel(),
  };
  const { text: responseText } = await request('POST', '', body);
  const rows = parseRows(responseText);
  return rows.length > 0 ? toMeta(rows[0]) : { ...toMeta(body), created_at: new Date().toISOString() };
}

export async function listSnapshots(): Promise<CloudSnapshotMeta[]> {
  const query = `?select=${LIST_COLUMNS}&order=created_at.desc&limit=${LIST_LIMIT}`;
  const { text } = await request('GET', query);
  return parseRows(text).map(toMeta);
}

/** 取回某条备份的原始 payload（形状与本地导出 JSON 一致）。 */
export async function downloadSnapshotText(id: string): Promise<string> {
  const query = `?select=payload&id=eq.${encodeURIComponent(id)}&limit=1`;
  const { text } = await request('GET', query);
  const rows = parseRows(text);
  if (rows.length === 0) throw new AppError('CLOUD_FAILED', '备份不存在或已删除');
  return JSON.stringify(rows[0].payload);
}

export async function deleteSnapshot(id: string): Promise<void> {
  await request('DELETE', `?id=eq.${encodeURIComponent(id)}`);
}
