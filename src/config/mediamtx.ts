import { env } from './env';

// Cliente mínimo de la API de MediaMTX v3 (diseño §8.4 y §8.5).

const LIVE_PATH = /^live\/([a-z0-9_]{3,20})$/;

// Tipo de fuente en /v3/paths/list → recurso para cortarla.
const KICK_RESOURCES: Record<string, string> = {
  rtmpConn: 'rtmpconns',
  rtmpsConn: 'rtmpsconns',
};

type PathItem = {
  name: string;
  ready: boolean;
  readyTime: string | null;
  source: { type: string; id: string } | null;
};

export type LiveSignal = {
  ready: boolean;
  readyTime: Date | null;
  source: { type: string; id: string } | null;
};

export const usernameFromPath = (path: string) => LIVE_PATH.exec(path)?.[1] ?? null;

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(`${env.MEDIAMTX_API_URL}${path}`, { ...init, signal: AbortSignal.timeout(2_000) });
  if (!res.ok) throw new Error(`MediaMTX ${init?.method ?? 'GET'} ${path} respondió ${res.status}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

// Señales en rutas live/<username>, listas o conectándose, por username.
export async function listLiveSignals(): Promise<Map<string, LiveSignal>> {
  const data = await call<{ items: PathItem[] }>('/v3/paths/list?itemsPerPage=1000');
  const signals = new Map<string, LiveSignal>();
  for (const item of data?.items ?? []) {
    const username = usernameFromPath(item.name);
    if (!username) continue;
    signals.set(username, {
      ready: item.ready,
      readyTime: item.readyTime ? new Date(item.readyTime) : null,
      source: item.source,
    });
  }
  return signals;
}

// Corta la conexión de OBS de un canal. Devuelve false si no había ninguna.
export async function kickPublisher(username: string): Promise<boolean> {
  const source = (await listLiveSignals()).get(username)?.source;
  const resource = source && KICK_RESOURCES[source.type];
  if (!source || !resource) return false;
  await call(`/v3/${resource}/kick/${source.id}`, { method: 'POST' });
  return true;
}
