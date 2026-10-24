import { env } from '../../../src/config/env';
import { buildProfile, STREAM_KEY } from '../../helpers/models';

const STARTED = new Date('2026-10-23T18:30:00.000Z');

describe('Profile', () => {
  describe('toProfile', () => {
    it('devuelve solo los datos públicos del perfil', () => {
      const profile = buildProfile({ username: 'ana', displayName: 'Ana P.', bio: 'Hola', avatarUrl: 'https://img/a.png' });

      expect(profile.toProfile()).toEqual({
        username: 'ana',
        displayName: 'Ana P.',
        bio: 'Hola',
        avatarUrl: 'https://img/a.png',
      });
    });
  });

  describe('toMe', () => {
    it('incluye id, correo, perfil y estado del canal', () => {
      const profile = buildProfile({ id: 'user-1' }, { status: 'live', title: 'Jugando', liveStartedAt: STARTED });

      expect(profile.toMe('ana@example.com')).toEqual({
        id: 'user-1',
        email: 'ana@example.com',
        profile: { username: 'ana', displayName: 'Ana', bio: '', avatarUrl: null },
        channel: { status: 'live', title: 'Jugando', liveStartedAt: '2026-10-23T18:30:00.000Z' },
      });
    });

    it('liveStartedAt es null si el canal no lo tiene', () => {
      expect(buildProfile().toMe('ana@example.com').channel.liveStartedAt).toBeNull();
    });

    it('nunca incluye la stream key', () => {
      const me = buildProfile({}, { status: 'live', liveStartedAt: STARTED }).toMe('ana@example.com');

      expect(JSON.stringify(me)).not.toContain(STREAM_KEY);
      expect(me.channel).not.toHaveProperty('streamKey');
    });
  });

  describe('toDashboard', () => {
    it('arma los datos para OBS: servidor RTMP_PUBLIC_URL y clave "<username>?key=<clave>"', () => {
      const dashboard = buildProfile({ username: 'ana' }, { status: 'waiting', title: 'Probando' }).toDashboard();

      expect(dashboard).toEqual({
        status: 'waiting',
        title: 'Probando',
        liveStartedAt: null,
        obs: { server: env.RTMP_PUBLIC_URL, streamKey: `ana?key=${STREAM_KEY}` },
      });
      expect(dashboard.obs.server).toBe('rtmp://localhost:1935/live');
    });

    it('incluye liveStartedAt en ISO si está en vivo', () => {
      const dashboard = buildProfile({}, { status: 'live', liveStartedAt: STARTED }).toDashboard();

      expect(dashboard.liveStartedAt).toBe('2026-10-23T18:30:00.000Z');
    });
  });

  describe('toPublic', () => {
    it('en vivo: isLive, liveStartedAt, espectadores y playbackUrl HLS', () => {
      const channel = buildProfile(
        { username: 'ana', displayName: 'Ana', bio: 'Bio', avatarUrl: null },
        { status: 'live', title: 'Jugando', liveStartedAt: STARTED },
      ).toPublic(7);

      expect(channel).toEqual({
        username: 'ana',
        displayName: 'Ana',
        bio: 'Bio',
        avatarUrl: null,
        title: 'Jugando',
        isLive: true,
        liveStartedAt: '2026-10-23T18:30:00.000Z',
        viewers: 7,
        playbackUrl: `${env.HLS_PUBLIC_URL}/live/ana/index.m3u8`,
      });
      expect(channel.playbackUrl).toBe('http://localhost:8888/live/ana/index.m3u8');
    });

    it.each(['offline', 'waiting'] as const)('%s: sin playbackUrl ni liveStartedAt', (status) => {
      // liveStartedAt con valor a propósito: no debe salir si el canal no está live.
      const channel = buildProfile({}, { status, title: 'Pronto', liveStartedAt: STARTED }).toPublic(2);

      expect(channel).toMatchObject({ isLive: false, liveStartedAt: null, playbackUrl: null, viewers: 2, title: 'Pronto' });
    });

    it('nunca incluye la stream key', () => {
      const channel = buildProfile({}, { status: 'live', liveStartedAt: STARTED }).toPublic(0);

      expect(JSON.stringify(channel)).not.toContain(STREAM_KEY);
      expect(channel).not.toHaveProperty('streamKey');
    });
  });

  describe('sin el canal cargado', () => {
    const profile = buildProfile({}, null);

    it.each([
      ['toMe', () => profile.toMe('ana@example.com')],
      ['toDashboard', () => profile.toDashboard()],
      ['toPublic', () => profile.toPublic(0)],
    ])('%s lanza un error', (_name, call) => {
      expect(call).toThrow('Profile.channel no está cargado');
    });

    it('toProfile funciona igual (no necesita el canal)', () => {
      expect(profile.toProfile().username).toBe('ana');
    });
  });
});
