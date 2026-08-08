"""运行环境配置持久化（issue #29）。

把原本只走环境变量/写死在契约里的运行环境配置（api key、默认模型、base_url、
组件级默认参数）落到 server/config.json，支持 GET /config（api key 掩码回显）
与 PUT /config（覆盖写入）。明文 api key 只存在该文件里，不进 git（已加入
.gitignore）、不进前端 DOM。

字段命名与 wire 契约一致（camelCase）：apiKey / baseUrl / componentParams。
"""

import json
import os
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config.json"

# 默认配置：api key 空 → 运行界面自动走离线兜底模型。
_DEFAULTS = {
    "apiKey": "",
    "baseUrl": "",
    "componentParams": {},
}


def mask_api_key(key: str) -> str:
    """掩码回显 api key：保留前 3 位与后 3 位，中间用 *** 代替（如 sk-***abc）。

    完整值只在 server 内部持有，回显给前端的是掩码，避免明文落前端 DOM。
    """
    if not key:
        return ""
    if len(key) <= 6:
        return "***"
    return f"{key[:3]}***{key[-3:]}"


class ConfigStore:
    """server/config.json 的读写封装：内存持有 + 变更落盘。

    文件不存在时用默认值（api key 空 → 离线兜底），首次 PUT 才落盘创建。
    路径可用环境变量 SERVER_CONFIG_PATH 覆盖（测试用临时文件，避免污染仓库）。
    """

    def __init__(self, path=None):
        self.path = Path(path) if path else Path(
            os.environ.get("SERVER_CONFIG_PATH") or DEFAULT_CONFIG_PATH
        )
        self._data = dict(_DEFAULTS)
        if self.path.is_file():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                raw = {}
            for key, value in _DEFAULTS.items():
                if isinstance(raw, dict) and key in raw:
                    self._data[key] = raw[key]

    # --- 内部读取（原始值，仅供 server 内部使用） ---

    @property
    def api_key(self) -> str:
        return self._data.get("apiKey") or ""

    @property
    def base_url(self) -> str:
        return self._data.get("baseUrl") or ""

    @property
    def component_params(self) -> dict:
        return self._data.get("componentParams") or {}

    # --- 对外读写（掩码回显 / 合并更新） ---

    def view(self) -> dict:
        """给前端的只读视图：api key 掩码回显，完整值不外泄。"""
        return {
            "apiKey": mask_api_key(self.api_key),
            "baseUrl": self.base_url,
            "componentParams": {
                component_id: dict(params)
                for component_id, params in self.component_params.items()
            },
        }

    def update(self, payload: dict) -> dict:
        """合并写入并落盘，返回掩码视图。

        - apiKey：掩码占位值（含 ***，即前端未改动）不覆盖真实 key；
          新 key 或空字符串（清空）直接写入。
        - componentParams：按组件 id 整组覆盖该组件的默认参数，其余组件保留。
        """
        if not isinstance(payload, dict):
            raise ValueError("config payload must be an object")
        if "apiKey" in payload and payload["apiKey"] is not None:
            api_key = str(payload["apiKey"])
            if "***" not in api_key:
                self._data["apiKey"] = api_key
        if "baseUrl" in payload and payload["baseUrl"] is not None:
            self._data["baseUrl"] = str(payload["baseUrl"])
        if "componentParams" in payload and isinstance(
            payload["componentParams"], dict
        ):
            merged = dict(self.component_params)
            for component_id, params in payload["componentParams"].items():
                if isinstance(params, dict):
                    merged[component_id] = dict(params)
            self._data["componentParams"] = merged
        self._persist()
        return self.view()

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
