import { createRuntimeServer } from "./server.ts";

const PORT = Number(process.env.PORT ?? 8000);
const ROOT_DIRS = ["public", "dist"];

const server = await createRuntimeServer(ROOT_DIRS);
server.listen(PORT, () => {
  console.log(`运行界面已启动: http://localhost:${PORT}`);
});
