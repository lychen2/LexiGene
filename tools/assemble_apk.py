"""Add the dex and bundled Go services to an aapt2-built APK without Gradle."""
import sys
import zipfile

base, dex, libdir, target = sys.argv[1:5]
with zipfile.ZipFile(base) as source, zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as output:
    for entry in source.infolist():
        output.writestr(entry, source.read(entry.filename))
    output.write(dex, "classes.dex")
    for abi in ("arm64-v8a", "x86_64"):
        output.write(f"{libdir}/{abi}/liblexigene.so", f"lib/{abi}/liblexigene.so")
print(f"Packaged {target}")
