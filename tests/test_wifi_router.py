"""The Wi-Fi router example (drawn in HA 2) loads, checks and elaborates."""
from pathlib import Path

from hdl_architect.core.model import check_model, load_ir

WIFI = Path(__file__).resolve().parents[1] / "examples" / "wifi_router"


def test_model_checks():
    check_model([WIFI])


def test_elaborates():
    top = load_ir([WIFI], "WifiPacketRouterFpga")
    assert top.kind == "FpgaPart"
    assert {c.name for c in top.children} >= {"ethernet", "adc_if", "dac_if", "uart", "Control"}
