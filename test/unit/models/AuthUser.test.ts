import '../../../src/database';
import { AuthUser } from '../../../src/models';

afterEach(() => jest.restoreAllMocks());

describe('AuthUser', () => {
  describe('isVerified', () => {
    it('es true si tiene emailConfirmedAt', () => {
      const user = AuthUser.build({ id: 'user-1', email: 'ana@example.com', emailConfirmedAt: new Date() });

      expect(user.isVerified).toBe(true);
    });

    it('es false si emailConfirmedAt es null', () => {
      const user = AuthUser.build({ id: 'user-1', email: 'ana@example.com', emailConfirmedAt: null });

      expect(user.isVerified).toBe(false);
    });
  });

  describe('findByEmail', () => {
    it('busca sin distinguir mayúsculas y solo pide id, email y emailConfirmedAt', async () => {
      const found = AuthUser.build({ id: 'user-1', email: 'ana@example.com', emailConfirmedAt: null });
      const findOne = jest.spyOn(AuthUser, 'findOne').mockResolvedValue(found);

      await expect(AuthUser.findByEmail('Ana@Example.COM')).resolves.toBe(found);

      expect(findOne).toHaveBeenCalledTimes(1);
      const options = findOne.mock.calls[0][0] as { attributes: string[]; where: { logic: unknown } };
      expect(options.attributes).toEqual(['id', 'email', 'emailConfirmedAt']);
      // where(lower(email), '<correo en minúsculas>')
      expect(options.where.logic).toBe('ana@example.com');
    });
  });
});
