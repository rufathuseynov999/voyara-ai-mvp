#!/usr/bin/env python3
"""Phase 3B Part 5 — contact sheet compositor.

Builds 6 contact sheets (3 locales x 2 viewports), each an 8-cell grid of the
screenshots captured by sandbox-screenshots.mjs, with a header band per sheet
and a caption per cell.
"""
import os
from PIL import Image, ImageDraw, ImageFont

SHOTS = "/tmp/shots"
OUT = "/tmp/contact-sheets"
os.makedirs(OUT, exist_ok=True)

LOCALE_NAMES = {"az": "Azerbaijani (AZ)", "ru": "Russian (RU)", "en": "English (EN)"}
SCREENS = [
    ("01-landing", "Landing", "Public marketing / showcase"),
    ("02-wizard", "Trip Wizard", "Customer A — live quote search"),
    ("03-proposal", "Proposal", "Customer A — Q_ACCEPTED status"),
    ("04-approvals", "Approvals", "Founder — Q_APPROVED status"),
    ("05-payment", "Payment", "Customer A — console (orchestration is staff-only)"),
    ("06-triproom", "Trip Room", "Customer A — Q_VERIFIED, voucher check (blocked in UI)"),
    ("07-crm", "CRM", "Founder — Q_MISMATCH status (detected \u2260 verified)"),
    ("08-founder", "Founder Command Center", "Founder — adapter health"),
]

def font(size, bold=False):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def build_sheet(locale, viewport):
    tag = f"{locale}-{viewport}"
    cell_shots = []
    for slug, title, note in SCREENS:
        path = f"{SHOTS}/{tag}-{slug}.png"
        img = Image.open(path)
        cell_shots.append((img, title, note))

    thumb_w = 520 if viewport == "desktop" else 300
    cols, rows = 4, 2
    pad = 24
    header_h = 150
    caption_h = 56

    ratios = [im.height / im.width for im, _, _ in cell_shots]
    thumb_h = int(thumb_w * max(ratios))

    cell_w = thumb_w + pad
    cell_h = thumb_h + caption_h + pad
    sheet_w = cell_w * cols + pad
    sheet_h = header_h + cell_h * rows + pad

    sheet = Image.new("RGB", (sheet_w, sheet_h), "#0b1e17")
    draw = ImageDraw.Draw(sheet)

    draw.rectangle([0, 0, sheet_w, header_h], fill="#0b1e17")
    draw.text((pad, 26), "VOYARA AI \u2014 Phase 3B Final Contact Sheet", font=font(30, bold=True), fill="#d9c48a")
    draw.text((pad, 66), f"{LOCALE_NAMES[locale]} \u00b7 {'Desktop 1440\u00d7900' if viewport=='desktop' else 'Mobile 390\u00d7844'} \u00b7 8 screens \u00b7 sandbox authenticated (synthetic accounts)", font=font(16), fill="#a9c9b8")
    draw.text((pad, 96), "Demo simulation \u2014 no live inventory or payment.", font=font(14), fill="#7fa08e")

    for idx, (img, title, note) in enumerate(cell_shots):
        r, c = divmod(idx, cols)
        x = pad + c * cell_w
        y = header_h + pad + r * cell_h
        scale = thumb_w / img.width
        thumb = img.resize((thumb_w, int(img.height * scale)))
        card = Image.new("RGB", (thumb_w, thumb_h), "#132b22")
        card.paste(thumb, (0, 0))
        sheet.paste(card, (x, y))
        draw.rectangle([x, y, x + thumb_w, y + thumb_h], outline="#3a5c4c", width=1)
        draw.text((x + 2, y + thumb_h + 6), f"{idx+1}. {title}", font=font(16, bold=True), fill="#eef3ef")
        draw.text((x + 2, y + thumb_h + 28), note, font=font(11), fill="#93b3a2")

    out_path = f"{OUT}/VOYARA-Phase3B-Contact-{viewport.capitalize()}-{locale.upper()}.png"
    sheet.save(out_path, optimize=True)
    print(out_path, sheet.size)

for locale in ["az", "ru", "en"]:
    for viewport in ["desktop", "mobile"]:
        build_sheet(locale, viewport)
