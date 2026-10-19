import { listLiveSignals, type LiveSignal } from '../config/mediamtx';
import { kickQuietly, notifyStreamChange } from '../controllers/stream.controller';
import { Channel, type ChannelStatus, Profile } from '../models';

// Monitor de señales (RF-12, diseño §8.4): cada 3 s compara lo que MediaMTX está
// recibiendo con el estado de cada canal. La primera pasada al arrancar hace la
// sincronización de RF-12.3.

const INTERVAL_MS = 3_000;

let running = false;
let mediaMtxDown = false;

// Cambia el estado solo si el canal sigue en `from`: evita pisar un "Finalizar stream"
// que llegó mientras el monitor leía.
async function transition(profile: Profile, from: ChannelStatus, to: ChannelStatus, liveStartedAt: Date | null) {
  const [changed] = await Channel.update(
    { status: to, liveStartedAt },
    { where: { userId: profile.id, status: from } },
  );
  if (!changed) return;
  profile.channel!.set({ status: to, liveStartedAt });
  notifyStreamChange(profile);
}

async function readSignals(): Promise<Map<string, LiveSignal> | null> {
  try {
    const signals = await listLiveSignals();
    if (mediaMtxDown) console.log('[monitor] MediaMTX volvió a responder.');
    mediaMtxDown = false;
    return signals;
  } catch (err) {
    // Sin datos de MediaMTX no se toca ningún estado (RF-12, diseño §8.4.5).
    if (!mediaMtxDown) {
      console.warn(`[monitor] MediaMTX no responde, no se cambian estados: ${err instanceof Error ? err.message : err}`);
    }
    mediaMtxDown = true;
    return null;
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const signals = await readSignals();
    if (!signals) return;
    const isReady = (username: string) => signals.get(username)?.ready === true;

    // live sin señal → waiting: OBS se detuvo o se cayó y puede reconectarse (RF-12.2).
    const live = await Profile.findAll({ include: [{ model: Channel, where: { status: 'live' } }] });
    for (const profile of live) {
      if (!isReady(profile.username)) await transition(profile, 'live', 'waiting', null);
    }

    const readyUsernames = [...signals.keys()].filter(isReady);
    if (readyUsernames.length === 0) return;

    const withSignal = await Profile.findAll({ where: { username: readyUsernames }, include: [Channel] });
    for (const profile of withSignal) {
      const status = profile.channel?.status;
      // waiting con señal → live (RF-12.1).
      if (status === 'waiting') {
        await transition(profile, 'waiting', 'live', signals.get(profile.username)?.readyTime ?? new Date());
      }
      // offline con señal: falló el corte al finalizar, se vuelve a intentar.
      if (status === 'offline') await kickQuietly(profile.username);
    }
  } catch (err) {
    console.error('[monitor] error al revisar las señales', err);
  } finally {
    running = false;
  }
}

export function startStreamMonitor(): () => void {
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  return () => clearInterval(timer);
}
