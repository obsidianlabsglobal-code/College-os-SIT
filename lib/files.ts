import type { PoolClient } from "pg";

export const maxFileBytes = 4 * 1024 * 1024;
export type Upload = { filename: string; mime: string; bytes: Buffer };

export async function parseUpload(entry: FormDataEntryValue | null): Promise<Upload | null> {
  // Multipart decoders can supply a filename for the browser's empty file field.
  if (!(entry instanceof File) || (entry.size === 0 && entry.type === "application/octet-stream")) return null;
  if (!entry.size || entry.size > maxFileBytes) throw new Error("Choose a file between 1 byte and 4 MiB.");
  const bytes = Buffer.from(await entry.arrayBuffer());
  const filename = entry.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 150).toWellFormed();
  if (/\.pdf$/i.test(filename) && entry.type === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-" &&
      bytes.subarray(-1024).toString().trimEnd().endsWith("%%EOF")) {
    return { filename, mime: "application/pdf", bytes };
  }
  if (/\.txt$/i.test(filename) && entry.type === "text/plain") {
    const decoded = new TextDecoder("utf-8", { fatal: true });
    try {
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded.decode(bytes))) {
        return { filename, mime: "text/plain", bytes };
      }
    } catch { /* Report the same validation error for invalid UTF-8. */ }
  }
  throw new Error("Upload a valid PDF or UTF-8 text file.");
}

export async function saveFile(client: PoolClient, institution: string, owner: { assignment?: string; submission?: string }, upload: Upload) {
  await client.query(
    "INSERT INTO attachment (institution_id,assignment_id,submission_id,filename,mime,bytes) VALUES ($1,$2,$3,$4,$5,$6)",
    [institution, owner.assignment, owner.submission, upload.filename, upload.mime, upload.bytes],
  );
}
