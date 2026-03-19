import { createApp } from "./app";

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);

  app.listen(port, () => {
    console.log(`Trippilot is running at http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start Trippilot:", error);
  process.exit(1);
});
