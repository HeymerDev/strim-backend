import { Router } from 'express';
import {
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resendOtp,
  resetPassword,
  verifyEmail,
} from '../controllers/auth.controller';
import { authLimiter } from '../middlewares/rateLimits';
import { requireAuth } from '../middlewares/requireAuth';
import { validate } from '../middlewares/validate';
import {
  emailBody,
  loginBody,
  refreshBody,
  registerBody,
  resetPasswordBody,
  verifyEmailBody,
} from '../validators/auth';

// /api/auth
export const authRouter = Router();

authRouter.use(authLimiter);

authRouter.post('/register', validate({ body: registerBody }), register);
authRouter.post('/verify-email', validate({ body: verifyEmailBody }), verifyEmail);
authRouter.post('/resend-otp', validate({ body: emailBody }), resendOtp);
authRouter.post('/login', validate({ body: loginBody }), login);
authRouter.post('/refresh', validate({ body: refreshBody }), refresh);
authRouter.post('/logout', requireAuth, logout);
authRouter.post('/password/forgot', validate({ body: emailBody }), forgotPassword);
authRouter.post('/password/reset', validate({ body: resetPasswordBody }), resetPassword);
