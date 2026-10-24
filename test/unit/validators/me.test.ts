import { changePasswordBody, deleteMeBody, updateMeBody } from '../../../src/validators/me';

const issuesOf = (value: unknown) => {
  const result = updateMeBody.safeParse(value);
  return result.success ? [] : result.error.issues;
};

describe('updateMeBody', () => {
  it('rechaza un body vacío', () => {
    const issues = issuesOf({});

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe('No hay nada que actualizar.');
  });

  it('rechaza un body con solo campos desconocidos (se descartan y queda vacío)', () => {
    expect(issuesOf({ email: 'otro@example.com' })[0]?.message).toBe('No hay nada que actualizar.');
  });

  it('normaliza el username', () => {
    expect(updateMeBody.parse({ username: ' Nuevo_Nombre ' })).toEqual({ username: 'nuevo_nombre' });
  });

  it('rechaza un username reservado', () => {
    expect(issuesOf({ username: 'Admin' })[0]?.message).toBe('Ese nombre de usuario no está disponible.');
  });

  it('quita los espacios del nombre visible y la bio', () => {
    expect(updateMeBody.parse({ displayName: '  Ana  ', bio: '  Hola  ' })).toEqual({ displayName: 'Ana', bio: 'Hola' });
  });

  it('rechaza un nombre visible vacío tras el trim', () => {
    expect(issuesOf({ displayName: '   ' })[0]?.message).toBe('El nombre visible no puede estar vacío.');
  });

  it('acepta un nombre visible de 30 caracteres y rechaza 31', () => {
    expect(updateMeBody.safeParse({ displayName: 'a'.repeat(30) }).success).toBe(true);
    expect(updateMeBody.safeParse({ displayName: 'a'.repeat(31) }).success).toBe(false);
  });

  it('acepta una bio vacía (sirve para borrarla)', () => {
    expect(updateMeBody.parse({ bio: '' })).toEqual({ bio: '' });
  });

  it('acepta una bio de 200 caracteres y rechaza 201', () => {
    expect(updateMeBody.safeParse({ bio: 'a'.repeat(200) }).success).toBe(true);
    expect(updateMeBody.safeParse({ bio: 'a'.repeat(201) }).success).toBe(false);
  });
});

describe('changePasswordBody', () => {
  it('la actual solo debe no estar vacía; la nueva sigue la política', () => {
    expect(changePasswordBody.safeParse({ currentPassword: 'x', newPassword: 'nueva1234' }).success).toBe(true);
  });

  it('rechaza una contraseña nueva débil', () => {
    const result = changePasswordBody.safeParse({ currentPassword: 'vieja1234', newPassword: '12345678' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['newPassword']);
  });
});

describe('deleteMeBody', () => {
  it('exige la contraseña', () => {
    expect(deleteMeBody.safeParse({}).success).toBe(false);
    expect(deleteMeBody.safeParse({ password: '' }).success).toBe(false);
    expect(deleteMeBody.parse({ password: 'x' })).toEqual({ password: 'x' });
  });
});
