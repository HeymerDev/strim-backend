import { startStreamBody, updateStreamBody } from '../../../src/validators/stream';

describe('startStreamBody', () => {
  it('el título es opcional', () => {
    expect(startStreamBody.parse({})).toEqual({});
  });

  it('quita los espacios del título', () => {
    expect(startStreamBody.parse({ title: '  Jugando  ' })).toEqual({ title: 'Jugando' });
  });

  it('acepta un título de 100 caracteres y rechaza 101', () => {
    expect(startStreamBody.safeParse({ title: 'a'.repeat(100) }).success).toBe(true);

    const result = startStreamBody.safeParse({ title: 'a'.repeat(101) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('El título puede tener como máximo 100 caracteres.');
  });

  it('cuenta el largo después del trim', () => {
    expect(startStreamBody.safeParse({ title: `  ${'a'.repeat(100)}  ` }).success).toBe(true);
  });
});

describe('updateStreamBody', () => {
  it('exige el título', () => {
    expect(updateStreamBody.safeParse({}).success).toBe(false);
  });

  it('acepta un título vacío', () => {
    expect(updateStreamBody.parse({ title: '   ' })).toEqual({ title: '' });
  });

  it('rechaza más de 100 caracteres', () => {
    expect(updateStreamBody.safeParse({ title: 'a'.repeat(101) }).success).toBe(false);
  });
});
