"""SysML names on ports: `port <processing> 'Processing CSR' : T;`.

In the file the readable text is `name` and the identifier is `shortName`;
VHDL and references use the identifier; HA 2 edits {name: id, label: text}."""
import copy
import json
from pathlib import Path

import jsonschema
import pytest

from hdl_architect.core.model import JSON_SCHEMA, load_ir
from hdl_architect.editor.server import Store, to_editor, to_file
from hdl_architect.generators import sysml, vhdl

SCHEMA = json.loads(JSON_SCHEMA.read_text())


def model(port: dict) -> dict:
    return {"schemaVersion": "0.6", "package": {
        "name": "P", "portDefs": [{"name": "BitOut", "attributes": [
            {"name": "bit", "type": "Logic", "direction": "out"}]}],
        "attributeDefs": [{"name": "Logic"}],
        "partDefs": [{"name": "Top", "ports": [port]}]}}


def errors(doc):
    return list(jsonschema.Draft202012Validator(SCHEMA).iter_errors(doc))


def test_schema_readable_name_needs_a_short_name():
    assert not errors(model({"name": "Processing CSR", "shortName": "processing", "type": "BitOut"}))
    assert errors(model({"name": "Processing CSR", "type": "BitOut"}))           # not an identifier
    assert errors(model({"name": "x", "shortName": "not ok", "type": "BitOut"}))  # short name must be one


def test_loader_uses_the_short_name_as_identifier(tmp_path):
    (tmp_path / "m.json").write_text(json.dumps(model(
        {"name": "Processing CSR", "shortName": "processing", "type": "BitOut", "doc": "Register access."})))
    top = load_ir([tmp_path], "Top")
    p = top.ports[0]
    assert (p.name, p.title) == ("processing", "Processing CSR")
    head = vhdl.port_header(p)
    assert head[0] == "-- Processing CSR : BitOut" and head[1] == "-- Register access."
    assert "processing" in "\n".join(vhdl.entity_block(top))


def test_sysml_text_has_short_name_and_quoted_name():
    lines = sysml.usage("port", {"name": "Processing CSR", "shortName": "processing", "type": "BitOut"}, "")
    assert lines == ["port <processing> 'Processing CSR' : BitOut;"]


def test_editor_form_round_trip():
    doc = model({"name": "Processing CSR", "shortName": "processing", "type": "BitOut"})
    ed = to_editor(copy.deepcopy(doc))
    assert ed["package"]["partDefs"][0]["ports"][0] == {"name": "processing", "label": "Processing CSR", "type": "BitOut"}
    assert to_file(ed) == doc
    plain = model({"name": "irq", "type": "BitOut"})
    assert to_file(to_editor(copy.deepcopy(plain))) == plain


def test_server_saves_the_sysml_form(tmp_path):
    f = tmp_path / "m.json"
    f.write_text(json.dumps(model({"name": "irq", "type": "BitOut"}), indent=2) + "\n")
    store = Store([tmp_path])
    pkg = store.scan()[0]
    pkg["model"]["package"]["partDefs"][0]["ports"][0]["label"] = "Interrupt to the PS"
    errs, _ = store.save_model(pkg["file"], pkg["model"], pkg["version"])
    assert errs == []
    port = json.loads(f.read_text())["package"]["partDefs"][0]["ports"][0]
    assert port == {"name": "Interrupt to the PS", "shortName": "irq", "type": "BitOut"}
    assert list(port) == ["name", "shortName", "type"]                          # schema key order


def test_sysml_references_use_the_readable_name_and_types_are_not_shadowed():
    """SysON resolves `Control.processing` (short name) and `part Control : Control`
    (the part itself) to the wrong element; the generated text avoids both."""
    sysml.DEFS.clear()
    sysml.index_defs({"name": "Pkg", "partDefs": [
        {"name": "Control", "ports": [{"name": "Processing CSR", "shortName": "processing", "type": "BitOut"},
                                      {"name": "irq", "type": "BitOut"}]},
        {"name": "Top", "parts": [{"name": "Control", "type": "Control"}],
         "ports": [{"name": "Board IRQ", "shortName": "irq", "type": "BitOut"}]}]})
    top = {"name": "Top"}
    assert sysml.ref(top, "Control.processing") == "Control.'Processing CSR'"
    assert sysml.ref(top, "Control.irq") == "Control.irq"
    assert sysml.ref(top, "irq") == "'Board IRQ'"
    assert sysml.usage("part", {"name": "Control", "type": "Control"}, "") == ["part Control : Pkg::Control;"]
    sysml.DEFS.clear()
