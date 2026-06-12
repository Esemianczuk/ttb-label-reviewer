#!/usr/bin/env python3
"""Cross-platform terminal launcher for the TTB Label Reviewer demo.

This intentionally avoids curses, tkinter, rich, and shell-only behavior so it
works in ordinary terminals, SSH sessions, Windows consoles, and headless
servers. It only manages processes started by this launcher.
"""

from __future__ import annotations

import argparse
import functools
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parents[1]
LOG_DIR = ROOT / "logs" / "launcher"
DEFAULT_SESSION_ID = "local-dev-session"
DEFAULT_BACKEND_HOST = "127.0.0.1"
DEFAULT_BACKEND_PORT = 8000
DEFAULT_CONSOLE_PORT = 5174
DEFAULT_WORKER_DIR = ROOT / ".worker-cache"


def is_windows() -> bool:
    return os.name == "nt"


def is_posix() -> bool:
    return os.name == "posix"


def venv_python() -> Path:
    if is_windows():
        return ROOT / ".venv" / "Scripts" / "python.exe"
    return ROOT / ".venv" / "bin" / "python"


def python_bin() -> str:
    venv = venv_python()
    return str(venv) if venv.exists() else sys.executable


def npm_bin() -> str:
    node = Path(node_bin())
    sibling = node.with_name("npm.cmd" if is_windows() else "npm")
    if sibling.exists():
        return str(sibling)
    npm = shutil.which("npm")
    return npm or "npm"


def node_bin() -> str:
    return str(best_node_bin() or shutil.which("node") or "node")


@functools.lru_cache(maxsize=1)
def best_node_bin() -> Path | None:
    candidates: list[Path] = []
    path_node = shutil.which("node")
    if path_node:
        candidates.append(Path(path_node))

    nvm_dir = Path(os.environ.get("NVM_DIR", str(Path.home() / ".nvm"))).expanduser()
    versions_dir = nvm_dir / "versions" / "node"
    if versions_dir.exists():
        for directory in sorted(versions_dir.glob("v*"), reverse=True):
            node = directory / "bin" / ("node.exe" if is_windows() else "node")
            if node.exists():
                candidates.append(node)

    volta_node = Path.home() / ".volta" / "bin" / ("node.exe" if is_windows() else "node")
    if volta_node.exists():
        candidates.append(volta_node)

    seen: set[Path] = set()
    usable: list[tuple[int, Path]] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        major = node_major(candidate)
        if major is not None:
            usable.append((major, candidate))
    for major, candidate in usable:
        if major >= 20:
            return candidate
    return usable[0][1] if usable else None


def node_major(node: Path) -> int | None:
    try:
        result = subprocess.run([str(node), "--version"], cwd=ROOT, text=True, capture_output=True, timeout=2, check=False)
    except Exception:
        return None
    match = re.search(r"v?(\d+)", (result.stdout or result.stderr).strip())
    return int(match.group(1)) if match else None


def format_command(command: list[str]) -> str:
    return " ".join(quote_arg(part) for part in command)


def process_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    node = best_node_bin()
    if node:
        env["PATH"] = str(node.parent) + os.pathsep + env.get("PATH", "")
    if extra:
        env.update(extra)
    return env


def quote_arg(value: str) -> str:
    if not value:
        return '""'
    if any(char.isspace() for char in value) or any(char in value for char in ['"', "'"]):
        return '"' + value.replace('"', '\\"') + '"'
    return value


def clear_screen() -> None:
    if not sys.stdout.isatty():
        return
    os.system("cls" if is_windows() else "clear")


def pause(message: str = "Press Enter to continue...") -> None:
    try:
        input(f"\n{message}")
    except EOFError:
        pass


def yes_no(prompt: str, default: bool = True) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    while True:
        try:
            value = input(f"{prompt} {suffix} ").strip().lower()
        except EOFError:
            return default
        if not value:
            return default
        if value in {"y", "yes"}:
            return True
        if value in {"n", "no"}:
            return False
        print("Please answer y or n.")


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        return default
    return value or default


def choose(prompt: str, options: list[tuple[str, str]], default: str | None = None) -> str:
    allowed = {key for key, _label in options}
    while True:
        print(prompt)
        for key, label in options:
            marker = " (default)" if default == key else ""
            print(f"  {key}. {label}{marker}")
        try:
            value = input("> ").strip()
        except EOFError:
            return default or options[0][0]
        if not value and default:
            return default
        if value in allowed:
            return value
        print("Choose one of: " + ", ".join(sorted(allowed)))


def port_is_open(host: str, port: int, timeout: float = 0.35) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def post_json(url: str, payload: dict, token: str | None = None, timeout: float = 8.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str, timeout: float = 4.0) -> dict | None:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def local_ip_guess() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


@dataclass
class ManagedProcess:
    name: str
    command: list[str]
    cwd: Path
    env: dict[str, str]
    log_path: Path
    process: subprocess.Popen | None = None
    started_at: float | None = None

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def returncode(self) -> int | None:
        if self.process is None:
            return None
        return self.process.poll()


@dataclass
class LauncherState:
    backend_host: str = DEFAULT_BACKEND_HOST
    backend_port: int = DEFAULT_BACKEND_PORT
    console_port: int = DEFAULT_CONSOLE_PORT
    session_id: str = DEFAULT_SESSION_ID
    worker_engines: str = "null,tesseract"
    worker_name: str = "auto"
    worker_concurrency: str = "auto"
    worker_data_dir: Path = DEFAULT_WORKER_DIR
    join_token: str = ""
    backend_lan_mode: bool = False
    processes: dict[str, ManagedProcess] = field(default_factory=dict)

    @property
    def backend_display_host(self) -> str:
        return "127.0.0.1" if self.backend_host in {"0.0.0.0", "::"} else self.backend_host

    @property
    def backend_url(self) -> str:
        return f"http://{self.backend_display_host}:{self.backend_port}"

    @property
    def coordinator_url_for_worker(self) -> str:
        if self.backend_host in {"0.0.0.0", "::"}:
            return f"http://{local_ip_guess()}:{self.backend_port}"
        return self.backend_url

    @property
    def console_dev_url(self) -> str:
        return f"http://127.0.0.1:{self.console_port}"


class Launcher:
    def __init__(self, state: LauncherState):
        self.state = state
        LOG_DIR.mkdir(parents=True, exist_ok=True)

    def run(self) -> None:
        while True:
            clear_screen()
            self.print_header()
            choice = choose(
                "What would you like to do?",
                [
                    ("1", "One-click local demo: setup if needed, backend, worker, open console"),
                    ("2", "Browser-only console dev server"),
                    ("3", "Backend coordinator and backend-served console"),
                    ("4", "Local worker for backend/cluster jobs"),
                    ("5", "Cluster/LAN setup helper"),
                    ("6", "Benchmarks and checks"),
                    ("7", "Open URLs / health / status"),
                    ("8", "Stop managed processes"),
                    ("9", "Configuration"),
                    ("0", "Exit"),
                ],
                default="1",
            )
            try:
                if choice == "1":
                    self.one_click_local_demo()
                elif choice == "2":
                    self.browser_only_menu()
                elif choice == "3":
                    self.backend_menu()
                elif choice == "4":
                    self.worker_menu()
                elif choice == "5":
                    self.cluster_menu()
                elif choice == "6":
                    self.benchmarks_and_checks_menu()
                elif choice == "7":
                    self.status_menu()
                elif choice == "8":
                    self.stop_menu()
                elif choice == "9":
                    self.configure_menu()
                elif choice == "0":
                    self.exit_menu()
                    return
            except KeyboardInterrupt:
                print("\nInterrupted.")
                pause()
            except Exception as error:  # noqa: BLE001 - launcher should report and keep running.
                print(f"\nAction failed: {type(error).__name__}: {error}")
                pause()

    def print_header(self) -> None:
        print("TTB Label Reviewer Launcher")
        print("=" * 72)
        print(f"Repo:        {ROOT}")
        print(f"Python:      {python_bin()}")
        print(f"Node/npm:    {version_line(node_bin(), ['--version'])} / {version_line(npm_bin(), ['--version'])}")
        print(f"Backend:     {self.state.backend_url} ({'open' if backend_online(self.state.backend_url) else 'not detected'})")
        print(f"Console dev: {self.state.console_dev_url} ({'open' if port_is_open('127.0.0.1', self.state.console_port) else 'not detected'})")
        print(f"Session:     {self.state.session_id}")
        print(f"Worker:      engines={self.state.worker_engines}, data={self.state.worker_data_dir}")
        print("Processes:")
        if self.state.processes:
            for name, managed in self.state.processes.items():
                status = "running" if managed.running() else f"exited {managed.returncode()}"
                print(f"  - {name}: {status} | log {managed.log_path.relative_to(ROOT)}")
        else:
            print("  - none started by this launcher")
        print()

    def one_click_local_demo(self) -> None:
        print("\nThis will start a local backend, issue a worker token, start one worker, and open the console.")
        print("It uses SQLite under data/ and worker cache under .worker-cache/.")
        if not self.dependencies_look_ready():
            if yes_no("Dependencies look incomplete. Run setup now?", default=True):
                self.run_setup()
            else:
                print("Continuing without setup. Some commands may fail.")
        self.start_backend(build_console=True, lan=False)
        self.wait_for_backend()
        self.ensure_join_token()
        self.start_worker()
        self.open_url(self.state.backend_url)
        self.print_mode_instructions()
        pause()

    def browser_only_menu(self) -> None:
        print()
        choice = choose(
            "Browser-only options",
            [
                ("1", "Start console dev server on http://127.0.0.1:5174"),
                ("2", "Start old browser-demo dev server"),
                ("3", "Package local Tesseract assets"),
                ("4", "Open console dev URL"),
                ("0", "Back"),
            ],
            default="1",
        )
        if choice == "1":
            self.start_console_dev()
        elif choice == "2":
            self.start_browser_demo()
        elif choice == "3":
            self.run_foreground("Package Tesseract assets", [node_bin(), "scripts/package-tesseract-assets.mjs"])
        elif choice == "4":
            self.open_url(self.state.console_dev_url)
        pause()

    def backend_menu(self) -> None:
        print()
        choice = choose(
            "Backend options",
            [
                ("1", "Start backend coordinator and serve built console"),
                ("2", "Start backend API only, keep Vite console dev separate"),
                ("3", "Build console now"),
                ("4", "Issue worker join token"),
                ("5", "Open backend-served console"),
                ("6", "Show backend health"),
                ("0", "Back"),
            ],
            default="1",
        )
        if choice == "1":
            self.start_backend(build_console=True, lan=False)
        elif choice == "2":
            self.start_backend(build_console=False, lan=False)
            self.start_console_dev()
        elif choice == "3":
            self.build_console()
        elif choice == "4":
            self.ensure_join_token(force=True)
        elif choice == "5":
            self.open_url(self.state.backend_url)
        elif choice == "6":
            self.print_backend_health()
        pause()

    def worker_menu(self) -> None:
        print()
        choice = choose(
            "Worker options",
            [
                ("1", "Start local worker, generating join token if needed"),
                ("2", "Run one worker claim then exit"),
                ("3", "Probe worker capabilities and OCR engines"),
                ("4", "Issue/copy join token only"),
                ("5", "Show worker command for another machine"),
                ("0", "Back"),
            ],
            default="1",
        )
        if choice == "1":
            self.ensure_join_token()
            self.start_worker()
        elif choice == "2":
            self.ensure_join_token()
            self.start_worker(once=True)
        elif choice == "3":
            self.run_worker_probe()
        elif choice == "4":
            self.ensure_join_token(force=True)
        elif choice == "5":
            self.print_remote_worker_command()
        pause()

    def cluster_menu(self) -> None:
        print()
        print("Cluster mode needs the backend reachable by other machines.")
        print("This binds FastAPI to 0.0.0.0 and prints a LAN warning. Use only on a trusted network.")
        choice = choose(
            "Cluster/LAN options",
            [
                ("1", "Start LAN backend on 0.0.0.0"),
                ("2", "Issue join token and show remote worker command"),
                ("3", "Start local worker against LAN URL"),
                ("4", "Open backend-served console"),
                ("0", "Back"),
            ],
            default="1",
        )
        if choice == "1":
            if yes_no("Start LAN backend now?", default=False):
                self.start_backend(build_console=True, lan=True)
        elif choice == "2":
            self.ensure_join_token(force=True)
            self.print_remote_worker_command()
        elif choice == "3":
            self.ensure_join_token()
            self.start_worker(coordinator_url=self.state.coordinator_url_for_worker)
        elif choice == "4":
            self.open_url(self.state.backend_url)
        pause()

    def benchmarks_and_checks_menu(self) -> None:
        print()
        choice = choose(
            "Benchmarks and checks",
            [
                ("1", "Run quick local benchmark"),
                ("2", "Run cluster benchmark"),
                ("3", "Run JavaScript unit tests"),
                ("4", "Run Python tests"),
                ("5", "Run console build"),
                ("6", "Run full check-all script"),
                ("0", "Back"),
            ],
            default="1",
        )
        if choice == "1":
            self.run_foreground("Local benchmark", shell_script_command("bench-local.sh"))
        elif choice == "2":
            self.run_foreground("Cluster benchmark", shell_script_command("bench-cluster.sh"))
        elif choice == "3":
            self.run_foreground("JavaScript tests", [npm_bin(), "run", "test:js"])
        elif choice == "4":
            self.run_foreground("Python tests", [python_bin(), "-m", "pytest", "-q"])
        elif choice == "5":
            self.build_console()
        elif choice == "6":
            self.run_foreground("check-all", shell_script_command("check-all.sh"))
        pause()

    def status_menu(self) -> None:
        print()
        choice = choose(
            "Status/open options",
            [
                ("1", "Open backend-served console"),
                ("2", "Open Vite console dev URL"),
                ("3", "Open backend health JSON"),
                ("4", "Print backend health JSON here"),
                ("5", "Show last 80 lines of a managed process log"),
                ("6", "List useful URLs and commands"),
                ("0", "Back"),
            ],
            default="4",
        )
        if choice == "1":
            self.open_url(self.state.backend_url)
        elif choice == "2":
            self.open_url(self.state.console_dev_url)
        elif choice == "3":
            self.open_url(f"{self.state.backend_url}/api/health")
        elif choice == "4":
            self.print_backend_health()
        elif choice == "5":
            self.tail_log_menu()
        elif choice == "6":
            self.print_useful_urls()
        pause()

    def stop_menu(self) -> None:
        print()
        running = [(name, proc) for name, proc in self.state.processes.items() if proc.running()]
        if not running:
            print("No running processes were started by this launcher.")
            pause()
            return
        options = [(str(index + 1), f"Stop {name}") for index, (name, _proc) in enumerate(running)]
        options.append(("a", "Stop all managed processes"))
        options.append(("0", "Back"))
        choice = choose("Stop which process?", options, default="0")
        if choice == "a":
            for name, proc in running:
                self.stop_process(name, proc)
        elif choice != "0":
            name, proc = running[int(choice) - 1]
            self.stop_process(name, proc)
        pause()

    def configure_menu(self) -> None:
        print()
        print("Press Enter to keep each current value.")
        self.state.backend_host = ask("Backend host", self.state.backend_host)
        self.state.backend_port = int(ask("Backend port", str(self.state.backend_port)))
        self.state.console_port = int(ask("Console dev port", str(self.state.console_port)))
        self.state.session_id = ask("Session id", self.state.session_id)
        self.state.worker_engines = ask("Worker engines", self.state.worker_engines)
        self.state.worker_name = ask("Worker name", self.state.worker_name)
        self.state.worker_concurrency = ask("Worker concurrency", self.state.worker_concurrency)
        self.state.worker_data_dir = Path(ask("Worker data directory", str(self.state.worker_data_dir))).expanduser().resolve()
        print("Configuration updated.")
        pause()

    def exit_menu(self) -> None:
        running = [(name, proc) for name, proc in self.state.processes.items() if proc.running()]
        if not running:
            return
        print()
        print("These launcher-managed processes are still running:")
        for name, proc in running:
            print(f"  - {name}: pid {proc.process.pid if proc.process else '?'}")
        if yes_no("Stop them before exiting?", default=True):
            for name, proc in running:
                self.stop_process(name, proc)

    def dependencies_look_ready(self) -> bool:
        return (
            Path(npm_bin()).name.startswith("npm")
            and (ROOT / "apps" / "console" / "node_modules").exists()
            and (ROOT / "browser-demo" / "node_modules").exists()
            and venv_python().exists()
        )

    def run_setup(self) -> None:
        self.run_portable_setup()

    def start_console_dev(self) -> None:
        self.start_process(
            name="console-dev",
            command=[npm_bin(), "--prefix", "apps/console", "run", "dev"],
            env={},
            url=self.state.console_dev_url,
        )

    def start_browser_demo(self) -> None:
        self.start_process(
            name="browser-demo",
            command=[npm_bin(), "--prefix", "browser-demo", "run", "dev"],
            env={},
            url="http://127.0.0.1:5173",
        )

    def start_backend(self, *, build_console: bool, lan: bool) -> None:
        if build_console:
            dist = ROOT / "apps" / "console" / "dist" / "index.html"
            if not dist.exists() or yes_no("Rebuild the backend-served console first?", default=False):
                self.build_console()
        host = "0.0.0.0" if lan else self.state.backend_host
        if lan:
            self.state.backend_host = host
            self.state.backend_lan_mode = True
        env = {
            "TTB_API_DATABASE_URL": os.environ.get("TTB_API_DATABASE_URL", "sqlite:///./data/api.sqlite3"),
            "TTB_API_DATA_DIR": os.environ.get("TTB_API_DATA_DIR", str(ROOT / "data")),
            "TTB_API_HOST": host,
            "TTB_API_PORT": str(self.state.backend_port),
            "TTB_API_STATIC_DIR": os.environ.get("TTB_API_STATIC_DIR", str(ROOT / "apps" / "console" / "dist")),
            "TTB_REQUIRE_WORKER_JOIN_TOKEN": os.environ.get("TTB_REQUIRE_WORKER_JOIN_TOKEN", "1"),
        }
        if lan:
            lan_ip = local_ip_guess()
            env["TTB_COORDINATOR_URL"] = f"http://{lan_ip}:{self.state.backend_port}"
            env["TTB_API_CORS_ORIGINS"] = ask(
                "Allowed CORS origins",
                f"http://127.0.0.1:{self.state.backend_port},http://{lan_ip}:{self.state.backend_port},http://127.0.0.1:{self.state.console_port}",
            )
        self.start_process(
            name="backend",
            command=[
                python_bin(),
                "-m",
                "uvicorn",
                "apps.api.app.main:app",
                "--host",
                host,
                "--port",
                str(self.state.backend_port),
                "--reload",
            ],
            env=env,
            url=self.state.backend_url,
        )

    def start_worker(self, *, once: bool = False, coordinator_url: str | None = None) -> None:
        coordinator = coordinator_url or self.state.coordinator_url_for_worker
        self.state.worker_data_dir.mkdir(parents=True, exist_ok=True)
        secret_file = self.state.worker_data_dir / "worker-secret.txt"
        command = [
            python_bin(),
            "-m",
            "ttb_worker",
            "--coordinator",
            coordinator,
            "--name",
            self.state.worker_name,
            "--concurrency",
            self.state.worker_concurrency,
            "--engines",
            self.state.worker_engines,
            "--data-dir",
            str(self.state.worker_data_dir),
            "--secret-file",
            str(secret_file),
            "--session-id",
            self.state.session_id,
        ]
        if self.state.join_token and not secret_file.exists():
            command.extend(["--join-token", self.state.join_token])
        if once:
            command.append("--once")
        env = {
            "PYTHONPATH": pythonpath_env(),
            "TTB_WORKER_COORDINATOR": coordinator,
            "TTB_WORKER_ENGINES": self.state.worker_engines,
            "TTB_WORKER_DATA_DIR": str(self.state.worker_data_dir),
            "TTB_WORKER_SECRET_FILE": str(secret_file),
        }
        if self.state.join_token and not secret_file.exists():
            env["TTB_WORKER_JOIN_TOKEN"] = self.state.join_token
        self.start_process("worker-once" if once else "worker", command, env=env)

    def run_worker_probe(self) -> None:
        env = {"PYTHONPATH": pythonpath_env()}
        self.run_foreground(
            "Worker capability probe",
            [
                python_bin(),
                "-m",
                "ttb_worker",
                "--coordinator",
                self.state.coordinator_url_for_worker,
                "--engines",
                self.state.worker_engines,
                "--data-dir",
                str(self.state.worker_data_dir),
                "--probe",
            ],
            extra_env=env,
        )

    def ensure_join_token(self, *, force: bool = False) -> str:
        secret_file = self.state.worker_data_dir / "worker-secret.txt"
        if secret_file.exists() and not force:
            print(f"Worker already has a persistent secret at {secret_file}. No join token needed.")
            return self.state.join_token
        if self.state.join_token and not force:
            print("Using existing join token in launcher memory.")
            return self.state.join_token
        self.wait_for_backend()
        admin = post_json(f"{self.state.backend_url}/api/auth/demo-login", {"role": "admin"})
        token = admin["token"]
        join = post_json(
            f"{self.state.backend_url}/api/cluster/join-token",
            {"ttlSeconds": 900},
            token=token,
        )
        self.state.join_token = join["token"]
        print("\nJoin token issued. It is short-lived; use it only on trusted machines.")
        print(f"Coordinator: {join.get('coordinatorUrl') or self.state.coordinator_url_for_worker}")
        print(f"Token:       {self.state.join_token}")
        if join.get("command"):
            print("\nBackend suggested command:")
            print(textwrap.fill(join["command"], width=100, subsequent_indent="  "))
        return self.state.join_token

    def wait_for_backend(self, timeout_seconds: float = 20.0) -> None:
        started = time.monotonic()
        while time.monotonic() - started < timeout_seconds:
            if backend_online(self.state.backend_url):
                return
            time.sleep(0.5)
        raise RuntimeError(f"Backend did not become healthy at {self.state.backend_url}/api/health")

    def build_console(self) -> None:
        self.run_foreground("Console build", [npm_bin(), "--prefix", "apps/console", "run", "build"])

    def print_backend_health(self) -> None:
        health = get_json(f"{self.state.backend_url}/api/health")
        if health is None:
            print(f"Backend is not reachable at {self.state.backend_url}/api/health")
            return
        print(json.dumps(health, indent=2, sort_keys=True))

    def print_mode_instructions(self) -> None:
        print()
        print("In the browser:")
        print("  1. Continue as Admin or Reviewer.")
        print("  2. Switch Processing Mode to Backend to use FastAPI.")
        print("  3. Switch Processing Mode to Cluster after the worker appears under Admin > Workers.")
        print("  4. Run automated review or batch review to create jobs and audit events.")
        print()
        print(f"Backend console: {self.state.backend_url}")
        print(f"Backend health:  {self.state.backend_url}/api/health")
        print(f"Worker session:  {self.state.session_id}")

    def print_remote_worker_command(self) -> None:
        token = self.ensure_join_token()
        coordinator = self.state.coordinator_url_for_worker
        print()
        print("Run this from a cloned/synced repo on another reachable machine:")
        print()
        print(f"cd {ROOT}")
        print(f'TTB_WORKER_COORDINATOR="{coordinator}" \\')
        print(f'TTB_WORKER_JOIN_TOKEN="{token}" \\')
        print(f'./scripts/dev-worker.sh --session-id "{self.state.session_id}"')
        print()
        print("On Windows PowerShell, set the variables first:")
        print(f'$env:TTB_WORKER_COORDINATOR="{coordinator}"')
        print(f'$env:TTB_WORKER_JOIN_TOKEN="{token}"')
        print(f'python -m ttb_worker --coordinator "{coordinator}" --join-token "{token}" --session-id "{self.state.session_id}"')

    def print_useful_urls(self) -> None:
        print(f"Backend-served console: {self.state.backend_url}/")
        print(f"Backend health:         {self.state.backend_url}/api/health")
        print(f"Console dev server:     {self.state.console_dev_url}/")
        print(f"Admin workers:          {self.state.backend_url}/admin/workers")
        print(f"Admin jobs:             {self.state.backend_url}/admin/jobs")
        print(f"Benchmark results dir:  {ROOT / 'benchmarks' / 'results'}")
        print(f"Launcher logs:          {LOG_DIR}")

    def tail_log_menu(self) -> None:
        if not self.state.processes:
            print("No managed process logs yet.")
            return
        options = [(str(index + 1), name) for index, name in enumerate(self.state.processes)]
        options.append(("0", "Back"))
        choice = choose("Which log?", options, default="1")
        if choice == "0":
            return
        name = options[int(choice) - 1][1]
        log_path = self.state.processes[name].log_path
        print(f"\n--- {log_path} ---")
        print(tail_text(log_path, lines=80))

    def start_process(self, name: str, command: list[str], env: dict[str, str], url: str | None = None) -> None:
        existing = self.state.processes.get(name)
        if existing and existing.running():
            print(f"{name} is already running with pid {existing.process.pid}.")
            if url and yes_no(f"Open {url}?", default=True):
                self.open_url(url)
            return
        log_path = LOG_DIR / f"{safe_name(name)}-{time.strftime('%Y%m%d-%H%M%S')}.log"
        merged_env = process_env(env)
        merged_env.setdefault("PYTHONUNBUFFERED", "1")
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_handle = log_path.open("ab")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if is_windows() else 0
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            env=merged_env,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=False,
            start_new_session=is_posix(),
            creationflags=flags,
        )
        self.state.processes[name] = ManagedProcess(
            name=name,
            command=command,
            cwd=ROOT,
            env=merged_env,
            log_path=log_path,
            process=process,
            started_at=time.time(),
        )
        print(f"Started {name} as pid {process.pid}.")
        print(f"Command: {format_command(command)}")
        print(f"Log:     {log_path}")
        if url:
            print(f"URL:     {url}")
            if yes_no(f"Open {url}?", default=True):
                self.open_url(url)

    def stop_process(self, name: str, managed: ManagedProcess) -> None:
        if not managed.running() or managed.process is None:
            print(f"{name} is not running.")
            return
        print(f"Stopping {name} pid {managed.process.pid}...")
        try:
            if is_windows():
                managed.process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                os.killpg(os.getpgid(managed.process.pid), signal.SIGTERM)
        except Exception:
            managed.process.terminate()
        try:
            managed.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            print(f"{name} did not stop promptly; killing it.")
            try:
                if is_windows():
                    managed.process.kill()
                else:
                    os.killpg(os.getpgid(managed.process.pid), signal.SIGKILL)
            except Exception:
                managed.process.kill()
        print(f"Stopped {name}.")

    def run_foreground(
        self,
        label: str,
        command: list[str],
        *,
        extra_env: dict[str, str] | None = None,
    ) -> int:
        print(f"\nRunning {label}:")
        print(format_command(command))
        env = process_env(extra_env)
        try:
            return subprocess.call(command, cwd=ROOT, env=env)
        except FileNotFoundError as error:
            print(f"Command not found: {error.filename}")
            return 127

    def run_portable_setup(self) -> int:
        print("\nRunning portable setup from Python.")
        print("This creates .venv, installs Python packages, installs npm packages, and installs Chromium for Playwright.")
        commands = [
            [sys.executable, "-m", "venv", str(ROOT / ".venv")],
            [python_bin(), "-m", "pip", "install", "--upgrade", "pip"],
            [python_bin(), "-m", "pip", "install", "-r", "requirements-dev.txt"],
            [npm_bin(), "install", "--prefix", "browser-demo"],
            [npm_bin(), "install", "--prefix", "apps/console"],
            [npm_bin(), "run", "playwright:install"],
        ]
        for command in commands:
            code = self.run_foreground("setup step", command)
            if code != 0:
                print(f"Setup stopped because this command returned {code}.")
                return code
        print("\nSetup complete.")
        return 0

    def open_url(self, url: str) -> None:
        print(f"Opening {url}")
        try:
            if not webbrowser.open(url):
                print("Could not open a browser automatically. Copy the URL above.")
        except Exception:
            print("Could not open a browser automatically. Copy the URL above.")


def safe_name(value: str) -> str:
    return "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in value).strip("-") or "process"


def backend_online(base_url: str) -> bool:
    health = get_json(f"{base_url}/api/health", timeout=0.7)
    return bool(health and health.get("ok") is True)


def version_line(binary: str, args: list[str]) -> str:
    if not shutil.which(binary) and Path(binary).name == binary:
        return "missing"
    try:
        result = subprocess.run([binary, *args], cwd=ROOT, env=process_env(), text=True, capture_output=True, timeout=2, check=False)
        value = (result.stdout or result.stderr).strip().splitlines()[0]
        return value or "unknown"
    except Exception:
        return "unknown"


def pythonpath_env() -> str:
    parts = [str(ROOT / "apps" / "worker"), str(ROOT)]
    existing = os.environ.get("PYTHONPATH")
    if existing:
        parts.append(existing)
    return os.pathsep.join(parts)


def tail_text(path: Path, lines: int = 80) -> str:
    if not path.exists():
        return "(log file missing)"
    data = path.read_text(errors="replace").splitlines()
    return "\n".join(data[-lines:]) or "(log is empty)"


def shell_script_command(script_name: str) -> list[str]:
    script = ROOT / "scripts" / script_name
    if is_windows():
        bash = shutil.which("bash")
        if bash:
            return [bash, str(script)]
    return [str(script)]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Terminal launcher for TTB Label Reviewer.")
    parser.add_argument("--status", action="store_true", help="Print health/status and exit.")
    parser.add_argument("--backend", action="store_true", help="Start backend and exit after printing URL.")
    parser.add_argument("--worker", action="store_true", help="Start local worker and exit after printing log path.")
    parser.add_argument("--console", action="store_true", help="Start console dev server and exit after printing URL.")
    parser.add_argument("--host", default=DEFAULT_BACKEND_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_BACKEND_PORT)
    parser.add_argument("--session-id", default=DEFAULT_SESSION_ID)
    parser.add_argument("--lan", action="store_true", help="Bind backend to 0.0.0.0 for LAN/cluster testing.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    state = LauncherState(
        backend_host="0.0.0.0" if args.lan else args.host,
        backend_port=args.port,
        session_id=args.session_id,
    )
    launcher = Launcher(state)
    if args.status:
        launcher.print_header()
        return 0
    if args.backend:
        launcher.start_backend(build_console=True, lan=args.lan)
        return 0
    if args.worker:
        launcher.ensure_join_token()
        launcher.start_worker()
        return 0
    if args.console:
        launcher.start_console_dev()
        return 0
    launcher.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
