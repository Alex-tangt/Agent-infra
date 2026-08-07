import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// 按顺序查找目录，命中即返回：静态壳（public/）优先，编译产物（dist/）兜底。
export async function createRuntimeServer(rootDirs: string[]): Promise<Server> {
  const roots = rootDirs.map((d) => normalize(d));
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let pathname = url.pathname;
      if (pathname === "/") pathname = "/index.html";
      const rel = normalize(pathname).replace(/^([/\\])+/, "");
      for (const root of roots) {
        try {
          const file = join(root, rel);
          const data = await readFile(file);
          res.writeHead(200, {
            "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
          });
          res.end(data);
          return;
        } catch {
          // try next root
        }
      }
      throw new Error("not found");
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  });
}
