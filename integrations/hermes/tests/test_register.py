from __future__ import annotations

import argparse
import importlib.util
import logging
import shutil
import sys
from pathlib import Path

from conftest import FakeCtx
import overdeck_hermes
from overdeck_hermes import SETUP_TEXT, register, skill_path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def test_register_adds_hook_command_skill_and_cli():
    ctx = FakeCtx()
    register(ctx)
    assert [name for name, _ in ctx.hooks] == ["pre_llm_call"]
    [(name, handler, description, args_hint)] = ctx.commands
    assert (name, args_hint) == ("overdeck", "<status|pending|answer N CHOICE>")
    assert callable(handler)
    [(skill_name, path, _)] = ctx.skills
    assert skill_name == "overdeck"
    assert Path(path).is_file()
    assert Path(path).as_posix().endswith("skills/overdeck/SKILL.md")
    assert [entry[0] for entry in ctx.cli_commands] == ["overdeck"]


def test_register_without_summary_adds_no_hook():
    ctx = FakeCtx(settings={"summary": False})
    register(ctx)
    assert ctx.hooks == []
    assert [entry[0] for entry in ctx.commands] == ["overdeck"]


class OldHermesCtx:
    """A PluginContext from before Hermes 0.21.6: no call_mcp, no get_config."""

    def __init__(self):
        self.registered = []

    def register_hook(self, *args, **kwargs):
        self.registered.append(("hook", args))

    def register_command(self, *args, **kwargs):
        self.registered.append(("command", args))

    def register_skill(self, *args, **kwargs):
        self.registered.append(("skill", args))

    def register_cli_command(self, *args, **kwargs):
        self.registered.append(("cli", args))


def test_register_on_old_hermes_registers_nothing(caplog):
    ctx = OldHermesCtx()
    with caplog.at_level(logging.WARNING):
        register(ctx)
    assert ctx.registered == []
    assert "0.21.6" in caplog.text


def test_skill_path_finds_repo_copy():
    assert skill_path() == PACKAGE_ROOT / "skills" / "overdeck" / "SKILL.md"


def test_directory_drop_loads(tmp_path):
    drop = tmp_path / "overdeck"
    shutil.copytree(Path(overdeck_hermes.__file__).parent, drop,
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(PACKAGE_ROOT / "plugin.yaml", drop / "plugin.yaml")
    shutil.copytree(PACKAGE_ROOT / "skills", drop / "skills")

    spec = importlib.util.spec_from_file_location(
        "hermes_plugins_overdeck", drop / "__init__.py", submodule_search_locations=[str(drop)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
        ctx = FakeCtx()
        module.register(ctx)
    finally:
        for name in [name for name in sys.modules if name == spec.name or name.startswith(spec.name + ".")]:
            del sys.modules[name]
    [(_, path, _)] = ctx.skills
    assert Path(path).is_relative_to(tmp_path)


def test_setup_cli_prints_setup_text(capsys):
    ctx = FakeCtx()
    register(ctx)
    [(name, _, setup_fn, handler_fn, _)] = ctx.cli_commands
    parser = argparse.ArgumentParser(prog="hermes")
    plugin_parser = parser.add_subparsers(dest="command").add_parser(name)
    setup_fn(plugin_parser)
    plugin_parser.set_defaults(func=handler_fn)
    args = parser.parse_args(["overdeck", "setup"])
    assert args.func(args) == 0
    assert capsys.readouterr().out == SETUP_TEXT + "\n"
    assert "      settings:\n        summary: true\n        allow_answers: false" in SETUP_TEXT
    assert len(SETUP_TEXT.splitlines()) == 14
    assert not SETUP_TEXT.endswith("\n")
