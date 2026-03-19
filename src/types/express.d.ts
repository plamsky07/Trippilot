import "express";

import type { CurrentUser } from "./domain";

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser | null;
    }
  }
}

export {};
