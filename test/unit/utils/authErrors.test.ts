import { AuthError } from '@supabase/supabase-js';
import { AppError } from '../../../src/utils/AppError';
import { fromAuthError, isRateLimited } from '../../../src/utils/authErrors';

const authError = (message: string, status?: number, code?: string) => new AuthError(message, status, code);

afterEach(() => jest.restoreAllMocks());

describe('isRateLimited', () => {
  it('es true con estado 429', () => {
    expect(isRateLimited(authError('Too many requests', 429))).toBe(true);
  });

  it.each(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit'])(
    'es true con el código %s',
    (code) => {
      expect(isRateLimited(authError('limit', 400, code))).toBe(true);
    },
  );

  it('es false con otro estado y otro código', () => {
    expect(isRateLimited(authError('bad', 400, 'invalid_credentials'))).toBe(false);
  });

  it('es false sin estado ni código', () => {
    expect(isRateLimited(authError('sin datos'))).toBe(false);
  });
});

describe('fromAuthError', () => {
  it('un error limitado → TOO_MANY_REQUESTS', () => {
    const result = fromAuthError(authError('limit', 429, 'over_email_send_rate_limit'));

    expect(result).toBeInstanceOf(AppError);
    expect(result).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
  });

  it.each(['Error sending confirmation email', 'Error sending recovery email', 'error SENDING magic link EMAIL'])(
    '"%s" → EMAIL_NOT_SENT',
    (message) => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      const result = fromAuthError(authError(message, 500, 'unexpected_failure'));

      expect(result).toMatchObject({ code: 'EMAIL_NOT_SENT', status: 503 });
      expect(console.error).toHaveBeenCalledTimes(1);
    },
  );

  it('el límite de intentos tiene prioridad sobre el fallo de envío de correo', () => {
    const result = fromAuthError(authError('Error sending confirmation email', 429));

    expect(result).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('weak_password → VALIDATION_ERROR con mensaje propio', () => {
    expect(fromAuthError(authError('weak', 422, 'weak_password'))).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'La contraseña no cumple los requisitos.',
    });
  });

  it.each(['email_address_invalid', 'validation_failed'])('%s → VALIDATION_ERROR "Correo inválido."', (code) => {
    expect(fromAuthError(authError('invalid', 400, code))).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Correo inválido.',
    });
  });

  it('email_address_not_authorized → VALIDATION_ERROR que menciona el SMTP', () => {
    const result = fromAuthError(authError('not authorized', 400, 'email_address_not_authorized'));

    expect(result).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(result.message).toMatch(/SMTP/);
  });

  it('cualquier otro error se devuelve tal cual', () => {
    const original = authError('boom', 500, 'unexpected_failure');

    expect(fromAuthError(original)).toBe(original);
  });

  it('un error sin código se devuelve tal cual', () => {
    const original = authError('boom');

    expect(fromAuthError(original)).toBe(original);
  });
});
