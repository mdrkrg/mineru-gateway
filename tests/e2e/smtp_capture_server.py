"""In-process SMTP capture sidecar for the e2e harness.

Listens for plain SMTP on ``--smtp-port`` and exposes a tiny FastAPI
control app on ``--control-port`` so the e2e test can read the captured
inbox. The control app reuses the same handler instance that aiosmtpd
calls on delivery, so messages are visible to the test as soon as the
``DATA`` command completes.

Run as a subprocess by ``tests/e2e/run_mock.py`` and
``frontend/tests/e2e/globalSetup.ts``.
"""

from __future__ import annotations

import argparse
import threading
from datetime import datetime, timezone
from email.message import Message

import uvicorn
from aiosmtpd.controller import Controller
from aiosmtpd.handlers import Message as MessageHandler
from fastapi import FastAPI, Query


class _Inbox:
    """Thread-safe inbox shared between aiosmtpd's SMTP loop and uvicorn."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._messages: list[dict] = []
        self._next_id = 1

    def add(self, msg: Message) -> dict:
        with self._lock:
            entry = {
                "id": self._next_id,
                "from": self._strip_addr(str(msg.get("From", ""))),
                "to": [self._strip_addr(t) for t in msg.get_all("To", []) or []],
                "subject": str(msg.get("Subject", "")),
                "body_text": self._extract_body(msg),
                "received_at": datetime.now(timezone.utc).isoformat(),
            }
            self._messages.append(entry)
            self._next_id += 1
            return entry

    @staticmethod
    def _strip_addr(value: str) -> str:
        """Reduce ``Name <addr>`` / ``<addr>`` to just ``addr``.

        Lets test-side substring filters work cleanly without angle-bracket
        boilerplate.
        """
        if "<" in value and ">" in value:
            return value.split("<", 1)[1].split(">", 1)[0].strip()
        return value.strip()

    @staticmethod
    def _extract_body(msg: Message) -> str:
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    return _decode_payload(part.get_payload(decode=True))
        return _decode_payload(msg.get_payload(decode=True))

    def all(self, to: str | None = None) -> list[dict]:
        with self._lock:
            if to is None:
                return list(self._messages)
            return [m for m in self._messages if to in m["to"]]

    def clear(self) -> int:
        with self._lock:
            count = len(self._messages)
            self._messages.clear()
            self._next_id = 1
            return count


def _decode_payload(payload: object) -> str:
    """Normalize ``get_payload(decode=True)`` to text.

    The email module's type stubs are loose; the runtime returns bytes
    when ``decode=True`` and the payload has a content transfer encoding.
    """
    if isinstance(payload, bytes):
        return payload.decode("utf-8", errors="replace")
    if payload is None:
        return ""
    return str(payload)


inbox = _Inbox()


class CaptureHandler(MessageHandler):
    """SMTP handler that records every delivered message in the shared inbox.

    The base ``handle_DATA`` parses the DATA bytes into an
    ``email.message.Message`` and dispatches to ``handle_message``; we only
    override the latter to capture.
    """

    def handle_message(self, message):  # type: ignore[override]
        inbox.add(message)


app = FastAPI(title="smtp-capture")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/emails")
async def list_emails(to: str | None = Query(default=None)) -> list[dict]:
    return inbox.all(to=to)


@app.delete("/emails")
async def clear_emails() -> dict[str, int]:
    return {"cleared": inbox.clear()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smtp-port", type=int, required=True)
    parser.add_argument("--control-port", type=int, required=True)
    parser.add_argument("--smtp-host", default="127.0.0.1")
    parser.add_argument("--control-host", default="127.0.0.1")
    args = parser.parse_args()

    controller = Controller(
        CaptureHandler(),
        hostname=args.smtp_host,
        port=args.smtp_port,
    )
    controller.start()

    config = uvicorn.Config(
        app,
        host=args.control_host,
        port=args.control_port,
        log_level="warning",
    )
    server = uvicorn.Server(config)

    try:
        server.run()
    finally:
        controller.stop()


if __name__ == "__main__":
    main()
