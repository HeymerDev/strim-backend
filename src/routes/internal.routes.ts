import { Router } from 'express';
import { authorizeMediaMtx } from '../controllers/mediamtx.controller';
import { requireInternalSecret } from '../middlewares/internalSecret';

// /internal: solo para MediaMTX, fuera de la API pública (RF-11.3).
// En producción el proxy no debe exponer esta ruta.
export const internalRouter = Router();

internalRouter.use(requireInternalSecret);

internalRouter.post('/mediamtx/auth', authorizeMediaMtx);
