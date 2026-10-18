import { z } from 'zod';
import { anyPasswordSchema, emailSchema, otpSchema, passwordSchema, usernameSchema } from './common';

export const registerBody = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const verifyEmailBody = z.object({ email: emailSchema, otp: otpSchema });

export const emailBody = z.object({ email: emailSchema });

export const loginBody = z.object({ email: emailSchema, password: anyPasswordSchema });

export const refreshBody = z.object({ refreshToken: z.string().min(1) });

export const resetPasswordBody = z.object({
  email: emailSchema,
  otp: otpSchema,
  newPassword: passwordSchema,
});

export type RegisterBody = z.infer<typeof registerBody>;
export type VerifyEmailBody = z.infer<typeof verifyEmailBody>;
export type EmailBody = z.infer<typeof emailBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type RefreshBody = z.infer<typeof refreshBody>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;
