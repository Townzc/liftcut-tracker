"""Check/freeze the D2 execution contract locally, with no GPU or network action."""
import argparse
from pathlib import Path
import json
from d2_execution import REVIEWED, build_plan, verify_plan, verify_adapters
from server_workspace import dump_new


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--prepared-dir", required=True, type=Path)
    parser.add_argument("--write-reviewed", action="store_true", help="Explicit development-only creation; refuses replacement")
    parser.add_argument("--adapters-root", type=Path)
    args = parser.parse_args()
    if args.write_reviewed:
        dump_new(REVIEWED, build_plan(args.prepared_dir))
    plan = verify_plan(args.prepared_dir)
    if args.adapters_root:
        verify_adapters(args.adapters_root)
    print(json.dumps({"execution_contract_verified": True, "cases_per_arm": len(plan["execution_case_ids"]),
                      "actual_adapter_bytes_verified": args.adapters_root is not None, "gpu_calls": 0,
                      "server_state_verified": False, "budget": plan["budget"]}))


if __name__ == "__main__":
    main()
