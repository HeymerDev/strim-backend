import { AppError, type ErrorCode } from '../../../src/utils/AppError';

describe('AppError', () => {
  it.each<[ErrorCode, number]>([
    ['VALIDATION_ERROR', 400],
    ['INVALID_OTP', 400],
    ['INVALID_CURRENT_PASSWORD', 400],
    ['SAME_PASSWORD', 400],
    ['INVALID_FILE', 400],
    ['NOT_IN_ROOM', 400],
    ['UNAUTHORIZED', 401],
    ['INVALID_CREDENTIALS', 401],
    ['AUTH_REQUIRED', 401],
    ['EMAIL_NOT_VERIFIED', 403],
    ['NOT_FOUND', 404],
    ['EMAIL_TAKEN', 409],
    ['USERNAME_TAKEN', 409],
    ['CHANNEL_LIVE', 409],
    ['PAYLOAD_TOO_LARGE', 413],
    ['TOO_MANY_REQUESTS', 429],
    ['RATE_LIMITED', 429],
    ['INTERNAL_ERROR', 500],
    ['EMAIL_NOT_SENT', 503],
  ])('%s responde con estado %i', (code, status) => {
    const error = new AppError(code);

    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });

  it('usa el mensaje del catálogo si no se le pasa uno', () => {
    expect(new AppError('NOT_FOUND').message).toBe('No encontrado.');
  });

  it('usa el mensaje propio si se le pasa uno', () => {
    expect(new AppError('VALIDATION_ERROR', 'Correo inválido.').message).toBe('Correo inválido.');
  });

  it('es un Error con nombre AppError', () => {
    const error = new AppError('UNAUTHORIZED');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
  });

  describe('toJSON', () => {
    it('sin details no incluye la clave details', () => {
      const json = new AppError('NOT_FOUND').toJSON();

      expect(json).toEqual({ code: 'NOT_FOUND', message: 'No encontrado.' });
      expect('details' in json).toBe(false);
    });

    it('con details los incluye', () => {
      const json = new AppError('VALIDATION_ERROR', undefined, { email: 'Correo inválido.' }).toJSON();

      expect(json).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Hay datos inválidos.',
        details: { email: 'Correo inválido.' },
      });
    });

    it('incluye details aunque sea null (solo se omite undefined)', () => {
      expect(new AppError('INTERNAL_ERROR', undefined, null).toJSON()).toHaveProperty('details', null);
    });

    it('JSON.stringify usa toJSON (sin stack ni status)', () => {
      const parsed = JSON.parse(JSON.stringify(new AppError('CHANNEL_LIVE')));

      expect(parsed).toEqual({ code: 'CHANNEL_LIVE', message: 'No puedes hacer esto mientras tu stream está activo.' });
    });
  });
});
