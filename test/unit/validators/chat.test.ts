import { joinPayload, sendPayload } from '../../../src/validators/chat';

describe('joinPayload', () => {
  it('normaliza el username', () => {
    expect(joinPayload.parse({ username: '  ANA ' })).toEqual({ username: 'ana' });
  });

  it('rechaza un username vacío o de más de 20 caracteres', () => {
    expect(joinPayload.safeParse({ username: '   ' }).success).toBe(false);
    expect(joinPayload.safeParse({ username: 'a'.repeat(21) }).success).toBe(false);
  });

  it('rechaza un payload que no es objeto', () => {
    expect(joinPayload.safeParse('ana').success).toBe(false);
    expect(joinPayload.safeParse(undefined).success).toBe(false);
  });
});

describe('sendPayload', () => {
  it('quita los espacios de los extremos', () => {
    expect(sendPayload.parse({ content: '  hola  ' })).toEqual({ content: 'hola' });
  });

  it('rechaza un mensaje vacío tras el trim', () => {
    const result = sendPayload.safeParse({ content: '    ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('El mensaje no puede estar vacío.');
  });

  it('acepta 1 y 300 caracteres', () => {
    expect(sendPayload.safeParse({ content: 'a' }).success).toBe(true);
    expect(sendPayload.safeParse({ content: 'a'.repeat(300) }).success).toBe(true);
  });

  it('rechaza 301 caracteres', () => {
    const result = sendPayload.safeParse({ content: 'a'.repeat(301) });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('El mensaje puede tener como máximo 300 caracteres.');
  });

  it('cuenta el largo después del trim', () => {
    expect(sendPayload.safeParse({ content: `   ${'a'.repeat(300)}   ` }).success).toBe(true);
  });

  it('rechaza un content que no es texto', () => {
    expect(sendPayload.safeParse({ content: 123 }).success).toBe(false);
  });
});
