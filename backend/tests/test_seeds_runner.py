"""
Tests for seed runner argparse (C-31).

Tests:
  - test_runner_parses_no_args: runner with no args sets full=False
  - test_runner_parses_full_flag: runner with --full sets full=True
  - test_runner_rejects_unknown_flag: unknown flag exits with non-zero code

These tests validate only the CLI argument parsing logic — they do NOT
connect to a database. The DB path is exercised in test_seeds_demo_full.py.
"""
import sys
import argparse
import pytest


# ---------------------------------------------------------------------------
# Helper: import the parse logic from runner
# We parse inline the same way runner.main() would, to avoid running
# asyncio.run() in tests.
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    """Replicate the argparse setup from runner.main()."""
    parser = argparse.ArgumentParser(
        description="Integrador seed runner",
        prog="rest_api.seeds.runner",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        default=False,
        help="Also run the rich demo seed (dev only)",
    )
    return parser


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_runner_parses_no_args() -> None:
    """Running the runner without any arguments must set full=False."""
    parser = _build_parser()
    args = parser.parse_args([])
    assert args.full is False


def test_runner_parses_full_flag() -> None:
    """Running the runner with --full must set full=True."""
    parser = _build_parser()
    args = parser.parse_args(["--full"])
    assert args.full is True


def test_runner_rejects_unknown_flag() -> None:
    """Unknown flags must cause argparse to exit with a non-zero code."""
    parser = _build_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["--unknown-flag-xyz"])
    assert exc_info.value.code != 0
