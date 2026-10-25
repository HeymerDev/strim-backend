import type { SocketData, StrimServer, StrimSocket } from '../../src/sockets/types';

// Socket de Socket.IO falso: solo data, join y leave.
export type FakeSocket = {
  id: string;
  data: SocketData;
  join: jest.Mock;
  leave: jest.Mock;
};

export function fakeSocket(data: Partial<SocketData> = {}, id = 'socket-1'): FakeSocket {
  return {
    id,
    data: { userId: null, exp: null, channelId: null, ...data },
    join: jest.fn(async () => undefined),
    leave: jest.fn(),
  };
}

export const asSocket = (socket: FakeSocket) => socket as unknown as StrimSocket;

// Servidor de Socket.IO falso para setSocketServer(): registra cada emit con su sala.
export type FakeServer = {
  emitted: { room: string; event: string; payload: unknown }[];
  disconnected: { room: string; close: unknown }[];
  // Sala → ids de los sockets que están en ella.
  rooms: Map<string, Set<string>>;
  // Sockets conectados a este servidor.
  sockets: Map<string, FakeSocket>;
  server: StrimServer;
};

export function fakeServer(): FakeServer {
  const fake = {
    emitted: [],
    disconnected: [],
    rooms: new Map<string, Set<string>>(),
    sockets: new Map<string, FakeSocket>(),
  } as unknown as FakeServer;

  fake.server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        fake.emitted.push({ room, event, payload });
        return true;
      },
    }),
    in: (room: string) => ({
      disconnectSockets: (close: unknown) => {
        fake.disconnected.push({ room, close });
      },
    }),
    sockets: {
      adapter: { rooms: fake.rooms },
      sockets: fake.sockets,
    },
  } as unknown as StrimServer;

  return fake;
}
