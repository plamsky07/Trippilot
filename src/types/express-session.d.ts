import "express-session";

import type { FlashMessage } from "./domain";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    flash?: FlashMessage | null;
  }
}
