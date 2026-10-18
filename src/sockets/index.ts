import type http from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { authenticateToken } from '../middlewares/requireAuth';
import { AppError, type ErrorCode } from '../utils/AppError';
import { setSocketServer, userRoom } from './emit';
import type { StrimServer } from './types';

// El cliente recibe `connect_error` con err.message = código y err.data = { code, message }.
function connectionError(code: ErrorCode) {
  const appError = new AppError(code);
  const err = new Error(code) as Error & { data: unknown };
  err.data = appError.toJSON();
  return err;
}

export function initSockets(httpServer: http.Server): StrimServer {
  const io: StrimServer = new Server(httpServer, { cors: { origin: env.FRONTEND_URL } });

  // Token opcional: sin token el socket es anónimo (solo lectura, RF-14.4);
  // con un token inválido o vencido se rechaza la conexión (RF-14.5).
  io.use(async (socket, next) => {
    socket.data.userId = null;
    socket.data.exp = null;
    socket.data.channelId = null;

    const token: unknown = socket.handshake.auth?.token;
    if (token === undefined || token === null || token === '') return next();
    if (typeof token !== 'string') return next(connectionError('UNAUTHORIZED'));

    try {
      const auth = await authenticateToken(token);
      if (!auth) return next(connectionError('UNAUTHORIZED'));
      socket.data.userId = auth.userId;
      socket.data.exp = auth.exp;
      next();
    } catch (err) {
      console.error('[socket] error al autenticar la conexión', err);
      next(connectionError('INTERNAL_ERROR'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));
  });

  setSocketServer(io);
  return io;
}
