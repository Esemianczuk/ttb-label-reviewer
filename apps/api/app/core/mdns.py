from __future__ import annotations

import socket
from dataclasses import dataclass

SERVICE_TYPE = "_ttb-label-reviewer._tcp.local."


@dataclass
class MdnsAdvertiser:
    name: str
    host: str
    port: int
    zeroconf: object | None = None
    service_info: object | None = None

    def start(self) -> bool:
        try:
            from zeroconf import ServiceInfo, Zeroconf
        except Exception:
            return False

        address = _host_address(self.host)
        self.zeroconf = Zeroconf()
        self.service_info = ServiceInfo(
            SERVICE_TYPE,
            f"{self.name}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(address)],
            port=self.port,
            properties={"app": "ttb-label-reviewer"},
            server=f"{socket.gethostname()}.local.",
        )
        self.zeroconf.register_service(self.service_info)
        return True

    def stop(self) -> None:
        if self.zeroconf and self.service_info:
            self.zeroconf.unregister_service(self.service_info)
            self.zeroconf.close()


def _host_address(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(("8.8.8.8", 80))
                return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"
    return host
