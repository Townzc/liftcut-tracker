from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
import server_workspace as workspace
from gpu_pilot import validate_tokens
from liftcut_agent.qwen_transport import parse_tool_text


class PilotTests(unittest.TestCase):
    def test_native_tool_calls_keep_arguments_and_unique_ids(self):
        text = '<tool_call>{"name":"get_context","arguments":{}}</tool_call>\n<tool_call>{"name":"get_memories","arguments":{}}</tool_call><|im_end|>'
        calls = parse_tool_text(text, 3)
        self.assertEqual([call["id"] for call in calls], ["qwen-3-0", "qwen-3-1"])
        self.assertEqual(json.loads(calls[1]["function"]["arguments"]), {})

    def test_malformed_generation_is_not_repaired(self):
        invalid = [
            'Here is a tool: <tool_call>{"name":"get_context","arguments":{}}</tool_call>',
            '<tool_call>{"name":"get_context","arguments":{}}',
            '<tool_call>{"name":"get_context","name":"finish","arguments":{}}</tool_call>',
            '<tool_call>{"name":"get_context","arguments":{"x":NaN}}</tool_call>',
            '<tool_call>{"name":"get_context","arguments":"{}"}</tool_call>',
            '<tool_call>{"name":"get_context","arguments":{}}</tool_call>' * 5,
        ]
        for text in invalid:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_tool_text(text, 1)

    def test_masks_reject_supervised_context_and_dropped_target(self):
        row = {"input_ids": [1, 2, 3, 4], "attention_mask": [1, 1, 1, 1],
               "labels": [-100, -100, 3, 4], "prompt_tokens": 2, "target_tokens": 2}
        validate_tokens([row])
        for index, value in [(0, 1), (3, -100)]:
            bad = deepcopy(row)
            bad["labels"][index] = value
            with self.assertRaises(ValueError):
                validate_tokens([bad])
        with self.assertRaises(ValueError):
            validate_tokens([row], max_length=3)

    def test_artifact_integrity_after_move_and_after_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "runs/pilot").mkdir(parents=True)
            (root / "runs/pilot/report.json").write_text('{"ok":true}')
            with patch.object(workspace, "check_checkout"):
                manifest = workspace.snapshot(root, "a" * 40, ["runs/pilot"])
                self.assertTrue(workspace.verify(root, manifest)["verified"])
                (root / "runs/pilot/report.json").write_text('{"ok":false}')
                with self.assertRaises(ValueError):
                    workspace.verify(root, manifest)

    def test_new_and_missing_files_invalidate_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data/one.json").write_text("1")
            with patch.object(workspace, "check_checkout"):
                manifest = workspace.snapshot(root, "a" * 40, ["data"])
                (root / "data/two.json").write_text("2")
                with self.assertRaises(ValueError):
                    workspace.verify(root, manifest)
                (root / "data/one.json").unlink()
                with self.assertRaises(ValueError):
                    workspace.verify(root, manifest)

    def test_credentials_and_path_escape_not_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "data").mkdir()
            (root / "data/.env").write_text("private placeholder")
            for selection in ["../outside", "/root/.ssh", "C:/private", "cache", "data"]:
                with self.subTest(selection=selection), self.assertRaises(ValueError):
                    workspace.artifact_files(root, [selection])

    def test_mutable_git_reference_rejected(self):
        for value in ["main", "abc123", "A" * 40, "-" * 40]:
            with self.assertRaises(ValueError):
                workspace.commit_id(value)

    def test_manifest_output_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            workspace.dump_new(path, {"a": 1})
            with self.assertRaises(FileExistsError):
                workspace.dump_new(path, {"a": 2})


if __name__ == "__main__":
    unittest.main()
