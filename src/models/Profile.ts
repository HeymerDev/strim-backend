import { AllowNull, Column, DataType, Default, HasOne, Model, PrimaryKey, Table, Unique } from 'sequelize-typescript';
import { env } from '../config/env';
import { Channel } from './Channel';
import type { MeDTO, ProfileDTO, PublicChannelDTO, StreamDashboardDTO } from './dto';

@Table({ tableName: 'profiles', underscored: true })
export class Profile extends Model {
  // Mismo id que auth.users.
  @PrimaryKey
  @Column(DataType.UUID)
  id: string;

  @AllowNull(false)
  @Unique
  @Column(DataType.STRING(20))
  username: string;

  @AllowNull(false)
  @Column(DataType.STRING(30))
  displayName: string;

  @AllowNull(false)
  @Default('')
  @Column(DataType.STRING(200))
  bio: string;

  @AllowNull(true)
  @Column(DataType.TEXT)
  avatarUrl: string | null;

  @HasOne(() => Channel, 'userId')
  channel?: Channel;

  declare createdAt: Date;
  declare updatedAt: Date;

  toProfile(): ProfileDTO {
    return {
      username: this.username,
      displayName: this.displayName,
      bio: this.bio,
      avatarUrl: this.avatarUrl,
    };
  }

  toMe(email: string): MeDTO {
    const channel = this.loadedChannel();
    return {
      id: this.id,
      email,
      profile: this.toProfile(),
      channel: {
        status: channel.status,
        title: channel.title,
        liveStartedAt: channel.liveStartedAt?.toISOString() ?? null,
      },
    };
  }

  toDashboard(): StreamDashboardDTO {
    const channel = this.loadedChannel();
    return {
      status: channel.status,
      title: channel.title,
      liveStartedAt: channel.liveStartedAt?.toISOString() ?? null,
      obs: {
        server: env.RTMP_PUBLIC_URL,
        streamKey: `${this.username}?key=${channel.streamKey}`,
      },
    };
  }

  toPublic(viewers: number): PublicChannelDTO {
    const channel = this.loadedChannel();
    const isLive = channel.status === 'live';
    return {
      ...this.toProfile(),
      title: channel.title,
      isLive,
      liveStartedAt: isLive ? (channel.liveStartedAt?.toISOString() ?? null) : null,
      viewers,
      playbackUrl: isLive ? `${env.HLS_PUBLIC_URL}/live/${this.username}/index.m3u8` : null,
    };
  }

  private loadedChannel(): Channel {
    if (!this.channel) throw new Error('Profile.channel no está cargado: usa include: [Channel]');
    return this.channel;
  }
}
