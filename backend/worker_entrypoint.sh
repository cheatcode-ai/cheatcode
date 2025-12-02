#!/bin/sh
# worker entrypoint script
# starts a simple http server for health checks and runs dramatiq worker

# start a simple health check server in the background
python3 -c "
import http.server
import socketserver
import threading
import os

PORT = int(os.environ.get('PORT', 8080))

class HealthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, format, *args):
        pass  # suppress logs

with socketserver.TCPServer(('', PORT), HealthHandler) as httpd:
    print(f'health check server on port {PORT}')
    httpd.serve_forever()
" &

# start dramatiq worker
exec uv run dramatiq --processes 2 --threads 4 run_agent_background
