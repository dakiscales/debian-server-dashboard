import subprocess
import time
from pathlib import Path

import psutil
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

ALLOWED_SERVICES = ["nginx"]


@app.get("/", response_class=FileResponse, include_in_schema=False)
def dashboard():
    return FileResponse(BASE_DIR / "templates" / "index.html", media_type="text/html")


def collect_metrics():
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    return {
        "cpu_percent": psutil.cpu_percent(interval=1),
        "memory_percent": memory.percent,
        "disk_percent": disk.percent,
        "uptime_seconds": int(time.time() - psutil.boot_time())
    }


def check_service(service_name):
    if service_name not in ALLOWED_SERVICES:
        return "not_allowed"

    try:
        result = subprocess.run(
            ["systemctl", "is-active", service_name],
            capture_output=True,
            text=True,
            timeout=5,
            check=False
        )

        status = result.stdout.strip()

        if status:
            return status

        return "unknown"

    except (subprocess.SubprocessError, OSError):
        return "unavailable"


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/metrics")
def metrics():
    return collect_metrics()


@app.get("/services")
def services():
    return {
        service: check_service(service)
        for service in ALLOWED_SERVICES
    }
