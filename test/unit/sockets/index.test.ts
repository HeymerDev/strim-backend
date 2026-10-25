// initSockets sobre un servidor HTTP local (puerto libre, 127.0.0.1) y clientes reales de
// socket.io-client: todo en proceso, como supertest. Los controladores del chat y la
// autenticación se simulan para probar solo el cableado, sin base de datos ni Supabase.
jest.mock('../../../src/middlewares/requireAuth', () => ({ authenticateToken: jest.fn() }));
jest.mock('../../../src/controllers/chat.controller', () => ({
  joinChannel: jest.fn(),
  leaveChannel: jest.fn(),
  sendMessage: jest.fn(),
}));
// userRoom y el resto quedan reales; setSocketServer se simula para no dejar un io global entre pruebas.
jest.mock('../../../src/sockets/emit', () => ({
  ...jest.requireActual('../../../src/sockets/emit'),
  markViewersChanged: jest.fn(),
  flushViewerCounts: jest.fn(),
  setSocketServer: jest.fn(),
}));

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { z } from 'zod';
import { env } from '../../../src/config/env';
import { joinChannel, leaveChannel, sendMessage } from '../../../src/controllers/chat.controller';
import { type AuthContext, authenticateToken } from '../../../src/middlewares/requireAuth';
import type { ChatMessageDTO, PublicChannelDTO } from '../../../src/models';
import { flushViewerCounts, markViewersChanged, setSocketServer } from '../../../src/sockets/emit';
import { initSockets } from '../../../src/sockets/index';
import type { StrimServer, StrimSocket } from '../../../src/sockets/types';
import { AppError } from '../../../src/utils/AppError';

const ACK_TIMEOUT_MS = 2_000;

const channel: PublicChannelDTO = {
  username: 'ana',
  displayName: 'Ana',
  bio: '',
  avatarUrl: null,
  title: 'Jugando',
  isLive: true,
  liveStartedAt: '2026-10-23T18:30:00.000Z',
  viewers: 3,
  playbackUrl: 'http://localhost:8888/live/ana/index.m3u8',
};

const message: ChatMessageDTO = {
  id: '7',
  content: 'hola',
  createdAt: '2026-10-23T18:31:00.000Z',
  author: { username: 'beto', displayName: 'Beto', avatarUrl: null },
};

// El socket solo usa userId y exp del contexto de autenticación.
const authOf = (userId: string, exp: number) =>
  ({ userId, exp, email: 'ana@example.com', accessToken: 'token-valido' }) as AuthContext;

type ConnectError = Error & { data?: unknown };

// Estado de cada prueba: se cierra todo en afterEach.
let io: StrimServer | undefined;
let clients: ClientSocket[] = [];
// Temporizadores de flushViewerCounts que creó initSockets, con su intervalo.
let flushTimers: { timer: NodeJS.Timeout; delay: number | undefined }[] = [];

// Arranca initSockets sobre un servidor HTTP en un puerto libre y devuelve su URL.
async function startServer(): Promise<{ io: StrimServer; url: string }> {
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const httpServer = http.createServer();
  const server = initSockets(httpServer);
  io = server;
  setIntervalSpy.mock.calls.forEach(([callback, delay], i) => {
    if (callback === flushViewerCounts) flushTimers.push({ timer: setIntervalSpy.mock.results[i].value, delay });
  });
  setIntervalSpy.mockRestore();

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { io: server, url: `http://127.0.0.1:${port}` };
}

function openClient(url: string, auth?: Record<string, unknown>): ClientSocket {
  const client = ioClient(url, { auth, forceNew: true, reconnection: false, transports: ['websocket'] });
  clients.push(client);
  return client;
}

// Espera a que el servidor acepte la conexión.
function connect(url: string, auth?: Record<string, unknown>): Promise<ClientSocket> {
  const client = openClient(url, auth);
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
}

// Espera a que el servidor rechace la conexión y devuelve el error de connect_error.
function connectRejected(url: string, auth?: Record<string, unknown>): Promise<ConnectError> {
  const client = openClient(url, auth);
  return new Promise((resolve, reject) => {
    client.once('connect_error', resolve);
    client.once('connect', () => reject(new Error('El servidor aceptó una conexión que debía rechazar.')));
  });
}

// Socket del servidor que corresponde a un cliente (en Socket.IO 4 comparten el id).
function serverSocketOf(server: StrimServer, client: ClientSocket): StrimSocket {
  const socket = server.sockets.sockets.get(client.id!);
  if (!socket) throw new Error(`No hay socket en el servidor para ${client.id}`);
  return socket;
}

const emitWithAck = (client: ClientSocket, event: string, ...args: unknown[]) =>
  client.timeout(ACK_TIMEOUT_MS).emitWithAck(event, ...args);

beforeEach(() => {
  // clearMocks solo borra las llamadas: las implementaciones se reinician aquí.
  jest.mocked(authenticateToken).mockReset();
  jest.mocked(joinChannel).mockReset().mockResolvedValue({ channel, messages: [message] });
  jest.mocked(leaveChannel).mockReset().mockReturnValue({});
  jest.mocked(sendMessage).mockReset().mockResolvedValue({ message });
});

afterEach(async () => {
  jest.useRealTimers();
  for (const client of clients) client.disconnect();
  clients = [];
  for (const { timer } of flushTimers) clearInterval(timer);
  flushTimers = [];
  // io.close() también cierra el servidor HTTP.
  if (io) await io.close();
  io = undefined;
  jest.restoreAllMocks();
});

describe('initSockets: arranque', () => {
  it('registra el servidor con setSocketServer y lo devuelve', async () => {
    const { io: server } = await startServer();

    expect(setSocketServer).toHaveBeenCalledTimes(1);
    expect(jest.mocked(setSocketServer).mock.calls[0][0]).toBe(server);
  });

  it('acepta conexiones solo desde FRONTEND_URL (CORS)', async () => {
    const { io: server } = await startServer();

    expect(server.engine.opts.cors).toEqual({ origin: env.FRONTEND_URL });
  });

  it('programa flushViewerCounts cada 5 s con un temporizador que no retiene el proceso', async () => {
    await startServer();

    expect(flushTimers).toHaveLength(1);
    expect(flushTimers[0].delay).toBe(5_000);
    expect(flushTimers[0].timer.hasRef()).toBe(false);
  });

  it('flushViewerCounts corre cada 5 s', async () => {
    // Solo se simulan setInterval/clearInterval: el resto de temporizadores sigue real.
    jest.useFakeTimers({
      doNotFake: [
        'Date',
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
      ],
    });
    await startServer();

    jest.advanceTimersByTime(4_999);
    expect(flushViewerCounts).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(flushViewerCounts).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10_000);
    expect(flushViewerCounts).toHaveBeenCalledTimes(3);
  });
});

describe('initSockets: conexión', () => {
  it.each([
    ['sin auth', undefined],
    ['con auth sin token', {}],
    ['con token vacío', { token: '' }],
    ['con token null', { token: null }],
  ])('%s → conecta como anónimo, sin userId ni sala de usuario', async (_caso, auth) => {
    const { io: server, url } = await startServer();

    const client = await connect(url, auth);

    const socket = serverSocketOf(server, client);
    expect(authenticateToken).not.toHaveBeenCalled();
    expect(socket.data).toEqual({ userId: null, exp: null, channelId: null });
    // Solo su sala propia (el id del socket), ninguna user:<id>.
    expect([...socket.rooms]).toEqual([socket.id]);
  });

  it.each([
    ['un número', 12345],
    ['un objeto', { access_token: 'abc' }],
    ['un booleano', true],
  ])('token que es %s → connect_error UNAUTHORIZED sin consultar authenticateToken', async (_caso, token) => {
    const { io: server, url } = await startServer();

    const err = await connectRejected(url, { token });

    expect(err.message).toBe('UNAUTHORIZED');
    expect(err.data).toEqual({ code: 'UNAUTHORIZED', message: 'Tu sesión no es válida o venció.' });
    expect(authenticateToken).not.toHaveBeenCalled();
    expect(server.sockets.sockets.size).toBe(0);
  });

  it('authenticateToken devuelve null (token inválido, vencido o cuenta borrada) → UNAUTHORIZED', async () => {
    jest.mocked(authenticateToken).mockResolvedValue(null);
    const { io: server, url } = await startServer();

    const err = await connectRejected(url, { token: 'token-vencido' });

    expect(authenticateToken).toHaveBeenCalledWith('token-vencido');
    expect(err.message).toBe('UNAUTHORIZED');
    expect(err.data).toEqual({ code: 'UNAUTHORIZED', message: 'Tu sesión no es válida o venció.' });
    expect(server.sockets.sockets.size).toBe(0);
  });

  it('authenticateToken lanza → INTERNAL_ERROR y lo registra en console.error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new Error('la base de datos no responde');
    jest.mocked(authenticateToken).mockRejectedValue(boom);
    const { io: server, url } = await startServer();

    const err = await connectRejected(url, { token: 'token-valido' });

    expect(err.message).toBe('INTERNAL_ERROR');
    expect(err.data).toEqual({ code: 'INTERNAL_ERROR', message: 'Algo salió mal.' });
    expect(consoleError).toHaveBeenCalledWith('[socket] error al autenticar la conexión', boom);
    expect(server.sockets.sockets.size).toBe(0);
  });

  it('token válido → guarda userId y exp, y entra a la sala user:<id>', async () => {
    jest.mocked(authenticateToken).mockResolvedValue(authOf('user-42', 1_800_000_000));
    const { io: server, url } = await startServer();

    const client = await connect(url, { token: 'token-valido' });

    const socket = serverSocketOf(server, client);
    expect(authenticateToken).toHaveBeenCalledWith('token-valido');
    expect(socket.data).toEqual({ userId: 'user-42', exp: 1_800_000_000, channelId: null });
    expect(socket.rooms.has('user:user-42')).toBe(true);
  });
});

describe('initSockets: eventos del chat', () => {
  it('chat:join llama a joinChannel con el socket y el payload, y responde { ok: true, … }', async () => {
    const { io: server, url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:join', { username: 'ana' });

    expect(ack).toEqual({ ok: true, channel, messages: [message] });
    expect(joinChannel).toHaveBeenCalledTimes(1);
    const [socket, payload] = jest.mocked(joinChannel).mock.calls[0];
    expect(socket).toBe(serverSocketOf(server, client));
    expect(payload).toEqual({ username: 'ana' });
    expect(leaveChannel).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('chat:leave llama a leaveChannel con el socket y responde { ok: true }', async () => {
    const { io: server, url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:leave');

    expect(ack).toEqual({ ok: true });
    expect(leaveChannel).toHaveBeenCalledTimes(1);
    expect(jest.mocked(leaveChannel).mock.calls[0]).toHaveLength(1);
    expect(jest.mocked(leaveChannel).mock.calls[0][0]).toBe(serverSocketOf(server, client));
    expect(joinChannel).not.toHaveBeenCalled();
  });

  it('chat:send llama a sendMessage con el socket y el payload, y responde { ok: true, message }', async () => {
    const { io: server, url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:send', { content: 'hola' });

    expect(ack).toEqual({ ok: true, message });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [socket, payload] = jest.mocked(sendMessage).mock.calls[0];
    expect(socket).toBe(serverSocketOf(server, client));
    expect(payload).toEqual({ content: 'hola' });
  });

  it('un AppError → { ok: false, error: { code, message } } sin details y sin registrar nada', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(sendMessage).mockRejectedValue(new AppError('RATE_LIMITED'));
    const { url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:send', { content: 'hola' });

    expect(ack).toEqual({ ok: false, error: { code: 'RATE_LIMITED', message: 'Vas muy rápido.' } });
    expect(ack.error).not.toHaveProperty('details');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('un AppError lanzado de forma síncrona (chat:leave) también llega por el ack', async () => {
    jest.mocked(leaveChannel).mockImplementation(() => {
      throw new AppError('NOT_FOUND');
    });
    const { url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:leave');

    expect(ack).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'No encontrado.' } });
  });

  it('un ZodError → VALIDATION_ERROR con details por campo', async () => {
    const schema = z.object({ content: z.string().min(1, 'Escribe un mensaje.') });
    const zodError = schema.safeParse({ content: '' }).error!;
    jest.mocked(sendMessage).mockRejectedValue(zodError);
    const { url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:send', { content: '' });

    expect(ack).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Hay datos inválidos.', details: { content: 'Escribe un mensaje.' } },
    });
  });

  it('un error inesperado → INTERNAL_ERROR sin detalles, y se registra en console.error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new Error('se cayó la base de datos');
    jest.mocked(joinChannel).mockRejectedValue(boom);
    const { url } = await startServer();
    const client = await connect(url);

    const ack = await emitWithAck(client, 'chat:join', { username: 'ana' });

    expect(ack).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Algo salió mal.' } });
    expect(ack.error).not.toHaveProperty('details');
    expect(consoleError).toHaveBeenCalledWith('[socket] error inesperado', boom);
  });

  it('sin función de ack no revienta, ni con éxito ni con error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new Error('inesperado');
    jest
      .mocked(sendMessage)
      .mockRejectedValueOnce(new AppError('RATE_LIMITED'))
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ message });
    const { url } = await startServer();
    const client = await connect(url);

    client.emit('chat:send', { content: 'uno' });
    client.emit('chat:send', { content: 'dos' });
    client.emit('chat:send', { content: 'tres' });
    client.emit('chat:join', { username: 'ana' });
    client.emit('chat:leave');
    // Un "ack" que no es función se ignora.
    client.emit('chat:leave', 'no-es-una-funcion');

    // El servidor atiende los eventos en orden: si este responde, los anteriores ya se procesaron.
    const ack = await emitWithAck(client, 'chat:leave');

    expect(ack).toEqual({ ok: true });
    expect(client.connected).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(joinChannel).toHaveBeenCalledTimes(1);
    expect(leaveChannel).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith('[socket] error inesperado', boom);
  });
});

describe('initSockets: desconexión', () => {
  // Espera a que el servidor procese la desconexión del cliente. El listener se registra
  // después del de initSockets, así que corre después de él.
  async function disconnectAndWait(server: StrimServer, client: ClientSocket) {
    const socket = serverSocketOf(server, client);
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    client.disconnect();
    await disconnected;
  }

  it('si el socket estaba en la sala de un canal, avisa markViewersChanged con ese canal', async () => {
    jest.mocked(joinChannel).mockImplementation(async (socket) => {
      socket.data.channelId = 'canal-1';
      return { channel, messages: [] };
    });
    const { io: server, url } = await startServer();
    const client = await connect(url);
    await emitWithAck(client, 'chat:join', { username: 'ana' });

    await disconnectAndWait(server, client);

    expect(markViewersChanged).toHaveBeenCalledTimes(1);
    expect(markViewersChanged).toHaveBeenCalledWith('canal-1');
  });

  it('si no estaba en ninguna sala, no avisa', async () => {
    const { io: server, url } = await startServer();
    const client = await connect(url);

    await disconnectAndWait(server, client);

    expect(markViewersChanged).not.toHaveBeenCalled();
  });
});
