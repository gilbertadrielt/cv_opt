"""Download the Roboflow datasets listed in datasets.yaml into ./datasets/<name>/.

    python download_datasets.py                 # every dataset in datasets.yaml
    python download_datasets.py silicon-wafer   # just one
    python download_datasets.py --force         # re-download even if already present

The API key is read from ROBOFLOW_API_KEY in .env (never from datasets.yaml).
"""
import argparse
import io
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path

import requests
import yaml
from dotenv import load_dotenv

try:  # verify TLS against the OS cert store (needed behind networks that re-sign HTTPS)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent
API = "https://api.roboflow.com"


def load_config() -> dict:
    with open(ROOT / "datasets.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)["datasets"]


def _api_key() -> str:
    load_dotenv(ROOT / ".env")
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key:
        sys.exit("ROBOFLOW_API_KEY is not set. Copy .env.example to .env and put your key in it.")
    return key


def _export_link(cfg: dict, key: str) -> str:
    url = f"{API}/{cfg['workspace']}/{cfg['project']}/{cfg['version']}/{cfg['format']}"
    for _ in range(60):  # Roboflow builds an export on first request, so poll until it is ready
        try:
            r = requests.get(url, params={"api_key": key}, timeout=60)
        except requests.RequestException as e:  # str(e) contains the URL, i.e. the API key
            sys.exit(f"Could not reach Roboflow ({type(e).__name__}). Check your network / TLS certificates.")
        if r.status_code != 200:  # same reason: don't raise_for_status()
            sys.exit(f"Roboflow API returned {r.status_code}: {r.text[:300]}")
        export = r.json().get("export") or {}
        if export.get("link"):
            return export["link"]
        time.sleep(5)
    sys.exit(f"Timed out waiting for Roboflow to build the {cfg['format']} export of {cfg['project']} v{cfg['version']}.")


def _normalize_yaml(out: Path) -> Path:
    """Roboflow's data.yaml uses '../train/images' paths; rewrite them as absolute-root + relative."""
    path = out / "data.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["path"] = str(out)
    for key, folders in (("train", ("train",)), ("val", ("valid", "val")), ("test", ("test",))):
        data.pop(key, None)
        for folder in folders:
            if (out / folder / "images").is_dir():
                data[key] = f"{folder}/images"
                break
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return path


def ensure_dataset(name: str, force: bool = False) -> Path:
    """Return the path to <name>'s data.yaml, downloading the dataset first if needed."""
    configs = load_config()
    if name not in configs:
        sys.exit(f"Unknown dataset '{name}'. Defined in datasets.yaml: {', '.join(configs)}")
    out = ROOT / "datasets" / name
    if (out / "data.yaml").exists() and not force:
        return out / "data.yaml"

    cfg = configs[name]
    print(f"[{name}] requesting {cfg['workspace']}/{cfg['project']} v{cfg['version']} ({cfg['format']}) ...")
    link = _export_link(cfg, _api_key())
    r = requests.get(link, timeout=600)
    r.raise_for_status()

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        z.extractall(out)
    yaml_path = _normalize_yaml(out)
    print(f"[{name}] ready: {yaml_path}")
    return yaml_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", help="dataset keys from datasets.yaml (default: all)")
    ap.add_argument("--force", action="store_true", help="re-download even if the dataset already exists")
    args = ap.parse_args()
    for n in args.names or load_config():
        ensure_dataset(n, force=args.force)
