import { createAssemblerServer, DEFAULT_ASSEMBLER_PORT } from "./server.ts";

// 组装器服务启动入口：默认监听 9001，可用环境变量 ASSEMBLER_PORT 覆盖。
const PORT = Number(process.env.ASSEMBLER_PORT ?? DEFAULT_ASSEMBLER_PORT);

const server = createAssemblerServer();
server.listen(PORT, () => {
  console.log(`组装器服务已启动: http://localhost:${PORT}`);
});
