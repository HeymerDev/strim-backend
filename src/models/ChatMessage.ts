import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Channel } from './Channel';
import type { ChatMessageDTO } from './dto';
import { Profile } from './Profile';

@Table({ tableName: 'chat_messages', underscored: true, updatedAt: false })
export class ChatMessage extends Model {
  // bigint: pg lo devuelve como string, y así viaja en el JSON.
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: string;

  @AllowNull(false)
  @ForeignKey(() => Channel)
  @Column(DataType.UUID)
  channelId: string;

  // Autor del mensaje.
  @AllowNull(false)
  @ForeignKey(() => Profile)
  @Column(DataType.UUID)
  userId: string;

  @AllowNull(false)
  @Column(DataType.STRING(300))
  content: string;

  @BelongsTo(() => Profile, 'userId')
  author?: Profile;

  @BelongsTo(() => Channel, 'channelId')
  channel?: Channel;

  declare createdAt: Date;

  toMessage(): ChatMessageDTO {
    if (!this.author) throw new Error('ChatMessage.author no está cargado: usa include: [{ model: Profile, as: "author" }]');
    return {
      id: String(this.id),
      content: this.content,
      createdAt: this.createdAt.toISOString(),
      author: {
        username: this.author.username,
        displayName: this.author.displayName,
        avatarUrl: this.author.avatarUrl,
      },
    };
  }
}
