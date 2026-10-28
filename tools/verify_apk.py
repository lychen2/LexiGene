"""Verify an APK carries the frontend, dex, and static native services.

Both bundled Go services run as ordinary processes started by the activity, so a
Linux kernel loader reference or a shared-library dependency would make the
installed app fail at startup.
"""
import struct
import sys
import zipfile


NATIVE_MACHINES = {"arm64-v8a": 183, "x86_64": 62}
REQUIRED_ENTRIES = (
    "classes.dex",
    "assets/www/index.html",
    *(f"lib/{abi}/liblexigene.so" for abi in NATIVE_MACHINES),
)

ELF_HEADER_SIZE = 64
PROGRAM_HEADER_SIZE = 56
DYNAMIC_ENTRY_SIZE = 16
ELF_TYPE_EXEC = 2
ELF_TYPE_DYN = 3
PT_LOAD = 1
PT_DYNAMIC = 2
PT_INTERP = 3
DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5


def read_elf_header(raw, name):
    """Return (type, machine, program header offset, entry size, entry count)."""
    if len(raw) < ELF_HEADER_SIZE or raw[:6] != b"\x7fELF\x02\x01":
        raise ValueError(f"Expected a 64-bit little-endian ELF program: {name}")
    elf_type, elf_machine = struct.unpack_from("<HH", raw, 16)
    phoff = struct.unpack_from("<Q", raw, 32)[0]
    phentsize, phnum = struct.unpack_from("<HH", raw, 54)
    return elf_type, elf_machine, phoff, phentsize, phnum


def read_program_headers(raw, name, phoff, phentsize, phnum):
    """Return the ELF64 program headers that describe this executable."""
    if phnum == 0:
        return []
    if phentsize < PROGRAM_HEADER_SIZE:
        raise ValueError(f"Malformed ELF program header table: {name}")
    if phoff < ELF_HEADER_SIZE or phoff + phentsize * phnum > len(raw):
        raise ValueError(f"Truncated ELF program header table: {name}")
    headers = []
    for index in range(phnum):
        start = phoff + index * phentsize
        p_type, _, p_offset, p_vaddr, _, p_filesz, p_memsz, _ = struct.unpack_from("<IIQQQQQQ", raw, start)
        if p_filesz and p_offset + p_filesz > len(raw):
            raise ValueError(f"Truncated ELF segment: {name}")
        headers.append({
            "type": p_type,
            "offset": p_offset,
            "vaddr": p_vaddr,
            "filesz": p_filesz,
            "memsz": p_memsz,
        })
    return headers


def find_interpreter(raw, name, headers):
    """Return the ELF interpreter path, which Android cannot load for this app."""
    for header in headers:
        if header["type"] != PT_INTERP:
            continue
        start = header["offset"]
        if not header["filesz"]:
            raise ValueError(f"Empty ELF interpreter segment: {name}")
        return raw[start:start + header["filesz"]].split(b"\0", 1)[0].decode("utf-8", "replace")
    return None


def cstring(raw, start):
    """Return a NUL-terminated string at a file offset, or None if unreadable."""
    if not 0 <= start < len(raw):
        return None
    end = raw.find(b"\0", start)
    if end < 0:
        return None
    return raw[start:end].decode("utf-8", "replace")


def vaddr_to_offset(headers, vaddr):
    """Translate a virtual address to a file offset through the load segments."""
    for header in headers:
        if header["type"] != PT_LOAD:
            continue
        if header["vaddr"] <= vaddr < header["vaddr"] + header["memsz"]:
            return header["offset"] + (vaddr - header["vaddr"])
    return None


def find_shared_libraries(raw, name, headers):
    """Return the DT_NEEDED names from the dynamic section, if it has any."""
    needed = []
    strtab = None
    for header in headers:
        if header["type"] != PT_DYNAMIC:
            continue
        start = header["offset"]
        for index in range(header["filesz"] // DYNAMIC_ENTRY_SIZE):
            tag, value = struct.unpack_from("<qQ", raw, start + index * DYNAMIC_ENTRY_SIZE)
            if tag == DT_NULL:
                break
            if tag == DT_NEEDED:
                needed.append(value)
            elif tag == DT_STRTAB:
                strtab = value
    if not needed:
        return []

    names = []
    strtab_offset = vaddr_to_offset(headers, strtab) if strtab is not None else None
    for index in needed:
        resolved = cstring(raw, strtab_offset + index) if strtab_offset is not None else None
        names.append(resolved or f"DT_NEEDED[{index}]")
    return names


def verify_apk(path):
    with zipfile.ZipFile(path) as archive:
        for name in REQUIRED_ENTRIES:
            try:
                entry = archive.getinfo(name)
            except KeyError:
                raise ValueError(f"Missing required APK entry: {name}") from None
            if entry.file_size == 0:
                raise ValueError(f"Empty required APK entry: {name}")

        for abi, machine in NATIVE_MACHINES.items():
            name = f"lib/{abi}/liblexigene.so"
            with archive.open(name) as binary:
                raw = binary.read()
            elf_type, elf_machine, phoff, phentsize, phnum = read_elf_header(raw, name)
            if elf_type not in (ELF_TYPE_EXEC, ELF_TYPE_DYN) or elf_machine != machine:
                raise ValueError(f"Wrong ELF type or architecture: {name}")
            headers = read_program_headers(raw, name, phoff, phentsize, phnum)
            interpreter = find_interpreter(raw, name, headers)
            if interpreter is not None:
                raise ValueError(f"Kernel loader dependency in {name}: PT_INTERP {interpreter}")
            needed = find_shared_libraries(raw, name, headers)
            if needed:
                raise ValueError(f"Shared library dependency in {name}: {', '.join(needed)}")

        corrupt = archive.testzip()
        if corrupt is not None:
            raise ValueError(f"Corrupt APK entry: {corrupt}")

    print(f"Verified APK contents: {path}")
    for name in REQUIRED_ENTRIES:
        print(f"  {name}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 tools/verify_apk.py APK")
    try:
        verify_apk(sys.argv[1])
    except (OSError, ValueError, zipfile.BadZipFile) as failure:
        sys.exit(f"APK verification failed: {failure}")
