#!/usr/bin/env python3
"""Optional localhost, memory-only MLX Whisper transcription service.

Uses already-installed numpy/mlx_whisper and cached model weights on Apple Silicon.
No files are created for incoming recordings. Does not run inside the app container.
"""
import argparse
import contextlib
import email.policy
import io
import json
import os
import signal
import socket
import sys
import threading
import wave
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from voice_whisper_runtime import (ClientDisconnected, ComputeTimeout, WorkerCleanupFailed,
                                  DEFAULT_COMPUTE_TIMEOUT, run_transcription)

MAX_BODY = 600_000
MODEL = os.environ.get('VOICE_WHISPER_MODEL', 'mlx-community/whisper-large-v3-turbo')


class VoiceWhisperServer(ThreadingHTTPServer):
    # Wait for handlers to terminate/reap their compute workers on graceful exit.
    daemon_threads = False

    def __init__(self, address, *, model=MODEL, compute_timeout=DEFAULT_COMPUTE_TIMEOUT, worker_command=None):
        if not 0 < compute_timeout <= DEFAULT_COMPUTE_TIMEOUT:
            raise ValueError('Compute timeout must be greater than 0 and at most 25 seconds')
        # Initialize before binding: TCPServer also calls server_close if bind fails.
        self.stopping = threading.Event()
        self.connections = set()
        self.connections_lock = threading.Lock()
        super().__init__(address, Handler)
        self.model = model
        self.compute_timeout = compute_timeout
        self.slot = threading.Lock()
        # Injection is for process/HTTP tests; the CLI never accepts a command.
        self.worker_command = worker_command

    def command(self, language):
        if self.worker_command is not None:
            return self.worker_command
        return [sys.executable, '-B', os.path.abspath(__file__), '--worker', '--model', self.model,
                '--language', language or 'auto']

    def server_close(self):
        self.stopping.set()
        with self.connections_lock:
            connections = list(self.connections)
        # Interrupt request-line/header/body reads as well as model compute.
        # Joining non-daemon handlers alone hangs on clients still sending input.
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass  # already disconnected or closed by its handler
        super().server_close()

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        with self.connections_lock:
            if self.stopping.is_set():
                connection.close()
                raise OSError('Server is stopping')
            self.connections.add(connection)
        return connection, address

    def shutdown_request(self, request):
        try:
            super().shutdown_request(request)
        finally:
            with self.connections_lock:
                self.connections.discard(request)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # no request bodies, credentials or transcripts in logs

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, {'status': 'ok' if self.path == '/health' else 'not_found'})

    def do_POST(self):
        if self.path != '/v1/audio/transcriptions':
            self.reply(404, {'error': 'not_found'})
            return
        if not self.server.slot.acquire(blocking=False):
            self.reply(429, {'error': 'busy'})
            return
        release_slot = True
        try:
            self.connection.settimeout(10)
            length = int(self.headers.get('Content-Length', '0'))
            content_type = self.headers.get('Content-Type', '')
            if not (0 < length <= MAX_BODY) or not content_type.startswith('multipart/form-data;') or '\n' in content_type or '\r' in content_type:
                self.reply(400, {'error': 'invalid_request'})
                return
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError('incomplete body')
            parsed = BytesParser(policy=email.policy.default).parsebytes(
                ('Content-Type: ' + content_type + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
            fields = {}
            if not parsed.is_multipart():
                raise ValueError('invalid multipart')
            for part in parsed.iter_parts():
                name = part.get_param('name', header='content-disposition')
                if name not in ('file', 'language', 'model', 'response_format') or name in fields:
                    raise ValueError('invalid field')
                fields[name] = part.get_payload(decode=True)
            if fields.get('model', b'').decode() != self.server.model or fields.get('response_format') != b'json':
                raise ValueError('unsupported model or format')
            language = fields.get('language', b'').decode() or None
            if language not in (None, 'en', 'zh', 'ko', 'th'):
                raise ValueError('unsupported language')
            with wave.open(io.BytesIO(fields.get('file', b'')), 'rb') as recording:
                if recording.getnchannels() != 1 or recording.getframerate() != 16000 or recording.getsampwidth() != 2 or not 16000 <= recording.getnframes() <= 240000:
                    raise ValueError('invalid recording')
                pcm = recording.readframes(recording.getnframes())
                if len(pcm) != recording.getnframes() * 2:
                    raise ValueError('incomplete recording')
            result = run_transcription(self.server.command(language), pcm, self.connection,
                                       self.server.compute_timeout, self.server.stopping)
            self.reply(200, result)
        except ClientDisconnected:
            pass
        except ComputeTimeout:
            self.reply(504, {'error': 'transcription_timeout'})
        except WorkerCleanupFailed:
            # Fail closed if the OS could not reap the worker. Do not admit a
            # second compute task alongside an unreaped one; restart the helper.
            release_slot = False
            self.reply(503, {'error': 'worker_unavailable'})
        except (ValueError, wave.Error, UnicodeError):
            self.reply(400, {'error': 'invalid_request'})
        except Exception:
            self.reply(502, {'error': 'transcription_failed'})
        finally:
            if release_slot:
                self.server.slot.release()


def worker(model, language):
    """Internal process entry point: raw validated PCM in, bounded JSON out."""
    try:
        pcm = sys.stdin.buffer.read(480001)
        if not 32000 <= len(pcm) <= 480000 or len(pcm) % 2:
            return 1
        # Keep third-party Python prints away from the response pipe. Parent
        # discards stderr and enforces a byte bound on stdout as well.
        with contextlib.redirect_stdout(sys.stderr):
            import numpy as np
            import mlx_whisper
            audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
            result = mlx_whisper.transcribe(audio, path_or_hf_repo=model, language=language,
                                           task='transcribe', verbose=None)
        text = result.get('text', '').strip()
        if not isinstance(text, str) or len(text) > 2000:
            return 1
        sys.stdout.write(json.dumps({'text': text, 'language': result.get('language')}, ensure_ascii=False))
        sys.stdout.flush()
        return 0
    except Exception:
        return 1  # no provider diagnostics or transcript in logs


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8768)
    parser.add_argument('--compute-timeout', type=float, default=DEFAULT_COMPUTE_TIMEOUT,
                        help='Seconds including model load; >0 and <=25 (default: 25)')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--model', default=MODEL, help=argparse.SUPPRESS)
    parser.add_argument('--language', default='auto', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        sys.exit(worker(args.model, None if args.language == 'auto' else args.language))
    try:
        server = VoiceWhisperServer(('127.0.0.1', args.port), compute_timeout=args.compute_timeout)
    except ValueError as error:
        parser.error(str(error))
    print(f'Voice Whisper service listening on 127.0.0.1:{args.port}', flush=True)
    def stop_service(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop_service)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
