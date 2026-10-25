import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthContext } from '../../src/middlewares/requireAuth';

// Respuesta falsa de Express: guarda el estado, el JSON y si se cerró con end().
export type MockResponse = {
  statusCode: number;
  body: unknown;
  ended: boolean;
  status: jest.Mock;
  json: jest.Mock;
  end: jest.Mock;
};

export function mockResponse(): MockResponse {
  const res = { statusCode: 200, body: undefined, ended: false } as MockResponse;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end = jest.fn(() => {
    res.ended = true;
    return res;
  });
  return res;
}

type RequestInit = {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  auth?: AuthContext;
  file?: Express.Multer.File;
  method?: string;
  originalUrl?: string;
};

// Petición falsa de Express con solo lo que usan los controladores y middlewares.
export function mockRequest(init: RequestInit = {}): Request {
  return {
    method: 'GET',
    originalUrl: '/',
    body: {},
    params: {},
    query: {},
    headers: {},
    ...init,
  } as unknown as Request;
}

// Llama a un handler de Express. Lo que lance (sincrónico o async) termina como promesa rechazada.
export async function runHandler(
  handler: RequestHandler,
  req: Request,
  res: MockResponse = mockResponse(),
  next: NextFunction = jest.fn(),
): Promise<void> {
  await handler(req, res as unknown as Response, next);
}

// Convierte el cuerpo enviado con res.json() en JSON plano (aplica los toJSON, como Express).
export const sentJson = (res: MockResponse) => JSON.parse(JSON.stringify(res.body)) as Record<string, unknown>;
