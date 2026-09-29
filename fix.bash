(
set -e

cd /home/daki/debian_server_dashboard

/home/daki/server_dashboard/.venv/bin/python -c \
'import main, uvicorn; print("Python and application: OK")'

sudo tee /etc/systemd/system/debian-dashboard.service >/dev/null <<'SERVICE'
[Unit]
Description=Debian Server Dashboard
After=network.target

[Service]
Type=exec
User=daki
WorkingDirectory=/home/daki/debian_server_dashboard
ExecStart=/home/daki/server_dashboard/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable debian-dashboard.service
sudo systemctl reset-failed debian-dashboard.service
sudo systemctl restart debian-dashboard.service

sleep 2
systemctl status debian-dashboard.service --no-pager -l
)
