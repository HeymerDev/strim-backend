import { buildMessage, buildProfile } from '../../helpers/models';

describe('ChatMessage.toMessage', () => {
  it('devuelve el id como string, la fecha en ISO y el autor público', () => {
    const author = buildProfile({ username: 'ana', displayName: 'Ana', avatarUrl: 'https://img/a.png' });
    const message = buildMessage(
      { id: 42, content: 'hola a todos', createdAt: new Date('2026-10-23T12:34:56.789Z') },
      author,
    );

    expect(message.toMessage()).toEqual({
      id: '42',
      content: 'hola a todos',
      createdAt: '2026-10-23T12:34:56.789Z',
      author: { username: 'ana', displayName: 'Ana', avatarUrl: 'https://img/a.png' },
    });
  });

  it('mantiene un id que ya llega como string (bigint de pg)', () => {
    expect(buildMessage({ id: '9007199254740993' }).toMessage().id).toBe('9007199254740993');
  });

  it('no incluye datos privados del autor ni ids internos', () => {
    const dto = buildMessage({}, buildProfile({ id: 'user-secreto', bio: 'bio' })).toMessage();

    expect(dto.author).toEqual({ username: 'ana', displayName: 'Ana', avatarUrl: null });
    expect(JSON.stringify(dto)).not.toContain('user-secreto');
  });

  it('lanza si el autor no está cargado', () => {
    const message = buildMessage({}, null);

    expect(() => message.toMessage()).toThrow('ChatMessage.author no está cargado');
  });
});
