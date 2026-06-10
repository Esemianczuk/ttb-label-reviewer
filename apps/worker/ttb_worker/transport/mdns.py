from __future__ import annotations

from dataclasses import dataclass

SERVICE_TYPE = "_ttb-label-reviewer._tcp.local."


@dataclass(frozen=True)
class DiscoveredCoordinator:
    name: str
    url: str
    host: str
    port: int


def discover_coordinators(timeout_seconds: float = 2.0) -> list[DiscoveredCoordinator]:
    try:
        from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    except Exception:
        return []

    found: list[DiscoveredCoordinator] = []

    class Listener(ServiceListener):
        def add_service(self, zeroconf, service_type, name):
            info = zeroconf.get_service_info(service_type, name)
            if not info or not info.addresses:
                return
            host = ".".join(str(part) for part in info.addresses[0])
            found.append(DiscoveredCoordinator(name=name, url=f"http://{host}:{info.port}", host=host, port=info.port))

        def update_service(self, zeroconf, service_type, name):
            return None

        def remove_service(self, zeroconf, service_type, name):
            return None

    zeroconf = Zeroconf()
    try:
        ServiceBrowser(zeroconf, SERVICE_TYPE, Listener())
        import time

        time.sleep(timeout_seconds)
    finally:
        zeroconf.close()
    return found
