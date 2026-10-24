// El monitor guarda `running` y `mediaMtxDown` en memoria del módulo: cada prueba lo carga
// de nuevo con jest.isolateModules, junto con sus dependencias simuladas.
jest.mock('../../../src/config/mediamtx', () => ({ listLiveSignals: jest.fn() }));
jest.mock('../../../src/controllers/stream.controller', () => ({ kickQuietly: jest.fn(), notifyStreamChange: jest.fn() }));
jest.mock('../../../src/models', () => ({ Profile: { findAll: jest.fn() }, Channel: { update: jest.fn() } }));

import type { LiveSignal } from '../../../src/config/mediamtx';
import type { ChannelStatus } from '../../../src/models';

type FakeProfile = {
  id: string;
  username: string;
  channel: { status: ChannelStatus; set: jest.Mock };
};

type Monitor = {
  startStreamMonitor: () => () => void;
  listLiveSignals: jest.Mock;
  kickQuietly: jest.Mock;
  notifyStreamChange: jest.Mock;
  Profile: { findAll: jest.Mock };
  Channel: { update: jest.Mock };
};

const READY_TIME = new Date('2026-10-23T18:30:00.000Z');
const NOW = new Date('2026-10-23T20:00:00.000Z');

function loadMonitor(): Monitor {
  let monitor!: Monitor;
  jest.isolateModules(() => {
    monitor = {
      startStreamMonitor: require('../../../src/jobs/streamMonitor').startStreamMonitor,
      listLiveSignals: require('../../../src/config/mediamtx').listLiveSignals,
      ...require('../../../src/controllers/stream.controller'),
      ...require('../../../src/models'),
    };
  });
  return monitor;
}

const fakeProfile = (id: string, username: string, status: ChannelStatus): FakeProfile => ({
  id,
  username,
  channel: { status, set: jest.fn() },
});

const signal = (init: Partial<LiveSignal> = {}): LiveSignal => ({
  ready: true,
  readyTime: READY_TIME,
  source: { type: 'rtmpConn', id: 'conn-1' },
  ...init,
});

// Deja correr las promesas pendientes (setImmediate no está simulado).
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

let m: Monitor;
let stop: (() => void) | undefined;

// Arranca el monitor (primera pasada inmediata) y espera a que termine.
async function runFirstTick() {
  stop = m.startStreamMonitor();
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  jest.setSystemTime(NOW);
  m = loadMonitor();
  m.Channel.update.mockResolvedValue([1]);
  m.kickQuietly.mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  stop?.();
  stop = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('streamMonitor', () => {
  it('live sin señal → waiting, con Channel.update condicionado a status live', async () => {
    const ana = fakeProfile('id-ana', 'ana', 'live');
    m.listLiveSignals.mockResolvedValue(new Map());
    m.Profile.findAll.mockResolvedValueOnce([ana]);

    await runFirstTick();

    expect(m.Profile.findAll).toHaveBeenCalledWith({ include: [{ model: m.Channel, where: { status: 'live' } }] });
    expect(m.Channel.update).toHaveBeenCalledWith(
      { status: 'waiting', liveStartedAt: null },
      { where: { userId: 'id-ana', status: 'live' } },
    );
    expect(ana.channel.set).toHaveBeenCalledWith({ status: 'waiting', liveStartedAt: null });
    expect(m.notifyStreamChange).toHaveBeenCalledWith(ana);
    // Sin señales listas no busca más perfiles.
    expect(m.Profile.findAll).toHaveBeenCalledTimes(1);
  });

  it('live con una señal que no está lista (ready: false) también pasa a waiting', async () => {
    const ana = fakeProfile('id-ana', 'ana', 'live');
    m.listLiveSignals.mockResolvedValue(new Map([['ana', signal({ ready: false, readyTime: null })]]));
    m.Profile.findAll.mockResolvedValueOnce([ana]);

    await runFirstTick();

    expect(m.Channel.update).toHaveBeenCalledWith(
      { status: 'waiting', liveStartedAt: null },
      { where: { userId: 'id-ana', status: 'live' } },
    );
  });

  it('live con señal lista no cambia', async () => {
    const ana = fakeProfile('id-ana', 'ana', 'live');
    m.listLiveSignals.mockResolvedValue(new Map([['ana', signal()]]));
    m.Profile.findAll.mockResolvedValueOnce([ana]).mockResolvedValueOnce([ana]);

    await runFirstTick();

    expect(m.Channel.update).not.toHaveBeenCalled();
    expect(m.notifyStreamChange).not.toHaveBeenCalled();
  });

  it('waiting con señal → live con el readyTime de MediaMTX', async () => {
    const beto = fakeProfile('id-beto', 'beto', 'waiting');
    m.listLiveSignals.mockResolvedValue(new Map([['beto', signal()]]));
    m.Profile.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([beto]);

    await runFirstTick();

    expect(m.Profile.findAll).toHaveBeenLastCalledWith({ where: { username: ['beto'] }, include: [m.Channel] });
    expect(m.Channel.update).toHaveBeenCalledWith(
      { status: 'live', liveStartedAt: READY_TIME },
      { where: { userId: 'id-beto', status: 'waiting' } },
    );
    expect(beto.channel.set).toHaveBeenCalledWith({ status: 'live', liveStartedAt: READY_TIME });
    expect(m.notifyStreamChange).toHaveBeenCalledWith(beto);
  });

  it('waiting con señal sin readyTime → live con la hora actual', async () => {
    const beto = fakeProfile('id-beto', 'beto', 'waiting');
    m.listLiveSignals.mockResolvedValue(new Map([['beto', signal({ readyTime: null })]]));
    m.Profile.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([beto]);

    await runFirstTick();

    expect(m.Channel.update).toHaveBeenCalledWith(
      { status: 'live', liveStartedAt: NOW },
      { where: { userId: 'id-beto', status: 'waiting' } },
    );
  });

  it('solo busca los perfiles de las señales listas', async () => {
    m.listLiveSignals.mockResolvedValue(
      new Map([
        ['beto', signal()],
        ['carla', signal({ ready: false })],
      ]),
    );
    m.Profile.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await runFirstTick();

    expect(m.Profile.findAll).toHaveBeenLastCalledWith({ where: { username: ['beto'] }, include: [m.Channel] });
  });

  it('offline con señal → corta a OBS sin cambiar el estado', async () => {
    const carla = fakeProfile('id-carla', 'carla', 'offline');
    m.listLiveSignals.mockResolvedValue(new Map([['carla', signal()]]));
    m.Profile.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([carla]);

    await runFirstTick();

    expect(m.kickQuietly).toHaveBeenCalledWith('carla');
    expect(m.Channel.update).not.toHaveBeenCalled();
    expect(m.notifyStreamChange).not.toHaveBeenCalled();
  });

  it('si Channel.update devuelve 0 (el estado cambió mientras tanto), no avisa', async () => {
    const ana = fakeProfile('id-ana', 'ana', 'live');
    m.listLiveSignals.mockResolvedValue(new Map());
    m.Profile.findAll.mockResolvedValueOnce([ana]);
    m.Channel.update.mockResolvedValue([0]);

    await runFirstTick();

    expect(m.Channel.update).toHaveBeenCalled();
    expect(ana.channel.set).not.toHaveBeenCalled();
    expect(m.notifyStreamChange).not.toHaveBeenCalled();
  });

  it('si MediaMTX no responde, no cambia ningún estado y avisa una sola vez', async () => {
    m.listLiveSignals.mockRejectedValue(new Error('fetch failed'));

    await runFirstTick();
    await jest.advanceTimersByTimeAsync(3_000);
    await flush();

    expect(m.listLiveSignals).toHaveBeenCalledTimes(2);
    expect(m.Profile.findAll).not.toHaveBeenCalled();
    expect(m.Channel.update).not.toHaveBeenCalled();
    expect(m.kickQuietly).not.toHaveBeenCalled();
    expect(m.notifyStreamChange).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('fetch failed'));
  });

  it('cuando MediaMTX vuelve a responder lo registra y sigue revisando', async () => {
    m.listLiveSignals.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue(new Map());
    m.Profile.findAll.mockResolvedValue([]);

    await runFirstTick();
    await jest.advanceTimersByTimeAsync(3_000);
    await flush();

    expect(console.log).toHaveBeenCalledWith('[monitor] MediaMTX volvió a responder.');
    expect(m.Profile.findAll).toHaveBeenCalledTimes(1);
  });

  it('repite cada 3 s y deja de hacerlo al llamar a la función que devuelve', async () => {
    m.listLiveSignals.mockResolvedValue(new Map());
    m.Profile.findAll.mockResolvedValue([]);

    await runFirstTick();
    expect(m.listLiveSignals).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(m.listLiveSignals).toHaveBeenCalledTimes(2);

    stop!();
    await jest.advanceTimersByTimeAsync(9_000);
    await flush();
    expect(m.listLiveSignals).toHaveBeenCalledTimes(2);
  });

  it('no empieza una pasada mientras la anterior sigue en curso', async () => {
    let resolveSignals!: (signals: Map<string, LiveSignal>) => void;
    m.listLiveSignals.mockReturnValueOnce(new Promise((resolve) => (resolveSignals = resolve)));
    m.Profile.findAll.mockResolvedValue([]);

    await runFirstTick();
    await jest.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(m.listLiveSignals).toHaveBeenCalledTimes(1);

    resolveSignals(new Map());
    await flush();
    m.listLiveSignals.mockResolvedValue(new Map());
    await jest.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(m.listLiveSignals).toHaveBeenCalledTimes(2);
  });

  it('un error de la base no detiene el monitor: lo registra y la siguiente pasada corre', async () => {
    m.listLiveSignals.mockResolvedValue(new Map());
    m.Profile.findAll.mockRejectedValueOnce(new Error('db caída')).mockResolvedValue([]);

    await runFirstTick();
    expect(console.error).toHaveBeenCalledWith('[monitor] error al revisar las señales', expect.any(Error));

    await jest.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(m.Profile.findAll).toHaveBeenCalledTimes(2);
  });
});
