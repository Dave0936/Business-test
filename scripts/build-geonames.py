#!/usr/bin/env python3
"""Builds data/geonames/ from a GeoNames dump (CC BY 4.0, credit "Places: GeoNames").

Usage: python3 scripts/build-geonames.py <dir containing cities5000.txt, countryInfo.txt, admin1CodesASCII.txt>
Download from https://download.geonames.org/export/dump/ (cities5000.zip, countryInfo.txt, admin1CodesASCII.txt).
Output: data/geonames/countries.json and data/geonames/towns/<CC>.json
"""
import json, os, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), "..", "data", "geonames")
os.makedirs(os.path.join(out, "towns"), exist_ok=True)

admin1 = {}
with open(os.path.join(src, "admin1CodesASCII.txt"), encoding="utf-8") as f:
    for line in f:
        code, name, *_ = line.rstrip("\n").split("\t")
        admin1[code] = name

countries = {}
with open(os.path.join(src, "countryInfo.txt"), encoding="utf-8") as f:
    for line in f:
        if line.startswith("#"):
            continue
        c = line.rstrip("\n").split("\t")
        langs = [l.split("-")[0] for l in c[15].split(",") if l]
        countries[c[0]] = {"code": c[0], "name": c[4], "languages": list(dict.fromkeys(langs))[:3], "towns": 0}

towns = {}
with open(os.path.join(src, "cities5000.txt"), encoding="utf-8") as f:
    for line in f:
        c = line.rstrip("\n").split("\t")
        gid, name, ascii_, cc, a1, pop = c[0], c[1], c[2], c[8], c[10], int(c[14] or 0)
        if c[6] != "P" or cc not in countries:
            continue
        towns.setdefault(cc, []).append([int(gid), name, ascii_, admin1.get(f"{cc}.{a1}", ""), pop, round(float(c[4]), 4), round(float(c[5]), 4)])

for cc, rows in towns.items():
    rows.sort(key=lambda r: -r[4])
    countries[cc]["towns"] = len(rows)
    with open(os.path.join(out, "towns", f"{cc}.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))

listed = sorted((c for c in countries.values() if c["towns"] > 0), key=lambda c: c["name"])
with open(os.path.join(out, "countries.json"), "w", encoding="utf-8") as f:
    json.dump({"attribution": "Places: GeoNames (CC BY 4.0, geonames.org)", "fields": ["id", "name", "ascii", "region", "population", "lat", "lng"], "countries": listed}, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(listed)} countries, {sum(c['towns'] for c in listed)} towns")
