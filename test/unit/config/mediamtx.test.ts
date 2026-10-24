import { kickPublisher, listLiveSignals, usernameFromPath } from '../../../src/config/mediamtx';

const API = 'http://127.0.0.1:9997';
const LIST_URL = `${API}/v3/paths/list?itemsPerPage=1000`;

type PathItem = {
  name: string;
  ready: boolean;
  readyTime: string | null;
  source: { type: string; id: string } | null;
};

const path = (name: string, init: Partial<PathItem> = {}): PathItem => ({
  name,
  ready: true,
  readyTime: '2026-10-23T18:30:00Z',
  source: { type: 'rtmpConn', id: `conn-${name}` },
  ...init,
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// fetch simulado: responde según la URL. Cada llamada recibe una Response nueva.
function mockFetch(routes: Record<string, () => Response>) {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`fetch inesperado a ${url}`);
    return route();
  });
}

afterEach(() => jest.restoreAllMocks());

describe('usernameFromPath', () => {
  it.each([
    ['live/ana', 'ana'],
    ['live/ana_01', 'ana_01'],
  ])('"%s" → "%s"', (path, username) => {
    expect(usernameFromPath(path)).toBe(username);
  });

  it.each(['live/Ana', 'live/ab', 'other/ana', 'live/ana/extra', 'live/', 'ana'])('"%s" → null', (path) => {
    expect(usernameFromPath(path)).toBeNull();
  });
});

describe('listLiveSignals', () => {
  it('pide /v3/paths/list a MEDIAMTX_API_URL con un timeout', async () => {
    const fetchSpy = mockFetch({ [LIST_URL]: () => jsonResponse({ items: [] }) });

    await listLiveSignals();

    expect(fetchSpy).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('solo toma las rutas live/<username> y convierte readyTime a Date', async () => {
    mockFetch({
      [LIST_URL]: () =>
        jsonResponse({
          items: [
            path('live/ana'),
            path('live/dan', { ready: false, readyTime: null, source: null }),
            path('live/Mayus'),
            path('live/ab'),
            path('otra/ruta'),
            path('live/ana/extra'),
          ],
        }),
    });

    const signals = await listLiveSignals();

    expect([...signals.keys()]).toEqual(['ana', 'dan']);
    expect(signals.get('ana')).toEqual({
      ready: true,
      readyTime: new Date('2026-10-23T18:30:00Z'),
      source: { type: 'rtmpConn', id: 'conn-live/ana' },
    });
    expect(signals.get('ana')?.readyTime).toBeInstanceOf(Date);
    expect(signals.get('dan')).toEqual({ ready: false, readyTime: null, source: null });
  });

  it('devuelve un Map vacío si la respuesta viene vacía o sin items', async () => {
    mockFetch({ [LIST_URL]: () => new Response('', { status: 200 }) });
    expect((await listLiveSignals()).size).toBe(0);

    jest.restoreAllMocks();
    mockFetch({ [LIST_URL]: () => jsonResponse({}) });
    expect((await listLiveSignals()).size).toBe(0);
  });

  it('lanza si MediaMTX responde con un estado no-ok', async () => {
    mockFetch({ [LIST_URL]: () => new Response('error', { status: 500 }) });

    await expect(listLiveSignals()).rejects.toThrow(`MediaMTX GET /v3/paths/list?itemsPerPage=1000 respondió 500`);
  });

  it('lanza si fetch falla (MediaMTX caído)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(listLiveSignals()).rejects.toThrow('fetch failed');
  });
});

describe('kickPublisher', () => {
  it.each([
    ['rtmpConn', 'rtmpconns'],
    ['rtmpsConn', 'rtmpsconns'],
  ])('fuente %s → POST /v3/%s/kick/<id> y devuelve true', async (type, resource) => {
    const kickUrl = `${API}/v3/${resource}/kick/abc123`;
    const fetchSpy = mockFetch({
      [LIST_URL]: () => jsonResponse({ items: [path('live/ana', { source: { type, id: 'abc123' } })] }),
      [kickUrl]: () => new Response('', { status: 200 }),
    });

    await expect(kickPublisher('ana')).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(kickUrl, expect.objectContaining({ method: 'POST' }));
  });

  it('devuelve false sin llamar al kick si el canal no tiene fuente', async () => {
    const fetchSpy = mockFetch({
      [LIST_URL]: () => jsonResponse({ items: [path('live/ana', { ready: false, source: null })] }),
    });

    await expect(kickPublisher('ana')).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('devuelve false si no hay ruta para ese username', async () => {
    const fetchSpy = mockFetch({ [LIST_URL]: () => jsonResponse({ items: [path('live/otro')] }) });

    await expect(kickPublisher('ana')).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('devuelve false si la fuente no es RTMP (no sabe cortarla)', async () => {
    const fetchSpy = mockFetch({
      [LIST_URL]: () => jsonResponse({ items: [path('live/ana', { source: { type: 'webRTCSession', id: 'x' } })] }),
    });

    await expect(kickPublisher('ana')).resolves.toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('lanza si el kick responde no-ok', async () => {
    mockFetch({
      [LIST_URL]: () => jsonResponse({ items: [path('live/ana', { source: { type: 'rtmpConn', id: 'abc' } })] }),
      [`${API}/v3/rtmpconns/kick/abc`]: () => new Response('not found', { status: 404 }),
    });

    await expect(kickPublisher('ana')).rejects.toThrow('MediaMTX POST /v3/rtmpconns/kick/abc respondió 404');
  });
});
