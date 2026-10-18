import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  Unique,
} from 'sequelize-typescript';
import { CHANNEL_STATUSES, type ChannelStatus } from './dto';
import { Profile } from './Profile';

@Table({ tableName: 'channels', underscored: true })
export class Channel extends Model {
  // Un canal por usuario: la PK es el id del perfil.
  @PrimaryKey
  @ForeignKey(() => Profile)
  @Column(DataType.UUID)
  userId: string;

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING(64))
  streamKey: string;

  @AllowNull(false)
  @Default('offline')
  @Column(DataType.ENUM(...CHANNEL_STATUSES))
  status: ChannelStatus;

  @AllowNull(false)
  @Default('')
  @Column(DataType.STRING(100))
  title: string;

  @AllowNull(true)
  @Column(DataType.DATE)
  liveStartedAt: Date | null;

  @BelongsTo(() => Profile, 'userId')
  profile?: Profile;

  declare createdAt: Date;
  declare updatedAt: Date;
}
