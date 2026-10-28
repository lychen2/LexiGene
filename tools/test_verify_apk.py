"""Exercise the package verifier through its build and CI command-line entry."""
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile


VERIFIER = Path(__file__).with_name("verify_apk.py")
ARM64 = "lib/arm64-v8a/liblexigene.so"
X86_64 = "lib/x86_64/liblexigene.so"

ELF_HEADER_SIZE = 64
PROGRAM_HEADER_SIZE = 56
PT_LOAD, PT_DYNAMIC, PT_INTERP = 1, 2, 3
DT_NULL, DT_NEEDED, DT_STRTAB, DT_STRSZ = 0, 1, 5, 10


def string_table(values):
    """Return (offsets, blob) for a NUL-terminated string table."""
    offsets, blob = [], b"\0"
    for value in values:
        offsets.append(len(blob))
        blob += value.encode() + b"\0"
    return offsets, blob


def elf(machine, elf_type=2, interpreter=None, needed=(), dynamic=False):
    """Build a minimal ELF64 program, optionally carrying loader dependencies."""
    interpreter_bytes = interpreter.encode() + b"\0" if interpreter is not None else b""
    wanted = list(needed)
    string_offsets, strings = string_table(wanted)
    if not dynamic and not wanted:
        strings = b""

    segments = [PT_LOAD]
    if strings:
        segments.append(PT_DYNAMIC)
    if interpreter_bytes:
        segments.append(PT_INTERP)

    dynamic_size = (len(wanted) + 3) * 16 if strings else 0
    strings_offset = ELF_HEADER_SIZE + len(segments) * PROGRAM_HEADER_SIZE
    dynamic_offset = strings_offset + len(strings)
    dynamic_offset += (-dynamic_offset) % 8
    interpreter_offset = dynamic_offset + dynamic_size
    total = interpreter_offset + len(interpreter_bytes)

    raw = bytearray(total)
    raw[:7] = b"\x7fELF\x02\x01\x01"
    struct.pack_into("<HH", raw, 16, elf_type, machine)
    struct.pack_into("<Q", raw, 32, ELF_HEADER_SIZE)
    struct.pack_into("<HH", raw, 54, PROGRAM_HEADER_SIZE, len(segments))

    # The load segment maps the whole file with matching virtual addresses.
    headers = [(PT_LOAD, 0, 0, total)]
    if strings:
        raw[strings_offset:strings_offset + len(strings)] = strings
        entries = [(DT_NEEDED, offset) for offset in string_offsets]
        entries += [(DT_STRTAB, strings_offset), (DT_STRSZ, len(strings)), (DT_NULL, 0)]
        for index, (tag, value) in enumerate(entries):
            struct.pack_into("<qQ", raw, dynamic_offset + index * 16, tag, value)
        headers.append((PT_DYNAMIC, dynamic_offset, dynamic_offset, dynamic_size))
    if interpreter_bytes:
        raw[interpreter_offset:interpreter_offset + len(interpreter_bytes)] = interpreter_bytes
        headers.append((PT_INTERP, interpreter_offset, interpreter_offset, len(interpreter_bytes)))

    for index, (p_type, p_offset, p_vaddr, p_filesz) in enumerate(headers):
        struct.pack_into(
            "<IIQQQQQQ", raw, ELF_HEADER_SIZE + index * PROGRAM_HEADER_SIZE,
            p_type, 4, p_offset, p_vaddr, p_vaddr, p_filesz, p_filesz, 8,
        )
    return bytes(raw)


class VerifyApkTest(unittest.TestCase):
    def setUp(self):
        self.entries = {
            "classes.dex": b"dex\n035\x00",
            "assets/www/index.html": b"<!doctype html><title>LexiGene</title>",
            ARM64: elf(183),
            X86_64: elf(62),
        }

    def verify(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "test.apk"
            with zipfile.ZipFile(apk, "w", zipfile.ZIP_DEFLATED) as archive:
                for name, content in self.entries.items():
                    archive.writestr(name, content)
            return subprocess.run(
                [sys.executable, str(VERIFIER), str(apk)],
                capture_output=True, text=True, check=False,
            )

    def verify_native(self, make_program):
        results = []
        for name, machine in ((ARM64, 183), (X86_64, 62)):
            content = self.entries[name]
            self.entries[name] = make_program(machine)
            try:
                results.append((name, self.verify()))
            finally:
                self.entries[name] = content
        return results

    def test_complete_package_passes(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_each_required_entry_must_exist(self):
        for name in tuple(self.entries):
            with self.subTest(entry=name):
                content = self.entries.pop(name)
                result = self.verify()
                self.entries[name] = content
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"Missing required APK entry: {name}", result.stderr)

    def test_each_required_entry_must_be_nonempty(self):
        for name, content in tuple(self.entries.items()):
            with self.subTest(entry=name):
                self.entries[name] = b""
                result = self.verify()
                self.entries[name] = content
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(f"Empty required APK entry: {name}", result.stderr)

    def test_each_native_program_must_be_elf(self):
        for name in (ARM64, X86_64):
            with self.subTest(entry=name):
                content = self.entries[name]
                self.entries[name] = b"not an ELF program"
                result = self.verify()
                self.entries[name] = content
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)

    def test_native_architectures_must_match_their_directories(self):
        self.entries[ARM64], self.entries[X86_64] = self.entries[X86_64], self.entries[ARM64]
        result = self.verify()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Wrong ELF type or architecture", result.stderr)

    def test_kernel_loader_interpreter_is_rejected(self):
        for name, result in self.verify_native(
            lambda machine: elf(machine, interpreter="/lib64/ld-linux-x86-64.so.2")
        ):
            self.assertNotEqual(result.returncode, 0, name)
            self.assertIn(f"Kernel loader dependency in {name}", result.stderr)
            self.assertIn("PT_INTERP /lib64/ld-linux-x86-64.so.2", result.stderr)

    def test_shared_library_dependency_is_rejected(self):
        for name, result in self.verify_native(
            lambda machine: elf(machine, needed=("libc.so.6", "libdl.so.2"))
        ):
            self.assertNotEqual(result.returncode, 0, name)
            self.assertIn(f"Shared library dependency in {name}", result.stderr)
            self.assertIn("libc.so.6", result.stderr)
            self.assertIn("libdl.so.2", result.stderr)

    def test_static_pie_without_libraries_passes(self):
        for name, result in self.verify_native(
            lambda machine: elf(machine, elf_type=3, dynamic=True)
        ):
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_truncated_program_header_table_is_rejected(self):
        def truncated(machine):
            raw = bytearray(elf(machine))
            struct.pack_into("<H", raw, 56, 1_000)
            return bytes(raw)

        for name, result in self.verify_native(truncated):
            self.assertNotEqual(result.returncode, 0, name)
            self.assertIn(f"Truncated ELF program header table: {name}", result.stderr)


if __name__ == "__main__":
    unittest.main()
