import multer from 'multer';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '../config/supabase';
import { AppError } from '../utils/AppError';

// Avatar en memoria: un archivo, máx. 2 MB, JPG/PNG/WebP (RF-06.4).
export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, accept) => {
    if (AVATAR_MIME_TYPES.includes(file.mimetype)) accept(null, true);
    else accept(new AppError('INVALID_FILE'));
  },
}).single('avatar');
