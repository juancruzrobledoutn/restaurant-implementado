"""Generate fresh QR images for the 3 tables. Opens PNGs in tmp_qr/."""
import json
from pathlib import Path
from urllib import request

import qrcode

BASE_URL = "http://localhost:5176"
API_URL = "http://localhost:8000"
OUT_DIR = Path(__file__).parent

TABLES = [
    {"code": "T01", "name": "Juan"},
    {"code": "T02", "name": "Ana"},
    {"code": "T03", "name": "Pedro"},
]


def join_table(code: str, name: str) -> str:
    url = f"{API_URL}/api/public/tables/code/{code}/join?branch_slug=demo"
    body = json.dumps({"name": name, "device_id": f"qr-{code}"}).encode()
    req = request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["table_token"]


def main() -> None:
    for table in TABLES:
        token = join_table(table["code"], table["name"])
        full_url = f"{BASE_URL}/t/demo/{table['code']}?token={token}"
        img = qrcode.make(full_url)
        out_path = OUT_DIR / f"qr_{table['code']}.png"
        img.save(out_path)
        print(f"{table['code']}: {out_path}")
        print(f"  URL: {full_url}")


if __name__ == "__main__":
    main()
