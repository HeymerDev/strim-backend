// Registra los modelos en Sequelize (crea la instancia sin conectarse) para poder usar build().
import '../../src/database';
import type { Model } from 'sequelize-typescript';
import type { AuthContext } from '../../src/middlewares/requireAuth';
import { Channel, type ChannelStatus, ChatMessage, Profile } from '../../src/models';

export const STREAM_KEY = 'clave-de-prueba-de-32-caracteres';

type ProfileInit = Partial<{
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
}>;

type ChannelInit = Partial<{
  streamKey: string;
  status: ChannelStatus;
  title: string;
  liveStartedAt: Date | null;
}>;

// Perfil con su canal cargado (como con include: [Channel]). channel = null → sin canal.
export function buildProfile(init: ProfileInit = {}, channel: ChannelInit | null = {}): Profile {
  const profile = Profile.build({
    id: 'user-1',
    username: 'ana',
    displayName: 'Ana',
    bio: '',
    avatarUrl: null,
    ...init,
  });
  if (channel) {
    profile.channel = Channel.build({
      userId: profile.id,
      streamKey: STREAM_KEY,
      status: 'offline',
      title: '',
      liveStartedAt: null,
      ...channel,
    });
  }
  return profile;
}

type MessageInit = Partial<{
  id: string | number;
  channelId: string;
  content: string;
  createdAt: Date;
}>;

// Mensaje del chat con su autor cargado (como con include: [{ model: Profile, as: 'author' }]).
export function buildMessage(init: MessageInit = {}, author: Profile | null = buildProfile()): ChatMessage {
  const message = ChatMessage.build({
    id: '1',
    channelId: 'channel-1',
    userId: author?.id ?? 'user-1',
    content: 'hola',
    createdAt: new Date('2026-10-23T12:00:00.000Z'),
    ...init,
  });
  if (author) message.author = author;
  return message;
}

// Contexto que deja requireAuth en req.auth.
export function buildAuth(profile: Profile = buildProfile(), init: Partial<Omit<AuthContext, 'profile'>> = {}): AuthContext {
  return {
    userId: profile.id,
    email: 'ana@example.com',
    accessToken: 'access-token',
    exp: Math.floor(Date.now() / 1000) + 3600,
    profile,
    ...init,
  };
}

// Sustituye instance.update() para que solo aplique los cambios en memoria (sin base de datos).
export function stubUpdate(instance: Model): jest.SpyInstance {
  return jest.spyOn(instance, 'update').mockImplementation((async (values: Record<string, unknown>) => {
    instance.set(values);
    return instance;
  }) as never);
}
