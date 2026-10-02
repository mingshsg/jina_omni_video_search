#!/usr/bin/env python3
"""Optional localhost, memory-only MLX Whisper transcription service.

Uses already-installed numpy/mlx_whisper and cached model weights on Apple Silicon.
No files are created for incoming recordings. Does not run inside the app container.
"""
import argparse
import email.policy
import io
import json
import os
import threading
import wave
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 600_000
MODEL = os.environ.get('VOICE_WHISPER_MODEL', 'mlx-community/whisper-large-v3-turbo')
SLOT = threading.Lock()


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
        if not SLOT.acquire(blocking=False):
            self.reply(429, {'error': 'busy'})
            return
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
            if fields.get('model', b'').decode() != MODEL or fields.get('response_format') != b'json':
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
            import numpy as np
            import mlx_whisper
            audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
            result = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL, language=language, task='transcribe', verbose=None)
            self.reply(200, {'text': result.get('text', '').strip(), 'language': result.get('language')})
        except (ValueError, wave.Error, UnicodeError):
            self.reply(400, {'error': 'invalid_request'})
        except Exception:
            self.reply(502, {'error': 'transcription_failed'})
        finally:
            SLOT.release()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8768)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Voice Whisper service listening on 127.0.0.1:{args.port}', flush=True)
    server.serve_forever()
