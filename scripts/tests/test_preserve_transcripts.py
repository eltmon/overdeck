"""Exercise real Restic backups using disposable fixture homes only."""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "preserve-transcripts.py"
SPEC = importlib.util.spec_from_file_location("preservation", SCRIPT)
preservation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preservation)


class SettingsTests(unittest.TestCase):
    def test_preserves_unrelated_settings_and_original_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = root / "settings.json"
            original = b'{"cleanupPeriodDays": 30, "env": {"EXAMPLE": "keep"}}'
            settings.write_bytes(original)
            self.assertTrue(preservation.protect_settings(settings, root / "backups"))
            self.assertEqual(json.loads(settings.read_text()), {
                "cleanupPeriodDays": 365000, "env": {"EXAMPLE": "keep"},
            })
            self.assertEqual(next((root / "backups").glob("*.json")).read_bytes(), original)
            self.assertFalse(preservation.protect_settings(settings, root / "backups"))

    def test_invalid_settings_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = root / "settings.json"
            for original in (b'{broken', b'[]'):
                settings.write_bytes(original)
                with self.assertRaises(ValueError):
                    preservation.protect_settings(settings, root / "backups")
                self.assertEqual(settings.read_bytes(), original)

    def test_settings_symlink_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "real.json"
            target.write_text('{}')
            link = root / "settings.json"
            link.symlink_to(target)
            preservation.protect_settings(link, root / "backups")
            self.assertTrue(link.is_symlink())
            self.assertEqual(json.loads(target.read_text())["cleanupPeriodDays"], 365000)


@unittest.skipUnless(shutil.which("restic"), "Restic must be installed")
class RecoveryTests(unittest.TestCase):
    def test_original_and_appended_history_survive_source_truncation_and_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            storage = home / ".overdeck/transcript-preservation"
            source = home / '.claude/projects/project space/#session\nname.jsonl'
            source.parent.mkdir(parents=True)
            first = b'{"message":"original"}\n'
            second = first + b'{"message":"appended"}\n'
            source.write_bytes(first)
            agent = home / ".overdeck/agents/conv-fixture/sessions/agent.jsonl"
            agent.parent.mkdir(parents=True)
            agent.write_text('{"message":"managed"}\n')
            private_settings = home / ".overdeck/agents/conv-fixture/claude-home/settings.json"
            private_settings.parent.mkdir(parents=True)
            private_settings.write_text('{"cleanupPeriodDays":1}')

            def backup():
                result = subprocess.run(["python3", str(SCRIPT), "backup", "--home", str(home)],
                                        capture_output=True)
                self.assertEqual(result.returncode, 0, result.stdout.decode() + result.stderr.decode())

            def snapshots():
                result = preservation.restic(storage, "snapshots", "--json", capture_output=True)
                return json.loads(result.stdout)

            def dump(snapshot):
                return preservation.restic(storage, "dump", snapshot, str(source),
                                           capture_output=True).stdout

            backup()
            first_id = snapshots()[-1]["id"]
            source.write_bytes(second)
            backup()
            second_id = snapshots()[-1]["id"]
            source.write_bytes(b'{}\n')
            backup()
            source.unlink()  # Disposable fixture: simulate vendor retention.
            backup()
            self.assertEqual(len(snapshots()), 4)
            self.assertEqual(dump(first_id), first)
            self.assertEqual(dump(second_id), second)
            self.assertEqual(json.loads(private_settings.read_text())["cleanupPeriodDays"], 365000)
            self.assertEqual(preservation.restic(storage, "dump", "latest", str(agent),
                                                capture_output=True).stdout, agent.read_bytes())
            preservation.restic(storage, "check", "--read-data", capture_output=True)

            # Malformed retention settings must report failure without stopping
            # the independent backup safeguard.
            private_settings.write_text('{broken')
            result = subprocess.run(["python3", str(SCRIPT), "backup", "--home", str(home)],
                                    capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(len(snapshots()), 5)
            self.assertEqual(private_settings.read_text(), '{broken')


if __name__ == "__main__":
    unittest.main()
