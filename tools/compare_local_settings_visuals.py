#!/usr/bin/env python3
"""Build first-five settings contact sheets and simple pixel-difference metrics."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageStat


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "qa" / "auth-capture"
LOCAL = ROOT / "qa" / "local-settings"
SLUGS = ["general", "notifications", "personalization", "plugins", "voice"]


def dialog_bbox(image: Image.Image, slug: str, mobile: bool) -> tuple[int, int, int, int]:
    if mobile:
        tops = {"general": 115, "notifications": 63, "personalization": 63, "plugins": 63, "voice": 82}
        bottoms = {"general": 730, "notifications": 782, "personalization": 782, "plugins": 782, "voice": 763}
        return 9, tops[slug] - 1, 381, bottoms[slug]
    # Desktop target screenshots are physical pixels at 1.25 DPR.
    return 535, 79, 1386, 1039


def fit_pair(target: Image.Image, local: Image.Image) -> tuple[Image.Image, Image.Image]:
    width = min(target.width, local.width)
    height = min(target.height, local.height)
    return target.crop((0, 0, width, height)), local.crop((0, 0, width, height))


def compare_mobile() -> None:
    metrics: dict[str, object] = {}
    strips: list[Image.Image] = []
    for slug in SLUGS:
        target_full = Image.open(TARGET / "mobile" / f"{slug}.png").convert("RGB")
        local_full = Image.open(LOCAL / f"current-mobile-{slug}.png").convert("RGB")
        target = target_full.crop(dialog_bbox(target_full, slug, True))
        local = local_full.crop(dialog_bbox(local_full, slug, True))
        target, local = fit_pair(target, local)
        raw_diff = ImageChops.difference(target, local)
        channel_means = ImageStat.Stat(raw_diff).mean
        channels = raw_diff.split()
        max_diff = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
        histogram = max_diff.histogram()
        pixels = target.width * target.height
        metrics[slug] = {
            "crop_size": [target.width, target.height],
            "mae_rgb": round(sum(channel_means) / 3, 4),
            "pixels_over_16_pct": round(sum(histogram[17:]) / pixels * 100, 4),
            "pixels_over_32_pct": round(sum(histogram[33:]) / pixels * 100, 4),
        }
        diff = ImageEnhance.Contrast(raw_diff).enhance(3.0)
        strip = Image.new("RGB", (target.width * 3, target.height + 28), "white")
        strip.paste(target, (0, 28))
        strip.paste(local, (target.width, 28))
        strip.paste(diff, (target.width * 2, 28))
        ImageDraw.Draw(strip).text((8, 6), f"{slug}: target | local | diff x3", fill="black")
        strips.append(strip)

    width = max(strip.width for strip in strips)
    height = sum(strip.height for strip in strips)
    contact = Image.new("RGB", (width, height), "white")
    y = 0
    for strip in strips:
        contact.paste(strip, (0, y))
        y += strip.height
    contact.save(LOCAL / "current-mobile-first-five-contact.png")
    (LOCAL / "current-mobile-first-five-metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


def compare_desktop() -> None:
    metrics: dict[str, object] = {}
    strips: list[Image.Image] = []
    crop_box = (427, 63, 1109, 665)
    for slug in SLUGS:
        target_full = Image.open(TARGET / "tabs" / f"{slug}.png").convert("RGB")
        target_full = target_full.resize((1536, 744), Image.Resampling.LANCZOS)
        local_full = Image.open(LOCAL / f"current-desktop-{slug}.png").convert("RGB")
        target = target_full.crop(crop_box)
        local = local_full.crop(crop_box)
        raw_diff = ImageChops.difference(target, local)
        channel_means = ImageStat.Stat(raw_diff).mean
        channels = raw_diff.split()
        max_diff = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
        histogram = max_diff.histogram()
        pixels = target.width * target.height
        metrics[slug] = {
            "crop_size": [target.width, target.height],
            "mae_rgb": round(sum(channel_means) / 3, 4),
            "pixels_over_16_pct": round(sum(histogram[17:]) / pixels * 100, 4),
            "pixels_over_32_pct": round(sum(histogram[33:]) / pixels * 100, 4),
        }
        diff = ImageEnhance.Contrast(raw_diff).enhance(3.0)
        strip = Image.new("RGB", (target.width * 3, target.height + 28), "white")
        strip.paste(target, (0, 28))
        strip.paste(local, (target.width, 28))
        strip.paste(diff, (target.width * 2, 28))
        ImageDraw.Draw(strip).text((8, 6), f"{slug}: target | local | diff x3", fill="black")
        strips.append(strip)

    width = max(strip.width for strip in strips)
    height = sum(strip.height for strip in strips)
    contact = Image.new("RGB", (width, height), "white")
    y = 0
    for strip in strips:
        contact.paste(strip, (0, y))
        y += strip.height
    contact.save(LOCAL / "current-desktop-first-five-contact.png")
    (LOCAL / "current-desktop-first-five-metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    compare_mobile()
    compare_desktop()
