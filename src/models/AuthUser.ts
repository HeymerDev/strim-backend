import { col, fn, where } from 'sequelize';
import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

// Tabla de usuarios de Supabase Auth. SOLO LECTURA: la administra Supabase.
// Se usa en el registro para saber si un correo existe y si está verificado.
@Table({ tableName: 'users', schema: 'auth', timestamps: false, underscored: true })
export class AuthUser extends Model {
  @PrimaryKey
  @Column(DataType.UUID)
  id: string;

  @Column(DataType.STRING)
  email: string | null;

  @Column(DataType.DATE)
  emailConfirmedAt: Date | null;

  static findByEmail(email: string) {
    return AuthUser.findOne({
      attributes: ['id', 'email', 'emailConfirmedAt'],
      where: where(fn('lower', col('email')), email.toLowerCase()),
    });
  }

  get isVerified() {
    return this.emailConfirmedAt !== null;
  }
}
