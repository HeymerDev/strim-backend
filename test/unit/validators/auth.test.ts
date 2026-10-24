import {
  emailBody,
  loginBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  verifyEmailBody,
} from '../../../src/validators/auth';

describe('registerBody', () => {
  it('normaliza el correo y el username', () => {
    const body = registerBody.parse({ email: ' Ana@Example.com ', username: ' Ana_01 ', password: 'secreta123' });

    expect(body).toEqual({ email: 'ana@example.com', username: 'ana_01', password: 'secreta123' });
  });

  it('aplica la política de contraseñas', () => {
    const result = registerBody.safeParse({ email: 'ana@example.com', username: 'ana', password: 'corta1' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['password']);
  });

  it('rechaza un username reservado', () => {
    const result = registerBody.safeParse({ email: 'ana@example.com', username: 'admin', password: 'secreta123' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['username']);
  });

  it('exige los tres campos', () => {
    const result = registerBody.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['email', 'username', 'password']);
  });
});

describe('verifyEmailBody', () => {
  it('acepta correo y OTP de 6 dígitos', () => {
    expect(verifyEmailBody.parse({ email: 'ANA@example.com', otp: ' 123456 ' })).toEqual({
      email: 'ana@example.com',
      otp: '123456',
    });
  });

  it('rechaza un OTP con letras', () => {
    expect(verifyEmailBody.safeParse({ email: 'ana@example.com', otp: 'abcdef' }).success).toBe(false);
  });
});

describe('emailBody', () => {
  it('solo pide el correo', () => {
    expect(emailBody.parse({ email: 'ana@example.com' })).toEqual({ email: 'ana@example.com' });
  });
});

describe('loginBody', () => {
  it('no aplica la política de contraseñas al iniciar sesión', () => {
    expect(loginBody.safeParse({ email: 'ana@example.com', password: 'x' }).success).toBe(true);
  });

  it('rechaza una contraseña vacía', () => {
    expect(loginBody.safeParse({ email: 'ana@example.com', password: '' }).success).toBe(false);
  });
});

describe('refreshBody', () => {
  it('acepta un refresh token', () => {
    expect(refreshBody.parse({ refreshToken: 'abc' })).toEqual({ refreshToken: 'abc' });
  });

  it('rechaza un refresh token vacío', () => {
    expect(refreshBody.safeParse({ refreshToken: '' }).success).toBe(false);
  });
});

describe('resetPasswordBody', () => {
  it('acepta correo, OTP y contraseña nueva válida', () => {
    expect(resetPasswordBody.parse({ email: 'ana@example.com', otp: '12345678', newPassword: 'nueva1234' })).toEqual({
      email: 'ana@example.com',
      otp: '12345678',
      newPassword: 'nueva1234',
    });
  });

  it('aplica la política a la contraseña nueva', () => {
    const result = resetPasswordBody.safeParse({ email: 'ana@example.com', otp: '123456', newPassword: 'sinnumeros' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['newPassword']);
  });
});
