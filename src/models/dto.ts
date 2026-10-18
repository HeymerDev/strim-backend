// Formas de las respuestas JSON (diseño §6).

export const CHANNEL_STATUSES = ['offline', 'waiting', 'live'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export type ProfileDTO = {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
};

export type MeDTO = {
  id: string;
  email: string;
  profile: ProfileDTO;
  channel: { status: ChannelStatus; title: string; liveStartedAt: string | null };
};

export type StreamDashboardDTO = {
  status: ChannelStatus;
  title: string;
  liveStartedAt: string | null;
  obs: { server: string; streamKey: string };
};

export type PublicChannelDTO = ProfileDTO & {
  title: string;
  isLive: boolean;
  liveStartedAt: string | null;
  viewers: number;
  playbackUrl: string | null;
};

export type ChatMessageDTO = {
  id: string;
  content: string;
  createdAt: string;
  author: { username: string; displayName: string; avatarUrl: string | null };
};
