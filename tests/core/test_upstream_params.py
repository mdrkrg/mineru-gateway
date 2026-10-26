"""MinerU 4.0 V1 parse-parameter validation."""

from __future__ import annotations

import pytest

from mineru_gateway.upstream.params import parse_v1_params


def test_native_v1_options_are_preserved():
    params = parse_v1_params(
        {
            "tier": "advanced",
            "ocr_mode": "ocr",
            "page_range": "1-3,7",
            "output_formats": "markdown,middle_json",
        },
        sync=False,
    )
    assert params == {
        "tier": "advanced",
        "ocr_mode": "ocr",
        "page_range": "1-3,7",
        "output_formats": ["markdown", "middle_json"],
    }


def test_v1_defaults_and_forced_async_zip():
    assert parse_v1_params({}, sync=False) == {
        "ocr_mode": "auto",
        "output_formats": ["markdown"],
    }
    params = parse_v1_params({}, sync=False, include_zip=True)
    assert params["output_formats"] == ["markdown", "zip"]


def test_repeated_and_comma_separated_output_formats_are_combined():
    params = parse_v1_params(
        {"output_formats": ["markdown,middle_json", "zip"]}, sync=False
    )
    assert params["output_formats"] == ["markdown", "middle_json", "zip"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("3,1-3,2", "1-3"),
        (" 1 - 3 , r2 - r1 ", "1-3,r2-r1"),
        ("3-r1", "3-r1"),
        ("all", "all"),
    ],
)
def test_page_range_uses_native_v1_normalization(value, expected):
    params = parse_v1_params({"page_range": value}, sync=False)
    assert params["page_range"] == expected


@pytest.mark.parametrize(
    "value",
    ["0", "5-3", "r1-r5", "1~5", "all,1", "01", "+1"],
)
def test_invalid_page_ranges_are_rejected(value):
    with pytest.raises(ValueError, match="page_range"):
        parse_v1_params({"page_range": value}, sync=False)


def test_sync_only_options_are_validated():
    params = parse_v1_params(
        {"response_format": "zip", "wait_timeout": "120"}, sync=True
    )
    assert params["response_format"] == "zip"
    assert params["wait_timeout"] == 120

    with pytest.raises(ValueError, match="response_format"):
        parse_v1_params({"response_format": "tar"}, sync=True)
    with pytest.raises(ValueError, match="wait_timeout"):
        parse_v1_params({"wait_timeout": "0"}, sync=True)


@pytest.mark.parametrize(
    "data",
    [
        {"backend": "pipeline"},
        {"parse_method": "ocr"},
        {"return_md": "true"},
        {"start_page_id": "0"},
    ],
)
def test_unsupported_options_are_rejected(data):
    with pytest.raises(ValueError, match="unsupported parse option"):
        parse_v1_params(data, sync=False)


def test_unknown_native_values_are_rejected():
    with pytest.raises(ValueError, match="tier"):
        parse_v1_params({"tier": "turbo"}, sync=False)
    with pytest.raises(ValueError, match="ocr_mode"):
        parse_v1_params({"ocr_mode": "vision"}, sync=False)
    with pytest.raises(ValueError, match="output_format"):
        parse_v1_params({"output_formats": "markdown,pdf"}, sync=False)


def test_sync_options_are_rejected_for_async_tasks():
    with pytest.raises(ValueError, match="unsupported parse option"):
        parse_v1_params({"response_format": "zip"}, sync=False)
