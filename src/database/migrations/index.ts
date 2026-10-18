import { profiles } from './001-profiles';
import { channels } from './002-channels';
import { chatMessages } from './003-chat-messages';

// En orden de ejecución. Una migración nueva se agrega al final.
export const migrations = [profiles, channels, chatMessages];
