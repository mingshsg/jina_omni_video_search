"""Real subprocess and loopback HTTP contracts; no model/dependency downloads."""
import http.client
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import unittest
from unittest import mock
import wave

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import voice_whisper_runtime as runtime

spec = importlib.util.spec_from_file_location('voice_server', SCRIPTS / 'voice-whisper-server.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


def command(code):
    return [sys.executable, '-B', '-c', code]


SUCCESS = command("import sys,json; data=sys.stdin.buffer.read(); print(json.dumps({'text':'  寻找汽车  ','language':'zh'},ensure_ascii=False))")
STALL_OR_SUCCESS = command("import sys,time,json; data=sys.stdin.buffer.read(); time.sleep(60) if data[0] == 0 else None; print(json.dumps({'text':'汽车','language':'zh'},ensure_ascii=False))")


def wav(value=0):
    output = io.BytesIO()
    with wave.open(output, 'wb') as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(16000)
        recording.writeframes(bytes([value, 0]) * 16000)
    return output.getvalue()


def multipart(value=0, model='fixture'):
    boundary = 'voice-cancellation-test-boundary'
    parts = []
    for key, data in [('model', model.encode()), ('response_format', b'json'), ('language', b'zh'), ('file', wav(value))]:
        disposition = f'Content-Disposition: form-data; name="{key}"'
        if key == 'file':
            disposition += '; filename="generated.wav"\r\nContent-Type: audio/wav'
        parts.append(f'--{boundary}\r\n{disposition}\r\n\r\n'.encode() + data + b'\r\n')
    return b''.join(parts) + f'--{boundary}--\r\n'.encode(), f'multipart/form-data; boundary={boundary}'


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.client, self.peer = socket.socketpair()
        self.addCleanup(self.client.close)
        self.addCleanup(self.peer.close)
        self.workers = []
        popen = subprocess.Popen

        def launch(*args, **kwargs):
            process = popen(*args, **kwargs)
            self.workers.append(process)
            return process

        self.patcher = mock.patch.object(runtime.subprocess, 'Popen', side_effect=launch)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_large_pipe_input_and_original_language_success(self):
        result = runtime.run_transcription(SUCCESS, b'\x01\x00' * 240000, self.client, 2)
        self.assertEqual(result, {'text': '寻找汽车', 'language': 'zh'})
        self.assertIsNotNone(self.workers[0].poll())
        self.assertTrue(self.workers[0].stdin.closed)
        self.assertTrue(self.workers[0].stdout.closed)

    def test_deadline_kills_worker_which_ignores_term_and_never_reads_input(self):
        stall = command('import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)')
        started = time.monotonic()
        with self.assertRaises(runtime.ComputeTimeout):
            runtime.run_transcription(stall, b'\x00' * 480000, self.client, 0.2)
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertIsNotNone(self.workers[0].poll())

    def test_disconnect_kills_worker_even_while_its_input_pipe_is_blocked(self):
        errors = []
        def run():
            try:
                runtime.run_transcription(command('import time; time.sleep(60)'), b'\x00' * 480000, self.client, 3)
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=run)
        thread.start()
        deadline = time.monotonic() + 1
        while not self.workers and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.workers)
        self.peer.close()
        thread.join(1.5)
        self.assertFalse(thread.is_alive())
        self.assertIsInstance(errors[0], runtime.ClientDisconnected)
        self.assertIsNotNone(self.workers[0].poll())

    def test_already_disconnected_client_never_starts_compute(self):
        self.peer.close()
        with self.assertRaises(runtime.ClientDisconnected):
            runtime.run_transcription(SUCCESS, b'\x00' * 32000, self.client)
        self.assertEqual(self.workers, [])

    def test_group_termination_error_fails_closed_and_closes_pipes(self):
        with mock.patch.object(runtime.os, 'killpg', side_effect=PermissionError('termination denied')):
            with self.assertRaises(runtime.WorkerCleanupFailed):
                runtime.run_transcription(SUCCESS, b'\x00' * 32000, self.client, 2)
        self.assertIsNotNone(self.workers[0].poll())
        self.assertTrue(self.workers[0].stdin.closed)
        self.assertTrue(self.workers[0].stdout.closed)

    def test_oversize_or_malformed_worker_result_is_rejected_and_reaped(self):
        for code in ["import sys; sys.stdout.write('x'*20000); sys.stdout.flush(); import time; time.sleep(60)",
                     "print('provider-secret-in-diagnostics')", "print('{\"text\":12}')", 'raise SystemExit(1)']:
            with self.subTest(code=code), self.assertRaises(runtime.WorkerFailed):
                runtime.run_transcription(command(code), b'\x00' * 32000, self.client, 2)
            self.assertIsNotNone(self.workers[-1].poll())


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.server = service.VoiceWhisperServer(('127.0.0.1', 0), model='fixture', compute_timeout=0.4,
                                                 worker_command=STALL_OR_SUCCESS)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.02})
        self.thread.start()
        self.addCleanup(self.shutdown)

    def shutdown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(1)

    def post(self, value=0, model='fixture'):
        body, content_type = multipart(value, model)
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request('POST', '/v1/audio/transcriptions', body, {'Content-Type': content_type})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_timeout_response_reaps_worker_and_next_request_succeeds(self):
        workers = []
        popen = subprocess.Popen
        def launch(*args, **kwargs):
            process = popen(*args, **kwargs)
            workers.append(process)
            return process
        with mock.patch.object(runtime.subprocess, 'Popen', side_effect=launch):
            self.assertEqual(self.post(), (504, {'error': 'transcription_timeout'}))
            self.assertIsNotNone(workers[0].poll())
            self.assertEqual(self.post(1), (200, {'text': '汽车', 'language': 'zh'}))
        self.assertFalse(self.server.slot.locked())

    def test_real_http_disconnect_releases_capacity_before_compute_deadline(self):
        self.server.compute_timeout = 3
        spawned = threading.Event()
        workers = []
        popen = subprocess.Popen
        def launch(*args, **kwargs):
            process = popen(*args, **kwargs)
            workers.append(process)
            spawned.set()
            return process
        with mock.patch.object(runtime.subprocess, 'Popen', side_effect=launch):
            peer = socket.create_connection(self.server.server_address, timeout=2)
            self.addCleanup(peer.close)
            body, content_type = multipart()
            peer.sendall(f'POST /v1/audio/transcriptions HTTP/1.1\r\nHost: localhost\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n'.encode() + body)
            self.assertTrue(spawned.wait(1))
            # A second request must not queue or start another model process.
            self.assertEqual(self.post(1), (429, {'error': 'busy'}))
            self.assertEqual(len(workers), 1)
            peer.close()
            deadline = time.monotonic() + 1
            while self.server.slot.locked() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(self.server.slot.locked())
            self.assertIsNotNone(workers[0].poll())
            self.assertEqual(self.post(1), (200, {'text': '汽车', 'language': 'zh'}))

    def test_worker_failure_is_sanitized_and_capacity_recovers(self):
        self.server.worker_command = command("print('private-provider-diagnostic')")
        self.assertEqual(self.post(1), (502, {'error': 'transcription_failed'}))
        self.server.worker_command = SUCCESS
        self.assertEqual(self.post(1), (200, {'text': '寻找汽车', 'language': 'zh'}))

    def test_service_close_cancels_and_reaps_active_worker(self):
        self.server.compute_timeout = 3
        spawned = threading.Event()
        workers = []
        popen = subprocess.Popen
        def launch(*args, **kwargs):
            process = popen(*args, **kwargs)
            workers.append(process)
            spawned.set()
            return process
        with mock.patch.object(runtime.subprocess, 'Popen', side_effect=launch):
            peer = socket.create_connection(self.server.server_address, timeout=2)
            self.addCleanup(peer.close)
            body, content_type = multipart()
            peer.sendall(f'POST /v1/audio/transcriptions HTTP/1.1\r\nHost: localhost\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n'.encode() + body)
            self.assertTrue(spawned.wait(1))
            started = time.monotonic()
            self.server.shutdown()
            self.server.server_close()
            self.assertLess(time.monotonic() - started, 1)
            self.assertIsNotNone(workers[0].poll())
            self.assertFalse(self.server.slot.locked())

    def test_invalid_model_does_not_start_a_worker(self):
        with mock.patch.object(runtime.subprocess, 'Popen') as start:
            self.assertEqual(self.post(1, 'other'), (400, {'error': 'invalid_request'}))
            start.assert_not_called()
        self.assertFalse(self.server.slot.locked())

    def assert_close_interrupts_request(self, request_bytes):
        accepted = threading.Event()
        closed = threading.Event()
        original_setup = service.Handler.setup
        def setup(handler):
            original_setup(handler)
            accepted.set()
        def close():
            self.server.shutdown()
            self.server.server_close()
            closed.set()
        with mock.patch.object(service.Handler, 'setup', setup):
            peer = socket.create_connection(self.server.server_address, timeout=2)
            try:
                if request_bytes:
                    peer.sendall(request_bytes)
                self.assertTrue(accepted.wait(1))
                closing = threading.Thread(target=close)
                closing.start()
                try:
                    self.assertTrue(closed.wait(1), 'unfinished HTTP input blocked shutdown')
                finally:
                    peer.close()
                    closing.join(2)
            finally:
                peer.close()

    def test_service_close_interrupts_idle_connection(self):
        self.assert_close_interrupts_request(b'')

    def test_service_close_interrupts_partial_headers(self):
        self.assert_close_interrupts_request(b'POST /v1/audio/transcriptions HTTP/1.1\r\n')

    def test_service_close_interrupts_partial_upload(self):
        self.assert_close_interrupts_request(
            b'POST /v1/audio/transcriptions HTTP/1.1\r\nHost: localhost\r\n'
            b'Content-Type: multipart/form-data; boundary=test\r\nContent-Length: 10000\r\n\r\npartial')

    def test_failed_reap_keeps_admission_closed(self):
        with mock.patch.object(service, 'run_transcription', side_effect=runtime.WorkerCleanupFailed):
            self.assertEqual(self.post(1), (503, {'error': 'worker_unavailable'}))
        self.assertEqual(self.post(1), (429, {'error': 'busy'}))

    def test_cli_timeout_bounds(self):
        for timeout in [0, -1, 26, float('nan')]:
            with self.assertRaises(ValueError):
                service.VoiceWhisperServer(('127.0.0.1', 0), compute_timeout=timeout)

    def test_occupied_port_preserves_bind_error(self):
        with self.assertRaises(OSError):
            service.VoiceWhisperServer(self.server.server_address)


if __name__ == '__main__':
    unittest.main(verbosity=2)
