import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const STORED = 0;
const DEFLATED = 8;

/**
 * Reads one named entry out of a ZIP archive held in memory.
 *
 * Office and ebook formats are all ZIP containers around XML, so this is the
 * part every such extractor needs and none of them should write twice. It reads
 * exactly the one entry it is asked for rather than expanding the archive, and
 * it caps what it will inflate, so a small file that claims to expand to
 * gigabytes is refused instead of taking the process down with it.
 */
export function readZipEntry(archive: Buffer, name: string, maxBytes: number): Buffer | undefined {
  const directoryStart = locateCentralDirectory(archive);
  let cursor = directoryStart;

  while (cursor + 46 <= archive.length && archive.readUInt32LE(cursor) === CENTRAL_FILE_HEADER) {
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const entryName = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (entryName === name) {
      if (uncompressedSize > maxBytes) {
        throw new Error(`The entry ${name} expands to ${uncompressedSize} bytes and the limit is ${maxBytes}.`);
      }
      return readEntryData(archive, localOffset, method, compressedSize, maxBytes);
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return undefined;
}

function readEntryData(
  archive: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  maxBytes: number,
): Buffer {
  if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new Error('The archive entry does not start with a local file header.');
  }
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = start + compressedSize;
  if (end > archive.length) throw new Error('The archive entry runs past the end of the file.');

  const data = archive.subarray(start, end);
  if (method === STORED) return data;
  if (method === DEFLATED) return inflateRawSync(data, { maxOutputLength: maxBytes });
  throw new Error(`The archive entry uses compression method ${method}, which is not supported.`);
}

/**
 * Finds the central directory by scanning back for the end record. The record
 * carries a variable-length comment, so its position is not fixed and the only
 * way to it is a backward scan for the signature.
 */
function locateCentralDirectory(archive: Buffer): number {
  if (archive.length < END_RECORD_LENGTH) throw new Error('The file is not a readable ZIP archive.');
  const earliest = Math.max(0, archive.length - END_RECORD_LENGTH - MAX_COMMENT_LENGTH);
  for (let cursor = archive.length - END_RECORD_LENGTH; cursor >= earliest; cursor -= 1) {
    if (archive.readUInt32LE(cursor) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = archive.readUInt16LE(cursor + 20);
    if (cursor + END_RECORD_LENGTH + commentLength !== archive.length) continue;
    const offset = archive.readUInt32LE(cursor + 16);
    if (offset >= archive.length) break;
    return offset;
  }
  throw new Error('The file is not a readable ZIP archive.');
}
