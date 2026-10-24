jest.mock('../../../src/sockets/emit');

import { getChannel, listLiveChannels } from '../../../src/controllers/channels.controller';
import { Channel, Profile } from '../../../src/models';
import { getViewers } from '../../../src/sockets/emit';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';
import { buildProfile, STREAM_KEY } from '../../helpers/models';

const viewers = jest.mocked(getViewers);
const STARTED = new Date('2026-10-23T18:30:00.000Z');

beforeEach(() => {
  viewers.mockReset();
  viewers.mockReturnValue(0);
});
afterEach(() => jest.restoreAllMocks());

describe('getChannel', () => {
  it('busca el username en minúsculas con su canal', async () => {
    const findOne = jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({ username: 'ana' }));

    await runHandler(getChannel, mockRequest({ params: { username: 'AnA' } }));

    expect(findOne).toHaveBeenCalledWith({ where: { username: 'ana' }, include: [Channel] });
  });

  it('responde 404 NOT_FOUND si el perfil no existe', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(null);

    await expect(runHandler(getChannel, mockRequest({ params: { username: 'nadie' } }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('responde 404 NOT_FOUND si el perfil no tiene canal', async () => {
    jest.spyOn(Profile, 'findOne').mockResolvedValue(buildProfile({}, null));

    await expect(runHandler(getChannel, mockRequest({ params: { username: 'ana' } }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('responde el canal público con los espectadores de su sala, sin stream key', async () => {
    jest
      .spyOn(Profile, 'findOne')
      .mockResolvedValue(buildProfile({ id: 'user-1', username: 'ana' }, { status: 'live', liveStartedAt: STARTED }));
    viewers.mockReturnValue(12);
    const res = mockResponse();

    await runHandler(getChannel, mockRequest({ params: { username: 'ana' } }), res);

    expect(viewers).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'ana', isLive: true, viewers: 12, playbackUrl: 'http://localhost:8888/live/ana/index.m3u8' }),
    );
    expect(JSON.stringify(res.body)).not.toContain(STREAM_KEY);
  });
});

describe('listLiveChannels', () => {
  it('pide solo los canales live', async () => {
    const findAll = jest.spyOn(Profile, 'findAll').mockResolvedValue([]);

    await runHandler(listLiveChannels, mockRequest());

    expect(findAll).toHaveBeenCalledWith({ include: [{ model: Channel, where: { status: 'live' } }] });
  });

  it('ordena por espectadores, de más a menos', async () => {
    const live = { status: 'live' as const, liveStartedAt: STARTED };
    jest
      .spyOn(Profile, 'findAll')
      .mockResolvedValue([
        buildProfile({ id: 'id-a', username: 'ana' }, live),
        buildProfile({ id: 'id-b', username: 'beto' }, live),
        buildProfile({ id: 'id-c', username: 'carla' }, live),
      ]);
    const counts: Record<string, number> = { 'id-a': 3, 'id-b': 10, 'id-c': 0 };
    viewers.mockImplementation((channelId) => counts[channelId]);
    const res = mockResponse();

    await runHandler(listLiveChannels, mockRequest(), res);

    const body = res.body as { username: string; viewers: number }[];
    expect(body.map((channel) => [channel.username, channel.viewers])).toEqual([
      ['beto', 10],
      ['ana', 3],
      ['carla', 0],
    ]);
  });

  it('responde [] si no hay nadie en vivo', async () => {
    jest.spyOn(Profile, 'findAll').mockResolvedValue([]);
    const res = mockResponse();

    await runHandler(listLiveChannels, mockRequest(), res);

    expect(res.json).toHaveBeenCalledWith([]);
  });
});
