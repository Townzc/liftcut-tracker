import sys,json;from pathlib import Path
sys.dont_write_bytecode=True
sys.path[:0]=['/root/autodl-tmp/liftcut/code/acbba44cb16dce519823f2277206a8cdf3fcfca6/research/liftcut-agent', '/root/autodl-tmp/liftcut/code/acbba44cb16dce519823f2277206a8cdf3fcfca6/research/liftcut-agent/src']
from i2_protocol import verify_plan,validate_opening,verify_adapter
from i2_receipt_transfer import validate_receipt
from server_workspace import sha256
from d2_execution import read,utcnow,aware
from research_lease import verify_live
run=Path('/root/autodl-tmp/liftcut/runs/i2-run-20261013-053401')
plan=verify_plan();opening=read(run/"opening.json")
binding=validate_opening(opening,plan)
assert binding=={'version': 'i2-window-binding-v1', 'code_commit': 'acbba44cb16dce519823f2277206a8cdf3fcfca6', 'execution_plan_digest': 'b25734f9ecba62f0d91aa012af056a99d9803e864a9c23a3c93088e3f225c4ad', 'reference_digest': 'dc0af2f9fca808c44e247fa3e1f11001ec9a7bad8102f972aceab8e8c03f16e1', 'booted_at_proxy': '2026-10-13T04:27:00+00:00', 'trial_started_at_utc': '2026-10-13T05:34:46.344357+00:00', 'work_cutoff': '2026-10-13T06:34:46.344357+00:00', 'collection_cutoff': '2026-10-13T06:54:46.344357+00:00', 'hard_cutoff': '2026-10-13T07:04:46.344357+00:00', 'test_episodes': 0, 'new_training': False, 'power_lease': {'version': 'liftcut-research-lease-v1', 'booted_at_proxy': '2026-10-13T04:27:00+00:00', 'shutdown_at_utc': '2026-10-13T15:00:00+00:00', 'hourly_cny': 2.18, 'reserve_cny': 25, 'automatic_shutdown': True, 'automatic_reboot': False, 'paid_api_calls': 0, 'disk_expansion': False, 'heldout_tasks_allowed': 0, 'authorization': '2026-10-12 user: retain opened 4090 until tomorrow 08:00 America/Los_Angeles; iterate experiments and morning report', 'maximum_followup_trials': 2, 'final_collection_buffer_minutes': 45}}
assert utcnow()<aware(binding["collection_cutoff"]),"original collection deadline"
lease=verify_live(Path("/root/autodl-tmp/liftcut/ops/overnight-20261013-042700/lease.json"))
assert lease==binding["power_lease"]
index=read(run/"backup-index.json");path=run/"off-instance-backup.json"
assert sha256(path)=='73cb287f2997c1f6a42824f44a653018128b7c2d23d3c229909e6eb0476dcc4e'
receipt=validate_receipt(path.read_bytes(),index,binding)
assert receipt["complete_study_replayed"] and receipt["model_result"]
weight=verify_adapter(run/"reference/final",plan["reference"]["checkpoint"])
status=read(run/"backup-copy-status.json");close=read(run/"window-close.json")
events=(run/"events.jsonl").read_text()
assert utcnow()<aware(binding["collection_cutoff"]),"original collection deadline"
value={"version":"i2-separate-receipt-verification-v1","at_utc":utcnow().isoformat(),
"binding":binding,"receipt_sha256":sha256(path),"receipt":receipt,
"index":index,"actual_remote_weights_verified":True,"original_server_status":status,
"original_window_close":close,"original_server_events":events,
"original_controller_consumption":status["off_instance_acknowledged"],
"separate_read_only_validator":True,"new_receipts_created":0,"remote_files_modified":0,
"new_model_calls":0,"deadline_extended":False}
print(json.dumps(value))