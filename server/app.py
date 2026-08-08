import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from server.runtime import RuntimeUI

_PATH_RE = re.compile(r"^/demo/([^/]+)/(chat|telemetry|ablations|generate)$")


class _Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._send_json(204, None)

    def do_GET(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def _dispatch(self) -> None:
        try:
            path = (self.path or "").split("?")[0]
            # 运行环境配置与组件清单端点不走 /demo/{id}/{action} 模式。
            if path == "/config":
                return self._handle_config()
            if path == "/components":
                return self._handle_components()
            match = _PATH_RE.match(path)
            if match is None:
                return self._error(404, f"unknown path: {self.path}")
            demo_id, action = match.groups()
            if self.command == "GET":
                if action != "telemetry":
                    return self._error(405, "method not allowed")
                return self._send_json(200, self.runtime.get_telemetry(demo_id))
            if self.command == "POST":
                body = self._read_json()
                if action == "chat":
                    payload = self.runtime.send_chat(demo_id, body.get("messages", []))
                elif action == "ablations":
                    payload = self.runtime.trigger_ablation(demo_id, body)
                elif action == "generate":
                    # ADR-0005：demo 代码是唯一真相源，generate 只收 { code }。
                    payload = self.runtime.generate_demo_from_code(
                        demo_id, body.get("code", "")
                    )
                else:
                    return self._error(405, "method not allowed")
                return self._send_json(200, payload)
            return self._error(405, "method not allowed")
        except KeyError as exc:
            self._error(404, str(exc))
        except (json.JSONDecodeError, ValueError) as exc:
            self._error(400, str(exc))
        except Exception as exc:
            self._error(500, str(exc))

    def _handle_config(self) -> None:
        if self.command == "GET":
            return self._send_json(200, self.runtime.get_config())
        if self.command == "PUT":
            return self._send_json(200, self.runtime.update_config(self._read_json()))
        return self._error(405, "method not allowed")

    def _handle_components(self) -> None:
        if self.command == "GET":
            return self._send_json(200, self.runtime.list_components())
        return self._error(405, "method not allowed")

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, status: int, payload) -> None:
        body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send_json(status, {"error": message})

    def log_message(self, *args) -> None:
        pass


def build_app(runtime=None, *, host: str = "127.0.0.1", port: int = 9000) -> ThreadingHTTPServer:
    if runtime is None:
        runtime = RuntimeUI()
    handler_runtime = runtime

    class _BoundHandler(_Handler):
        runtime = handler_runtime

    return ThreadingHTTPServer((host, port), _BoundHandler)


def main(argv=None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="运行界面 Demo API server（U6）")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    args = parser.parse_args(argv)

    server = build_app(RuntimeUI(), host=args.host, port=args.port)
    print(f"LISTENING {server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
