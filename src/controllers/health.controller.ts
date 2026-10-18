import type { RequestHandler } from 'express';

export const health: RequestHandler = (_req, res) => {
  res.json({ ok: true });
};
