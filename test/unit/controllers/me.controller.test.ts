jest.mock('../../../src/config/supabase', () => require('../../helpers/supabase').mockSupabaseModule());
jest.mock('../../../src/config/mediamtx', () => ({
  ...jest.requireActual('../../../src/config/mediamtx'),
  kickPublisher: jest.fn(),
  listLiveSignals: jest.fn(),
}));
jest.mock('../../../src/sockets/emit');

import { kickPublisher } from '../../../src/config/mediamtx';
import {
  changePassword,
  deleteMe,
  getMe,
  removeAvatars,
  updateMe,
  uploadAvatar,
  verifyCurrentPassword,
} from '../../../src/controllers/me.controller';
import type { ChannelStatus } from '../../../src/models';
import { closeChannelRoom, disconnectUser } from '../../../src/sockets/emit';
import { mockRequest, mockResponse, runHandler } from '../../helpers/http';
import { buildAuth, buildProfile, stubUpdate } from '../../helpers/models';
import { authError, bucket, fakeSession, publicAuth, resetSupabase, supabaseAdmin } from '../../helpers/supabase';

const kick = jest.mocked(kickPublisher);
const EMAIL = 'ana@example.com';
const NOW = 1_761_200_000_000;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

// Archivo que deja multer en req.file.
function avatarFile(mimetype: string, buffer: Buffer): Express.Multer.File {
  return { fieldname: 'avatar', originalname: 'avatar', mimetype, buffer, size: buffer.length } as Express.Multer.File;
}

// Usuario autenticado con su canal en `status`.
function setup(status: ChannelStatus = 'offline', init: { body?: unknown; file?: Express.Multer.File } = {}) {
  const profile = buildProfile({ id: 'user-1', username: 'ana' }, { status });
  const profileUpdate = stubUpdate(profile);
  const channelUpdate = stubUpdate(profile.channel!);
  const req = mockRequest({ auth: buildAuth(profile, { email: EMAIL }), body: init.body ?? {}, file: init.file });
  return { profile, profileUpdate, channelUpdate, req, res: mockResponse() };
}

// La contraseña comprobada con signInWithPassword es correcta: abre la sesión de prueba.
function passwordIsCorrect() {
  const session = { ...fakeSession(), access_token: 'token-de-prueba' };
  publicAuth.signInWithPassword.mockResolvedValue({ data: { user: session.user, session }, error: null });
}

function passwordIsWrong() {
  publicAuth.signInWithPassword.mockResolvedValue({
    data: { user: null, session: null },
    error: authError('invalid_credentials', 400),
  });
}

beforeEach(() => {
  resetSupabase();
  kick.mockReset();
  kick.mockResolvedValue(true);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('getMe', () => {
  it('responde el usuario con su perfil y canal', async () => {
    const { req, res, profile } = setup('waiting');

    await runHandler(getMe, req, res);

    expect(res.json).toHaveBeenCalledWith(profile.toMe(EMAIL));
  });
});

describe('updateMe', () => {
  it.each(['waiting', 'live'] as const)('cambiar el username con el canal %s → CHANNEL_LIVE', async (status) => {
    const { req, profileUpdate } = setup(status, { body: { username: 'nuevo' } });

    await expect(runHandler(updateMe, req)).rejects.toMatchObject({ code: 'CHANNEL_LIVE', status: 409 });
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('cambiar el username con el canal offline lo guarda y responde el usuario', async () => {
    const { req, res, profileUpdate } = setup('offline', { body: { username: 'nuevo' } });

    await runHandler(updateMe, req, res);

    expect(profileUpdate).toHaveBeenCalledWith({ username: 'nuevo' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ username: 'nuevo' }) }));
  });

  it('mandar el mismo username estando en vivo no cuenta como cambio', async () => {
    const { req, res, profileUpdate } = setup('live', { body: { username: 'ana', bio: 'Hola' } });

    await runHandler(updateMe, req, res);

    expect(profileUpdate).toHaveBeenCalledWith({ username: 'ana', bio: 'Hola' });
    expect(res.json).toHaveBeenCalled();
  });

  it('cambiar el nombre visible o la bio estando en vivo está permitido', async () => {
    const { req, res, profileUpdate } = setup('live', { body: { displayName: 'Ana P.', bio: 'Nueva bio' } });

    await runHandler(updateMe, req, res);

    expect(profileUpdate).toHaveBeenCalledWith({ displayName: 'Ana P.', bio: 'Nueva bio' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ profile: expect.objectContaining({ displayName: 'Ana P.', bio: 'Nueva bio' }) }),
    );
  });
});

describe('uploadAvatar', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('sin archivo → INVALID_FILE', async () => {
    const { req } = setup();

    await expect(runHandler(uploadAvatar, req)).rejects.toMatchObject({ code: 'INVALID_FILE', status: 400 });
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('tipo no permitido → INVALID_FILE', async () => {
    const { req } = setup('offline', { file: avatarFile('image/gif', Buffer.from('GIF89a')) });

    await expect(runHandler(uploadAvatar, req)).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });

  it.each([
    ['image/png', Buffer.from('esto no es una imagen')],
    ['image/jpeg', PNG],
    ['image/webp', JPEG],
    ['image/png', Buffer.alloc(0)],
  ])('mimetype %s válido pero bytes que no corresponden → INVALID_FILE sin subir nada', async (mimetype, buffer) => {
    const { req, profileUpdate } = setup('offline', { file: avatarFile(mimetype, buffer) });

    await expect(runHandler(uploadAvatar, req)).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(bucket.upload).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['image/jpeg', JPEG, 'jpg'],
    ['image/png', PNG, 'png'],
    ['image/webp', WEBP, 'webp'],
  ])('%s válido: sube a avatars/<userId>/<timestamp>.%s', async (mimetype, buffer, ext) => {
    const { req } = setup('offline', { file: avatarFile(mimetype, buffer) });

    await runHandler(uploadAvatar, req);

    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith('avatars');
    expect(bucket.upload).toHaveBeenCalledWith(`user-1/${NOW}.${ext}`, buffer, {
      contentType: mimetype,
      cacheControl: '31536000',
    });
  });

  it('guarda la URL pública, borra los avatares anteriores y responde el usuario', async () => {
    const newPath = `user-1/${NOW}.png`;
    bucket.list.mockResolvedValue({ data: [{ name: '1600000000000.jpg' }, { name: `${NOW}.png` }, { name: '1650000000000.webp' }], error: null });
    const { req, res, profileUpdate } = setup('offline', { file: avatarFile('image/png', PNG) });

    await runHandler(uploadAvatar, req, res);

    const publicUrl = `https://storage.test/avatars/${newPath}`;
    expect(bucket.getPublicUrl).toHaveBeenCalledWith(newPath);
    expect(profileUpdate).toHaveBeenCalledWith({ avatarUrl: publicUrl });
    expect(bucket.list).toHaveBeenCalledWith('user-1');
    expect(bucket.remove).toHaveBeenCalledWith(['user-1/1600000000000.jpg', 'user-1/1650000000000.webp']);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ profile: expect.objectContaining({ avatarUrl: publicUrl }) }));
  });

  it('si Storage falla al subir, lanza ese error sin tocar el perfil', async () => {
    const storageError = new Error('Storage caído');
    bucket.upload.mockResolvedValue({ data: null, error: storageError });
    const { req, profileUpdate } = setup('offline', { file: avatarFile('image/png', PNG) });

    await expect(runHandler(uploadAvatar, req)).rejects.toBe(storageError);
    expect(profileUpdate).not.toHaveBeenCalled();
  });
});

describe('removeAvatars', () => {
  it('borra todos los archivos de la carpeta del usuario', async () => {
    bucket.list.mockResolvedValue({ data: [{ name: 'a.png' }, { name: 'b.jpg' }], error: null });

    await removeAvatars('user-1');

    expect(bucket.remove).toHaveBeenCalledWith(['user-1/a.png', 'user-1/b.jpg']);
  });

  it('no llama a remove si la carpeta está vacía o solo queda el que se conserva', async () => {
    bucket.list.mockResolvedValue({ data: [{ name: 'a.png' }], error: null });

    await removeAvatars('user-1', 'user-1/a.png');

    expect(bucket.remove).not.toHaveBeenCalled();
  });

  it('lanza si falla el listado o el borrado', async () => {
    const listError = new Error('list falló');
    bucket.list.mockResolvedValue({ data: null, error: listError });
    await expect(removeAvatars('user-1')).rejects.toBe(listError);

    const removeError = new Error('remove falló');
    bucket.list.mockResolvedValue({ data: [{ name: 'a.png' }], error: null });
    bucket.remove.mockResolvedValue({ data: null, error: removeError });
    await expect(removeAvatars('user-1')).rejects.toBe(removeError);
  });
});

describe('verifyCurrentPassword', () => {
  it('abre una sesión de prueba con el correo y la cierra enseguida (local)', async () => {
    passwordIsCorrect();

    await verifyCurrentPassword(EMAIL, 'actual123');

    expect(publicAuth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: 'actual123' });
    expect(supabaseAdmin.auth.admin.signOut).toHaveBeenCalledWith('token-de-prueba', 'local');
  });

  it('contraseña incorrecta → INVALID_CURRENT_PASSWORD', async () => {
    passwordIsWrong();

    await expect(verifyCurrentPassword(EMAIL, 'mala')).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD', status: 400 });
    expect(supabaseAdmin.auth.admin.signOut).not.toHaveBeenCalled();
  });

  it('Supabase limita → TOO_MANY_REQUESTS', async () => {
    publicAuth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: authError('over_request_rate_limit', 429),
    });

    await expect(verifyCurrentPassword(EMAIL, 'x')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});

describe('changePassword', () => {
  it('la nueva igual a la actual → SAME_PASSWORD sin consultar a Supabase', async () => {
    const { req } = setup('offline', { body: { currentPassword: 'igual1234', newPassword: 'igual1234' } });

    await expect(runHandler(changePassword, req)).rejects.toMatchObject({ code: 'SAME_PASSWORD', status: 400 });
    expect(publicAuth.signInWithPassword).not.toHaveBeenCalled();
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('contraseña actual incorrecta → INVALID_CURRENT_PASSWORD sin cambiarla', async () => {
    passwordIsWrong();
    const { req } = setup('offline', { body: { currentPassword: 'mala', newPassword: 'nueva1234' } });

    await expect(runHandler(changePassword, req)).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('éxito: guarda la nueva y responde 204', async () => {
    passwordIsCorrect();
    const { req, res } = setup('offline', { body: { currentPassword: 'actual123', newPassword: 'nueva1234' } });

    await runHandler(changePassword, req, res);

    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith('user-1', { password: 'nueva1234' });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('si Supabase rechaza la nueva → error convertido (weak_password → VALIDATION_ERROR)', async () => {
    passwordIsCorrect();
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ data: { user: null }, error: authError('weak_password', 422) });
    const { req } = setup('offline', { body: { currentPassword: 'actual123', newPassword: 'nueva1234' } });

    await expect(runHandler(changePassword, req)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('deleteMe', () => {
  const body = { password: 'actual123' };

  it('contraseña incorrecta → INVALID_CURRENT_PASSWORD sin borrar nada', async () => {
    passwordIsWrong();
    const { req } = setup('live', { body });

    await expect(runHandler(deleteMe, req)).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
    expect(supabaseAdmin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(closeChannelRoom).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });

  it.each(['live', 'waiting'] as const)('canal %s: pasa a offline y después corta a OBS', async (status) => {
    passwordIsCorrect();
    const { req, res, channelUpdate } = setup(status, { body });

    await runHandler(deleteMe, req, res);

    expect(channelUpdate).toHaveBeenCalledWith({ status: 'offline', liveStartedAt: null });
    expect(kick).toHaveBeenCalledWith('ana');
    expect(channelUpdate.mock.invocationCallOrder[0]).toBeLessThan(kick.mock.invocationCallOrder[0]);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('canal offline: no toca el canal ni corta a OBS', async () => {
    passwordIsCorrect();
    const { req, channelUpdate } = setup('offline', { body });

    await runHandler(deleteMe, req);

    expect(channelUpdate).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });

  it('siempre: cierra la sala, borra avatares y el usuario, y desconecta sus sockets (en ese orden)', async () => {
    passwordIsCorrect();
    bucket.list.mockResolvedValue({ data: [{ name: 'a.png' }], error: null });
    const { req, res } = setup('offline', { body });

    await runHandler(deleteMe, req, res);

    expect(closeChannelRoom).toHaveBeenCalledWith('user-1');
    expect(bucket.remove).toHaveBeenCalledWith(['user-1/a.png']);
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
    expect(disconnectUser).toHaveBeenCalledWith('user-1');

    const order = [
      jest.mocked(closeChannelRoom).mock.invocationCallOrder[0],
      bucket.list.mock.invocationCallOrder[0],
      supabaseAdmin.auth.admin.deleteUser.mock.invocationCallOrder[0],
      jest.mocked(disconnectUser).mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('si falla el borrado del avatar, la cuenta se borra igual', async () => {
    passwordIsCorrect();
    bucket.list.mockResolvedValue({ data: null, error: new Error('Storage caído') });
    const { req, res } = setup('offline', { body });

    await runHandler(deleteMe, req, res);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Storage caído'));
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
    expect(disconnectUser).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('si MediaMTX falla al cortar, la cuenta se borra igual', async () => {
    passwordIsCorrect();
    kick.mockRejectedValue(new Error('MediaMTX caído'));
    const { req, res } = setup('live', { body });

    await runHandler(deleteMe, req, res);

    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('user-1');
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('si Supabase no puede borrar el usuario, lanza y no desconecta los sockets', async () => {
    passwordIsCorrect();
    const deleteError = authError('unexpected_failure', 500);
    supabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ data: { user: null }, error: deleteError });
    const { req } = setup('offline', { body });

    await expect(runHandler(deleteMe, req)).rejects.toBe(deleteError);
    expect(disconnectUser).not.toHaveBeenCalled();
  });
});
