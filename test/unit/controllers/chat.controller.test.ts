jest.mock('../../../src/sockets/emit', () => ({
  ...jest.requireActual('../../../src/sockets/emit'),
  emitToChannel: jest.fn(),
  markViewersChanged: jest.fn(),
  getViewers: jest.fn(),
}));

import { ForeignKeyConstraintError } from 'sequelize';
import { ZodError } from 'zod';
import { joinChannel, leaveChannel, sendMessage } from '../../../src/controllers/chat.controller';
import { Channel, ChatMessage, Profile } from '../../../src/models';
import { emitToChannel, getViewers, markViewersChanged } from '../../../src/sockets/emit';
import { buildMessage, buildProfile } from '../../helpers/models';
import { asSocket, fakeSocket } from '../../helpers/socket';

const NOW = 1_761_200_000_000;
const validExp = () => Math.floor(Date.now() / 1000) + 3600;

// chat.controller guarda el último mensaje de cada usuario en memoria del módulo:
// cada prueba usa un usuario distinto para no arrastrar ese estado.
let userSeq = 0;
const newUserId = () => `chat-user-${++userSeq}`;

beforeEach(() => {
  jest.mocked(getViewers).mockReset();
  jest.mocked(getViewers).mockReturnValue(0);
});
afterEach(() => jest.restoreAllMocks());

describe('joinChannel', () => {
  function channelOwner() {
    return buildProfile({ id: 'owner-1', username: 'ana' }, { status: 'live', liveStartedAt: new Date(NOW) });
  }

  it('valida el payload (username vacío → ZodError)', async () => {
    await expect(joinChannel(asSocket(fakeSocket()), { username: '' })).rejects.toBeInstanceOf(ZodError);
    await expect(joinChannel(asSocket(fakeSocket()), 'ana')).rejects.toBeInstanceOf(ZodError);
  });

  it('busca el canal por username en minúsculas', async () => {
    const findOne = jest.spyOn(Profile, 'findOne').mockResolvedValue(channelOwner());
    jest.spyOn(ChatMessage, 'findAll').mockResolvedValue([]);

    await joinChannel(asSocket(fakeSocket()), { username: '  ANA ' });

    expect(findOne).toHaveBeenCalledWith({ where: { username: 'ana' }, include: [Channel] });
  });

  it('canal inexistente → NOT_FOUND sin unirse a ninguna sala', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(null);
    const socket = fakeSocket();

    await expect(joinChannel(asSocket(socket), { username: 'nadie' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.data.channelId).toBeNull();
  });

  it('une el socket a la sala del canal y marca el cambio de espectadores', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(channelOwner());
    jest.spyOn(ChatMessage, 'findAll').mockResolvedValue([]);
    const socket = fakeSocket();

    await joinChannel(asSocket(socket), { username: 'ana' });

    expect(socket.join).toHaveBeenCalledWith('channel:owner-1');
    expect(socket.data.channelId).toBe('owner-1');
    expect(markViewersChanged).toHaveBeenCalledWith('owner-1');
    expect(socket.leave).not.toHaveBeenCalled();
  });

  it('deja la sala anterior antes de unirse a la nueva', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(channelOwner());
    jest.spyOn(ChatMessage, 'findAll').mockResolvedValue([]);
    const socket = fakeSocket({ channelId: 'otro-canal' });

    await joinChannel(asSocket(socket), { username: 'ana' });

    expect(socket.leave).toHaveBeenCalledWith('channel:otro-canal');
    expect(markViewersChanged).toHaveBeenCalledWith('otro-canal');
    expect(socket.leave.mock.invocationCallOrder[0]).toBeLessThan(socket.join.mock.invocationCallOrder[0]);
    expect(socket.data.channelId).toBe('owner-1');
  });

  it('volver a unirse a la misma sala no la deja', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(channelOwner());
    jest.spyOn(ChatMessage, 'findAll').mockResolvedValue([]);
    const socket = fakeSocket({ channelId: 'owner-1' });

    await joinChannel(asSocket(socket), { username: 'ana' });

    expect(socket.leave).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('channel:owner-1');
  });

  it('devuelve el canal público y los últimos 50 mensajes del más antiguo al más reciente', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(channelOwner());
    jest.mocked(getViewers).mockReturnValue(4);
    // La consulta los trae del más reciente al más antiguo (ORDER BY id DESC).
    const findAll = jest
      .spyOn(ChatMessage, 'findAll')
      .mockResolvedValue([buildMessage({ id: '3', content: 'tercero' }), buildMessage({ id: '2', content: 'segundo' }), buildMessage({ id: '1', content: 'primero' })]);

    const result = await joinChannel(asSocket(fakeSocket()), { username: 'ana' });

    expect(findAll).toHaveBeenCalledWith({
      where: { channelId: 'owner-1' },
      include: [{ model: Profile, as: 'author' }],
      order: [['id', 'DESC']],
      limit: 50,
    });
    expect(result.messages.map((message) => message.id)).toEqual(['1', '2', '3']);
    expect(result.messages.map((message) => message.content)).toEqual(['primero', 'segundo', 'tercero']);
    expect(result.channel).toMatchObject({ username: 'ana', isLive: true, viewers: 4 });
    expect(getViewers).toHaveBeenCalledWith('owner-1');
  });
});

describe('leaveChannel', () => {
  it('deja la sala actual, limpia channelId y marca el cambio de espectadores', () => {
    const socket = fakeSocket({ channelId: 'canal-1' });

    expect(leaveChannel(asSocket(socket))).toEqual({});

    expect(socket.leave).toHaveBeenCalledWith('channel:canal-1');
    expect(socket.data.channelId).toBeNull();
    expect(markViewersChanged).toHaveBeenCalledWith('canal-1');
  });

  it('sin sala no hace nada', () => {
    const socket = fakeSocket();

    expect(leaveChannel(asSocket(socket))).toEqual({});
    expect(socket.leave).not.toHaveBeenCalled();
    expect(markViewersChanged).not.toHaveBeenCalled();
  });
});

describe('sendMessage', () => {
  // Socket con sesión, token vigente y dentro de la sala canal-1.
  const readySocket = (userId = newUserId()) => fakeSocket({ userId, exp: validExp(), channelId: 'canal-1' });

  // ChatMessage.create y findByPk simulados: devuelven el mensaje guardado con su autor.
  function mockSave(content = 'hola') {
    const saved = buildMessage({ id: '77', channelId: 'canal-1', content });
    const create = jest.spyOn(ChatMessage, 'create').mockResolvedValue(saved as never);
    const findByPk = jest.spyOn(ChatMessage, 'findByPk').mockResolvedValue(saved);
    return { saved, create, findByPk };
  }

  describe('orden de las validaciones', () => {
    it('anónimo → AUTH_REQUIRED (aunque además falte todo lo demás)', async () => {
      const socket = fakeSocket({ userId: null, exp: 1, channelId: null });

      await expect(sendMessage(asSocket(socket), { content: '' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    });

    it('token vencido → UNAUTHORIZED (antes que NOT_IN_ROOM)', async () => {
      const socket = fakeSocket({ userId: newUserId(), exp: Math.floor(Date.now() / 1000) - 1, channelId: null });

      await expect(sendMessage(asSocket(socket), { content: 'hola' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('sin exp → UNAUTHORIZED', async () => {
      const socket = fakeSocket({ userId: newUserId(), exp: null, channelId: 'canal-1' });

      await expect(sendMessage(asSocket(socket), { content: 'hola' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('token que vence justo ahora → UNAUTHORIZED', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      const socket = fakeSocket({ userId: newUserId(), exp: NOW / 1000, channelId: 'canal-1' });

      await expect(sendMessage(asSocket(socket), { content: 'hola' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('fuera de una sala → NOT_IN_ROOM (antes que el contenido inválido)', async () => {
      const socket = fakeSocket({ userId: newUserId(), exp: validExp(), channelId: null });

      await expect(sendMessage(asSocket(socket), { content: '' })).rejects.toMatchObject({ code: 'NOT_IN_ROOM', status: 400 });
    });

    it('menos de 1 s desde el último mensaje → RATE_LIMITED (antes que el contenido inválido)', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
      mockSave();
      const socket = readySocket();
      await sendMessage(asSocket(socket), { content: 'primero' });

      now.mockReturnValue(NOW + 999);

      await expect(sendMessage(asSocket(socket), { content: '' })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    });

    it('contenido inválido → ZodError (VALIDATION_ERROR) y no consume el límite', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      const { create } = mockSave();
      const socket = readySocket();

      await expect(sendMessage(asSocket(socket), { content: '   ' })).rejects.toBeInstanceOf(ZodError);
      await expect(sendMessage(asSocket(socket), { content: 'a'.repeat(301) })).rejects.toBeInstanceOf(ZodError);
      expect(create).not.toHaveBeenCalled();

      // En el mismo instante, un mensaje válido pasa: el intento inválido no contó.
      await expect(sendMessage(asSocket(socket), { content: 'ahora sí' })).resolves.toHaveProperty('message');
    });
  });

  describe('límite de 1 mensaje por segundo', () => {
    it('vuelve a aceptar mensajes cuando pasa 1 s', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
      mockSave();
      const socket = readySocket();

      await sendMessage(asSocket(socket), { content: 'uno' });
      now.mockReturnValue(NOW + 1_000);

      await expect(sendMessage(asSocket(socket), { content: 'dos' })).resolves.toHaveProperty('message');
    });

    it('es por usuario: otro usuario puede escribir en el mismo instante', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      mockSave();

      await sendMessage(asSocket(readySocket()), { content: 'uno' });

      await expect(sendMessage(asSocket(readySocket()), { content: 'dos' })).resolves.toHaveProperty('message');
    });
  });

  it('si el canal se borró mientras tanto (ForeignKeyConstraintError) → NOT_IN_ROOM y sale de la sala', async () => {
    jest.spyOn(ChatMessage, 'create').mockRejectedValue(new ForeignKeyConstraintError({}));
    const findByPk = jest.spyOn(ChatMessage, 'findByPk').mockResolvedValue(null);
    const socket = readySocket();

    await expect(sendMessage(asSocket(socket), { content: 'hola' })).rejects.toMatchObject({ code: 'NOT_IN_ROOM' });
    expect(socket.data.channelId).toBeNull();
    expect(findByPk).not.toHaveBeenCalled();
    expect(emitToChannel).not.toHaveBeenCalled();
  });

  it('otro error al guardar se relanza tal cual', async () => {
    const dbError = new Error('conexión perdida');
    jest.spyOn(ChatMessage, 'create').mockRejectedValue(dbError);
    const socket = readySocket();

    await expect(sendMessage(asSocket(socket), { content: 'hola' })).rejects.toBe(dbError);
    expect(socket.data.channelId).toBe('canal-1');
  });

  it('éxito: guarda el texto sin espacios, emite chat:message a la sala y lo devuelve', async () => {
    const { saved, create, findByPk } = mockSave('hola a todos');
    const userId = newUserId();
    const socket = readySocket(userId);

    const result = await sendMessage(asSocket(socket), { content: '  hola a todos  ' });

    expect(create).toHaveBeenCalledWith({ channelId: 'canal-1', userId, content: 'hola a todos' });
    expect(findByPk).toHaveBeenCalledWith('77', { include: [{ model: Profile, as: 'author' }] });
    const message = saved.toMessage();
    expect(emitToChannel).toHaveBeenCalledWith('canal-1', 'chat:message', message);
    expect(result).toEqual({ message });
    expect(result.message).toMatchObject({ id: '77', content: 'hola a todos', author: { username: 'ana' } });
  });
});
