import type { AuthError } from '@supabase/supabase-js';
import { AppError } from './AppError';

export const isRateLimited = (error: AuthError) =>
  error.status === 429 || (error.code?.startsWith('over_') ?? false);

// Convierte los errores de Supabase Auth que tienen sentido para el cliente.
// Lo demás se relanza tal cual y termina como 500 en el errorHandler.
export function fromAuthError(error: AuthError): Error {
  if (isRateLimited(error)) return new AppError('TOO_MANY_REQUESTS');

  // "Error sending confirmation email", "Error sending recovery email"…: casi siempre el SMTP.
  if (/error sending .*email/i.test(error.message)) {
    console.error(`[auth] Supabase no pudo enviar el correo (revisa el SMTP en Supabase): ${error.message}`);
    return new AppError('EMAIL_NOT_SENT');
  }

  switch (error.code) {
    case 'weak_password':
      return new AppError('VALIDATION_ERROR', 'La contraseña no cumple los requisitos.');
    case 'email_address_invalid':
    case 'validation_failed':
      return new AppError('VALIDATION_ERROR', 'Correo inválido.');
    case 'email_address_not_authorized':
      // El correo por defecto de Supabase solo envía a los miembros del equipo del proyecto.
      return new AppError(
        'VALIDATION_ERROR',
        'Todavía no podemos enviar correos a esta dirección. Hay que configurar un SMTP propio en Supabase.',
      );
    default:
      return error;
  }
}
