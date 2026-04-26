"""Parser coverage for the request-sheet intents."""
from __future__ import annotations

import pytest

from app.intents.parser import IntentKind, parse


@pytest.mark.parametrize(
    "msg, gate, reason",
    [
        ("request gate 4", 4, None),
        ("request access to gate 7", 7, None),
        ("request access for gate 9", 9, None),
        ("request gate 4 because need night access", 4, "need night access"),
        ("Request gate 5 reason: inspections only", 5, "inspections only"),
    ],
)
def test_request_access_patterns(msg: str, gate: int, reason: str | None):
    intent = parse(msg)
    assert intent.kind == IntentKind.request_access, msg
    assert intent.gate_id == gate
    assert intent.reason == reason


@pytest.mark.parametrize(
    "msg, expected_id",
    [
        ("approve request 12", 12),
        ("approve req 3", 3),
        ("approve #5", 5),
        ("approve 17", 17),
    ],
)
def test_approve_request(msg: str, expected_id: int):
    intent = parse(msg)
    assert intent.kind == IntentKind.approve_request
    assert intent.request_id == expected_id


@pytest.mark.parametrize(
    "msg, expected_id",
    [
        ("deny request 12", 12),
        ("reject req 4", 4),
        ("deny #9", 9),
    ],
)
def test_deny_request(msg: str, expected_id: int):
    intent = parse(msg)
    assert intent.kind == IntentKind.deny_request
    assert intent.request_id == expected_id


@pytest.mark.parametrize(
    "msg",
    ["my requests", "list requests", "show my requests", "pending requests"],
)
def test_list_requests(msg: str):
    assert parse(msg).kind == IntentKind.list_requests


def test_cancel_request():
    intent = parse("cancel my request 7")
    assert intent.kind == IntentKind.cancel_request
    assert intent.request_id == 7


def test_request_does_not_collide_with_query_access():
    """`request access to gate 7` must hit request_access, not query_access."""
    assert parse("request access to gate 7").kind == IntentKind.request_access


def test_list_requests_does_not_collide_with_list_gates():
    assert parse("list requests").kind == IntentKind.list_requests
    assert parse("list gates").kind == IntentKind.list_gates


def test_approve_request_does_not_collide_with_request_access():
    """`approve request 5` must NOT be parsed as request_access for gate 5."""
    intent = parse("approve request 5")
    assert intent.kind == IntentKind.approve_request
    assert intent.request_id == 5
    assert intent.gate_id is None
