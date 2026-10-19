import { Router } from 'express';
import { changePassword, deleteMe, getMe, updateMe, uploadAvatar } from '../controllers/me.controller';
import { sensitiveLimiter } from '../middlewares/rateLimits';
import { requireAuth } from '../middlewares/requireAuth';
import { avatarUpload } from '../middlewares/upload';
import { validate } from '../middlewares/validate';
import { changePasswordBody, deleteMeBody, updateMeBody } from '../validators/me';

// /api/me
export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', getMe);
meRouter.patch('/', validate({ body: updateMeBody }), updateMe);
meRouter.delete('/', sensitiveLimiter, validate({ body: deleteMeBody }), deleteMe);
meRouter.put('/avatar', avatarUpload, uploadAvatar);
// Cambiar la contraseña y borrar la cuenta comparten el límite de intentos (RF-08.2).
meRouter.put('/password', sensitiveLimiter, validate({ body: changePasswordBody }), changePassword);
