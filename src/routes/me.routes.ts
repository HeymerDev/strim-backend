import { Router } from 'express';
import { changePassword, getMe, updateMe, uploadAvatar } from '../controllers/me.controller';
import { sensitiveLimiter } from '../middlewares/rateLimits';
import { requireAuth } from '../middlewares/requireAuth';
import { avatarUpload } from '../middlewares/upload';
import { validate } from '../middlewares/validate';
import { changePasswordBody, updateMeBody } from '../validators/me';

// /api/me
export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', getMe);
meRouter.patch('/', validate({ body: updateMeBody }), updateMe);
meRouter.put('/avatar', avatarUpload, uploadAvatar);
meRouter.put('/password', sensitiveLimiter, validate({ body: changePasswordBody }), changePassword);
