import itertools

import pytest

from lawata.sampling.domain import (
    InvalidTransitionError,
    SamplingStatus,
    TaskAction,
    next_status,
)

S = SamplingStatus
A = TaskAction

ALLOWED = {
    (S.PENDING_APPROVAL, A.APPROVE): S.APPROVED,
    (S.PENDING_APPROVAL, A.REJECT): S.REJECTED,
    (S.APPROVED, A.COMPLETE): S.DONE,
}

ALL_PAIRS = list(itertools.product(SamplingStatus, TaskAction))
FORBIDDEN = [pair for pair in ALL_PAIRS if pair not in ALLOWED]


def test_table_covers_every_pair() -> None:
    assert len(ALL_PAIRS) == len(SamplingStatus) * len(TaskAction) == 12
    assert len(FORBIDDEN) == 9


@pytest.mark.parametrize(("current", "action"), list(ALLOWED))
def test_next_status_allowed(current: SamplingStatus, action: TaskAction) -> None:
    assert next_status(current, action) is ALLOWED[(current, action)]


@pytest.mark.parametrize(("current", "action"), FORBIDDEN)
def test_next_status_forbidden_raises(current: SamplingStatus, action: TaskAction) -> None:
    with pytest.raises(InvalidTransitionError) as error:
        next_status(current, action)
    assert str(error.value) == f"task is {current.value}; cannot {action.value}"


@pytest.mark.parametrize("action", list(TaskAction))
def test_no_action_leads_back_to_pending(action: TaskAction) -> None:
    for current in SamplingStatus:
        if (current, action) in ALLOWED:
            assert next_status(current, action) is not S.PENDING_APPROVAL


def test_terminal_statuses_allow_nothing() -> None:
    for terminal in (S.REJECTED, S.DONE):
        for action in TaskAction:
            with pytest.raises(InvalidTransitionError):
                next_status(terminal, action)


def test_error_message_names_task_when_given() -> None:
    with pytest.raises(InvalidTransitionError, match="^task 1 is approved; cannot approve$"):
        next_status(S.APPROVED, A.APPROVE, task_id=1)


def test_statuses_mirror_db_enum() -> None:
    assert [s.value for s in SamplingStatus] == ["pending_approval", "approved", "rejected", "done"]
