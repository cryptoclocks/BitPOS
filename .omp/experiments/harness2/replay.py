"""Offline Harness2 adapter. Scripted proposals on seeded regression cases only.

No OMP invocation, model/API/auth access, product edits or live fixture access.
The upstream package is separately installed and pinned in the private lab.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

PIN = "1cfe254e8d25b15f37048c3730134686abe60335"
LAB = Path("/Users/cryptoclock/.local/share/bitpos-harness-lab")

# These are authored fault reproductions, NOT reconstructed historical runs.
CASES = {
    "evidence-handoff": [
        {"id": "valid", "kind": "evidence", "expected_sha": "a" * 64, "actual_sha": "a" * 64, "new_output": True},
        {"id": "truncated-digest", "kind": "evidence", "expected_sha": "a" * 63, "actual_sha": "a" * 64, "new_output": True},
        {"id": "changed-source", "kind": "evidence", "expected_sha": "a" * 64, "actual_sha": "b" * 64, "new_output": True},
        {"id": "historical-output", "kind": "evidence", "expected_sha": "a" * 64, "actual_sha": "a" * 64, "new_output": False},
    ],
    "runtime-readiness": [
        {"id": "ready", "kind": "readiness", "owner_matches": True, "schema_complete": True, "process_started": 100, "source_changed": 90, "entry_time": 110, "decision_time": 115, "deadline": 200, "minimum_budget": 30},
        {"id": "stale-module", "kind": "readiness", "owner_matches": True, "schema_complete": True, "process_started": 100, "source_changed": 105, "entry_time": 110, "decision_time": 115, "deadline": 200, "minimum_budget": 30},
        {"id": "missing-columns", "kind": "readiness", "owner_matches": True, "schema_complete": False, "process_started": 100, "source_changed": 90, "entry_time": 110, "decision_time": 115, "deadline": 200, "minimum_budget": 30},
        {"id": "probe-consumes-budget", "kind": "readiness", "owner_matches": True, "schema_complete": True, "process_started": 100, "source_changed": 90, "entry_time": 110, "decision_time": 135, "deadline": 160, "minimum_budget": 30},
        {"id": "wrong-owner", "kind": "readiness", "owner_matches": False, "schema_complete": True, "process_started": 100, "source_changed": 90, "entry_time": 110, "decision_time": 115, "deadline": 200, "minimum_budget": 30},
    ],
}

SCRIPT = '''import json, re, sys
STRICT_EVIDENCE = False
STRICT_READINESS = False

def admit(row):
    if row['kind'] == 'evidence':
        if not STRICT_EVIDENCE:
            return bool(row['expected_sha'])
        return (re.fullmatch(r'[a-f0-9]{64}', row['expected_sha']) is not None
                and row['expected_sha'] == row['actual_sha'] and row['new_output'])
    if not STRICT_READINESS:
        return row['owner_matches'] and row['deadline'] - row['entry_time'] >= row['minimum_budget']
    return (row['owner_matches'] and row['schema_complete']
            and row['process_started'] >= row['source_changed']
            and row['deadline'] - row['decision_time'] >= row['minimum_budget'])

with open(sys.argv[1]) as source:
    rows = json.load(source)
print(json.dumps({r['id']: bool(admit(r)) for r in rows}, sort_keys=True))
'''

GUIDANCE = """# Candidate BitPOS offline handoff guidance
Only synthetic replay evidence is available here. This is not live acceptance.
Before handing evidence to a reviewer, use a unique output and compare full digests.
Before local integration, check owned runtime, required schema, and the budget at decision time.
Use the existing .omp/guard CLI when adopted by the actual OMP owner.
Never alter goal, model routes, quota, roles, payment state or deadlines to obtain a pass.
Read the relevant observation and scope before changing code; keep unchanged checks reusable.
"""


def valid_case(row):
    """Independent, author-declared invariant check, separate from candidate code."""
    if row["kind"] == "evidence":
        value = row["expected_sha"]
        return len(value) == 64 and all(c in "0123456789abcdef" for c in value) and value == row["actual_sha"] and row["new_output"]
    return row["owner_matches"] and row["schema_complete"] and row["process_started"] >= row["source_changed"] and row["deadline"] - row["decision_time"] >= row["minimum_budget"]


def initialize():
    # Strip inherited provider variables before importing upstream config.
    for key in list(os.environ):
        if key.startswith(("HARNESS2_", "OPENAI_", "ANTHROPIC_", "GOOGLE_", "GEMINI_", "VERTEX_")):
            os.environ.pop(key)
    upstream = LAB / "harness2"
    commit = subprocess.check_output(["git", "-C", str(upstream), "rev-parse", "HEAD"], text=True).strip()
    if commit != PIN or (upstream / ".env").exists():
        raise RuntimeError("Unpinned upstream or unexpected environment file; offline experiment refused")
    from harness2.core import tree
    from harness2.core.proposer import Proposer, Reply
    from harness2.core.schedule import run_domain
    from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec
    from harness2.substrate.opencode import OpencodeSubstrate
    return tree, Proposer, Reply, run_domain, BenchPrompts, BenchSpec, ChannelSpec, OpencodeSubstrate


def run(root):
    tree, Proposer, Reply, run_domain, BenchPrompts, BenchSpec, ChannelSpec, OpencodeSubstrate = initialize()

    class Adapter:
        def __init__(self):
            self.substrate = OpencodeSubstrate()  # Tree schema only: no OpenCode process.
            channel = ChannelSpec("opencode", "local/deterministic")
            self.spec = BenchSpec(name="bitpos_offline", runs_root=root / "runs", install_mode="workspace_config",
                prompts=BenchPrompts(work="check local readiness and evidence handoff invariants"),
                channels={"proposer": channel, "selector": channel}, allow_subagents=False)
            self.execution_count = 0
            base = {key: "" for key in self.substrate.surface().always_on}
            base["systemprompt.md"] = "Use python scripts/check_handoff.py to inspect the supplied synthetic cases.\n"
            base["scripts/check_handoff.py"] = SCRIPT
            tree.write_tree(self.substrate.surface(), base, self.base_harness(), stubs=False)
            for task, cases in CASES.items():
                self.task_files(task).mkdir(parents=True)
                (self.task_files(task) / "cases.json").write_text(json.dumps(cases))

        def tasks(self, split="all"): return list(CASES)
        def domain_of(self, task): return "bitpos_handoff"
        def task_prompt(self, task): return "Check every supplied case against digest equality, exclusive output, runtime ownership, source freshness, required schema and remaining deadline budget at decision time. Return an id-to-admission mapping."
        def task_files(self, task): return root / "sources" / task
        def base_harness(self): return root / "base"
        def validate_tree(self, value):
            if "scripts/check_handoff.py" not in value: raise ValueError("Required deterministic script is missing")
            # Candidates remain predefined scripts; never execute arbitrary model-edited code.
            allowed = {SCRIPT.replace("STRICT_EVIDENCE = False", "STRICT_EVIDENCE = " + str(a)).replace("STRICT_READINESS = False", "STRICT_READINESS = " + str(b)) for a in [False, True] for b in [False, True]}
            if value["scripts/check_handoff.py"] not in allowed: raise ValueError("Outside predefined offline proposal surface")
        def execute(self, task, harness_dir, run_id, *, timeout=None):
            self.execution_count += 1
            work = root / "executions" / run_id
            work.mkdir(parents=True, exist_ok=True)
            script = (harness_dir or self.base_harness()) / "scripts/check_handoff.py"
            process = subprocess.run([sys.executable, "-I", str(script), str(self.task_files(task) / "cases.json")], text=True, capture_output=True, check=True, timeout=10,
                cwd=work, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
            (work / "answer.json").write_text(process.stdout)
            (work / "trajectory.md").write_text("[ACTION] Synthetic local handoff check\n[OBSERVATION]\n" + process.stdout)
            return work
        def delivered(self, work): return (work / "answer.json").is_file()
        def trajectory(self, work, *, obs_trunc): return (work / "trajectory.md").read_text()
        def deliverable_text(self, work): return (work / "answer.json").read_text()
        def deliverable_files(self, work): return {"answer.json": self.deliverable_text(work)}

    class ScriptedProposer(Proposer):
        def call(self, mission, context_dir, label, **kwargs):
            context = Path(context_dir); workspace = None
            if label.startswith("select."):
                rows = json.loads((context / "source/cases.json").read_text())
                expected = json.dumps({r["id"]: valid_case(r) for r in rows}, sort_keys=True)
                candidates = sorted((context / "candidates").glob("*.md"))
                chosen = next(path.stem for path in candidates if expected in path.read_text())
                text = "<why>Matches authored case invariants; scripted selection, not a model judgment.</why>\n```choice\n" + chosen + "\n```"
            elif label.startswith("experience."):
                text = "<edits>\ncomponent: scripts/check_handoff.py\ncandidates: inv1, dom1\nchange: enable strict evidence and runtime admission\nobserved: seeded invalid cases rejected while valid cases remain admitted\nverdict: helped within authored cases only\n</edits>\n<experience>\ncue: When a local handoff carries digests or time-sensitive fixture readiness\nlesson: Bind exact evidence and evaluate required runtime/schema/deadline invariants at the decision boundary.\nevidence: The paired synthetic base/probe outputs changed admission for invalid fields; full case definitions and executions remain in this run.\nconfidence: limited to deterministic seeded replay; no live OMP improvement or token saving established\n</experience>"
            else:
                workspace = context / "harness"
                script = workspace / "scripts/check_handoff.py"
                script.write_text(script.read_text().replace("STRICT_EVIDENCE = False", "STRICT_EVIDENCE = True").replace("STRICT_READINESS = False", "STRICT_READINESS = True"))
                (workspace / "guardrails.md").write_text(GUIDANCE)
                text = "<notes>Known prior-failure-inspired strict checks; scripted proposal, not autonomous discovery.</notes>"
            reply = Reply(label=label, text=text, ok=True, attempts=1, workspace=workspace)
            self._calls.append(reply)
            return reply

    adapter = Adapter(); proposer = ScriptedProposer(adapter.spec.channels["proposer"])
    kwargs = dict(adapter=adapter, prop=proposer, runs_root=adapter.spec.runs_root, library_root=root / "library", modes=("seq",))
    result = run_domain("bitpos_handoff", adapter.tasks(), 1, **kwargs)
    calls, executions = len(proposer._calls), adapter.execution_count
    resumed = run_domain("bitpos_handoff", adapter.tasks(), 1, **kwargs)
    if calls != len(proposer._calls) or executions != adapter.execution_count:
        raise AssertionError("Unchanged resume unexpectedly repeated proposal or execution")
    # A separate assertion layer: do not treat upstream delivery/selection success as correctness.
    final_checks = []
    for task in adapter.tasks():
        # Upstream keeps the shared reference + combined summary under agg even
        # for a seq-only sweep; the actual mode remains explicit inside summary.
        summary = json.loads((adapter.spec.runs_root / "bitpos_offline-oc-agg1" / task / "summary.json").read_text())
        selected = summary["selections"]["seq"]
        observed = json.loads(adapter.deliverable_text(Path(selected["chosen_run_dir"])))
        expected = {r["id"]: valid_case(r) for r in CASES[task]}
        if observed != expected: raise AssertionError("Selected output violates authored case invariants")
        base = json.loads(adapter.deliverable_text(Path(summary["base"][0]["run_dir"])))
        final_checks.append({"task": task, "cases": len(expected), "matched": True,
            "base_invalid_admissions": sum(bool(base[key]) and not value for key, value in expected.items()),
            "final_invalid_admissions": sum(bool(observed[key]) and not value for key, value in expected.items()),
            "valid_cases_retained": sum(bool(observed[key]) and value for key, value in expected.items()),
            "ledger": summary["modes"]["seq"]["ledger"]})
    report = {"status": "PASS_OFFLINE_SCRIPTED_REPLAY", "upstreamCommit": PIN,
        "method": "Real Harness2 sequential Propose-Probe-Compose/library; scripted proposer and selector; k=1",
        "tasks": result, "execution_count": executions, "scripted_editor_calls": calls, "model_calls": 0,
        "selection": "At k=1 the upstream accepts its single delivered final without invoking a selector; the independent authored-invariant assertion above remains separate",
        "invariantChecks": final_checks, "resume": {"no_new_executions": adapter.execution_count == executions, "no_new_editor_calls": len(proposer._calls) == calls, "statuses": [r["status"] for r in resumed["tasks"]]},
        "liveOmpActivated": False, "limits": ["Seeded regression cases, not historical execution reconstruction", "No model/real task performance or token savings measured", "No API/DB/AVD/provider/product access; no OMP signaling or config edits", "Upstream full Linux benchmarks and OMP executor integration not verified"]}
    (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(root / "report.json"), "tasks": result["done"], "failed": result["failed"], "model_calls": 0, "final_cases": sum(x["cases"] for x in final_checks), "resume_no_new_executions": report["resume"]["no_new_executions"]}, indent=2))
    return int(result["failed"] > 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--new-run", action="store_true", required=True)
    parser.parse_args()
    (LAB / "runs").mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="bitpos-replay-", dir=LAB / "runs"))
    sys.exit(run(output))
