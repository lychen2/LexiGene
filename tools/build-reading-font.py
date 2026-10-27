"""Instantiate Noto Serif for clear screen reading; preserve every character."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
source = root / "artifacts/NotoSerif-Variable.ttf"
target = root / "public/fonts/LexiGeneReading.woff2"
font = TTFont(source)
original_characters = set(font.getBestCmap())
font = instantiateVariableFont(font, {"wdth": 100, "wght": 500}, inplace=True)
# Give this screen-reading instance its own family name while retaining credits.
names = {1: "LexiGene Reading", 2: "Regular", 3: "LexiGeneReading-1.0", 4: "LexiGene Reading", 6: "LexiGeneReading", 16: "LexiGene Reading", 17: "Regular"}
for record in font["name"].names:
    if record.nameID in names:
        font["name"].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
font.flavor = "woff2"
font.save(target)
result = TTFont(target)
assert set(result.getBestCmap()) == original_characters
print(f"Reading font: {target.stat().st_size} bytes; all {len(original_characters)} characters retained; weight500, width100.")
