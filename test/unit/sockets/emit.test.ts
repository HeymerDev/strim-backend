import {
  channelRoom,
  closeChannelRoom,
  disconnectUser,
  emitToChannel,
  emitToUser,
  flushViewerCounts,
  getViewers,
  markViewersChanged,
  setSocketServer,
  userRoom,
} from '../../../src/sockets/emit';
import { fakeServer, fakeSocket, type FakeServer } from '../../helpers/socket';

let io: FakeServer;

beforeEach(() => {
  // Vacía las salas marcadas que pudiera haber dejado otra prueba (sin io no emite nada).
  setSocketServer(null);
  flushViewerCounts();

  io = fakeServer();
  setSocketServer(io.server);
});
afterEach(() => setSocketServer(null));

describe('nombres de las salas', () => {
  it('channel:<id> y user:<id>', () => {
    expect(channelRoom('abc')).toBe('channel:abc');
    expect(userRoom('abc')).toBe('user:abc');
  });
});

describe('emitToChannel / emitToUser', () => {
  it('emitToChannel emite a la sala del canal', () => {
    emitToChannel('canal-1', 'stream:title', { title: 'Hola' });

    expect(io.emitted).toEqual([{ room: 'channel:canal-1', event: 'stream:title', payload: { title: 'Hola' } }]);
  });

  it('emitToUser emite a la sala del usuario', () => {
    emitToUser('user-1', 'stream:state', { status: 'live', title: '', liveStartedAt: null });

    expect(io.emitted).toEqual([
      { room: 'user:user-1', event: 'stream:state', payload: { status: 'live', title: '', liveStartedAt: null } },
    ]);
  });
});

describe('getViewers', () => {
  it('devuelve el tamaño de la sala del canal', () => {
    io.rooms.set('channel:canal-1', new Set(['s1', 's2', 's3']));

    expect(getViewers('canal-1')).toBe(3);
  });

  it('devuelve 0 si la sala no existe', () => {
    expect(getViewers('vacio')).toBe(0);
  });

  it('devuelve 0 si Socket.IO no está iniciado', () => {
    setSocketServer(null);

    expect(getViewers('canal-1')).toBe(0);
  });
});

describe('flushViewerCounts', () => {
  it('solo avisa a las salas marcadas, con su número de espectadores', () => {
    io.rooms.set('channel:a', new Set(['s1', 's2']));
    io.rooms.set('channel:c', new Set(['s3', 's4', 's5']));
    markViewersChanged('a');
    markViewersChanged('b');

    flushViewerCounts();

    expect(io.emitted).toEqual([
      { room: 'channel:a', event: 'viewers:count', payload: { viewers: 2 } },
      { room: 'channel:b', event: 'viewers:count', payload: { viewers: 0 } },
    ]);
  });

  it('marcar dos veces la misma sala avisa una sola vez', () => {
    markViewersChanged('a');
    markViewersChanged('a');

    flushViewerCounts();

    expect(io.emitted).toHaveLength(1);
  });

  it('después de avisar limpia las marcas', () => {
    markViewersChanged('a');
    flushViewerCounts();
    io.emitted.length = 0;

    flushViewerCounts();

    expect(io.emitted).toEqual([]);
  });
});

describe('closeChannelRoom', () => {
  it('avisa channel:deleted y saca de la sala a sus sockets limpiando channelId', () => {
    const inRoom1 = fakeSocket({ channelId: 'canal-1' }, 's1');
    const inRoom2 = fakeSocket({ channelId: 'canal-1', userId: 'u2' }, 's2');
    const elsewhere = fakeSocket({ channelId: 'canal-2' }, 's3');
    for (const socket of [inRoom1, inRoom2, elsewhere]) io.sockets.set(socket.id, socket);

    closeChannelRoom('canal-1');

    expect(io.emitted).toEqual([{ room: 'channel:canal-1', event: 'channel:deleted', payload: {} }]);
    for (const socket of [inRoom1, inRoom2]) {
      expect(socket.leave).toHaveBeenCalledWith('channel:canal-1');
      expect(socket.data.channelId).toBeNull();
    }
    expect(elsewhere.leave).not.toHaveBeenCalled();
    expect(elsewhere.data.channelId).toBe('canal-2');
  });

  it('sin Socket.IO no hace nada', () => {
    setSocketServer(null);

    expect(() => closeChannelRoom('canal-1')).not.toThrow();
    expect(io.emitted).toEqual([]);
  });
});

describe('disconnectUser', () => {
  it('cierra todas las conexiones de la sala del usuario', () => {
    disconnectUser('user-1');

    expect(io.disconnected).toEqual([{ room: 'user:user-1', close: true }]);
  });
});

describe('sin Socket.IO iniciado', () => {
  it('los avisos no hacen nada ni lanzan', () => {
    setSocketServer(null);

    expect(() => {
      emitToChannel('canal-1', 'stream:title', { title: 'x' });
      emitToUser('user-1', 'stream:title', { title: 'x' });
      disconnectUser('user-1');
      markViewersChanged('canal-1');
      flushViewerCounts();
    }).not.toThrow();
    expect(io.emitted).toEqual([]);
    expect(io.disconnected).toEqual([]);
  });
});
