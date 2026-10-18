// Catálogo de errores de la API y del socket (diseño §9).
const catalog = {
  VALIDATION_ERROR: { status: 400, message: 'Hay datos inválidos.' },
  INVALID_OTP: { status: 400, message: 'El código es incorrecto o venció.' },
  INVALID_CURRENT_PASSWORD: { status: 400, message: 'La contraseña actual no es correcta.' },
  SAME_PASSWORD: { status: 400, message: 'La nueva contraseña debe ser distinta de la actual.' },
  INVALID_FILE: { status: 400, message: 'El avatar debe ser JPG, PNG o WebP de hasta 2 MB.' },
  NOT_IN_ROOM: { status: 400, message: 'Únete a un canal antes de escribir.' },
  UNAUTHORIZED: { status: 401, message: 'Tu sesión no es válida o venció.' },
  INVALID_CREDENTIALS: { status: 401, message: 'Correo o contraseña incorrectos.' },
  AUTH_REQUIRED: { status: 401, message: 'Inicia sesión para comentar.' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Verifica tu correo para iniciar sesión.' },
  NOT_FOUND: { status: 404, message: 'No encontrado.' },
  EMAIL_TAKEN: { status: 409, message: 'Ese correo ya está registrado.' },
  USERNAME_TAKEN: { status: 409, message: 'Ese nombre de usuario ya está en uso.' },
  CHANNEL_LIVE: { status: 409, message: 'No puedes hacer esto mientras tu stream está activo.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'La petición es demasiado grande.' },
  TOO_MANY_REQUESTS: { status: 429, message: 'Demasiados intentos. Espera un momento.' },
  RATE_LIMITED: { status: 429, message: 'Vas muy rápido.' },
  INTERNAL_ERROR: { status: 500, message: 'Algo salió mal.' },
} as const;

export type ErrorCode = keyof typeof catalog;

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? catalog[code].message);
    this.name = 'AppError';
    this.status = catalog[code].status;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}
