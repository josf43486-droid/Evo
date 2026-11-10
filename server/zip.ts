import zlib from 'zlib';

// قراءة وكتابة ملفات ZIP بدون مكتبات خارجية

export class ZipError extends Error {}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- القراءة ----------------

export interface ZipEntry {
  name: string;
  isDir: boolean;
  isSymlink: boolean;
  method: number;
  flags: number;
  crc: number;
  compSize: number;
  size: number;
  offset: number;
}

export function readZipEntries(buf: Buffer, maxEntries = 20000): ZipEntry[] {
  if (buf.length < 22) throw new ZipError('This is not a valid ZIP file');
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('This is not a valid ZIP file');

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }
  if (total > maxEntries) throw new ZipError(`The archive has too many files (limit ${maxEntries})`);
  if (cdOffset + cdSize > buf.length) throw new ZipError('The ZIP file is corrupted');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('The ZIP file is corrupted');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const unixMode = madeBy >> 8 === 3 ? extAttr >>> 16 : 0;
    entries.push({
      name,
      isDir: name.endsWith('/') || name.endsWith('\\'),
      isSymlink: (unixMode & 0o170000) === 0o120000,
      method, flags, crc, compSize, size, offset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readEntryData(buf: Buffer, e: ZipEntry): Buffer {
  if (e.flags & 1) throw new ZipError(`"${e.name}" is password protected`);
  const o = e.offset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new ZipError('The ZIP file is corrupted');
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const raw = buf.subarray(start, start + e.compSize);
  if (raw.length !== e.compSize) throw new ZipError('The ZIP file is corrupted');

  let out: Buffer;
  if (e.method === 0) {
    out = raw;
  } else if (e.method === 8) {
    try {
      out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
    } catch {
      throw new ZipError(`Could not decompress "${e.name}"`);
    }
  } else {
    throw new ZipError(`"${e.name}" uses an unsupported compression method`);
  }
  if (out.length !== e.size || crc32(out) !== e.crc) throw new ZipError(`"${e.name}" is corrupted`);
  return out;
}

// ---------------- الكتابة (بث مباشر) ----------------

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function createZipWriter(write: (b: Buffer) => void | Promise<void>) {
  let offset = 0;
  let count = 0;
  const central: Buffer[] = [];

  const emit = async (b: Buffer) => {
    await write(b);
    offset += b.length;
  };

  const add = async (name: string, data: Buffer, mtime: Date, isDir: boolean) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(mtime);
    const crc = isDir ? 0 : crc32(data);
    let method = 0;
    let body = isDir ? Buffer.alloc(0) : data;
    if (!isDir && data.length > 64) {
      const deflated = zlib.deflateRawSync(data);
      if (deflated.length < data.length) { method = 8; body = deflated; }
    }
    const flags = 0x0800; // أسماء UTF-8

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const localOffset = offset;
    if (offset + 30 + nameBuf.length + body.length > 0xfffffff0) throw new ZipError('The backup is too large for the ZIP format');

    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(0x0314, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(flags, 8);
    rec.writeUInt16LE(method, 10);
    rec.writeUInt16LE(time, 12);
    rec.writeUInt16LE(date, 14);
    rec.writeUInt32LE(crc, 16);
    rec.writeUInt32LE(body.length, 20);
    rec.writeUInt32LE(data.length, 24);
    rec.writeUInt16LE(nameBuf.length, 28);
    rec.writeUInt32LE((((isDir ? 0o040755 : 0o100644) << 16) | (isDir ? 0x10 : 0)) >>> 0, 38);
    rec.writeUInt32LE(localOffset, 42);
    central.push(Buffer.concat([rec, nameBuf]));

    await emit(local);
    await emit(nameBuf);
    if (body.length) await emit(body);
    count++;
  };

  return {
    addFile: (name: string, data: Buffer, mtime: Date) => add(name, data, mtime, false),
    addDir: (name: string, mtime: Date) => add(name.endsWith('/') ? name : name + '/', Buffer.alloc(0), mtime, true),
    async finish() {
      if (count > 0xfffe) throw new ZipError('Too many files for a single ZIP backup');
      const cdStart = offset;
      for (const c of central) await emit(c);
      const cdSize = offset - cdStart;
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(count, 8);
      end.writeUInt16LE(count, 10);
      end.writeUInt32LE(cdSize, 12);
      end.writeUInt32LE(cdStart, 16);
      await emit(end);
    },
  };
}
