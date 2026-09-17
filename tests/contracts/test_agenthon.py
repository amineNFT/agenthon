import json
import pytest

URL = "https://react.dev/reference/react/useState"
QUOTE = "useState is a React Hook that lets you add a state variable to your component."

@pytest.fixture
def desk(direct_vm, direct_deploy, direct_bob):
    direct_vm.warp("2026-09-17T12:00:00Z")
    contract = direct_deploy("contracts/agenthon.py", sdk_version="v0.6.0-rc5")
    contract.create_task(
        "task-001",
        "Explain what useState returns",
        json.dumps(["State what useState returns.", "Cite the official React docs."]),
        7,
    )
    return contract

def deliver(desk, vm, agent, summary="useState returns an array with exactly two values.", claims=None):
    if claims is None:
        claims = [{"text": "useState lets you add a state variable to your component.", "url": URL}]
    with vm.prank(agent):
        desk.submit_deliverable("task-001", summary, json.dumps(claims))

def mock_grade(vm, bands=("met", "met"), citation="supported", quote=QUOTE, status=200):
    vm.mock_web(r"react\.dev", {"status": status, "body": QUOTE})
    vm.mock_llm(r"AGENTHON_CITATION_CHECK", mocked_json({"verdict": citation, "quote": quote,
                                                         "reason": "The page states it."}))
    vm.mock_llm(r"AGENTHON_RUBRIC_GRADE", mocked_json({
        "criteria": [{"band": band, "reason": "Graded from the deliverable."} for band in bands]
    }))

def mocked_json(value) -> str:
    """Encode a mock LLM reply the way this gltest RC hands it to the v0.6 SDK.

    gltest json-parses a mock string before returning it, while the v0.6 SDK
    json-parses the returned text itself. Double-encoding keeps the model reply
    as text through the first parse.
    """
    return json.dumps(json.dumps(value))

def state(desk, task_id="task-001"):
    return json.loads(desk.get_task(task_id))

def agent_state(desk, address):
    return json.loads(desk.get_agent("0x" + address.hex()))

def test_accepted_delivery_sets_score_and_reputation(desk, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm)
    desk.grade_deliverable("task-001")
    task = state(desk)
    assert task["status"] == "accepted"
    assert task["score"] == 100
    assert [c["band"] for c in task["grade"]["criteria"]] == ["met", "met"]
    assert task["grade"]["citations"][0]["verdict"] == "supported"
    agent = agent_state(desk, direct_bob)
    assert agent["graded"] == 1 and agent["accepted"] == 1
    assert agent["average"] == 100
    assert direct_vm.run_validator() is True

def test_partial_work_needs_revision(desk, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, bands=("met", "partial"))
    desk.grade_deliverable("task-001")
    task = state(desk)
    assert task["status"] == "needs_work"
    assert task["score"] == 80
    # The agent may deliver again after a partial grade.
    deliver(desk, direct_vm, direct_bob, summary="useState returns exactly two values: the state and its setter.")
    assert state(desk)["revision"] == 2

def test_unmet_criterion_rejects_and_blocks_payment(desk, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, bands=("unmet", "met"))
    desk.grade_deliverable("task-001")
    assert state(desk)["status"] == "rejected"
    with direct_vm.prank(direct_bob), direct_vm.expect_revert("Payment is not available"):
        desk.claim_payout("task-001")

def test_invented_citation_is_not_evidence(desk, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, citation="supported", quote="This passage was invented by the agent.")
    desk.grade_deliverable("task-001")
    assert state(desk)["grade"]["citations"][0]["verdict"] == "unsupported"

def test_citation_formatting_does_not_lose_evidence(desk, direct_vm, direct_bob):
    # Validators rewrite the passages they quote; case and punctuation must not
    # turn a real citation into a missing one, or grades stop agreeing.
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, quote="USESTATE IS A REACT HOOK, THAT LETS YOU ADD A STATE VARIABLE TO YOUR COMPONENT")
    desk.grade_deliverable("task-001")
    assert state(desk)["grade"]["citations"][0]["verdict"] == "supported"

def test_validator_tolerates_bands_that_keep_the_decision(desk, direct_vm, direct_bob):
    # met vs partial on one criterion does not change acceptance... it changes
    # needs_work, so the equivalent case must be a tolerable pair: compare a
    # leader grade with itself under different wording.
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, bands=("partial", "met"))
    desk.grade_deliverable("task-001")
    assert state(desk)["status"] == "needs_work"
    direct_vm.clear_mocks()
    mock_grade(direct_vm, bands=("partial", "met"))
    assert direct_vm.run_validator() is True

def test_validator_rejects_a_different_decision(desk, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm)
    desk.grade_deliverable("task-001")
    assert state(desk)["status"] == "accepted"
    direct_vm.clear_mocks()
    mock_grade(direct_vm, bands=("unmet", "met"))
    assert direct_vm.run_validator() is False

def test_unretrieved_source_is_never_credit(desk, direct_vm, direct_bob):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, status=404)
    desk.grade_deliverable("task-001")
    assert state(desk)["grade"]["citations"][0]["verdict"] == "unsupported"

def test_requester_cannot_deliver_their_own_task(desk, direct_vm):
    with direct_vm.expect_revert("requester cannot deliver"):
        desk.accept_task("task-001")

def test_only_the_accepting_agent_can_deliver(desk, direct_vm, direct_bob, direct_charlie):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    with direct_vm.prank(direct_charlie), direct_vm.expect_revert("Only the accepting agent"):
        desk.submit_deliverable("task-001", "Someone else delivers this work entirely.", "[]")

def test_outsider_cannot_grade(desk, direct_vm, direct_bob, direct_charlie):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    with direct_vm.prank(direct_charlie), direct_vm.expect_revert("Only the requester or the agent"):
        desk.grade_deliverable("task-001")

@pytest.mark.parametrize("url", ["https://127.0.0.1/", "http://react.dev/", "https://react.dev.evil.com/",
                                 "https://***@evil.com/", "https://react.dev:443/reference/react/useState",
                                 "https://react.dev/reference/react/useState?x=1", "https://localhost/"])
def test_citation_urls_are_restricted(desk, direct_vm, direct_bob, url):
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    with direct_vm.expect_revert():
        deliver(desk, direct_vm, direct_bob, claims=[{"text": "A citation pointing somewhere else.", "url": url}])

def test_funded_work_is_open_to_any_agent(desk, direct_vm, direct_bob):
    # A funded task must be acceptable by an address with no history, so anyone
    # reviewing the app can fund a task and deliver it themselves.
    direct_vm.value = 100
    desk.create_task("task-funded", "Explain React state updates",
                     json.dumps(["State how set functions update state."]), 7)
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-funded")
    assert state(desk, "task-funded")["agent"] == "0x" + direct_bob.hex()
    assert state(desk, "task-funded")["status"] == "working"

def test_expired_open_task_is_refunded(desk, direct_vm):
    with direct_vm.expect_revert("Refund is not available"):
        desk.refund_expired("task-001")
    direct_vm.warp("2026-09-25T12:00:00Z")
    desk.refund_expired("task-001")
    assert state(desk)["status"] == "refunded"

def test_task_ids_and_bounds_are_enforced(desk, direct_vm):
    with direct_vm.expect_revert("already exists"):
        desk.create_task("task-001", "Duplicate task identifier", json.dumps(["Anything at all."]), 7)
    with direct_vm.expect_revert("1 to 4 rubric criteria"):
        desk.create_task("task-002", "Empty rubric task", json.dumps([]), 7)
    with direct_vm.expect_revert("Deadline must be 1 to 30 days"):
        desk.create_task("task-003", "Deadline out of range", json.dumps(["One criterion here."]), 90)

def test_task_list_and_version(desk):
    assert desk.get_version() == "agenthon/1.0"
    assert desk.list_tasks(0, 10) == ["task-001"]
    with pytest.raises(Exception):
        desk.list_tasks(0, 99)

def test_rejected_delivery_can_be_corrected(desk, direct_vm, direct_bob):
    # A rejection keeps the escrow: the agent corrects the work and delivers again.
    with direct_vm.prank(direct_bob):
        desk.accept_task("task-001")
    deliver(desk, direct_vm, direct_bob)
    mock_grade(direct_vm, bands=("unmet", "met"))
    desk.grade_deliverable("task-001")
    assert state(desk)["status"] == "rejected"
    deliver(desk, direct_vm, direct_bob, summary="useState returns the current state and its set function.")
    assert state(desk)["status"] == "grading"
    direct_vm.clear_mocks()
    mock_grade(direct_vm, bands=("met", "met"))
    desk.grade_deliverable("task-001")
    assert state(desk)["status"] == "accepted"
    agent = agent_state(desk, direct_bob)
    assert agent["graded"] == 2 and agent["accepted"] == 1
    assert agent["average"] == 75  # (50 + 100) / 2 over two graded deliveries
