"""Bounded, memory-only subprocess execution for the optional local ASR server."""
import json
import os
import select
import selectors
import signal
import socket
import subprocess
import time

MAX_RESULT = 16 * 1024
DEFAULT_COMPUTE_TIMEOUT = 25.0


class ClientDisconnected(Exception):
    pass


class ComputeTimeout(Exception):
    pass


class WorkerFailed(Exception):
    pass


class WorkerCleanupFailed(Exception):
    """Admission must stay closed if the operating system cannot reap a worker."""


def disconnected(connection):
    try:
        # Python sockets with a timeout wait for readability even when recv uses
        # MSG_DONTWAIT. Poll first so an idle HTTP connection cannot delay the
        # compute deadline by its upload timeout.
        if not select.select([connection], [], [], 0)[0]:
            return False
        return connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b''
    except BlockingIOError:
        return False
    except OSError:
        return True


def run_transcription(command, pcm, connection, timeout=DEFAULT_COMPUTE_TIMEOUT, stopping=None):
    """Pump bounded PCM/result pipes while watching the client and compute deadline.

    The command is supplied by the server, never by an HTTP field. Model startup,
    input transfer and transcription all count toward the deadline. A separate
    process group permits cancellation of the worker and any descendants.
    """
    if disconnected(connection) or (stopping is not None and stopping.is_set()):
        raise ClientDisconnected()
    deadline = time.monotonic() + timeout
    worker = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        output = bytearray()
        remaining = memoryview(pcm)
        stdout_done = False
        os.set_blocking(worker.stdin.fileno(), False)
        os.set_blocking(worker.stdout.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(connection, selectors.EVENT_READ, 'client')
            selector.register(worker.stdin, selectors.EVENT_WRITE, 'input')
            selector.register(worker.stdout, selectors.EVENT_READ, 'output')
            while True:
                # Check before accepting a result, including a simultaneous abort.
                if disconnected(connection) or (stopping is not None and stopping.is_set()):
                    raise ClientDisconnected()
                left = deadline - time.monotonic()
                if left <= 0:
                    raise ComputeTimeout()
                if stdout_done and worker.poll() is not None:
                    if worker.returncode != 0:
                        raise WorkerFailed()
                    break
                for key, _mask in selector.select(min(0.1, left)):
                    if key.data == 'client':
                        # No further request bytes are valid on this HTTP/1.0
                        # connection. A readable peer has closed or sent extra data.
                        raise ClientDisconnected()
                    if key.data == 'input':
                        try:
                            written = os.write(worker.stdin.fileno(), remaining[:65536])
                            remaining = remaining[written:]
                        except BrokenPipeError:
                            raise WorkerFailed() from None
                        if not remaining:
                            selector.unregister(worker.stdin)
                            worker.stdin.close()
                    else:
                        chunk = os.read(worker.stdout.fileno(), MAX_RESULT - len(output) + 1)
                        if not chunk:
                            selector.unregister(worker.stdout)
                            stdout_done = True
                        else:
                            output.extend(chunk)
                            if len(output) > MAX_RESULT:
                                raise WorkerFailed()
        try:
            result = json.loads(output)
            if not isinstance(result, dict) or not isinstance(result.get('text'), str) or len(result['text']) > 2000:
                raise ValueError('invalid transcript')
            language = result.get('language')
            if language is not None and not isinstance(language, str):
                raise ValueError('invalid language')
            return {'text': result['text'].strip(), 'language': language}
        except (ValueError, UnicodeError):
            raise WorkerFailed() from None
    finally:
        # Kill the owned group even if its leader exited while a descendant holds
        # stdout open. Admission is released only after the direct worker is reaped.
        try:
            kill_failed = False
            try:
                os.killpg(worker.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError:
                kill_failed = True
            try:
                worker.wait(timeout=1)
            except subprocess.TimeoutExpired:
                raise WorkerCleanupFailed() from None
            if kill_failed:
                # Even if the leader exited, descendants may still be running.
                # Keep admission closed when group termination was not confirmed.
                raise WorkerCleanupFailed() from None
        finally:
            worker.stdin.close()
            worker.stdout.close()
