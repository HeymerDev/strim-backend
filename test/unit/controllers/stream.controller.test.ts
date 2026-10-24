jest.mock('../../../src/config/mediamtx', () => ({
  ...jest.requireActual('../../../src/config/mediamtx'),
  kickPublisher: jest.fn(),
  listLiveSignals: jest.fn(),
}));
jest.mock('../../../src/sockets/emit');

import { kickPublisher } from '../../../src/config/mediamtx';
import {
  getStream,
  kickQuietly,
  notifyStreamChange,
  regenerateKey,
  startStream,
  stopStream,
  updateStream,
} from '../../../src/controllers/stream.controller';
import { emitToChannel, emitToUser } from '../../../src/sockets/emit';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';
import { buildAuth, buildProfile, STREAM_KEY, stubUpdate } from '../../helpers/models';
import type { ChannelStatus } from '../../../src/models';

const kick = jest.mocked(kickPublisher);
const STARTED = new Date('2026-10-23T18:30:00.000Z');

// Perfil del streamer con canal en `status`, y su petición autenticada.
function setup(status: ChannelStatus, channel: { title?: string; liveStartedAt?: Date | null } = {}, body: unknown = {}) {
  const profile = buildProfile({ id: 'user-1', username: 'ana' }, { status, ...channel });
  const update = stubUpdate(profile.channel!);
  const req = mockRequest({ auth: buildAuth(profile), body });
  const res = mockResponse();
  return { profile, update, req, res };
}

// Eventos emitidos con su destino, en orden.
const emitted = () => [
  ...jest.mocked(emitToChannel).mock.calls.map(([room, event, payload]) => ({ to: `channel:${room}`, event, payload })),
  ...jest.mocked(emitToUser).mock.calls.map(([room, event, payload]) => ({ to: `user:${room}`, event, payload })),
];

beforeEach(() => {
  kick.mockReset();
  kick.mockResolvedValue(true);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('notifyStreamChange', () => {
  it('en vivo: emite stream:status a la sala y stream:state al dueño', () => {
    const profile = buildProfile({ id: 'user-1', username: 'ana' }, { status: 'live', title: 'Jugando', liveStartedAt: STARTED });

    notifyStreamChange(profile);

    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:status', {
      isLive: true,
      liveStartedAt: '2026-10-23T18:30:00.000Z',
      playbackUrl: 'http://localhost:8888/live/ana/index.m3u8',
    });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'stream:state', {
      status: 'live',
      title: 'Jugando',
      liveStartedAt: '2026-10-23T18:30:00.000Z',
    });
  });

  it('en waiting: la sala recibe isLive false y el dueño el estado waiting', () => {
    const profile = buildProfile({ id: 'user-1' }, { status: 'waiting', title: 'Pronto' });

    notifyStreamChange(profile);

    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:status', {
      isLive: false,
      liveStartedAt: null,
      playbackUrl: null,
    });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'stream:state', {
      status: 'waiting',
      title: 'Pronto',
      liveStartedAt: null,
    });
  });

  it('nunca manda la stream key por el socket', () => {
    notifyStreamChange(buildProfile({}, { status: 'live', liveStartedAt: STARTED }));

    expect(JSON.stringify(emitted())).not.toContain(STREAM_KEY);
  });
});

describe('kickQuietly', () => {
  it('corta la señal del username', async () => {
    await kickQuietly('ana');

    expect(kick).toHaveBeenCalledWith('ana');
  });

  it('no lanza si MediaMTX falla; solo avisa en el log', async () => {
    kick.mockRejectedValue(new Error('MediaMTX caído'));

    await expect(kickQuietly('ana')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('MediaMTX caído'));
  });
});

describe('getStream', () => {
  it('responde el dashboard con los datos para OBS', async () => {
    const { req, res } = setup('offline');

    await runHandler(getStream, req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'offline', obs: { server: 'rtmp://localhost:1935/live', streamKey: `ana?key=${STREAM_KEY}` } }),
    );
  });
});

describe('regenerateKey', () => {
  it.each(['waiting', 'live'] as const)('con el canal %s → CHANNEL_LIVE sin cambiar la clave', async (status) => {
    const { req, update } = setup(status);

    await expect(runHandler(regenerateKey, req)).rejects.toMatchObject({ code: 'CHANNEL_LIVE', status: 409 });
    expect(update).not.toHaveBeenCalled();
  });

  it('offline: guarda una clave nueva de 32 caracteres y responde el dashboard', async () => {
    const { req, res, update, profile } = setup('offline');

    await runHandler(regenerateKey, req, res);

    expect(update).toHaveBeenCalledWith({ streamKey: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/) });
    const newKey = profile.channel!.streamKey;
    expect(newKey).not.toBe(STREAM_KEY);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ obs: expect.objectContaining({ streamKey: `ana?key=${newKey}` }) }));
  });
});

describe('startStream', () => {
  it('offline → waiting, guarda el título y avisa stream:title, stream:status y stream:state', async () => {
    const { req, res, update } = setup('offline', { title: '' }, { title: 'Jugando' });

    await runHandler(startStream, req, res);

    expect(update).toHaveBeenCalledWith({ status: 'waiting', title: 'Jugando' });
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:title', { title: 'Jugando' });
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:status', expect.objectContaining({ isLive: false }));
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'stream:state', expect.objectContaining({ status: 'waiting', title: 'Jugando' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting', title: 'Jugando' }));
  });

  it('offline sin título → waiting, sin aviso de título', async () => {
    const { req, res, update } = setup('offline');

    await runHandler(startStream, req, res);

    expect(update).toHaveBeenCalledWith({ status: 'waiting' });
    expect(emitToChannel).not.toHaveBeenCalledWith('user-1', 'stream:title', expect.anything());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting' }));
  });

  it('es idempotente: si ya está live no cambia el estado', async () => {
    const { req, res, update } = setup('live', { liveStartedAt: STARTED, title: 'Jugando' });

    await runHandler(startStream, req, res);

    expect(update).toHaveBeenCalledWith({});
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'live', liveStartedAt: '2026-10-23T18:30:00.000Z' }),
    );
  });

  it('si ya está waiting, solo actualiza el título', async () => {
    const { req, res, update } = setup('waiting', { title: 'Viejo' }, { title: 'Nuevo' });

    await runHandler(startStream, req, res);

    expect(update).toHaveBeenCalledWith({ title: 'Nuevo' });
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:title', { title: 'Nuevo' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting', title: 'Nuevo' }));
  });

  it('con el mismo título no avisa stream:title', async () => {
    const { req } = setup('waiting', { title: 'Igual' }, { title: 'Igual' });

    await runHandler(startStream, req);

    expect(emitToChannel).not.toHaveBeenCalledWith('user-1', 'stream:title', expect.anything());
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:status', expect.anything());
  });
});

describe('stopStream', () => {
  it('pasa a offline, borra liveStartedAt, avisa y después corta a OBS', async () => {
    const { req, res, update } = setup('live', { liveStartedAt: STARTED });

    await runHandler(stopStream, req, res);

    expect(update).toHaveBeenCalledWith({ status: 'offline', liveStartedAt: null });
    expect(kick).toHaveBeenCalledWith('ana');
    // offline antes del corte: así MediaMTX rechaza la reconexión de OBS.
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(kick.mock.invocationCallOrder[0]);
    expect(jest.mocked(emitToChannel).mock.invocationCallOrder[0]).toBeLessThan(kick.mock.invocationCallOrder[0]);
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:status', { isLive: false, liveStartedAt: null, playbackUrl: null });
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'stream:state', expect.objectContaining({ status: 'offline' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline', liveStartedAt: null }));
  });

  it('si MediaMTX falla al cortar, la petición no falla', async () => {
    kick.mockRejectedValue(new Error('MediaMTX no responde'));
    const { req, res } = setup('waiting');

    await expect(runHandler(stopStream, req, res)).resolves.toBeUndefined();

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' }));
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('updateStream', () => {
  it('guarda el título y avisa stream:title y el estado', async () => {
    const { req, res, update } = setup('live', { liveStartedAt: STARTED, title: 'Viejo' }, { title: 'Nuevo título' });

    await runHandler(updateStream, req, res);

    expect(update).toHaveBeenCalledWith({ title: 'Nuevo título' });
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:title', { title: 'Nuevo título' });
    expect(emitToChannel).toHaveBeenCalledWith('user-1', 'stream:status', expect.objectContaining({ isLive: true }));
    expect(emitToUser).toHaveBeenCalledWith('user-1', 'stream:state', expect.objectContaining({ title: 'Nuevo título' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nuevo título', status: 'live' }));
  });
});
