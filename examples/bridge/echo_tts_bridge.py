#!/usr/bin/env python3
"""Minimal zero-dependency Python example client for Deskumi's local WS bridge.

Licensed under the MIT License (see examples/LICENSE).
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import socket
import struct
import sys
import time
from pathlib import Path

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
BINARY_MAGIC = b"DSK1"
BINARY_KIND_SPEAK_CHUNK = 1


def resolve_bridge_json_path() -> Path:
    for env_key in ("XDG_RUNTIME_DIR", "APPDATA", "XDG_DATA_HOME"):
        val = os.environ.get(env_key)
        if val:
            return Path(val) / "deskumi" / "bridge.json"
    return Path.home() / ".local" / "share" / "deskumi" / "bridge.json"


class MinimalWsClient:
    """Tiny RFC 6455 loopback client over stdlib sockets (no Origin header)."""

    def __init__(self, host: str, port: int) -> None:
        self.sock = socket.create_connection((host, port), timeout=5.0)
        self._buf = bytearray()
        self._handshake(host, port)

    def _handshake(self, host: str, port: int) -> None:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET / HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        while b"\r\n\r\n" not in self._buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("EOF during WebSocket handshake")
            self._buf.extend(chunk)
        header_end = self._buf.index(b"\r\n\r\n") + 4
        raw_headers = bytes(self._buf[:header_end]).decode("latin1")
        del self._buf[:header_end]
        status_line = raw_headers.split("\r\n", 1)[0]
        if "101" not in status_line:
            raise ConnectionError(f"WebSocket upgrade rejected: {status_line}")
        expected_accept = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
        ).decode("ascii")
        if expected_accept not in raw_headers:
            raise ConnectionError("Invalid Sec-WebSocket-Accept header")

    def _read_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self.sock.recv(max(4096, n - len(self._buf)))
            if not chunk:
                raise ConnectionError("Unexpected EOF from bridge socket")
            self._buf.extend(chunk)
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out

    def send_frame(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.extend(struct.pack("!BH", 0x80 | 126, length))
        else:
            header.extend(struct.pack("!BQ", 0x80 | 127, length))
        header.extend(mask)
        masked = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def send_json(self, obj: dict) -> None:
        self.send_frame(0x1, json.dumps(obj).encode("utf-8"))

    def recv_json(self) -> dict | None:
        while True:
            b1, b2 = self._read_exact(2)
            opcode = b1 & 0x0F
            length = b2 & 0x7F
            if length == 126:
                (length,) = struct.unpack("!H", self._read_exact(2))
            elif length == 127:
                (length,) = struct.unpack("!Q", self._read_exact(8))
            if b2 & 0x80:
                mask = self._read_exact(4)
                raw = self._read_exact(length)
                payload = bytes(b ^ mask[i & 3] for i, b in enumerate(raw))
            else:
                payload = self._read_exact(length)
            if opcode == 0x8:
                return None
            if opcode == 0x9:  # Ping -> Pong
                self.send_frame(0xA, payload)
                continue
            if opcode == 0x1:
                return json.loads(payload.decode("utf-8"))

    def close(self) -> None:
        try:
            self.send_frame(0x8, b"")
        except OSError:
            pass
        self.sock.close()


def pack_speak_chunk(stream_id: str, sample_rate: int, pcm: bytes) -> bytes:
    sid_bytes = stream_id.encode("utf-8")
    header = struct.pack(
        ">4sBBHI",
        BINARY_MAGIC,
        BINARY_KIND_SPEAK_CHUNK,
        0,
        len(sid_bytes),
        sample_rate,
    )
    return header + sid_bytes + pcm


def sine_pcm16(freq_hz: float, sample_rate: int, duration_s: float) -> bytes:
    samples = int(sample_rate * duration_s)
    buf = bytearray()
    for i in range(samples):
        val = int(0.25 * 32767 * math.sin(2.0 * math.pi * freq_hz * i / sample_rate))
        buf.extend(struct.pack("<h", val))
    return bytes(buf)


def main() -> int:
    bridge_path = resolve_bridge_json_path()
    if not bridge_path.exists():
        print(f"bridge.json not found at {bridge_path}", file=sys.stderr)
        return 1

    info = json.loads(bridge_path.read_text(encoding="utf-8"))
    ws = MinimalWsClient("127.0.0.1", int(info["port"]))
    try:
        ws.send_json(
            {
                "v": 1,
                "id": "hello-1",
                "cmd": {
                    "type": "hello",
                    "token": info["token"],
                    "clientName": "echo_tts_bridge.py",
                    "clientVersion": "0.1.0",
                    "events": ["speechStart", "speechEnd"],
                },
            }
        )
        print("hello ->", ws.recv_json())

        ws.send_json(
            {
                "v": 1,
                "id": "say-1",
                "cmd": {
                    "type": "say",
                    "id": "utt-say",
                    "text": "Hello from Deskumi local bridge!",
                    "durationMs": 1500,
                    "policy": "queue",
                },
            }
        )
        print("say ->", ws.recv_json())

        stream_id = "echo-stream-1"
        sample_rate = 22050
        ws.send_json(
            {
                "v": 1,
                "id": "stream-start",
                "cmd": {
                    "type": "speakStart",
                    "streamId": stream_id,
                    "id": "utt-stream",
                    "text": "Streaming synthetic tone.",
                    "sampleRate": sample_rate,
                    "channels": 1,
                    "format": "pcm_s16le",
                    "policy": "queue",
                },
            }
        )
        print("speakStart ->", ws.recv_json())

        pcm_chunk = sine_pcm16(440.0, sample_rate, 0.1)
        frame = pack_speak_chunk(stream_id, sample_rate, pcm_chunk)
        for _ in range(5):
            ws.send_frame(0x2, frame)
            time.sleep(0.08)

        ws.send_json(
            {
                "v": 1,
                "id": "stream-end",
                "cmd": {"type": "speakEnd", "streamId": stream_id},
            }
        )
        print("speakEnd ->", ws.recv_json())
    finally:
        ws.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
